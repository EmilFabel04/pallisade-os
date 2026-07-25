/**
 * Divider geometry for the dashboard stat band.
 *
 * Dividers are per-cell borders rather than `divide-x`, which draws a stray
 * line at a wrap boundary. Which cells need a border depends on the column
 * count, and the column count changes per breakpoint — so the classes are
 * derived here (and unit-tested) instead of hand-counted in `nth-child`
 * variants that no test in this repo can exercise.
 */
export const BAND_COLUMNS = { base: 2, sm: 4, lg: 7 } as const;

/** A cell divides from a right-hand neighbour unless it ends a row or is last. */
function hasRight(n: number, total: number, cols: number): boolean {
  return n !== total && n % cols !== 0;
}

/** A cell divides from the row below unless it already sits in the final row. */
function hasBottom(n: number, total: number, cols: number): boolean {
  return Math.ceil(n / cols) < Math.ceil(total / cols);
}

/** Tailwind border classes for cell `n` (1-based) of a `total`-cell band. */
export function bandCellBorders(n: number, total: number): string {
  const at = (cols: number) => ({ r: hasRight(n, total, cols), b: hasBottom(n, total, cols) });
  const base = at(BAND_COLUMNS.base);
  const sm = at(BAND_COLUMNS.sm);
  const lg = at(BAND_COLUMNS.lg);

  const out: string[] = [];
  if (base.r) out.push("border-r");
  if (base.b) out.push("border-b");
  if (sm.r !== base.r) out.push(sm.r ? "sm:border-r" : "sm:border-r-0");
  if (sm.b !== base.b) out.push(sm.b ? "sm:border-b" : "sm:border-b-0");
  if (lg.r !== sm.r) out.push(lg.r ? "lg:border-r" : "lg:border-r-0");
  if (lg.b !== sm.b) out.push(lg.b ? "lg:border-b" : "lg:border-b-0");
  return out.join(" ");
}
