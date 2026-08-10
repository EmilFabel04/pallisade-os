"use client";

import { useState } from "react";
import { Calculator } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { Field, NumberInput, Select } from "@/components/ui/Field";
import { preparePricing, buildBand } from "@/lib/pricing/band";
import { adjudicateRequestFrom } from "@/lib/pricing/recompute";
import { fetchAdjudication } from "@/lib/pricingClient";
import { useComparables, useQuotes, useSettings } from "@/lib/store";
import { fmtCurrency, nowISO } from "@/lib/utils";
import { LOST_REASONS, type Lead, type LostReason, type PriceTriple, type Quote } from "@/lib/types";

const DEGRADE_COPY: Record<string, string> = {
  "no-anchor": "Too few comparable solutions to anchor a setup fee — add some in the library.",
  "no-intent": "No buying-intent read, so the target is not adjusted for how badly they want it.",
  "no-capex": "No capex read, so the ceiling is not adjusted for what they can afford.",
  "no-adjudication": "Priced without an adjudication — the target sits at the comparable midpoint.",
  "no-fx-rate": "USD comparables were excluded: set the USD→ZAR rate in Settings.",
  "unpriced-ai-model": "The AI usage line is uncosted, so the retainer floor may be too low.",
};

function TripleRow({ label, triple, currency }: { label: string; triple: PriceTriple | null; currency: "ZAR" | "USD" }) {
  if (!triple) {
    return (
      <tr className="border-t border-[var(--color-line)]">
        <td className="py-3 text-[var(--color-muted)]">{label}</td>
        <td colSpan={3} className="py-3 text-[var(--color-dim)] text-[0.83rem]">
          No range — not enough comparables.
        </td>
      </tr>
    );
  }
  return (
    <tr className="border-t border-[var(--color-line)]">
      <td className="py-3 text-[var(--color-muted)]">{label}</td>
      <td className="py-3 text-right tnum">{fmtCurrency(triple.floor, currency)}</td>
      <td className="py-3 text-right tnum text-[var(--color-accent)] text-[1.05rem]">
        {fmtCurrency(triple.target, currency)}
      </td>
      <td className="py-3 text-right tnum">{fmtCurrency(triple.stretch, currency)}</td>
    </tr>
  );
}

