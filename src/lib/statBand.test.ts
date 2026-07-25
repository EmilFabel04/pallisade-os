import { describe, it, expect } from "vitest";
import { bandCellBorders, BAND_COLUMNS } from "./statBand";

const TOTAL = 7;

/**
 * Replay Tailwind's min-width cascade for one cell at a given column count,
 * so we assert the rendered border state rather than the class string.
 */
function resolve(classes: string, cols: number): { r: boolean; b: boolean } {
  const tokens = classes.split(/\s+/).filter(Boolean);
  const active = (t: string) =>
    !t.includes(":") ||
    (t.startsWith("sm:") && cols >= BAND_COLUMNS.sm) ||
    (t.startsWith("lg:") && cols >= BAND_COLUMNS.lg);
  const state = { r: false, b: false };
  // Base first, then sm, then lg — later breakpoints win, as in the stylesheet.
  for (const prefix of ["", "sm:", "lg:"]) {
    for (const t of tokens) {
      if (!t.startsWith(prefix) || (prefix === "" && t.includes(":"))) continue;
      if (prefix !== "" && t.slice(prefix.length).includes(":")) continue;
      if (!active(t)) continue;
      const u = prefix === "" ? t : t.slice(prefix.length);
      if (u === "border-r") state.r = true;
      if (u === "border-r-0") state.r = false;
      if (u === "border-b") state.b = true;
      if (u === "border-b-0") state.b = false;
    }
  }
  return state;
}

function layout(cols: number) {
  const cells = Array.from({ length: TOTAL }, (_, i) => resolve(bandCellBorders(i + 1, TOTAL), cols));
  return {
    right: cells.flatMap((c, i) => (c.r ? [i + 1] : [])),
    bottom: cells.flatMap((c, i) => (c.b ? [i + 1] : [])),
  };
}

describe("bandCellBorders", () => {
  it("divides 7 cells across 2 columns without a stray edge divider", () => {
    // rows: (1,2) (3,4) (5,6) (7) — divider only between the pair, none on row ends
    expect(layout(2)).toEqual({ right: [1, 3, 5], bottom: [1, 2, 3, 4, 5, 6] });
  });

  it("divides 7 cells across 4 columns", () => {
    // rows: (1,2,3,4) (5,6,7) — no right border on 4 (row end) or 7 (last)
    expect(layout(4)).toEqual({ right: [1, 2, 3, 5, 6], bottom: [1, 2, 3, 4] });
  });

  it("divides 7 cells across a single 7-column row", () => {
    expect(layout(7)).toEqual({ right: [1, 2, 3, 4, 5, 6], bottom: [] });
  });

  it("never puts a right border on the final cell at any width", () => {
    for (const cols of [2, 4, 7]) expect(layout(cols).right).not.toContain(TOTAL);
  });

  it("never puts a bottom border on a cell in the final row", () => {
    for (const cols of [2, 4, 7]) {
      const lastRowStart = (Math.ceil(TOTAL / cols) - 1) * cols + 1;
      for (const n of layout(cols).bottom) expect(n).toBeLessThan(lastRowStart);
    }
  });
});
