import { beforeEach, describe, expect, it, vi } from "vitest";

// The service imports config at module load; supply the env it requires before
// any import of it happens.
process.env.DATABASE_URL ??= "mysql://root:x@localhost:3306/test";
process.env.AMI_SECRET ??= "test";
process.env.ADMIN_PASSWORD ??= "test";
process.env.SESSION_SECRET ??= "test-session-secret";
process.env.BELL_TIMEZONE ??= "Asia/Kathmandu";
process.env.BELL_BUSY_GRACE_SEC ??= "60";
process.env.BELL_CATCHUP_SEC ??= "0";

import { createFakeDb, type FakeDb } from "./bells.test-support.js";
import { BellService } from "./bells.js";

const io = { emit: vi.fn() } as any;

function seedBell(db: FakeDb, overrides: Record<string, any> = {}) {
  db.bells.seed([
    {
      id: 1,
      name: "Period 1",
      timeOfDay: "07:45",
      daysOfWeek: "1,2,3,4,5",
      dateFrom: "",
      dateTo: "",
      enabled: true,
      announcementId: 10,
      beep: false,
      volume: null,
      ...overrides,
    },
  ]);
  db.announcements.seed([
    {
      id: 10,
      name: "Chime",
      filename: "chime.wav",
      music: false,
      broadcast: true,
    },
  ]);
  db.zones.seed([{ id: 1, name: "Classrooms" }]);
  db.endpoints.seed([{ id: 1, extension: "2001", isActive: true }]);
  db.zoneMembers.seed([{ id: 1, zoneId: 1, endpointId: 1 }]);
  db.bellZones.seed([{ id: 1, bellId: 1, zoneId: 1 }]);
}

function makeBroadcast(opts: { busy?: boolean } = {}) {
  const calls: any[] = [];
  return {
    calls,
    broadcastForBell: async (input: any) => {
      if (opts.busy) throw new (await import("../errors.js")).ApiError(409, "busy");
      calls.push(input);
      return { id: 100 + calls.length };
    },
  } as any;
}

function seedOccurrence(db: FakeDb, when: Date, overrides: Record<string, any> = {}) {
  db.occurrences.seed([
    {
      id: 1,
      bellId: 1,
      scheduledAt: when,
      localDate: "2026-11-23",
      localMinute: "07:45",
      status: "scheduled",
      reason: "",
      resultStatus: "",
      broadcastLogId: null,
      claimedAt: null,
      firedAt: null,
      ...overrides,
    },
  ]);
}

let fake: FakeDb;
beforeEach(() => {
  fake = createFakeDb();
  io.emit.mockClear();
});

const service = (broadcast = makeBroadcast()) =>
  new BellService(broadcast, io, fake.db as never);

describe("materialize", () => {
  it("is idempotent across repeated runs", async () => {
    seedBell(fake);
    const bells = service();
    const first = await bells.materialize(14);
    const second = await bells.materialize(14);
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
    expect(fake.occurrences.rows).toHaveLength(first);
  });

  it("records a holiday skip instead of a suspicious gap", async () => {
    seedBell(fake, { dateFrom: "", dateTo: "" });
    fake.skips.seed([
      { id: 1, date: "2026-11-25", bellId: null, reason: "holiday" },
    ]);
    await service().materialize(14);
    const row = fake.occurrences.rows.find((o) => o.localDate === "2026-11-25");
    expect(row).toMatchObject({ status: "skipped", reason: "holiday" });
  });

  it("never materializes a time that already passed today", async () => {
    // A bell created at 08:00 for 07:45 must not chime on save.
    const now = new Date();
    const pastMinute = new Date(now.getTime() - 60 * 60 * 1000)
      .toISOString()
      .slice(11, 16);
    seedBell(fake, { timeOfDay: pastMinute, daysOfWeek: "1,2,3,4,5,6,7" });
    await service().materialize(1);
    const today = new Date().toISOString().slice(0, 10);
    expect(
      fake.occurrences.rows.some(
        (o) => o.localDate === today && o.scheduledAt.getTime() < now.getTime(),
      ),
    ).toBe(false);
  });

  it("materializes a DST gap as skipped/dst, not shifted", async () => {
    // 2027-03-14 is the next US spring-forward Sunday after today, so the gap is
    // inside the forward-walking horizon without touching the global clock.
    seedBell(fake, {
      timeOfDay: "02:30",
      daysOfWeek: "7",
      dateFrom: "2027-03-14",
      dateTo: "2027-03-14",
    });
    await new BellService(makeBroadcast(), io, fake.db as never, "America/New_York")
      .materialize(400);
    expect(fake.occurrences.rows[0]).toMatchObject({
      status: "skipped",
      reason: "dst",
    });
  });
});

