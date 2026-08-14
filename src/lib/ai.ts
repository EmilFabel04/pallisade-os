/* ============================================================
   Mock AI layer.
   These functions take raw text and return structured output.
   They are intentionally self-contained and side-effect free so
   each can be swapped for a real OpenAI/Claude call later by
   replacing the body (keep the signature). See README notes.

   To wire a real model:
     1. Add a server route /api/ai that calls the provider.
     2. Replace the body of each function with `await fetch(...)`.
     3. Keep the return shapes identical — the UI depends on them.
   ============================================================ */

import type { BusinessReview, CallSummary } from "./types";
import { nowISO } from "./utils";

/** Simulated latency so the UI's loading state is exercised. */
export const AI_LATENCY_MS = 850;

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
}

function bulletsFrom(text: string): string[] {
  return text
    .split(/[\n;•·\-]+/)
    .map((s) => s.trim().replace(/^[-–•]\s*/, ""))
    .filter((s) => s.length > 2);
}

function pick(lines: string[], keywords: string[]): string[] {
  const lower = keywords.map((k) => k.toLowerCase());
  return lines.filter((l) => lower.some((k) => l.toLowerCase().includes(k)));
}

function firstNonEmpty(...vals: string[]): string {
  return vals.find((v) => v && v.trim().length > 0) ?? "";
}

/* ---------------- Call summary ---------------- */

export function generateCallSummary(input: {
  rawNotes: string;
  whatTheySaid?: string;
  painPoints?: string;
  objections?: string;
  buyingSignals?: string;
  company?: string;
  contact?: string;
}): CallSummary {
  const corpus = [
    input.rawNotes,
    input.whatTheySaid,
    input.painPoints,
    input.objections,
    input.buyingSignals,
  ]
    .filter(Boolean)
    .join(". ");
  const lines = sentences(corpus);

  const painKeywords = ["pain", "struggle", "manual", "slow", "waste", "hours", "spreadsheet", "error", "bottleneck", "time", "cost", "hard", "difficult", "no system", "messy"];
  const objectionKeywords = ["budget", "expensive", "cost", "not sure", "later", "think about", "already", "no time", "priority", "risk", "concern", "team", "internal"];
  const signalKeywords = ["interested", "love", "great", "send", "proposal", "demo", "when can", "how much", "next step", "book", "call", "follow up", "timeline", "start", "keen"];

  const keyPainPoints = dedupe([
    ...bulletsFrom(input.painPoints ?? ""),
    ...pick(lines, painKeywords),
  ]).slice(0, 5);

  const objections = dedupe([
    ...bulletsFrom(input.objections ?? ""),
    ...pick(lines, objectionKeywords),
  ]).slice(0, 4);

  const buyingSignals = dedupe([
    ...bulletsFrom(input.buyingSignals ?? ""),
    ...pick(lines, signalKeywords),
  ]).slice(0, 4);

  const who = firstNonEmpty(input.contact ?? "", "the prospect");
  const co = firstNonEmpty(input.company ?? "", "their company");

  const cleanSummary = buildSummaryParagraph(who, co, lines, keyPainPoints, buyingSignals);

  const topPain = keyPainPoints[0] ?? "the operational friction they described";
  const suggestedFollowUpMessage =
    `Hi ${who.split(" ")[0] || "there"}, great speaking earlier — thanks for walking me through how ${co} currently handles things. ` +
    `Based on what you shared about ${shorten(topPain)}, I'll put together a short outline of how we'd approach it. ` +
    `Are you open to a 20-minute follow-up next week to look at it together?`;

  const suggestedNextStep =
    buyingSignals.length > 0
      ? "Send a tailored one-pager and propose a specific follow-up slot within 5 business days."
      : objections.length > 0
        ? "Address the raised objection directly, then re-confirm interest before proposing next steps."
        : "Send a value-led recap email and ask one qualifying question to keep momentum.";

  const offerAngle = buildOfferAngle(keyPainPoints);

  return {
    cleanSummary,
    keyPainPoints: keyPainPoints.length ? keyPainPoints : ["No explicit pain points captured — probe deeper next time."],
    objections: objections.length ? objections : ["None raised."],
    buyingSignals: buyingSignals.length ? buyingSignals : ["None obvious — qualify intent."],
    suggestedFollowUpMessage,
    suggestedNextStep,
    offerAngle,
    generatedAt: nowISO(),
  };
}

