import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Server as SocketServer } from "socket.io";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import {
  audioDurationSeconds,
  normalizeAudioTo8k,
} from "../lib/audio.js";
import {
  addLocalDays,
  formatDays,
  instantForWallClock,
  isValidLocalDate,
  isValidLocalMinute,
  localDateOf,
  localMinuteOf,
  parseDays,
  weekdayOf,
  withinTerm,
} from "../lib/bell-time.js";
import { EVENTS } from "@infinity/shared";
import type {
  Bell,
  BellInput,
  BellOccurrence,
  BellSkipView,
  BellStatusResponse,
} from "@infinity/shared";
import type { BroadcastService } from "./broadcast.js";

export interface OccurrenceQuery {
  from?: string;
  to?: string;
  status?: string;
  bellId?: number;
  limit?: number;
}

interface BellRow {
  id: number;
  name: string;
  timeOfDay: string;
  daysOfWeek: string;
  dateFrom: string;
  dateTo: string;
  enabled: boolean;
  announcementId: number | null;
  beep: boolean;
  volume: number | null;
  zones: { zoneId: number; zone: { name: string } }[];
  endpoints: { endpointId: number }[];
}

const STATUSES = [
  "scheduled",
  "firing",
  "fired",
  "skipped",
  "missed",
  "failed",
] as const;

/**
 * Owns the bell clock: CRUD, occurrence materialization, the dispatch tick,
 * pause/skip state, the ledger, and copying real AMI delivery results back onto
 * occurrences.
 *
 * Exactly-once firing rests on two independent guards:
 *  1. the unique `(bellId, localDate, localMinute)` ledger key, so materializing
 *     twice (boot, hourly, edit) cannot create a second row; and
 *  2. the atomic `updateMany({ where: { id, status: "scheduled" } })` claim, so a
 *     duplicated tick or a second API process cannot both proceed from one row.
 */
export class BellService {
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private horizonTimer: ReturnType<typeof setInterval> | null = null;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(
    private readonly broadcast: BroadcastService,
    private readonly io: SocketServer,
    /** Injectable for tests; production always uses the shared client. */
    private readonly db: typeof prisma = prisma,
    /** Site timezone; all wall-clock values are interpreted in it. */
    private readonly timezone: string = config.bell.timezone,
  ) {}

  // ---- settings / status --------------------------------------------------

