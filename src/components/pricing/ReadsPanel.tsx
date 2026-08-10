"use client";

import { useState } from "react";
import { RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { fetchCapex, fetchIntent } from "@/lib/pricingClient";
import { timeAgo } from "@/lib/utils";
import type { Lead, Quote } from "@/lib/types";

function Card({
  title,
  headline,
  timestamp,
  busy,
  error,
  onRefresh,
  children,
}: {
  title: string;
  headline: React.ReactNode;
  timestamp: string | null;
  busy: boolean;
  error: string;
  onRefresh: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-[var(--color-line)] rounded-[10px] p-3.5">
      <div className="flex items-center justify-between gap-3">
        <button
          className="flex items-center gap-2 text-left"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="text-[0.8rem] text-[var(--color-muted)]">{title}</span>
          <span className="text-[0.9rem] text-[var(--color-ink)]">{headline}</span>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[0.72rem] text-[var(--color-dim)]">
            {timestamp ? timeAgo(timestamp) : "never run"}
          </span>
          <button
            className="btn btn-ghost btn-icon"
            onClick={onRefresh}
            disabled={busy}
            aria-label={`Refresh ${title}`}
          >
            <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
          </button>
        </div>
      </div>
      {error && (
        <p className="text-[0.78rem] text-[var(--color-accent)] mt-2">{error}</p>
      )}
      {open && <div className="mt-3.5">{children}</div>}
    </div>
  );
}

export function ReadsPanel({
  quote,
  lead,
  onPatch,
}: {
  quote: Quote;
  lead: Lead | null;
  onPatch: (p: Partial<Quote>) => void;
}) {
  const [intentBusy, setIntentBusy] = useState(false);
  const [capexBusy, setCapexBusy] = useState(false);
  const [intentError, setIntentError] = useState("");
  const [capexError, setCapexError] = useState("");

  async function runIntent() {
    if (!lead) return;
    setIntentBusy(true);
    setIntentError("");
    try {
      onPatch({ intent: await fetchIntent(lead.id) });
    } catch (e) {
      setIntentError(e instanceof Error ? e.message : "The intent read failed.");
    } finally {
      setIntentBusy(false);
    }
  }

  async function runCapex() {
    if (!lead) return;
    setCapexBusy(true);
    setCapexError("");
    try {
      onPatch({
        capex: await fetchCapex({
          company: lead.company,
          industry: lead.industry,
          companyType: lead.companyType,
        }),
      });
    } catch (e) {
      setCapexError(e instanceof Error ? e.message : "The capex research failed.");
    } finally {
      setCapexBusy(false);
    }
  }

  const intent = quote.intent;
  const capex = quote.capex;

  return (
    <Panel title="Reads">
      <div className="flex flex-col gap-3">
        <Card
          title="Buying intent"
          headline={
            intent ? (
              <>
                <span className="tnum">{intent.score}</span>/100{" "}
                <Badge tone={intent.band === "hot" ? "positive" : intent.band === "warm" ? "warning" : "muted"}>
                  {intent.band}
                </Badge>
              </>
            ) : (
              <span className="text-[var(--color-dim)]">not read</span>
            )
          }
          timestamp={intent?.generatedAt ?? null}
          busy={intentBusy}
          error={intentError}
          onRefresh={runIntent}
        >
          {intent && (
            <div className="flex flex-col gap-3 text-[0.83rem]">
              <div>
                <p className="eyebrow mb-1.5">Signals</p>
                {intent.signals.length === 0 ? (
                  <p className="text-[var(--color-dim)]">
                    Nothing in the record supported a score.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {intent.signals.map((s, i) => (
                      <li key={i} className="text-[var(--color-ink-soft)] leading-relaxed">
                        &ldquo;{s.quote}&rdquo;
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {intent.risks.length > 0 && (
                <div>
                  <p className="eyebrow mb-1.5">Risks</p>
                  <ul className="flex flex-col gap-1">
                    {intent.risks.map((r, i) => (
                      <li key={i} className="text-[var(--color-muted)]">{r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Card>

        <Card
          title="Capex"
          headline={
            capex ? (
              <>
                <Badge tone={capex.band === "unknown" ? "muted" : "info"}>{capex.band}</Badge>{" "}
                <span className="text-[0.78rem] text-[var(--color-dim)]">
                  {capex.confidence} confidence
                </span>
              </>
            ) : (
              <span className="text-[var(--color-dim)]">not researched</span>
            )
          }
          timestamp={capex?.generatedAt ?? null}
          busy={capexBusy}
          error={capexError}
          onRefresh={runCapex}
        >
          {capex && (
            <div className="flex flex-col gap-3 text-[0.83rem]">
              {(capex.headcount || capex.revenueNote) && (
                <p className="text-[var(--color-ink-soft)]">
                  {capex.headcount ? `~${capex.headcount} staff. ` : ""}
                  {capex.revenueNote}
                </p>
              )}
              <div>
                <p className="eyebrow mb-1.5">Sources</p>
                {capex.evidence.length === 0 ? (
                  <p className="text-[var(--color-dim)]">Nothing citable was found.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {capex.evidence.map((e, i) => (
                      <li key={i}>
                        <a
                          href={e.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[var(--color-ink-soft)] underline decoration-[var(--color-line-strong)] hover:decoration-[var(--color-ink)]"
                        >
                          {e.claim || e.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>

      {!lead && (
        <p className="text-[0.78rem] text-[var(--color-dim)] mt-3">
          Both reads need a lead. This quote has none.
        </p>
      )}
    </Panel>
  );
}