export function PricePanel({
  quote,
  lead,
  onPatch,
}: {
  quote: Quote;
  lead: Lead | null;
  onPatch: (p: Partial<Quote>) => void;
}) {
  const settings = useSettings();
  const comparables = useComparables();
  const quotes = useQuotes();
  const [busy, setBusy] = useState(false);

  async function recompute() {
    // Guard re-entry here too, not only via the button's `disabled` — React
    // applies `disabled` after the state commit, so a fast double-click can
    // otherwise slip a second adjudication call through before the first
    // `setBusy(true)` has painted.
    if (busy) return;
    setBusy(true);
    try {
      const prepared = preparePricing({
        attributes: quote.attributes,
        opexLines: quote.opexLines,
        aiUsage: quote.aiUsage,
        comparables,
        quotes,
        currentQuoteId: quote.id,
        settings,
        intent: quote.intent,
        capex: quote.capex,
      });

      // A failed adjudication degrades to the deterministic band. Abandoning the
      // recompute would leave the founder with no number at all, which is worse.
      let adjudication = null;
      try {
        adjudication = await fetchAdjudication(
          adjudicateRequestFrom(
            lead?.company ?? "Unknown",
            quote.attributes.buildStatus,
            prepared,
            quote.intent,
            quote.capex,
          ),
        );
      } catch {
        adjudication = null;
      }

      onPatch({ band: buildBand(prepared, adjudication, settings.currency, nowISO()) });
    } finally {
      setBusy(false);
    }
  }

  const band = quote.band;

  return (
    <Panel
      title="Price"
      action={
        <button className="btn btn-accent" onClick={recompute} disabled={busy}>
          <Calculator size={14} /> {busy ? "Pricing…" : "Recompute"}
        </button>
      }
    >
      {!band ? (
        <p className="text-[0.84rem] text-[var(--color-muted)]">
          Nothing priced yet. Fill in the build and running cost, then recompute.
        </p>
      ) : (
        <>
          <table className="w-full text-[0.86rem]">
            <thead>
              <tr className="text-[var(--color-dim)] text-[0.7rem] uppercase tracking-wider">
                <th className="text-left font-medium pb-1"></th>
                <th className="text-right font-medium pb-1">Floor</th>
                <th className="text-right font-medium pb-1">Target</th>
                <th className="text-right font-medium pb-1">Stretch</th>
              </tr>
            </thead>
            <tbody>
              <TripleRow label="Setup" triple={band.setup} currency={settings.currency} />
              <TripleRow label="Monthly" triple={band.monthly} currency={settings.currency} />
            </tbody>
          </table>

          {quote.attributes.buildStatus === "license as-is" && band.setup && (
            <p className="text-[0.8rem] text-[var(--color-muted)] mt-4 leading-relaxed">
              Already built, so the setup fee recovers no build cost —{" "}
              {fmtCurrency(band.setup.target, settings.currency)} is effectively all margin.
            </p>
          )}

          {band.clamps.length > 0 && (
            <ul className="mt-4 flex flex-col gap-1.5">
              {band.clamps.map((c, i) => (
                <li key={i} className="text-[0.79rem] text-[var(--color-muted)] leading-relaxed">
                  {c}
                </li>
              ))}
            </ul>
          )}

          {band.reasoning && (
            <p className="text-[0.84rem] text-[var(--color-ink-soft)] mt-4 leading-relaxed">
              {band.reasoning}
            </p>
          )}

          {band.degraded.length > 0 && (
            <ul className="mt-4 pt-3 border-t border-[var(--color-line)] flex flex-col gap-1.5">
              {band.degraded.map((d) => (
                <li key={d} className="text-[0.78rem] text-[var(--color-dim)]">
                  {DEGRADE_COPY[d] ?? d}
                </li>
              ))}
            </ul>
          )}

          {band.matched.length > 0 && (
            <p className="text-[0.75rem] text-[var(--color-dim)] mt-4">
              Anchored on {band.matched.length} comparable
              {band.matched.length === 1 ? "" : "s"}:{" "}
              {band.matched.map((m) => m.label).join(", ")}.
            </p>
          )}
        </>
      )}

      <div className="mt-6 pt-4 border-t border-[var(--color-line)]">
        <p className="eyebrow mb-3">Outcome</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5">
          <Field label="Quoted setup">
            <NumberInput
              value={quote.sentSetup}
              min={0}
              onChange={(e) => onPatch({ sentSetup: Number(e.target.value) })}
            />
          </Field>
          <Field label="Quoted monthly">
            <NumberInput
              value={quote.sentMonthly}
              min={0}
              onChange={(e) => onPatch({ sentMonthly: Number(e.target.value) })}
            />
          </Field>
          {quote.status === "won" && (
            <>
              <Field label="Closed setup">
                <NumberInput
                  value={quote.closedSetup}
                  min={0}
                  onChange={(e) => onPatch({ closedSetup: Number(e.target.value) })}
                />
              </Field>
              <Field label="Closed monthly">
                <NumberInput
                  value={quote.closedMonthly}
                  min={0}
                  onChange={(e) => onPatch({ closedMonthly: Number(e.target.value) })}
                />
              </Field>
            </>
          )}
          {quote.status === "lost" && (
            <Field
              label="Why it was lost"
              hint="Only a price loss caps future stretch. A timing loss must not drag your pricing down."
            >
              <Select
                options={LOST_REASONS}
                value={quote.lostReason || "other"}
                onChange={(e) => onPatch({ lostReason: e.target.value as LostReason })}
              />
            </Field>
          )}
        </div>

        {quote.status === "won" && quote.closedSetup <= 0 && (
          <p className="text-[0.78rem] text-[var(--color-warning)] mt-4 leading-relaxed">
            This deal is not counted as a comparable yet — enter the closed setup above, or
            future quotes will be priced without it.
          </p>
        )}
        {quote.status === "lost" && quote.lostReason === "price" && quote.sentSetup <= 0 && (
          <p className="text-[0.78rem] text-[var(--color-warning)] mt-4 leading-relaxed">
            This price loss is not counted as a comparable yet — enter the quoted setup above,
            or future quotes will be priced without it.
          </p>
        )}

        <div className="flex flex-wrap gap-2 mt-4">
          <button
            className="btn btn-ghost"
            onClick={() =>
              onPatch({
                status: "sent",
                sentSetup: quote.sentSetup || band?.setup?.target || 0,
                sentMonthly: quote.sentMonthly || band?.monthly.target || 0,
              })
            }
          >
            Mark sent
          </button>
          <button
            className="btn btn-ghost"
            onClick={() =>
              onPatch({
                status: "won",
                closedSetup: quote.closedSetup || quote.sentSetup,
                closedMonthly: quote.closedMonthly || quote.sentMonthly,
              })
            }
          >
            Won
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => onPatch({ status: "lost", lostReason: quote.lostReason || "other" })}
          >
            Lost
          </button>
        </div>
        <p className="text-[0.75rem] text-[var(--color-dim)] mt-3 leading-relaxed">
          Closing a quote is what feeds the comparables library — every future price is
          anchored on the ones you finish.
        </p>
      </div>
    </Panel>
  );
}
