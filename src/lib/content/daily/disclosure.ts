/* ============================================================
   The disclosure check — pure, no model calls.

   gate.ts asks whether a detail is TRUE. This asks whether it may be SEEN.
   They are independent, and the gap between them is the whole reason this
   file exists: a real client name traces perfectly against its source record,
   so checkSpecificity passes it. gate.ts's isCompanyAnchor only fires on
   UNTRACED names, because it was built to catch fabrication, not disclosure.

   Three categories, per the agreed boundary:
     identity  — who he deals with
     business  — anything measuring HIS business, and his commercial stage
     struggle  — difficulty that is still open rather than resolved

   A client's own operational figure ("14 hours a month") is deliberately NOT
   blocked. The gate requires every post to carry a traceable anchor, and
   banning all digits would strip it and fail almost everything.
   ============================================================ */

import { matchesIn, type Vocabulary } from "./redact";
import type { EditorialCheck } from "./types";

interface Signal {
  regex: RegExp;
  label: string;
}

/**
 * Anything that measures his business or reveals its stage. Written narrowly
 * and anchored on first-person possessives where the bare noun is ordinary:
 * "revenue" alone appears in perfectly good client-facing prose ("the revenue
 * model of the average finance team"), so only "my/our revenue" is a signal.
 */
export const BUSINESS_SIGNALS: Signal[] = [
  { regex: /\bpre[-\s]?revenue\b/i, label: "pre-revenue" },
  { regex: /\bboot ?strapp\w*\b/i, label: "bootstrapping" },
  { regex: /\brunway\b/i, label: "runway" },
  { regex: /\b(?:my|our)\s+(?:first|only)\s+(?:client|customer|deal|sale)/i, label: "first client" },
  { regex: /\b(?:my|our)\s+(?:revenue|pipeline|churn|numbers|books)\b/i, label: "own business metrics" },
  { regex: /\b(?:MRR|ARR)\b/, label: "recurring-revenue figure" },
  { regex: /\b(?:no|zero|not any)\s+(?:paying\s+)?(?:clients|customers|revenue|sales)\b/i, label: "no clients yet" },
  { regex: /\b(?:clients|customers|revenue)\s+(?:yet|so far)\b/i, label: "no clients yet" },
  { regex: /\bstill\s+(?:building|figuring|working out|trying|nothing)\b/i, label: "still building" },
  { regex: /\b(?:just|only)\s+(?:started|launched|began)\b/i, label: "just started" },
  { regex: /\b(?:have|has)\s*n[o']?t\s+(?:closed|landed|sold|made)\b/i, label: "nothing closed" },
  { regex: /\bearly days\b/i, label: "early days" },
  { regex: /\b\d+\s+(?:dials|cold calls)\b/i, label: "activity count" },
  { regex: /\b(?:dials|cold calls|proposals sent|leads created)\b/i, label: "activity count" },
  { regex: /\b(?:booked|sent|made)\s+\d+\s+(?:meetings?|calls?|proposals?)\b/i, label: "activity count" },
  { regex: /\b\d+\s+(?:meetings?|replies)\s+(?:this|last)\s+(?:week|month)\b/i, label: "activity count" },
];

/**
 * Difficulty that is still open. The agreed rule is that a lesson may be
 * published from the far side of it — problem plus fix, told as expertise —
 * so these match the unresolved framing, not the difficulty itself. "It broke
 * twice. The queue was not idempotent. That is now fixed." passes.
 */
export const STRUGGLE_SIGNALS: Signal[] = [
  { regex: /\bI'?m\s+(?:stuck|lost|struggling|drowning|terrified|scared|exhausted|overwhelmed|burnt? out)\b/i, label: "open struggle" },
  { regex: /\bI\s+am\s+(?:stuck|lost|struggling|drowning|terrified|scared|exhausted|overwhelmed)\b/i, label: "open struggle" },
  { regex: /\bI\s+(?:do\s*n[o']?t|don't)\s+know\b/i, label: "admitted uncertainty" },
  { regex: /\bno\s+idea\b/i, label: "admitted uncertainty" },
  { regex: /\bI\s*ca?n[o']?t\s+(?:figure|work out|seem to|keep up)\b/i, label: "admitted defeat" },
  { regex: /\b(?:struggling|floundering|falling behind)\b/i, label: "open struggle" },
  { regex: /\bnot\s+sure\s+(?:if|whether|how|this|it)\b/i, label: "admitted uncertainty" },
  { regex: /\bkeeps?\s+happening\b/i, label: "unresolved recurrence" },
];

function fired(body: string, signals: Signal[]): string[] {
  const hits = signals.filter((s) => s.regex.test(body)).map((s) => s.label);
  return [...new Set(hits)];
}

/**
 * `identities` and the redaction pass share one matcher (redact.ts's
 * matchesIn), so the gate can never reject a name redaction would have
 * scrubbed, nor pass one it would have caught.
 */
export function checkDisclosure(body: string, vocab: Vocabulary): EditorialCheck {
  const problems: string[] = [];

  const names = matchesIn(body, vocab);
  if (names.length > 0) {
    problems.push(
      `names people or companies from your records: ${names.slice(0, 3).map((n) => `"${n}"`).join(", ")} — ` +
        `write the same point about "a client" or the industry instead`,
    );
  }

  const business = fired(body, BUSINESS_SIGNALS);
  if (business.length > 0) {
    problems.push(
      `reveals your commercial position (${business.join(", ")}) — ` +
        `your network does not need to know the stage you are at`,
    );
  }

  const struggle = fired(body, STRUGGLE_SIGNALS);
  if (struggle.length > 0) {
    problems.push(
      `publishes unresolved difficulty (${struggle.join(", ")}) — ` +
        `a lesson is publishable only from the far side of it: the problem AND the fix`,
    );
  }

  return problems.length === 0
    ? { rule: "disclosure", passed: true, detail: "discloses nothing private" }
    : { rule: "disclosure", passed: false, detail: problems.join("; ") };
}
