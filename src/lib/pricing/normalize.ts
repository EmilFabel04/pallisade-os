/* ============================================================
   Model output → engine input.

   A forced tool call constrains the schema but not the sense of the
   values. A score of 3000, an invented band, an evidence entry with no
   URL — each becomes a wrong price if it reaches the engine, so every
   field is re-derived or discarded here.
   ============================================================ */

import type { CapexBand, CapexRead, IntentRead } from "@/lib/types";
import type { Adjudication } from "./band";

const CAPEX_BANDS: CapexBand[] = ["unknown", "micro", "small", "mid", "enterprise"];
const CONFIDENCES = ["low", "medium", "high"] as const;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function rows(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v.filter((r) => r && typeof r === "object") as Record<string, unknown>[]) : [];
}

export function normalizeIntent(raw: Record<string, unknown>, now: string): IntentRead {
  const r = raw ?? {};
  const score = clamp(Math.round(num(r.score) ?? 0), 0, 100);

  // The band is re-derived rather than trusted: it must agree with the score,
  // because the score is what the founder reads off the card.
  const band: IntentRead["band"] = score < 34 ? "cold" : score < 67 ? "warm" : "hot";

  const signals = rows(r.signals)
    .map((s) => ({ quote: str(s.quote), weight: clamp(num(s.weight) ?? 0, 0, 1) }))
    .filter((s) => s.quote.length > 0);

  const risks = Array.isArray(r.risks)
    ? r.risks.map(str).filter((s) => s.length > 0)
    : [];

  return { score, band, signals, risks, generatedAt: now };
}

export function normalizeCapex(raw: Record<string, unknown>, now: string): CapexRead {
  const r = raw ?? {};
  const rawBand = str(r.band) as CapexBand;
  const band = CAPEX_BANDS.includes(rawBand) ? rawBand : "unknown";

  const rawConfidence = str(r.confidence) as CapexRead["confidence"];
  const confidence = (CONFIDENCES as readonly string[]).includes(rawConfidence)
    ? rawConfidence
    : "low";

  // An unsourced claim about a client's balance sheet is a guess wearing a
  // citation's clothes — drop it rather than let it move the ceiling.
  const evidence = rows(r.evidence)
    .map((e) => ({ claim: str(e.claim), url: str(e.url) }))
    .filter((e) => e.url.length > 0);

  return {
    band,
    headcount: num(r.headcount),
    revenueNote: str(r.revenueNote),
    evidence,
    confidence,
    generatedAt: now,
  };
}

export function normalizeAdjudication(raw: Record<string, unknown>): Adjudication {
  const r = raw ?? {};
  const pair = (v: unknown): { target: number; stretch: number } | null => {
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    const target = num(o.target);
    const stretch = num(o.stretch);
    return target === null || stretch === null ? null : { target, stretch };
  };

  return {
    setup: pair(r.setup),
    // A zeroed monthly is safe: clampTriple lifts it to the opex floor.
    monthly: pair(r.monthly) ?? { target: 0, stretch: 0 },
    reasoning: str(r.reasoning),
  };
}
