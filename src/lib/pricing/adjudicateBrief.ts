import type {
  BuildStatus, CapexRead, IntentRead, MatchedComparable,
} from "@/lib/types";
import type { Anchor } from "./anchor";
import type { Bounds } from "./bounds";

export interface AdjudicateRequest {
  company: string;
  bounds: Bounds;
  anchor: Anchor | null;
  matched: MatchedComparable[];
  intent: IntentRead | null;
  capex: CapexRead | null;
  buildStatus: BuildStatus;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** `{ floor, ceiling }` read defensively — a malformed request body must
    degrade to null, never throw. */
function range(v: unknown): { floor: number; ceiling: number } | null {
  if (!isObj(v)) return null;
  const floor = num(v.floor);
  const ceiling = num(v.ceiling);
  return floor === null || ceiling === null ? null : { floor, ceiling };
}

/** The route casts an unchecked request body to `AdjudicateRequest`, so every
    field — and the request itself — is read defensively here: `null`,
    `undefined`, a wrong-typed value, or a non-array where an array is
    expected all degrade to a safe default instead of throwing past the
    route's error handling. See Task 11's `capexQuery` for the precedent. */
export function adjudicateBrief(req: AdjudicateRequest): string {
  const r = isObj(req) ? req : ({} as AdjudicateRequest);
  const parts: string[] = [`Client: ${str(r.company) || "unknown"}`];

  const boundsRaw = isObj(r.bounds) ? r.bounds : {};
  const setupRange = range((boundsRaw as Record<string, unknown>).setup);
  const monthlyRange = range((boundsRaw as Record<string, unknown>).monthly) ?? {
    floor: 0,
    ceiling: 0,
  };
  const anchor = isObj(r.anchor) ? (r.anchor as Anchor) : null;

  if (setupRange && anchor) {
    parts.push(
      `Setup range: ${setupRange.floor} to ${setupRange.ceiling}. ` +
        `Comparable anchor: low ${num(anchor.low) ?? 0}, mid ${num(anchor.mid) ?? 0}, high ${num(anchor.high) ?? 0}.`,
    );
  } else {
    parts.push("Setup: no setup range — too few comparables to anchor one. Return setup as null.");
  }

  parts.push(`Monthly range: ${monthlyRange.floor} to ${monthlyRange.ceiling}. ` +
    `The floor is running cost plus the founder's target margin and is not negotiable.`);

  if (r.buildStatus === "license as-is") {
    parts.push(
      "This solution is already built, so the setup fee recovers no build cost — the whole range is margin. " +
        "That does not make it worth less to the client; price it on value, not on effort saved.",
    );
  } else if (r.buildStatus === "adapt existing") {
    parts.push("This adapts an existing solution rather than starting from scratch.");
  }

  const matched = arr(r.matched).filter(isObj) as unknown as MatchedComparable[];
  if (matched.length) {
    parts.push(
      "Matched comparables:\n" +
        matched
          .map((m) => `- ${str(m.label)} (${str(m.source)}, similarity ${(num(m.similarity) ?? 0).toFixed(2)})`)
          .join("\n"),
    );
  }

  const intent = isObj(r.intent) ? (r.intent as IntentRead) : null;
  parts.push(
    intent
      ? `Buying intent: ${num(intent.score) ?? 0}/100 (${str(intent.band) || "unknown"}).\nSignals:\n` +
          arr(intent.signals)
            .filter(isObj)
            .map((s) => `- "${str((s as Record<string, unknown>).quote)}"`)
            .join("\n") +
          (arr(intent.risks).length
            ? `\nRisks:\n${arr(intent.risks).map((rk) => `- ${str(rk)}`).join("\n")}`
            : "")
      : "No intent read available — do not assume enthusiasm you have no evidence for.",
  );

  const capex = isObj(r.capex) ? (r.capex as CapexRead) : null;
  parts.push(
    capex
      ? `Capex band: ${str(capex.band) || "unknown"} (confidence ${str(capex.confidence) || "unknown"}).` +
          (num(capex.headcount) !== null ? ` Headcount ~${num(capex.headcount)}.` : "") +
          (str(capex.revenueNote) ? ` ${str(capex.revenueNote)}.` : "")
      : "No capex read available — the ceiling has not been adjusted for capacity.",
  );

  return parts.join("\n\n");
}
