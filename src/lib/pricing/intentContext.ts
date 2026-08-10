import type { DataShape } from "@/lib/types";

export interface IntentInteraction {
  date: string;
  type: string;
  whatTheySaid: string;
  painPoints: string;
  objections: string;
  buyingSignals: string;
}

export interface IntentContext {
  company: string;
  contactRole: string;
  industry: string;
  status: string;
  quality: string;
  painPoint: string;
  objection: string;
  buyingSignal: string;
  lastContact: string | null;
  estimatedValue: number;
  interactions: IntentInteraction[];
}

/** Assembled server-side from a leadId — CRM text never travels from the browser. */
export function buildIntentContext(data: DataShape, leadId: string): IntentContext | null {
  const lead = data.leads.find((l) => l.id === leadId);
  if (!lead) return null;

  const interactions = data.interactions
    .filter((i) => i.leadId === leadId)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .map((i) => ({
      date: i.date,
      type: i.type,
      whatTheySaid: i.whatTheySaid,
      painPoints: i.painPoints,
      objections: i.objections,
      buyingSignals: i.buyingSignals,
    }));

  return {
    company: lead.company,
    contactRole: lead.contactRole,
    industry: lead.industry,
    status: lead.status,
    quality: lead.quality,
    painPoint: lead.painPoint,
    objection: lead.objection,
    buyingSignal: lead.buyingSignal,
    lastContact: lead.lastContact,
    estimatedValue: lead.estimatedValue,
    interactions,
  };
}