describe("dispatch claim", () => {
  it("fires exactly once when two schedulers tick together", async () => {
    seedBell(fake);
    seedOccurrence(fake, new Date(Date.now() - 1_000));
    const broadcast = makeBroadcast();
    const a = new BellService(broadcast, io, fake.db as never);
    const b = new BellService(broadcast, io, fake.db as never);

    await Promise.all([a.tick(), b.tick()]);

    expect(broadcast.calls).toHaveLength(1);
    expect(fake.occurrences.rows[0]).toMatchObject({
      status: "fired",
      broadcastLogId: 101,
    });
    expect(io.emit).toHaveBeenCalledWith("bell.fired", expect.anything());
  });

  it("ignores an occurrence that is not yet due", async () => {
    seedBell(fake);
    seedOccurrence(fake, new Date(Date.now() + 60_000));
    const broadcast = makeBroadcast();
    await new BellService(broadcast, io, fake.db as never).tick();
    expect(broadcast.calls).toHaveLength(0);
    expect(fake.occurrences.rows[0].status).toBe("scheduled");
  });

  it("stamps due rows skipped/paused while paused", async () => {
    seedBell(fake);
    fake.settings.seed([
      { id: 1, paused: true, pausedBy: "admin", pausedAt: new Date() },
    ]);
    seedOccurrence(fake, new Date(Date.now() - 1_000));
    const broadcast = makeBroadcast();
    await new BellService(broadcast, io, fake.db as never).tick();
    expect(broadcast.calls).toHaveLength(0);
    expect(fake.occurrences.rows[0]).toMatchObject({
      status: "skipped",
      reason: "paused",
    });
  });
});

describe("busy zones", () => {
  it("retries inside the grace window, then fails busy", async () => {
    seedBell(fake);
    const broadcast = makeBroadcast({ busy: true });
    const bells = new BellService(broadcast, io, fake.db as never);

    seedOccurrence(fake, new Date(Date.now() - 5_000));
    await bells.tick();
    expect(fake.occurrences.rows[0]).toMatchObject({
      status: "scheduled",
      claimedAt: null,
    });

    fake.occurrences.rows[0].scheduledAt = new Date(Date.now() - 120_000);
    await bells.tick();
    expect(fake.occurrences.rows[0]).toMatchObject({
      status: "failed",
      reason: "busy",
    });
  });
});

describe("restart reconciliation", () => {
  it("marks downtime occurrences missed when catch-up is off", async () => {
    seedBell(fake);
    seedOccurrence(fake, new Date(Date.now() - 300_000));
    await service().reconcileOnBoot();
    expect(fake.occurrences.rows[0]).toMatchObject({
      status: "missed",
      reason: "downtime",
    });
  });

  it("does not replay an occurrence that just fired", async () => {
    seedBell(fake);
    seedOccurrence(fake, new Date(Date.now() - 1_000), { status: "fired" });
    const broadcast = makeBroadcast();
    const bells = new BellService(broadcast, io, fake.db as never);
    await bells.reconcileOnBoot();
    await bells.tick();
    expect(broadcast.calls).toHaveLength(0);
  });

  it("fails occurrences left mid-fire by a crash", async () => {
    seedBell(fake);
    seedOccurrence(fake, new Date(Date.now() - 1_000), { status: "firing" });
    await service().reconcileOnBoot();
    expect(fake.occurrences.rows[0]).toMatchObject({
      status: "failed",
      reason: "interrupted",
    });
  });
});

describe("schedule edits and delivery results", () => {
  it("drops stale future occurrences when a bell is disabled", async () => {
    seedBell(fake);
    await service().materialize(14);
    const before = fake.occurrences.rows.length;
    await service().setEnabled(1, false);
    expect(fake.occurrences.rows.length).toBeLessThan(before);
  });

  it("copies the finalized log status onto its occurrence", async () => {
    seedBell(fake);
    seedOccurrence(fake, new Date(), { status: "fired", broadcastLogId: 101 });
    await service().onLogFinalized(101, "partial");
    expect(fake.occurrences.rows[0].resultStatus).toBe("partial");
  });

  it("skips a single occurrence and refuses to skip a fired one", async () => {
    seedBell(fake);
    seedOccurrence(fake, new Date(Date.now() + 60_000));
    const bells = service();
    await bells.skipOccurrence(1, "assembly");
    expect(fake.occurrences.rows[0]).toMatchObject({
      status: "skipped",
      reason: "assembly",
    });
    await expect(bells.skipOccurrence(1, "again")).rejects.toThrow(/scheduled/i);
  });
});
