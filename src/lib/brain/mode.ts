export type BrainMode = "strategist" | "brainstorm";

/** Legacy brainThreads rows have no `mode`; treat them as strategist. */
export function threadMode(t: { mode?: BrainMode }): BrainMode {
  return t.mode === "brainstorm" ? "brainstorm" : "strategist";
}

/**
 * Which agent a persisted Brain thread belongs to.
 *
 * `mode` predates the roster and only ever had room for two buckets, so from
 * Task 15 threads carry an `agentId` as well — written alongside `mode` so a
 * rollback still reads the row. No migration exists, and none is needed: a row
 * without `agentId` resolves through the legacy branch to exactly the agent it
 * opened as before.
 */
export function threadAgentId(t: { agentId?: string; mode?: BrainMode }): string {
  return t.agentId || (threadMode(t) === "brainstorm" ? "product-brainstorm" : "strategist");
}