function buildSummaryParagraph(
  who: string,
  co: string,
  lines: string[],
  pains: string[],
  signals: string[],
): string {
  const opener = `${who} at ${co} ${signals.length ? "showed genuine interest" : "shared their current situation"} during the conversation.`;
  const painBit = pains.length
    ? ` The core friction centres on ${shorten(pains[0])}${pains[1] ? ` and ${shorten(pains[1])}` : ""}.`
    : " No single dominant pain emerged, so the next touch should dig into where time and money currently leak.";
  const closeBit = signals.length
    ? ` There's a clear opening to advance the conversation toward a scoped next step.`
    : ` Intent is still soft — the goal now is to qualify and create urgency.`;
  return opener + painBit + closeBit;
}

function buildOfferAngle(pains: string[]): string {
  if (pains.length === 0)
    return "Lead with a discovery-style audit to surface a quantifiable problem before pitching a build.";
  const p = pains[0].toLowerCase();
  if (/manual|spreadsheet|copy|paste|re-?key/.test(p))
    return "Position a workflow-automation build that removes the manual handling and gives back hours per week.";
  if (/report|dashboard|visib|data/.test(p))
    return "Position a bespoke reporting dashboard that turns their scattered data into one decision-ready view.";
  if (/lead|sales|outreach|pipeline/.test(p))
    return "Position an AI-assisted outreach/CRM system that keeps the pipeline warm without extra headcount.";
  return "Frame a small fixed-scope pilot that solves the headline pain first, then expands into a retained build.";
}

/* ---------------- Business review ---------------- */

export function generateBusinessReview(rawUpdate: string): BusinessReview {
  const lines = sentences(rawUpdate);
  const bullets = bulletsFrom(rawUpdate);
  const all = dedupe([...bullets, ...lines]);

  const forwardKw = ["closed", "booked", "sent", "signed", "demo", "won", "proposal", "meeting", "shipped", "built", "launched", "replied", "interested"];
  const wasteKw = ["distract", "scroll", "waste", "stuck", "rabbit hole", "too long", "meeting that", "admin", "again", "procrastinat", "unfocused"];
  const riskKw = ["risk", "behind", "late", "blocked", "no reply", "quiet", "ghost", "cash", "pipeline thin", "burnout", "tired", "overwhelm"];
  const followKw = ["follow up", "follow-up", "chase", "reply to", "send", "email back", "call back", "circle back", "waiting on"];
  const oppKw = ["interested", "warm", "keen", "wants", "asked", "referral", "introduced", "opportunity", "potential", "big"];

  const movedForward = pick(all, forwardKw).slice(0, 5);
  const wastedTime = pick(all, wasteKw).slice(0, 4);
  const risks = pick(all, riskKw).slice(0, 4);
  const followUps = pick(all, followKw).slice(0, 5);
  const bestOpportunities = pick(all, oppKw).slice(0, 4);

  const whatHappened = all.slice(0, 6);

  const topPriorities = dedupe([
    ...followUps,
    ...bestOpportunities,
    ...movedForward,
  ])
    .slice(0, 3)
    .map((s) => `Action: ${capitalize(shorten(s, 90))}`);

  while (topPriorities.length < 3) {
    const fallbacks = [
      "Action: Book 3 new discovery conversations from warm pipeline.",
      "Action: Advance the highest-value open project by one concrete milestone.",
      "Action: Clear all overdue follow-ups before starting anything new.",
    ];
    topPriorities.push(fallbacks[topPriorities.length]);
  }

  const outreachFocus = bestOpportunities.length
    ? `Double down on the warm signals: prioritise ${shorten(bestOpportunities[0], 70)}. Front-load outreach before deep work.`
    : "Rebuild top-of-funnel: target 30 quality touches across cold call, LinkedIn and email before noon.";

  const buildFocus = movedForward.length
    ? `Protect a focused build block to push ${shorten(movedForward[0], 70)} closer to demo-ready.`
    : "Protect one 2-hour deep-work block on the highest-leverage deliverable; ship something demonstrable.";

  return {
    whatHappened: ensure(whatHappened, "A normal working day — log more detail next time for sharper analysis."),
    movedForward: ensure(movedForward, "Nothing clearly advanced the business — tighten focus tomorrow."),
    wastedTime: ensure(wastedTime, "No obvious time sinks flagged."),
    bestOpportunities: ensure(bestOpportunities, "No standout opportunities surfaced — generate more conversations."),
    risks: ensure(risks, "No acute risks detected."),
    followUps: ensure(followUps, "No explicit follow-ups captured — review the pipeline manually."),
    topPriorities,
    outreachFocus,
    buildFocus,
    generatedAt: nowISO(),
  };
}

/* ---------------- helpers ---------------- */

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    const key = s.toLowerCase().slice(0, 60);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}

function ensure(arr: string[], fallback: string): string[] {
  return arr.length ? arr : [fallback];
}

function shorten(s: string, max = 80): string {
  const t = s.trim().replace(/[.;]+$/, "");
  return t.length > max ? t.slice(0, max - 1).trim() + "…" : t;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
