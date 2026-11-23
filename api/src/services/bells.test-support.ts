/**
 * In-memory stand-in for the slice of Prisma the bell scheduler touches.
 *
 * The decisions worth testing (claim-once under a duplicated tick, pause,
 * busy retry, restart catch-up) must not require a live MySQL. `updateMany`
 * mutates synchronously before its promise resolves, mirroring a single atomic
 * UPDATE statement — which is exactly the property the claim relies on.
 */
export type Row = Record<string, any>;

const time = (v: unknown): number =>
  v instanceof Date ? v.getTime() : typeof v === "number" ? v : 0;

function matches(row: Row, where: any = {}): boolean {
  return Object.entries(where ?? {}).every(([key, cond]) => {
    if (key === "AND") return (cond as any[]).every((c) => matches(row, c));
    if (key === "OR") return (cond as any[]).some((c) => matches(row, c));
    if (key === "NOT") return !matches(row, cond);
    const value = row[key];
    if (cond === null) return value === null || value === undefined;
    if (cond instanceof Date)
      return value instanceof Date && value.getTime() === cond.getTime();
    if (typeof cond === "object") {
      const c = cond as Row;
      if ("in" in c) return (c.in as unknown[]).includes(value);
      if ("notIn" in c) return !(c.notIn as unknown[]).includes(value);
      if ("lte" in c) return time(value) <= time(c.lte);
      if ("gte" in c) return time(value) >= time(c.gte);
      if ("lt" in c) return time(value) < time(c.lt);
      if ("gt" in c) return time(value) > time(c.gt);
      if ("not" in c) return value !== c.not;
      return false;
    }
    return value === cond;
  });
}

function applyOrdering(rows: Row[], orderBy: any): Row[] {
  const specs = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
  if (specs.length === 0) return rows;
  const sorted = [...rows];
  for (const spec of [...specs].reverse()) {
    const [key, dir] = Object.entries(spec as Row)[0];
    sorted.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      const cmp =
        av instanceof Date
          ? time(av) - time(bv)
          : typeof av === "number"
            ? av - (bv as number)
            : String(av).localeCompare(String(bv));
      return dir === "desc" ? -cmp : cmp;
    });
  }
  return sorted;
}

export class Table {
  rows: Row[] = [];
  private nextId = 1;

  seed(rows: Row[]): Row[] {
    for (const r of rows) {
      const row = { id: r.id ?? this.nextId++, ...r };
      if (row.id >= this.nextId) this.nextId = row.id + 1;
      this.rows.push(row);
    }
    return this.rows;
  }

  private materialise(data: Row): Row {
    return { id: this.nextId++, ...data };
  }

  async create({ data }: { data: Row }): Promise<Row> {
    const row = this.materialise(data);
    this.rows.push(row);
    return { ...row };
  }

  async createMany({
    data,
    skipDuplicates,
  }: {
    data: Row[];
    skipDuplicates?: boolean;
  }): Promise<{ count: number }> {
    let count = 0;
    for (const item of data) {
      if (
        skipDuplicates &&
        this.rows.some(
          (r) =>
            r.bellId === item.bellId &&
            r.localDate === item.localDate &&
            r.localMinute === item.localMinute,
        )
      )
        continue;
      this.rows.push(this.materialise(item));
      count += 1;
    }
    return { count };
  }

  async findMany(args: { where?: any; orderBy?: any; take?: number } = {}) {
    let rows = this.rows.filter((r) => matches(r, args.where));
    if (args.orderBy) rows = applyOrdering(rows, args.orderBy);
    if (args.take) rows = rows.slice(0, args.take);
    return rows.map((r) => ({ ...r }));
  }

  async findFirst(args: { where?: any; orderBy?: any } = {}) {
    const rows = await this.findMany(args);
    return rows[0] ?? null;
  }

  async findUnique({ where }: { where: any }) {
    const row = this.rows.find((r) => matches(r, where));
    return row ? { ...row } : null;
  }

  async update({ where, data }: { where: any; data: Row }) {
    const row = this.rows.find((r) => matches(r, where));
    if (!row) throw new Error("Record not found");
    Object.assign(row, data);
    return { ...row };
  }

  /** Atomic UPDATE ... WHERE (mutates before resolving). */
  async updateMany({ where, data }: { where?: any; data: Row }) {
    const affected = this.rows.filter((r) => matches(r, where));
    for (const row of affected) Object.assign(row, data);
    return { count: affected.length };
  }

  async upsert({
    where,
    create,
    update,
  }: {
    where: any;
    create: Row;
    update: Row;
  }) {
    const row = this.rows.find((r) => matches(r, where));
    if (row) {
      Object.assign(row, update);
      return { ...row };
    }
    const created = this.materialise(create);
    this.rows.push(created);
    return { ...created };
  }

  async delete({ where }: { where: any }) {
    const index = this.rows.findIndex((r) => matches(r, where));
    if (index < 0) throw new Error("Record not found");
    const [row] = this.rows.splice(index, 1);
    return { ...row };
  }

  async deleteMany({ where }: { where?: any } = {}) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !matches(r, where));
    return { count: before - this.rows.length };
  }
}

