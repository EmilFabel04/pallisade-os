/* ============================================================
   TypeSafe Jev client (server-only).

   One endpoint, plain fetch, no SDK: the published package name is
   ambiguous across TypeSafe's own docs and the community guides, and a
   week-old dependency is not worth the risk for a single POST.

   Dormant until TYPESAFE_API_KEY exists, in the manner of gmail/config.ts —
   every consumer checks isConfigured() first and degrades rather than fails.
   ============================================================ */

import { JevError, type JevQuestion, type JevResponse } from "./types";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MODEL = process.env.JEV_MODEL || "jev-latest";

/** Published rate: $0.042 per million input tokens. Output is free. */
export const USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;

/** Only 429 and 529 are retried; everything else is a fact about the request. */
const RETRY_STATUSES = new Set([429, 529]);
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 250;

export function isConfigured(): boolean {
  return !!process.env.TYPESAFE_API_KEY;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Evaluate one state against a set of typed questions.
 *
 * Jev answers every question in parallel against the same state, so callers
 * should batch their questions into one call rather than looping.
 */
export async function evaluate(
  state: unknown,
  questions: Record<string, JevQuestion>,
): Promise<JevResponse> {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new JevError("TYPESAFE_API_KEY is not set");

  let lastStatus = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ state, model: MODEL, questions }),
      });
    } catch (e) {
      throw new JevError(`jev request failed: ${(e as Error).message}`);
    }

    if (res.ok) {
      const body = (await res.json().catch(() => null)) as JevResponse | null;
      if (!body || typeof body !== "object" || !body.answers) {
        throw new JevError("jev response carried no answers");
      }
      return body;
    }

    lastStatus = res.status;
    if (!RETRY_STATUSES.has(res.status) || attempt === MAX_ATTEMPTS - 1) {
      const detail = await res.text().catch(() => "");
      throw new JevError(`jev ${res.status}: ${detail.slice(0, 200)}`, res.status);
    }

    await sleep(BASE_DELAY_MS * 2 ** attempt);
  }

  throw new JevError(`jev ${lastStatus}: retries exhausted`, lastStatus);
}
