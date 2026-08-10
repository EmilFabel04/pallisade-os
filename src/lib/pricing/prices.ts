/* ============================================================
   Claude model prices, USD per 1,000,000 tokens.

   STANDARD rates only — never promotional ones. Sonnet 5 carries an
   introductory $2/$10 through 2026-08-31; a retainer priced against a
   discount that expires is exactly the error this table prevents.

   An AiUsageLine may override either price, so a stale table can
   always be corrected per-quote without a deploy.
   ============================================================ */

export interface ModelPrice {
  input: number;
  output: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

export const PRICED_MODELS: string[] = Object.keys(MODEL_PRICES);

export function priceFor(model: string): ModelPrice | null {
  return MODEL_PRICES[model] ?? null;
}