  private async setting() {
    const existing = await this.db.bellSetting.findUnique({ where: { id: 1 } });
    if (existing) return existing;
    return this.db.bellSetting.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    });
  }

  async status(): Promise<BellStatusResponse> {
    const [setting, next] = await Promise.all([
      this.setting(),
      this.db.bellOccurrence.findMany({
        where: { status: "scheduled", scheduledAt: { gte: new Date() } },
        orderBy: { scheduledAt: "asc" },
        take: 5,
        include: { bell: { select: { name: true } } },
      }),
    ]);
    const now = new Date();
    return {
      enabled: config.bell.enabled,
      paused: setting.paused,
      pausedBy: setting.pausedBy,
      pausedAt: setting.pausedAt?.toISOString() ?? null,
      timezone: this.timezone,
      serverTime: now.toISOString(),
      clockDriftSec: this.clockDriftSec(now),
      next: next.map((o) => ({
        occurrenceId: o.id,
        bellId: o.bellId,
        bellName: o.bell.name,
        scheduledAt: o.scheduledAt.toISOString(),
        localDate: o.localDate,
        localMinute: o.localMinute,
      })),
    };
  }

  /**
   * Self-check of the timezone math, not a wall-clock comparison: convert now to
   * the bell zone's wall clock and back. A healthy configuration (and a correct
   * tz database) yields 0; anything else means the runtime's tz data disagrees
   * with itself and every bell time is suspect. Comparing the host's offset
   * instead would flag every correctly-configured UTC container as "drifted".
   */
  private clockDriftSec(now: Date): number {
    const date = localDateOf(now, this.timezone);
    const minute = localMinuteOf(now, this.timezone);
    const roundTrip = instantForWallClock(date, minute, this.timezone);
    if (!roundTrip) return 0;
    // The wall clock has minute granularity, so compare at that resolution.
    return Math.round(
      (roundTrip.getTime() - (now.getTime() - (now.getTime() % 60_000))) / 1000,
    );
  }

  async pause(paused: boolean, by = ""): Promise<BellStatusResponse> {
    await this.setting();
    await this.db.bellSetting.update({
      where: { id: 1 },
      data: {
        paused,
        pausedBy: paused ? by.slice(0, 120) : "",
        pausedAt: paused ? new Date() : null,
      },
    });
    if (!paused) {
      // Resume: rows stamped skipped/paused because of the pause go back to
      // scheduled. Occurrences already handled are untouched.
      const now = new Date();
      await this.db.bellOccurrence.updateMany({
        where: {
          status: "skipped",
          reason: "paused",
          scheduledAt: { gte: now },
        },
        data: { status: "scheduled", reason: "" },
      });
    }
    this.emitChanged();
    return this.status();
  }

  // ---- CRUD ---------------------------------------------------------------

  async list(): Promise<Bell[]> {
    const rows = await this.db.bell.findMany({
      orderBy: [{ timeOfDay: "asc" }, { id: "asc" }],
      include: {
        announcement: { select: { name: true } },
        zones: { include: { zone: { select: { name: true } } } },
        endpoints: true,
      },
    });
    const today = localDateOf(new Date(), this.timezone);
    // One query for every bell's next fire and one for today's statuses, instead
    // of two per row (the list is rendered on every schedule change).
    const [upcoming, todayRows] = await Promise.all([
      this.db.bellOccurrence.findMany({
        where: { status: "scheduled", scheduledAt: { gte: new Date() } },
        orderBy: { scheduledAt: "asc" },
        select: { bellId: true, scheduledAt: true },
      }),
      this.db.bellOccurrence.findMany({
        where: { localDate: today },
        select: { bellId: true, status: true },
      }),
    ]);
    const nextByBell = new Map<number, Date>();
    for (const occurrence of upcoming) {
      if (!nextByBell.has(occurrence.bellId))
        nextByBell.set(occurrence.bellId, occurrence.scheduledAt);
    }
    const todayByBell = new Map(todayRows.map((r) => [r.bellId, r.status]));

    return rows.map((row) =>
      this.serialize(
        row,
        nextByBell.get(row.id) ?? null,
        todayByBell.get(row.id) ?? null,
      ),
    );
  }

  async get(id: number): Promise<Bell> {
    const row = await this.db.bell.findUnique({
      where: { id },
      include: {
        announcement: { select: { name: true } },
        zones: { include: { zone: { select: { name: true } } } },
        endpoints: true,
      },
    });
    if (!row) throw new ApiError(404, "Bell not found");
    const today = localDateOf(new Date(), this.timezone);
    const [next, todayRow] = await Promise.all([
      this.db.bellOccurrence.findFirst({
        where: {
          bellId: id,
          status: "scheduled",
          scheduledAt: { gte: new Date() },
        },
        orderBy: { scheduledAt: "asc" },
        select: { scheduledAt: true },
      }),
      this.db.bellOccurrence.findFirst({
        where: { bellId: id, localDate: today },
        select: { status: true },
      }),
    ]);
    return this.serialize(
      row,
      next?.scheduledAt ?? null,
      todayRow?.status ?? null,
    );
  }

  private serialize(
    row: BellRow & { announcement?: { name: string } | null },
    nextAt: Date | null,
    todayStatus: string | null,
  ): Bell {
    return {
      id: row.id,
      name: row.name,
      timeOfDay: row.timeOfDay,
      daysOfWeek: parseDays(row.daysOfWeek),
      dateFrom: row.dateFrom,
      dateTo: row.dateTo,
      enabled: row.enabled,
      announcementId: row.announcementId,
      announcementName: row.announcement?.name ?? null,
      beep: row.beep,
      volume: row.volume,
      zoneIds: row.zones.map((z) => z.zoneId),
      zoneNames: row.zones.map((z) => z.zone.name),
      endpointIds: row.endpoints.map((e) => e.endpointId),
      nextAt: nextAt?.toISOString() ?? null,
      todayStatus: (todayStatus as Bell["todayStatus"]) ?? null,
    };
  }
  async create(input: BellInput): Promise<Bell> {
    const clean = await this.validate(input);
    const row = await this.db.bell.create({
      data: {
        name: clean.name,
        timeOfDay: clean.timeOfDay,
        daysOfWeek: formatDays(clean.daysOfWeek),
        dateFrom: clean.dateFrom,
        dateTo: clean.dateTo,
        enabled: clean.enabled,
        announcementId: clean.announcementId,
        beep: clean.beep,
        volume: clean.volume,
        zones: { create: clean.zoneIds.map((zoneId) => ({ zoneId })) },
        endpoints: {
          create: clean.endpointIds.map((endpointId) => ({ endpointId })),
        },
      },
    });
    await this.materializeBell(row.id);
    this.emitChanged();
    return this.get(row.id);
  }

  async update(id: number, input: BellInput): Promise<Bell> {
    const existing = await this.requireBell(id);
    const clean = await this.validate(input);

    // A schedule edit (time / days / term) invalidates future rows; a cosmetic
    // edit (name, audio, beep, volume, targets) must not wipe the ledger's
    // pending skips or lose claims. Disabling counts as a schedule change: the
    // toggle path clears future rows, and a PUT must behave the same way.
    const scheduleChanged =
      existing.timeOfDay !== clean.timeOfDay ||
      existing.daysOfWeek !== formatDays(clean.daysOfWeek) ||
      existing.dateFrom !== clean.dateFrom ||
      existing.dateTo !== clean.dateTo;
    const disabling = existing.enabled && !clean.enabled;

    await this.db.$transaction([
      this.db.bell.update({
        where: { id },
        data: {
          name: clean.name,
          timeOfDay: clean.timeOfDay,
          daysOfWeek: formatDays(clean.daysOfWeek),
          dateFrom: clean.dateFrom,
          dateTo: clean.dateTo,
          enabled: clean.enabled,
          announcementId: clean.announcementId,
          beep: clean.beep,
          volume: clean.volume,
          zones: {
            deleteMany: {},
            create: clean.zoneIds.map((zoneId) => ({ zoneId })),
          },
          endpoints: {
            deleteMany: {},
            create: clean.endpointIds.map((endpointId) => ({ endpointId })),
          },
        },
      }),
      ...(scheduleChanged || disabling
        ? [
            // A moved bell must not keep a stale ghost in the future, but an
            // operator's explicit skip for a future day is intent, not a ghost:
            // it is re-applied by materialize() from the skip ledger.
            this.db.bellOccurrence.deleteMany({
              where: {
                bellId: id,
                status: "scheduled",
                scheduledAt: { gt: new Date() },
              },
            }),
          ]
        : []),
    ]);
    await this.materializeBell(id);
    this.emitChanged();
    return this.get(id);
  }

  async setEnabled(id: number, enabled: boolean): Promise<Bell> {
    await this.requireBell(id);
    await this.db.bell.update({ where: { id }, data: { enabled } });
    if (enabled) await this.materializeBell(id);
    else
      await this.db.bellOccurrence.deleteMany({
        where: {
          bellId: id,
          status: "scheduled",
          scheduledAt: { gt: new Date() },
        },
      });
    this.emitChanged();
    return this.get(id);
  }

  async remove(id: number): Promise<void> {
    await this.db.bell.delete({ where: { id } }).catch(() => {
      throw new ApiError(404, "Bell not found");
    });
    // BroadcastLog rows stay: History is an immutable record of what was dialed.
    this.emitChanged();
  }

  private async requireBell(id: number) {
    const row = await this.db.bell.findUnique({ where: { id } });
    if (!row) throw new ApiError(404, "Bell not found");
    return row;
  }

  // ---- validation ---------------------------------------------------------

  private async validate(
    input: BellInput,
  ): Promise<Required<Omit<BellInput, "announcementId">> & { announcementId: number | null }> {
    const name = (input.name ?? "").trim();
    if (!name) throw new ApiError(422, "Name is required");
    if (name.length > 120) throw new ApiError(422, "Name is too long");

    if (!isValidLocalMinute(input.timeOfDay))
      throw new ApiError(422, "Time must be HH:MM (24-hour)");

    const days = [...new Set(input.daysOfWeek ?? [])].filter(
      (d) => Number.isInteger(d) && d >= 1 && d <= 7,
    );
    if (days.length === 0)
      throw new ApiError(422, "Select at least one weekday");

    const dateFrom = input.dateFrom ?? "";
    const dateTo = input.dateTo ?? "";
    if ((dateFrom && !isValidLocalDate(dateFrom)) || (dateTo && !isValidLocalDate(dateTo)))
      throw new ApiError(422, "Dates must be YYYY-MM-DD");
    if (dateFrom && dateTo && dateFrom > dateTo)
      throw new ApiError(422, "End date must be on or after the start date");

    const volume = input.volume ?? null;
    if (volume != null && (!Number.isInteger(volume) || volume < 0 || volume > 100))
      throw new ApiError(422, "Volume must be 0-100");

    const zoneIds = [...new Set(input.zoneIds ?? [])];
    const endpointIds = [...new Set(input.endpointIds ?? [])];
    if (zoneIds.length === 0 && endpointIds.length === 0)
      throw new ApiError(422, "Select at least one zone or endpoint");

    if (zoneIds.length) {
      const found = await this.db.zone.findMany({
        where: { id: { in: zoneIds } },
        select: { id: true },
      });
      if (found.length !== zoneIds.length)
        throw new ApiError(422, "One or more zones no longer exist");
    }
    if (endpointIds.length) {
      const found = await this.db.endpoint.findMany({
        where: { id: { in: endpointIds } },
        select: { id: true },
      });
      if (found.length !== endpointIds.length)
        throw new ApiError(422, "One or more endpoints no longer exist");
    }

    const announcementId = input.announcementId ?? null;
    if (announcementId != null) {
      const a = await this.db.announcement.findUnique({
        where: { id: announcementId },
      });
      if (!a) throw new ApiError(422, "Announcement not found");
      if (!(a.broadcast ?? !a.music))
        throw new ApiError(422, "That media is not available for broadcast");
      if (a.duration != null && a.duration > 120)
        // Loud warning at save time, not a hard rejection: some schools ring a
        // 2-minute tone deliberately. The zone busy check stops overlap.
        console.warn(
          `[bell] "${name}" audio is ${Math.round(a.duration)}s (>120s)`,
        );
    }

    return {
      name,
      timeOfDay: input.timeOfDay,
      daysOfWeek: days,
      dateFrom,
      dateTo,
      enabled: input.enabled ?? true,
      announcementId,
      beep: input.beep ?? false,
      volume,
      zoneIds,
      endpointIds,
    };
  }

  // ---- materialization ----------------------------------------------------

  /**
   * Upsert every enabled bell's occurrences over the configured horizon.
   * Idempotent: the unique ledger key means a re-run creates nothing new and
   * never touches a claimed/fired row.
   */
  async materialize(horizonDays = config.bell.horizonDays): Promise<number> {
    const bells = await this.db.bell.findMany({
      where: { enabled: true },
      select: { id: true },
    });
    let created = 0;
    for (const bell of bells) created += await this.materializeBell(bell.id, horizonDays);
    return created;
  }

  private async materializeBell(
    bellId: number,
    horizonDays = config.bell.horizonDays,
  ): Promise<number> {
    const bell = await this.db.bell.findUnique({
      where: { id: bellId },
      include: { skips: true },
    });
    if (!bell || !bell.enabled) return 0;

    const tz = this.timezone;
    const now = new Date();
    const startDate = localDateOf(now, tz);
    const endDate = addLocalDays(startDate, horizonDays);
    const days = parseDays(bell.daysOfWeek);
    if (days.length === 0) return 0;

    const existing = await this.db.bellOccurrence.findMany({
      where: { bellId, localDate: { gte: startDate, lte: endDate } },
      select: { localDate: true, localMinute: true },
    });
    const have = new Set(existing.map((e) => `${e.localDate}|${e.localMinute}`));

    // Bell-wide skips (bellId null) cover every bell on a holiday; a bell's own
    // skips override the label. Bell rows are loaded above via `include`.
    const globalSkips = await this.db.bellSkip.findMany({
      where: { bellId: null, date: { gte: startDate, lte: endDate } },
      select: { date: true, reason: true },
    });
    const skipByDate = new Map<string, string>();
    for (const skip of globalSkips)
      skipByDate.set(skip.date, skip.reason || "holiday");
    for (const skip of bell.skips) skipByDate.set(skip.date, skip.reason || "skip");
    const daySet = new Set(days);
    const rows: {
      bellId: number;
      scheduledAt: Date;
      localDate: string;
      localMinute: string;
      status: string;
      reason: string;
    }[] = [];

    for (
      let date = startDate;
      date <= endDate;
      date = addLocalDays(date, 1)
    ) {
      if (!withinTerm(date, bell.dateFrom, bell.dateTo)) continue;
      if (!daySet.has(weekdayOf(date))) continue;
      const key = `${date}|${bell.timeOfDay}`;
      if (have.has(key)) continue;

      const instant = instantForWallClock(date, bell.timeOfDay, tz);
      if (instant === null) {
        // Spring-forward gap: record it as skipped/"dst" so the ledger explains
        // the silence instead of showing a suspicious hole.
        rows.push({
          bellId,
          scheduledAt: new Date(`${date}T00:00:00.000Z`),
          localDate: date,
          localMinute: bell.timeOfDay,
          status: "skipped",
          reason: "dst",
        });
        continue;
      }
      // Never materialize an instant that is already in the past. A bell saved at
      // 08:00 for 07:45 must not chime the moment it is created, and moving a
      // bell earlier in the day must not fire it retroactively. The catch-up rule
      // for rows that *already existed* is reconcileOnBoot's job.
      if (instant.getTime() < now.getTime()) continue;
      const skipReason = skipByDate.get(date);
      rows.push({
        bellId,
        scheduledAt: instant,
        localDate: date,
        localMinute: bell.timeOfDay,
        status: skipReason !== undefined ? "skipped" : "scheduled",
        reason: skipReason !== undefined ? skipReason || "skip" : "",
      });
    }

    if (rows.length === 0) return 0;
    const result = await this.db.bellOccurrence.createMany({
      data: rows,
      skipDuplicates: true,
    });
    return result.count;
  }

  // ---- dispatch -----------------------------------------------------------

  start(): void {
    if (!config.bell.enabled) {
      console.log("[bell] disabled (BELL_ENABLED=false)");
      return;
    }
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => {
      void this.tick().catch((e) =>
        console.warn("[bell] tick failed:", (e as Error).message),
      );
    }, config.bell.tickMs);
    // Rematerialize hourly so a long-running process keeps a full horizon even
    // if edits were made from a second tab or through the API directly.
    this.horizonTimer = setInterval(() => {
      void this.materialize().catch((e) =>
        console.warn("[bell] rematerialize failed:", (e as Error).message),
      );
    }, 60 * 60 * 1000);
    this.pruneTimer = setInterval(() => {
      void this.prune().catch((e) =>
        console.warn("[bell] prune failed:", (e as Error).message),
      );
    }, 24 * 60 * 60 * 1000);
    console.log(
      `[bell] scheduler started (tz=${this.timezone}, tick=${config.bell.tickMs}ms, horizon=${config.bell.horizonDays}d)`,
    );
  }

  stop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.horizonTimer) clearInterval(this.horizonTimer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.tickTimer = this.horizonTimer = this.pruneTimer = null;
  }

  /**
   * Boot reconciliation. Rows left `firing` by a crash are ambiguous (the AMI
   * originate may or may not have run); rows that came due while the API was
   * down are only replayed when BELL_CATCHUP_SEC allows it.
   */
  async reconcileOnBoot(): Promise<void> {
    if (!config.bell.enabled) return;
    const now = Date.now();

    const interrupted = await this.db.bellOccurrence.updateMany({
      where: { status: "firing" },
      data: { status: "failed", reason: "interrupted" },
    });
    if (interrupted.count > 0)
      console.warn(`[bell] ${interrupted.count} interrupted occurrence(s) marked failed`);

    const stale = await this.db.bellOccurrence.findMany({
      where: { status: "scheduled", scheduledAt: { lte: new Date(now) } },
      select: { id: true, scheduledAt: true },
    });
    const graceMs = config.bell.catchupSec * 1000;
    const missedIds = stale
      .filter((o) => now - o.scheduledAt.getTime() > graceMs)
      .map((o) => o.id);
    if (missedIds.length > 0) {
      await this.db.bellOccurrence.updateMany({
        where: { id: { in: missedIds } },
        data: { status: "missed", reason: "downtime" },
      });
      console.log(
        `[bell] ${missedIds.length} due occurrence(s) marked missed (catch-up ${config.bell.catchupSec}s)`,
      );
    }
  }

  async tick(): Promise<void> {
    if (!config.bell.enabled || this.ticking) return;
    this.ticking = true;
    try {
      const setting = await this.setting();
      const now = new Date();
      const due = await this.db.bellOccurrence.findMany({
        where: { status: "scheduled", scheduledAt: { lte: now } },
        orderBy: { scheduledAt: "asc" },
        take: 50,
      });
      if (due.length === 0) return;

      if (setting.paused) {
        const ids = due.map((o) => o.id);
        await this.db.bellOccurrence.updateMany({
          where: { id: { in: ids }, status: "scheduled" },
          data: { status: "skipped", reason: "paused" },
        });
        this.emitChanged();
        return;
      }

      let changed = false;
      for (const occurrence of due) {
        const fired = await this.fireOccurrence(occurrence.id);
        changed = changed || fired;
      }
      if (changed) this.emitChanged();
    } finally {
      this.ticking = false;
    }
  }

  private async fireOccurrence(occurrenceId: number): Promise<boolean> {
    // The atomic claim: only a claim count of 1 may proceed to broadcast.
    const claim = await this.db.bellOccurrence.updateMany({
      where: { id: occurrenceId, status: "scheduled" },
      data: { status: "firing", claimedAt: new Date() },
    });
    if (claim.count !== 1) return false;

    const occurrence = await this.db.bellOccurrence.findUnique({
      where: { id: occurrenceId },
      include: {
        bell: {
          include: {
            zones: { select: { zoneId: true } },
            endpoints: { select: { endpointId: true } },
          },
        },
      },
    });
    if (!occurrence) return false;

    const bell = occurrence.bell;
    if (!bell.enabled) {
      await this.finish(occurrenceId, "skipped", "disabled");
      return true;
    }
    if (bell.announcementId == null) {
      await this.finish(occurrenceId, "failed", "no-audio");
      return true;
    }

    try {
      const { id: logId } = await this.broadcast.broadcastForBell({
        bellName: bell.name,
        announcementId: bell.announcementId,
        zoneIds: bell.zones.map((z) => z.zoneId),
        endpointIds: bell.endpoints.map((e) => e.endpointId),
        beep: bell.beep,
        volume: bell.volume,
      });
      await this.db.bellOccurrence.update({
        where: { id: occurrenceId },
        data: {
          status: "fired",
          reason: "",
          broadcastLogId: logId,
          firedAt: new Date(),
        },
      });
      this.io.emit(EVENTS.bellFired, {
        occurrenceId,
        bellId: bell.id,
        bellName: bell.name,
        broadcastLogId: logId,
        localDate: occurrence.localDate,
        localMinute: occurrence.localMinute,
        scheduledAt: occurrence.scheduledAt.toISOString(),
      });
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const elapsed = Date.now() - occurrence.scheduledAt.getTime();
        if (elapsed <= config.bell.busyGraceSec * 1000) {
          // Still inside the grace window: hand the row back for the next tick.
          await this.db.bellOccurrence.updateMany({
            where: { id: occurrenceId, status: "firing" },
            data: { status: "scheduled", claimedAt: null },
          });
        } else {
          await this.finish(occurrenceId, "failed", "busy");
        }
        return true;
      }
      await this.finish(occurrenceId, "failed", (e as Error).message.slice(0, 200));
      return true;
    }
  }

  private async finish(
    occurrenceId: number,
    status: (typeof STATUSES)[number],
    reason: string,
  ): Promise<void> {
    await this.db.bellOccurrence.update({
      where: { id: occurrenceId },
      data: { status, reason },
    });
  }

  // ---- fire-now (test) ----------------------------------------------------

  /**
   * Fire a bell immediately to its current targets. Deliberately does not create
   * a ledger row: a test is an operator action, not a scheduled occurrence.
   */
  async test(
    id: number,
    overrides: {
      announcementId?: number;
      zoneIds?: number[];
      endpointIds?: number[];
      beep?: boolean;
      volume?: number | null;
    } = {},
  ): Promise<{ id: number }> {
    const bell = await this.db.bell.findUnique({
      where: { id },
      include: { zones: true, endpoints: true },
    });
    if (!bell) throw new ApiError(404, "Bell not found");

    const announcementId = overrides.announcementId ?? bell.announcementId;
    if (announcementId == null)
      throw new ApiError(422, "Choose an announcement before testing");

    return this.broadcast.broadcastForBell({
      bellName: `${bell.name || "Bell"} (test)`,
      announcementId,
      zoneIds: overrides.zoneIds ?? bell.zones.map((z) => z.zoneId),
      endpointIds:
        overrides.endpointIds ?? bell.endpoints.map((e) => e.endpointId),
      beep: overrides.beep ?? bell.beep,
      volume: overrides.volume ?? bell.volume,
      source: "manual",
    });
  }

  /**
   * Fire an unsaved bell's form values (the dialog's "Test" before Save).
   * Records nothing in the ledger — the same contract as `test`.
   */
  async unsavedTest(input: {
    announcementId: number;
    zoneIds: number[];
    endpointIds: number[];
    beep: boolean;
    volume: number | null;
  }): Promise<{ id: number }> {
    if (input.zoneIds.length === 0 && input.endpointIds.length === 0)
      throw new ApiError(422, "Select at least one zone or endpoint");
    return this.broadcast.broadcastForBell({
      bellName: "Bell (test)",
      announcementId: input.announcementId,
      zoneIds: input.zoneIds,
      endpointIds: input.endpointIds,
      beep: input.beep,
      volume: input.volume,
      source: "manual",
    });
  }

  // ---- ledger / skips -----------------------------------------------------
  async occurrences(query: OccurrenceQuery): Promise<BellOccurrence[]> {
    const rows = await this.db.bellOccurrence.findMany({
      where: {
        ...(query.bellId ? { bellId: query.bellId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.from || query.to
          ? {
              localDate: {
                ...(query.from ? { gte: query.from } : {}),
                ...(query.to ? { lte: query.to } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
      take: query.limit ?? 200,
      include: { bell: { select: { name: true } } },
    });
    return rows.map((o) => ({
      id: o.id,
      bellId: o.bellId,
      bellName: o.bell.name,
      scheduledAt: o.scheduledAt.toISOString(),
      localDate: o.localDate,
      localMinute: o.localMinute,
      status: o.status as BellOccurrence["status"],
      reason: o.reason,
      resultStatus: o.resultStatus,
      broadcastLogId: o.broadcastLogId,
      firedAt: o.firedAt?.toISOString() ?? null,
    }));
  }

  async skipOccurrence(id: number, reason: string): Promise<void> {
    const row = await this.db.bellOccurrence.findUnique({ where: { id } });
    if (!row) throw new ApiError(404, "Occurrence not found");
    if (row.status !== "scheduled")
      throw new ApiError(
        409,
        `Only a scheduled occurrence can be skipped (current: ${row.status})`,
      );
    await this.db.bellOccurrence.update({
      where: { id },
      data: { status: "skipped", reason: reason || "manual" },
    });
    this.emitChanged();
  }

  async listSkips(): Promise<BellSkipView[]> {
    const rows = await this.db.bellSkip.findMany({
      orderBy: { date: "asc" },
      include: { bell: { select: { name: true } } },
    });
    return rows.map((s) => ({
      id: s.id,
      date: s.date,
      bellId: s.bellId,
      bellName: s.bell?.name ?? null,
      reason: s.reason,
    }));
  }

  async addSkip(input: {
    date: string;
    bellId?: number | null;
    reason?: string;
  }): Promise<BellSkipView> {
    if (!isValidLocalDate(input.date))
      throw new ApiError(422, "Date must be YYYY-MM-DD");
    const bellId = input.bellId ?? null;
    if (bellId != null) await this.requireBell(bellId);

    // MySQL treats NULLs as distinct in a unique index, so a bell-wide skip
    // (bellId = null) cannot use the composite-key upsert: find it explicitly.
    const existing =
      bellId == null
        ? await this.db.bellSkip.findFirst({
            where: { date: input.date, bellId: null },
          })
        : await this.db.bellSkip.findUnique({
            where: { date_bellId: { date: input.date, bellId } },
          });
    const skip = existing
      ? await this.db.bellSkip.update({
          where: { id: existing.id },
          data: { reason: input.reason ?? "" },
        })
      : await this.db.bellSkip.create({
          data: { date: input.date, bellId, reason: input.reason ?? "" },
        });

    // Materialized rows for that date flip to skipped so the ledger explains
    // the silence, labelled with the operator's reason when one was given.
    // Already-claimed rows are never touched.
    const reason = (input.reason ?? "").trim();
    await this.db.bellOccurrence.updateMany({
      where: {
        localDate: input.date,
        status: "scheduled",
        ...(bellId != null ? { bellId } : {}),
      },
      data: {
        status: "skipped",
        reason: reason || (bellId != null ? "skip" : "holiday"),
      },
    });
    this.emitChanged();
    const bell = skip.bellId
      ? await this.db.bell.findUnique({ where: { id: skip.bellId } })
      : null;
    return {
      id: skip.id,
      date: skip.date,
      bellId: skip.bellId,
      bellName: bell?.name ?? null,
      reason: skip.reason,
    };
  }

  async removeSkip(id: number): Promise<void> {
    const skip = await this.db.bellSkip.findUnique({ where: { id } });
    if (!skip) throw new ApiError(404, "Skip not found");
    await this.db.bellSkip.delete({ where: { id } });
    // Re-open that day's rows that were skipped *because of a skip ledger entry*.
    // A per-occurrence manual skip or a DST gap is unrelated and stays skipped.
    await this.db.bellOccurrence.updateMany({
      where: {
        localDate: skip.date,
        status: "skipped",
        reason: { notIn: ["manual", "dst", "paused"] },
        ...(skip.bellId != null ? { bellId: skip.bellId } : {}),
      },
      data: { status: "scheduled", reason: "" },
    });
    this.emitChanged();
  }

  // ---- delivery result ----------------------------------------------------

  /** Copy the log's terminal status onto the occurrence that produced it. */
  async onLogFinalized(logId: number, status: string): Promise<void> {
    await this.db.bellOccurrence
      .updateMany({
        where: { broadcastLogId: logId },
        data: { resultStatus: status },
      })
      .catch(() => undefined);
  }

  // ---- maintenance --------------------------------------------------------

  async prune(): Promise<number> {
    const cutoff = new Date(
      Date.now() - config.bell.retentionDays * 24 * 60 * 60 * 1000,
    );
    const result = await this.db.bellOccurrence.deleteMany({
      where: { scheduledAt: { lt: cutoff }, status: { not: "scheduled" } },
    });
    return result.count;
  }

  /**
   * Seed three short chime clips through the same normalizer as announcements so
   * the feature works before anyone uploads audio (mirrors seedPaMedia).
   */
  async seedChimes(): Promise<void> {
    // Synthesized so a fresh install has a working chime before anyone uploads
    // audio. Notes are a rising triad (A5/C#6/E6) with a short decay, which reads
    // as a chime rather than a test tone.
    const chimes = [
      { name: "Bell chime", file: "bell-chime", notes: "880,1109,1319", ring: 0.9 },
      { name: "Bell double", file: "bell-double", notes: "988,988", ring: 0.55 },
      { name: "Bell long", file: "bell-long", notes: "784,784,784", ring: 1.6 },
    ] as const;

    for (const chime of chimes) {
      const already = await this.db.announcement.findFirst({
        where: { name: chime.name, flash: false },
      });
      if (already) continue;

      const id = randomUUID();
      const tmp = path.join(config.announcementsDir, `.${id}-src.wav`);
      const canonical = `${chime.file}-${id}.wav`;
      const canonicalPath = path.join(config.announcementsDir, canonical);
      try {
        await fs.mkdir(config.announcementsDir, { recursive: true });
        await this.renderChime(chime.notes, chime.ring, tmp);
        await normalizeAudioTo8k(tmp, canonicalPath);
      } catch (e) {
        console.warn(
          `[bell] chime seed skipped (${chime.name}): ${(e as Error).message}`,
        );
        continue;
      } finally {
        await fs.unlink(tmp).catch(() => undefined);
      }

      const fileSize = (await fs.stat(canonicalPath)).size;
      const duration = await audioDurationSeconds(canonicalPath);
      await this.db.announcement.create({
        data: {
          name: chime.name,
          filename: canonical,
          originalName: `${chime.file}.wav`,
          originalFile: "",
          fileSize,
          duration,
          music: false,
          broadcast: true,
        },
      });
      console.log(`[bell] seeded chime "${chime.name}"`);
    }
  }

  /**
   * Render a chime from a CSV of note frequencies: one sine burst per note with a
   * fast attack and exponential decay, concatenated with small gaps so the
   * result sounds struck rather than continuous.
   */
  private renderChime(notes: string, ringSec: number, out: string): Promise<void> {
    const frequencies = notes
      .split(",")
      .map((n) => Number(n.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (frequencies.length === 0)
      return Promise.reject(new Error("no notes to render"));

    const noteSec = 0.42;
    const totalNotes = noteSec * frequencies.length;
    const inputs = frequencies.flatMap((freq) => [
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${freq}:duration=${noteSec}:sample_rate=44100`,
    ]);
    // One [n] input per note; each is enveloped then concatenated in order.
    const chains = frequencies
      .map(
        (_, index) =>
          `[${index}]afade=t=in:d=0.005,afade=t=out:st=${(noteSec - 0.18).toFixed(2)}:d=0.18,volume=0.55[n${index}]`,
      )
      .join(";");
    const labels = frequencies.map((_, i) => `[n${i}]`).join("");
    // Only pad when the requested ring outlasts the notes; otherwise the chime is
    // simply the notes back to back (padding a negative duration fails ffmpeg).
    const pad = Math.max(0, ringSec - totalNotes);
    const tail = pad > 0 ? `,apad=pad_dur=${pad.toFixed(2)}` : "";
    const duration = Math.max(ringSec, totalNotes).toFixed(2);
    const filterComplex = `${chains};${labels}concat=n=${frequencies.length}:v=0:a=1${tail},atrim=0:${duration}[out]`;

    return new Promise((resolve, reject) => {
      execFile(
        "ffmpeg",
        [
          ...inputs,
          "-filter_complex",
          filterComplex,
          "-map",
          "[out]",
          "-y",
          out,
        ],
        { maxBuffer: 16 * 1024 * 1024 },
        (err, _stdout, stderr) => {
          if (err) {
            reject(
              new Error(
                `ffmpeg chime failed: ${String(stderr ?? err.message)
                  .split("\n")
                  .filter(Boolean)
                  .slice(-2)
                  .join(" | ")}`,
              ),
            );
            return;
          }
          resolve();
        },
      );
    });
  }
  private emitChanged(): void {
    this.io.emit(EVENTS.bellsChanged);
  }
}
