import { describe, expect, it } from "vitest";
import {
  bellCreateSchema,
  bellOccurrenceQuerySchema,
  bellPauseSchema,
  bellSkipCreateSchema,
  bellTestSchema,
} from "./schemas.js";

const valid = {
  name: "Period 3",
  timeOfDay: "07:45",
  daysOfWeek: [1, 2, 3, 4, 5],
  zoneIds: [1],
  endpointIds: [],
};

describe("bellCreateSchema", () => {
  it("accepts a minimal valid bell and applies defaults", () => {
    const parsed = bellCreateSchema.parse(valid);
    expect(parsed).toMatchObject({
      name: "Period 3",
      timeOfDay: "07:45",
      daysOfWeek: [1, 2, 3, 4, 5],
      dateFrom: "",
      dateTo: "",
      enabled: true,
      beep: false,
      volume: null,
      zoneIds: [1],
      endpointIds: [],
    });
  });

  it("rejects a non HH:MM time", () => {
    for (const timeOfDay of ["7:45", "24:00", "07:60", "0745", ""]) {
      expect(bellCreateSchema.safeParse({ ...valid, timeOfDay }).success).toBe(false);
    }
  });

  it("rejects an empty or out-of-range weekday mask", () => {
    expect(bellCreateSchema.safeParse({ ...valid, daysOfWeek: [] }).success).toBe(false);
    expect(bellCreateSchema.safeParse({ ...valid, daysOfWeek: [0] }).success).toBe(false);
    expect(bellCreateSchema.safeParse({ ...valid, daysOfWeek: [8] }).success).toBe(false);
  });

  it("rejects a backwards date range", () => {
    const result = bellCreateSchema.safeParse({
      ...valid,
      dateFrom: "2026-04-30",
      dateTo: "2026-04-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a bell with no targets at all", () => {
    const result = bellCreateSchema.safeParse({
      ...valid,
      zoneIds: [],
      endpointIds: [],
    });
    expect(result.success).toBe(false);
  });

  it("accepts endpoints alone as targets", () => {
    expect(
      bellCreateSchema.safeParse({ ...valid, zoneIds: [], endpointIds: [7] }).success,
    ).toBe(true);
  });

  it("rejects volume outside 0-100", () => {
    expect(bellCreateSchema.safeParse({ ...valid, volume: 101 }).success).toBe(false);
    expect(bellCreateSchema.safeParse({ ...valid, volume: -1 }).success).toBe(false);
    expect(bellCreateSchema.safeParse({ ...valid, volume: null }).success).toBe(true);
    expect(bellCreateSchema.safeParse({ ...valid, volume: 0 }).success).toBe(true);
  });
});

describe("other bell schemas", () => {
  it("requires a real date on a skip", () => {
    expect(bellSkipCreateSchema.safeParse({ date: "2026-12-25" }).success).toBe(true);
    expect(bellSkipCreateSchema.safeParse({ date: "25-12-2026" }).success).toBe(false);
    expect(bellSkipCreateSchema.safeParse({ date: "" }).success).toBe(false);
  });

  it("requires a boolean pause flag", () => {
    expect(bellPauseSchema.safeParse({ paused: true }).success).toBe(true);
    expect(bellPauseSchema.safeParse({ paused: "yes" }).success).toBe(false);
  });

  it("caps the ledger limit and allows filters", () => {
    const parsed = bellOccurrenceQuerySchema.parse({
      from: "2026-11-01",
      to: "2026-11-30",
      status: "fired",
      limit: "25",
    });
    expect(parsed.limit).toBe(25);
    // A huge limit is clamped by validation rather than handed to Prisma.
    expect(bellOccurrenceQuerySchema.safeParse({ limit: 10_000 }).success).toBe(false);
  });

  it("lets a test call override the saved audio and targets", () => {
    expect(bellTestSchema.parse({}).announcementId).toBeUndefined();
    expect(
      bellTestSchema.parse({ announcementId: 3, zoneIds: [1], beep: true }),
    ).toMatchObject({ announcementId: 3, zoneIds: [1], beep: true });
  });
});