export function createFakeDb() {
  const bells = new Table();
  const occurrences = new Table();
  const skips = new Table();
  const settings = new Table();
  const announcements = new Table();
  const zones = new Table();
  const endpoints = new Table();
  const zoneMembers = new Table();
  const bellZones = new Table();
  const bellEndpoints = new Table();

  const decorateBell = (row: Row) => ({
    ...row,
    announcement:
      row.announcementId != null
        ? (announcements.rows.find((a) => a.id === row.announcementId) ?? null)
        : null,
    zones: bellZones.rows
      .filter((z) => z.bellId === row.id)
      .map((z) => ({
        zoneId: z.zoneId,
        zone: { name: zones.rows.find((x) => x.id === z.zoneId)?.name ?? "" },
      })),
    endpoints: bellEndpoints.rows
      .filter((e) => e.bellId === row.id)
      .map((e) => ({ endpointId: e.endpointId })),
    skips: skips.rows.filter((s) => s.bellId === row.id),
  });

  const decorateOccurrence = (row: Row, include?: any) => {
    if (!include?.bell) return { ...row };
    const bell = bells.rows.find((b) => b.id === row.bellId);
    return { ...row, bell: bell ? decorateBell(bell) : null };
  };

  const db = {
    bellSetting: {
      findUnique: (args: any) => settings.findUnique(args),
      upsert: (args: any) => settings.upsert(args),
      update: (args: any) => settings.update(args),
    },
    bell: {
      findMany: async (args: any = {}) =>
        (await bells.findMany({ where: args.where, take: args.take })).map(
          decorateBell,
        ),
      findUnique: async ({ where }: any) => {
        const row = await bells.findUnique({ where });
        return row ? decorateBell(row) : null;
      },
      create: async ({ data }: any) => {
        const { zones: zoneLinks, endpoints: endpointLinks, ...rest } = data;
        const row = await bells.create({ data: rest });
        for (const z of zoneLinks?.create ?? [])
          await bellZones.create({ data: { bellId: row.id, zoneId: z.zoneId } });
        for (const e of endpointLinks?.create ?? [])
          await bellEndpoints.create({
            data: { bellId: row.id, endpointId: e.endpointId },
          });
        return row;
      },
      update: async ({ where, data }: any) => {
        const { zones: zoneLinks, endpoints: endpointLinks, ...rest } = data;
        const row = await bells.update({ where, data: rest });
        if (zoneLinks) {
          bellZones.rows = bellZones.rows.filter((z) => z.bellId !== row.id);
          for (const z of zoneLinks.create ?? [])
            await bellZones.create({
              data: { bellId: row.id, zoneId: z.zoneId },
            });
        }
        if (endpointLinks) {
          bellEndpoints.rows = bellEndpoints.rows.filter(
            (e) => e.bellId !== row.id,
          );
          for (const e of endpointLinks.create ?? [])
            await bellEndpoints.create({
              data: { bellId: row.id, endpointId: e.endpointId },
            });
        }
        return row;
      },
      delete: async ({ where }: any) => {
        const row = await bells.delete({ where });
        bells.rows = bells.rows;
        return row;
      },
    },
    bellOccurrence: {
      findMany: async (args: any = {}) =>
        (await occurrences.findMany(args)).map((r) =>
          decorateOccurrence(r, args.include),
        ),
      findFirst: async (args: any = {}) => {
        const row = await occurrences.findFirst(args);
        return row ? decorateOccurrence(row, args.include) : null;
      },
      findUnique: async (args: any = {}) => {
        const row = await occurrences.findUnique({ where: args.where });
        return row ? decorateOccurrence(row, args.include) : null;
      },
      create: (args: any) => occurrences.create(args),
      createMany: (args: any) => occurrences.createMany(args),
      update: (args: any) => occurrences.update(args),
      updateMany: (args: any) => occurrences.updateMany(args),
      deleteMany: (args: any) => occurrences.deleteMany(args),
    },
    bellSkip: {
      findMany: (args: any = {}) => skips.findMany(args),
      findFirst: (args: any = {}) => skips.findFirst(args),
      findUnique: (args: any = {}) => skips.findUnique({ where: args.where }),
      create: (args: any) => skips.create(args),
      update: (args: any) => skips.update(args),
      delete: (args: any) => skips.delete(args),
      deleteMany: (args: any) => skips.deleteMany(args),
    },
    announcement: {
      findUnique: ({ where }: any) => announcements.findUnique({ where }),
      findFirst: ({ where }: any = {}) => announcements.findFirst({ where }),
    },
    zone: {
      findMany: ({ where }: any = {}) => zones.findMany({ where }),
      findUnique: ({ where }: any) => zones.findUnique({ where }),
    },
    endpoint: {
      findMany: ({ where }: any = {}) => endpoints.findMany({ where }),
    },
    zoneMember: {
      findMany: ({ where }: any = {}) => zoneMembers.findMany({ where }),
    },
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  };

  return {
    db,
    bells,
    occurrences,
    skips,
    settings,
    announcements,
    zones,
    endpoints,
    zoneMembers,
    bellZones,
    bellEndpoints,
  };
}

export type FakeDb = ReturnType<typeof createFakeDb>;
