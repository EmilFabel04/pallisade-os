"use client";

import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { useLeads } from "@/lib/store";
import type { Quote } from "@/lib/types";

export function QuoteDetail({ quote, onClose }: { quote: Quote; onClose: () => void }) {
  const leads = useLeads();
  const lead = leads.find((l) => l.id === quote.leadId) ?? null;

  return (
    <PageHeader
      title={quote.name}
      subtitle={lead ? `${lead.company} · ${lead.contactName}` : "Lead missing"}
      actions={
        <button className="btn btn-ghost" onClick={onClose}>
          <ArrowLeft size={15} /> All quotes
        </button>
      }
    />
  );
}
