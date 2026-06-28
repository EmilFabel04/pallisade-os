export type BrainMode = "strategist" | "brainstorm";

/** Legacy brainThreads rows have no `mode`; treat them as strategist. */
export function threadMode(t: { mode?: BrainMode }): BrainMode {
  return t.mode === "brainstorm" ? "brainstorm" : "strategist";
}
