"use client";

import type { BusinessReview, CallSummary } from "./types";
import { generateBusinessReview, generateCallSummary } from "./ai";

/* ============================================================
   Client-side AI gateway.
   Calls the server route (real Claude Sonnet 4.6) and transparently
   falls back to the local mock in lib/ai.ts when no API key is
   configured or the request fails. The UI never changes regardless
   of which path runs.
   ============================================================ */

export interface AIStatus {
  configured: boolean;
  model: string;
  effort: string;
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
  try {
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "callSummary", input, context: input.context }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.result) return data.result as CallSummary;
    }
  } catch {
    /* fall through to mock */
  }
  return generateCallSummary(input);
}

export async function requestBusinessReview(
  text: string,
  context?: { businessName?: string; services?: string },
): Promise<BusinessReview> {
  try {
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "businessReview", input: { text }, context }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.result) return data.result as BusinessReview;
    }
  } catch {
    /* fall through to mock */
  }
  return generateBusinessReview(text);
}
