"use client";

import type { BusinessReview, CallSummary } from "./types";

/* ============================================================
   Client-side AI gateway.
   Calls the server route (real Claude Sonnet 4.6, schema-constrained
   JSON output). There is no local fallback: if the model is
   unavailable, unconfigured, or returns nothing usable, the promise
   rejects with AIUnavailable and the caller must render a failure
   state. A failure must never be rendered as an answer.
   ============================================================ */

export interface AIStatus {
  configured: boolean;
  model: string;
  effort: string;
}

export class AIUnavailable extends Error {
  constructor(public code: "no_key" | "failed", message: string) { super(message); }
}

export async function aiStatus(): Promise<AIStatus | null> {
  try {
    const res = await fetch("/api/ai", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as AIStatus;
  } catch {
    return null;
  }
}

async function post<T>(kind: string, input: unknown, context?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, input, context }),
    });
  } catch (err) {
    throw new AIUnavailable("failed", (err as Error).message);
  }
  if (res.status === 503) throw new AIUnavailable("no_key", "No model configured");
  if (!res.ok) throw new AIUnavailable("failed", `Model request failed (${res.status})`);
  let data: { result?: unknown };
  try {
    data = await res.json();
  } catch (err) {
    throw new AIUnavailable("failed", `Model returned an unreadable response: ${(err as Error).message}`);
  }
  // `!data?.result` alone is NOT enough: api/ai/route.ts stamps `generatedAt`
  // onto whatever it parsed, so an empty model response arrives as a truthy
  // `{ generatedAt }` object and sails past a falsy check — then renders as
  // "✓ Generated" and crashes the modal on reopen. A real result always
  // carries more than just the timestamp, so require at least one other field.
  const result = data?.result;
  const looksReal =
    result !== null && typeof result === "object" && Object.keys(result as object).length > 1;
  if (!looksReal) throw new AIUnavailable("failed", "Model returned no result");
  return result as T;
}

export async function requestCallSummary(input: {
  rawNotes: string;
  whatTheySaid?: string;
  painPoints?: string;
  objections?: string;
  buyingSignals?: string;
  company?: string;
  contact?: string;
  context?: { businessName?: string; services?: string };
}): Promise<CallSummary> {
  return post<CallSummary>("callSummary", input, input.context);
}

export async function requestBusinessReview(
  text: string,
  context?: { businessName?: string; services?: string },
): Promise<BusinessReview> {
  return post<BusinessReview>("businessReview", { text }, context);
}
