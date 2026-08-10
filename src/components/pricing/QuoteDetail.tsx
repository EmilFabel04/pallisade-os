"use client";

import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DetailGrid, DetailRow } from "@/components/ui/Detail";
import { Badge } from "@/components/ui/Badge";
import { BuildPanel } from "./BuildPanel";
import { OpexPanel } from "./OpexPanel";
import { useLeads, useSettings, useStore } from "@/lib/store";
import { qualityTone } from "@/lib/badges";
import { fmtCurrency, fmtDate } from "@/lib/utils";
import type { Quote } from "@/lib/types";

export function QuoteDetail({ quote, onClose }: { quote: Quote; onClose: () => void }) {
  const leads = useLeads();
  const settings = useSettings();
  const { update } = useStore();

  const lead = leads.find((l) => l.id === quote.leadId) ?? null;

  // Straight through to the store — it already debounces persistence, so a local
  // draft buffer would only create a second source of truth to keep in sync.
  const patch = (p: Partial<Quote>) => update("quotes", quote.id, p);

  return (
    <>
      <PageHeader
        title={quote.name}
        subtitle={lead ? `${lead.company} · ${lead.contactName}` : "Lead missing"}
        actions={
          <button className="btn btn-ghost" onClick={onClose}>
            <ArrowLeft size={15} /> All quotes
          </button>
        }
      />

      <div className="flex flex-col gap-4">
        <Panel title="Lead">
          {lead ? (
            <DetailGrid>
              <DetailRow label="Company">{lead.company}</DetailRow>
              <DetailRow label="Quality">
                <Badge tone={qualityTone(lead.quality)}>{lead.quality}</Badge>
              </DetailRow>
              <DetailRow label="Estimated value">
                {lead.estimatedValue ? fmtCurrency(lead.estimatedValue, settings.currency) : ""}
              </DetailRow>
              <DetailRow label="Last contact">
                {lead.lastContact ? fmtDate(lead.lastContact) : ""}
              </DetailRow>
              <DetailRow label="Pain point" full>
                {lead.painPoint}
              </DetailRow>
            </DetailGrid>
          ) : (
            <p className="text-[0.84rem] text-[var(--color-muted)]">
              This quote points at a lead that no longer exists. Intent cannot be scored.
            </p>
          )}
        </Panel>

        <BuildPanel quote={quote} onPatch={patch} />
        <OpexPanel quote={quote} onPatch={patch} />
      </div>
    </>
  );
}
