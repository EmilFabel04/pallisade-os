import { describe, it, expect } from "vitest";
import { monthlyOpex, DAYS_PER_MONTH } from "./opex";
import { priceFor, PRICED_MODELS } from "./prices";
import type { AiUsageLine, OpexLine } from "@/lib/types";

const LINES: OpexLine[] = [
  { id: "a", label: "Hosting", monthlyCost: 400 },
  { id: "b", label: "Database", monthlyCost: 250 },
];

const AI: AiUsageLine = {
  model: "claude-sonnet-5",
  runsPerDay: 100,
  inputTokensPerRun: 2000,
  outputTokensPerRun: 500,
  inputPriceOverride: null,
  outputPriceOverride: null,
};

describe("prices", () => {
  it("prices the current models at standard, not promotional, rates", () => {
    expect(priceFor("claude-sonnet-5")).toEqual({ input: 3, output: 15 });
    expect(priceFor("claude-opus-5")).toEqual({ input: 5, output: 25 });
    expect(priceFor("claude-haiku-4-5")).toEqual({ input: 1, output: 5 });
  });

  it("returns null for a model it does not know", () => {
    expect(priceFor("gpt-hypothetical")).toBeNull();
  });

  it("exposes the model list for the usage form", () => {
    expect(PRICED_MODELS).toContain("claude-sonnet-5");
  });
});

describe("monthlyOpex", () => {
  it("sums fixed lines when there is no AI usage", () => {
    const r = monthlyOpex(LINES, null, 18);
    expect(r.fixed).toBe(650);
    expect(r.ai).toBe(0);
    expect(r.total).toBe(650);
    expect(r.breakdown).toHaveLength(2);
    expect(r.unpricedModel).toBeNull();
  });

  it("models the AI line from tokens, runs and the FX rate", () => {
    // per run: 2000/1e6*3 + 500/1e6*15 = 0.006 + 0.0075 = 0.0135 USD
    const perRunUsd = 0.0135;
    const expectedZar = 100 * DAYS_PER_MONTH * perRunUsd * 18;
    const r = monthlyOpex(LINES, AI, 18);
    expect(r.ai).toBeCloseTo(expectedZar, 6);
    expect(r.total).toBeCloseTo(650 + expectedZar, 6);
    expect(r.breakdown.at(-1)!.label).toContain("claude-sonnet-5");
  });

  it("prefers an explicit price override over the table", () => {
    const overridden: AiUsageLine = { ...AI, inputPriceOverride: 30, outputPriceOverride: 150 };
    const plain = monthlyOpex([], AI, 18);
    const custom = monthlyOpex([], overridden, 18);
    expect(custom.ai).toBeCloseTo(plain.ai * 10, 4);
  });

  it("reports an unpriced model instead of silently costing it at zero", () => {
    const r = monthlyOpex([], { ...AI, model: "gpt-hypothetical" }, 18);
    expect(r.unpricedModel).toBe("gpt-hypothetical");
    expect(r.ai).toBe(0);
  });

  it("treats usdToZar of 0 as unset and reports the AI line as unpriced", () => {
    const r = monthlyOpex(LINES, AI, 0);
    expect(r.ai).toBe(0);
    expect(r.total).toBe(650);
    expect(r.unpricedModel).toBe("claude-sonnet-5");
  });
});
