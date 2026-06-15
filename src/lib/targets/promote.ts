import type { Lead, Target } from "@/lib/types";

export type NewLead = Omit<Lead, "id" | "createdAt" | "updatedAt">;

// NOTE: the Lead schema has NO `location` field, so the target's `location`
// is intentionally not carried over (it has nowhere to go). Every other
// target field maps 1:1; the rest are sensible defaults.
/** Build a Lead from a Target. Source derives from whether a LinkedIn URL exists. */
export function targetToLead(target: Target, founderName: string): NewLead {
  return {
    company: target.company,
    contactName: target.contactName,
    contactRole: target.contactRole,
    email: target.email,
    phone: target.phone,
    linkedinUrl: target.linkedinUrl,
    industry: target.industry,
    companyType: "",
    source: target.linkedinUrl ? "LinkedIn" : "website",
    status: "new",
    quality: "medium",
    painPoint: "",
    objection: "",
    buyingSignal: "",
    lastContact: null,
    nextFollowUp: null,
    notes: target.notes,
    solutionIdea: "",
    estimatedValue: 0,
    owner: founderName,
  };
}
