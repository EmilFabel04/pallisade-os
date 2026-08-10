"use client";

import { Plus, X } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { Field, FormGrid, NumberInput, Select, TextInput } from "@/components/ui/Field";
import { monthlyOpex } from "@/lib/pricing/opex";
import { monthlyFloor } from "@/lib/pricing/bounds";
import { PRICED_MODELS } from "@/lib/pricing/prices";
import { useSettings } from "@/lib/store";
import { fmtCurrency, uid } from "@/lib/utils";
import type { OpexLine, Quote } from "@/lib/types";

export function OpexPanel({
  quote,
  onPatch,
}: {
  quote: Quote;
  onPatch: (p: Partial<Quote>) => void;
}) {
  const settings = useSettings();
  const opex = monthlyOpex(quote.opexLines, quote.aiUsage, settings.usdToZar);
  const floor = monthlyFloor(opex.total, settings.targetMarginPct);

  const setLine = (id: string, p: Partial<OpexLine>) =>
    onPatch({ opexLines: quote.opexLines.map((l) => (l.id === id ? { ...l, ...p } : l)) });

  const ai = quote.aiUsage;

  return (
    <Panel
      title="Running cost"
      action={
        <button
          className="btn btn-ghost"
          onClick={() =>
            onPatch({
              opexLines: [...quote.opexLines, { id: uid("opex"), label: "", monthlyCost: 0 }],
            })
          }
        >
          <Plus size={14} /> Line
        </button>
      }
    >
      <div className="flex flex-col gap-2">
        {quote.opexLines.map((l) => (
          <div key={l.id} className="flex items-center gap-2">
            <TextInput
              value={l.label}
              placeholder="Hosting"
              onChange={(e) => setLine(l.id, { label: e.target.value })}
            />
            <NumberInput
              value={l.monthlyCost}
              min={0}
              onChange={(e) => setLine(l.id, { monthlyCost: Number(e.target.value) })}
            />
            <button
              className="btn btn-ghost btn-icon"
              aria-label="Remove line"
              onClick={() =>
                onPatch({ opexLines: quote.opexLines.filter((x) => x.id !== l.id) })
              }
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      <p className="eyebrow mt-6 mb-3">AI usage</p>
      {ai ? (
        <>
          <FormGrid>
            <Field label="Model">
              <Select
                options={PRICED_MODELS}
                value={ai.model}
                onChange={(e) => onPatch({ aiUsage: { ...ai, model: e.target.value } })}
              />
            </Field>
            <Field label="Runs per day">
              <NumberInput
                value={ai.runsPerDay}
                min={0}
                onChange={(e) => onPatch({ aiUsage: { ...ai, runsPerDay: Number(e.target.value) } })}
              />
            </Field>
            <Field label="Input tokens per run">
              <NumberInput
                value={ai.inputTokensPerRun}
                min={0}
                onChange={(e) =>
                  onPatch({ aiUsage: { ...ai, inputTokensPerRun: Number(e.target.value) } })
                }
              />
            </Field>
            <Field label="Output tokens per run">
              <NumberInput
                value={ai.outputTokensPerRun}
                min={0}
                onChange={(e) =>
                  onPatch({ aiUsage: { ...ai, outputTokensPerRun: Number(e.target.value) } })
                }
              />
            </Field>
          </FormGrid>
          <button
            className="btn btn-ghost mt-3"
            onClick={() => onPatch({ aiUsage: null })}
          >
            Remove AI line
          </button>
        </>
      ) : (
        <button
          className="btn btn-ghost"
          onClick={() =>
            onPatch({
              aiUsage: {
                model: "claude-sonnet-5",
                runsPerDay: 10,
                inputTokensPerRun: 2000,
                outputTokensPerRun: 500,
                inputPriceOverride: null,
                outputPriceOverride: null,
              },
            })
          }
        >
          <Plus size={14} /> Add AI usage line
        </button>
      )}

      {opex.unpricedModel && (
        <p className="text-[0.78rem] text-[var(--color-accent)] mt-4 leading-relaxed">
          The AI line is not costed — {opex.unpricedModel} has no price, or the USD→ZAR rate
          is unset in Settings. The retainer floor below excludes it.
        </p>
      )}

      <div className="flex items-baseline justify-between mt-6 pt-4 border-t border-[var(--color-line)]">
        <span className="text-[0.8rem] text-[var(--color-muted)]">
          Monthly cash out · {fmtCurrency(Math.round(opex.total), settings.currency)}
        </span>
        <span className="text-[0.95rem] tnum text-[var(--color-ink)]">
          Retainer floor {fmtCurrency(floor, settings.currency)}
        </span>
      </div>
    </Panel>
  );
}
