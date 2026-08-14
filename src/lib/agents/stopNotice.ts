import type { AgentStopReason } from "./types";

/**
 * The one-line notice a surface shows when a turn ended for any reason other
 * than the agent finishing. Both routes have always returned `stoppedBy`
 * faithfully; nothing read it, so a capped turn was byte-indistinguishable
 * from a complete one — exactly the silent truncation the spec's error table
 * exists to eliminate ("Iteration cap hit … surfaced, partial answer kept").
 *
 * Shared by the Brain and Advisor pages so the copy cannot drift, and pure so
 * it is testable without a DOM.
 *
 * Returns null when there is nothing to say.
 */
export function stopNotice(stoppedBy?: AgentStopReason | null): string | null {
  switch (stoppedBy) {
    case "max_iterations":
      return "This answer was cut short — the agent hit its tool-call limit before finishing. " +
        'Ask a narrower question, or say "continue".';
    case "max_tokens":
      return "This answer was cut short — it hit the length limit. " +
        'Ask for a shorter answer, or say "continue".';
    default:
      return null;
  }
}
