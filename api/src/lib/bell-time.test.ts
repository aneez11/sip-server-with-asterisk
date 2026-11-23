import { describe, expect, it } from "vitest";
import {
  addLocalDays,
  formatDays,
  instantForWallClock,
  isValidLocalDate,
  isValidLocalMinute,
  localDateOf,
  localMinuteOf,
  nextOccurrences,
  parseDays,
  weekdayOf,
  withinTerm,
} from "./bell-time.js";

const NEPAL = "Asia/Kathmandu";
const NEW_YORK = "America/New_York";

describe("timestamps vs wall clock", () => {
  it("converts a Nepal wall clock to the exact UTC instant (+05:45)", () => {
    const at = instantForWallClock("2026-11-23", "07:45", NEPAL);
    expect(at?.toISOString()).toBe("2026-11-23T02:00:00.000Z");
  });

  it("round-trips local date and minute in Nepal", () => {
    const at = new Date("2026-11-23T02:00:00.000Z");
    expect(localDateOf(at, NEPAL)).toBe("2026-11-23");
    expect(localMinuteOf(at, NEPAL)).toBe("07:45");
  });

  it("crosses a local midnight when the UTC day differs", () => {
    const at = new Date("2026-11-23T19:00:00.000Z"); // 00:45 Nov 24 in Nepal
    expect(localDateOf(at, NEPAL)).toBe("2026-11-24");
    expect(localMinuteOf(at, NEPAL)).toBe("00:45");
  });
});

describe("DST policy", () => {
  it("returns null for a non-existent spring-forward time", () => {
    // 2026-03-08: 02:00 EST jumps to 03:00 EDT.
    expect(instantForWallClock("2026-03-08", "02:30", NEW_YORK)).toBeNull();
  });

  it("still resolves the hours either side of the gap", () => {
    expect(instantForWallClock("2026-03-08", "01:30", NEW_YORK)?.toISOString()).toBe(
      "2026-03-08T06:30:00.000Z",
    );
    expect(instantForWallClock("2026-03-08", "03:30", NEW_YORK)?.toISOString()).toBe(
      "2026-03-08T07:30:00.000Z",
    );
  });

  it("uses the first instant for an ambiguous fall-back time", () => {
    // 2026-11-01: 01:30 occurs at 05:30Z (EDT) and 06:30Z (EST).
    expect(instantForWallClock("2026-11-01", "01:30", NEW_YORK)?.toISOString()).toBe(
      "2026-11-01T05:30:00.000Z",
    );
  });

  it("has no DST in Nepal", () => {
    expect(instantForWallClock("2026-03-08", "02:30", NEPAL)?.toISOString()).toBe(
      "2026-03-07T20:45:00.000Z",
    );
  });
});

describe("validation and calendar helpers", () => {
  it("validates local dates and minutes strictly", () => {
    expect(isValidLocalDate("2026-02-28")).toBe(true);
    expect(isValidLocalDate("2026-02-30")).toBe(false);
    expect(isValidLocalDate("2026-2-8")).toBe(false);
    expect(isValidLocalMinute("07:45")).toBe(true);
    expect(isValidLocalMinute("24:00")).toBe(false);
    expect(isValidLocalMinute("7:45")).toBe(false);
  });

  it("parses and normalizes weekday masks", () => {
    expect(parseDays("5,1,3,1,9,0")).toEqual([1, 3, 5]);
    expect(parseDays("")).toEqual([]);
    expect(formatDays([5, 1, 1, 3])).toBe("1,3,5");
  });

  it("computes ISO weekdays and day offsets", () => {
    expect(weekdayOf("2026-11-22")).toBe(7); // Sunday
    expect(weekdayOf("2026-11-23")).toBe(1); // Monday
    expect(addLocalDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addLocalDays("2026-12-01", -1)).toBe("2026-11-30");
  });

  it("honours an inclusive term window", () => {
    expect(withinTerm("2026-04-01", "", "")).toBe(true);
    expect(withinTerm("2026-04-01", "2026-04-01", "2026-04-30")).toBe(true);
    expect(withinTerm("2026-03-31", "2026-04-01", "2026-04-30")).toBe(false);
    expect(withinTerm("2026-05-01", "2026-04-01", "2026-04-30")).toBe(false);
  });
});

describe("nextOccurrences", () => {
  const bell = {
    timeOfDay: "07:45",
    daysOfWeek: "1,2,3,4,5",
    dateFrom: "",
    dateTo: "",
  };

  it("produces one occurrence per selected weekday", () => {
    const from = new Date("2026-11-22T12:00:00.000Z"); // Sunday
    const next = nextOccurrences(bell, NEPAL, 14, from);
    expect(next).toHaveLength(14);
    for (const occ of next) {
      expect([1, 2, 3, 4, 5]).toContain(weekdayOf(occ.localDate));
      expect(occ.localMinute).toBe("07:45");
      expect(occ.scheduledAt).not.toBeNull();
    }
    expect(next[0].localDate).toBe("2026-11-23");
    expect(next[13].localDate).toBe("2026-12-10");
  });

  it("never returns an instant at or before `from` on the same day", () => {
    const from = new Date("2026-11-23T02:05:00.000Z"); // 07:50 local, past 07:45
    const next = nextOccurrences(bell, NEPAL, 1, from);
    expect(next[0].localDate).toBe("2026-11-24");
  });

  it("includes today when the bell is still ahead", () => {
    const from = new Date("2026-11-23T01:00:00.000Z"); // 06:45 local
    const next = nextOccurrences(bell, NEPAL, 1, from);
    expect(next[0].localDate).toBe("2026-11-23");
  });

  it("respects the term window and weekday mask together", () => {
    const next = nextOccurrences(
      { ...bell, dateFrom: "2026-11-24", dateTo: "2026-11-27" },
      NEPAL,
      10,
      new Date("2026-11-22T12:00:00.000Z"),
    );
    expect(next.map((o) => o.localDate)).toEqual([
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
      "2026-11-27",
    ]);
  });

  it("reports a spring-forward gap as a null instant, not a shifted one", () => {
    const next = nextOccurrences(
      {
        timeOfDay: "02:30",
        daysOfWeek: "7",
        dateFrom: "2026-03-08",
        dateTo: "2026-03-08",
      },
      NEW_YORK,
      1,
      new Date("2026-03-01T00:00:00.000Z"),
    );
    expect(next).toHaveLength(1);
    expect(next[0].scheduledAt).toBeNull();
  });

  it("returns nothing when no weekday is selected", () => {
    expect(
      nextOccurrences({ ...bell, daysOfWeek: "" }, NEPAL, 5, new Date()),
    ).toEqual([]);
  });
});
