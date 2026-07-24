import { describe, it, expect } from "vitest";
import { affirmationForDate, AFFIRMATIONS } from "./affirmations";

describe("affirmationForDate", () => {
  it("is deterministic for the same date", () => {
    const a = affirmationForDate(new Date(2026, 6, 24));
    const b = affirmationForDate(new Date(2026, 6, 24));
    expect(a).toBe(b);
  });

  it("rotates across consecutive days", () => {
    const day1 = affirmationForDate(new Date(2026, 6, 24));
    const day2 = affirmationForDate(new Date(2026, 6, 25));
    expect(day1).not.toBe(day2);
  });

  it("always returns a value from the list for any date across a year", () => {
    for (let i = 0; i < 400; i++) {
      const d = new Date(2026, 0, 1 + i);
      expect(AFFIRMATIONS).toContain(affirmationForDate(d));
    }
  });

  it("has no adjacent duplicate affirmations (so rotation always changes)", () => {
    for (let i = 1; i < AFFIRMATIONS.length; i++) {
      expect(AFFIRMATIONS[i]).not.toBe(AFFIRMATIONS[i - 1]);
    }
  });

  it("rotates across the DST spring-forward boundary (Mar 8 -> Mar 9 2026)", () => {
    const before = affirmationForDate(new Date(2026, 2, 8));
    const after = affirmationForDate(new Date(2026, 2, 9));
    expect(before).not.toBe(after);
  });
});
