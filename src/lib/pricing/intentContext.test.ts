import { describe, it, expect } from "vitest";
import { buildIntentContext } from "./intentContext";
import { DEFAULT_SETTINGS } from "@/lib/seed";
import type { DataShape, Interaction, Lead } from "@/lib/types";

const lead: Lead = {
  id: "l1", createdAt: "", updatedAt: "",
  company: "Quillmere Capital", contactName: "Johan", contactRole: "MD",
  email: "", phone: "", linkedinUrl: "", industry: "Asset Management",
  companyType: "Boutique fund manager", source: "referral", status: "interested",
  quality: "high", painPoint: "Reports take three days",
  objection: "Worried about data security", buyingSignal: "Asked about timelines",
  lastContact: "2026-08-01", nextFollowUp: null, notes: "", solutionIdea: "",
  estimatedValue: 120000, owner: "Emil",
};

function interaction(over: Partial<Interaction>): Interaction {
  return {
    id: "i1", createdAt: "", updatedAt: "", leadId: "l1",
    company: "Quillmere Capital", contact: "Johan", date: "2026-08-01",
    type: "discovery call", rawNotes: "", whatTheySaid: "We want this live by Q4",
    painPoints: "Manual Excel work", objections: "", buyingSignals: "Asked for pricing",
    followUpRequired: false, followUpDate: null, ...over,
  };
}

const DATA = {
  leads: [lead],
  interactions: [interaction({}), interaction({ id: "i2", leadId: "other" })],
  projects: [], tasks: [], scorecards: [], painPoints: [], conversations: [],
  playbooks: [], targets: [], dialLists: [], positioningProfiles: [],
  voiceSamples: [], voiceProfile: [], contentThreads: [], brainThreads: [],
  newsFeed: [], newsInterests: [], newsBookmarks: [], notes: [], metricEntries: [],
  milestones: [], projectThreads: [], quotes: [], comparables: [],
  followUpState: [],
  settings: DEFAULT_SETTINGS,
} as DataShape;

describe("buildIntentContext", () => {
  it("returns null for a lead that does not exist", () => {
    expect(buildIntentContext(DATA, "nope")).toBeNull();
  });

  it("gathers the lead's own signal fields", () => {
    const ctx = buildIntentContext(DATA, "l1")!;
    expect(ctx.company).toBe("Quillmere Capital");
    expect(ctx.painPoint).toBe("Reports take three days");
    expect(ctx.objection).toBe("Worried about data security");
    expect(ctx.quality).toBe("high");
  });

  it("includes only interactions belonging to that lead", () => {
    const ctx = buildIntentContext(DATA, "l1")!;
    expect(ctx.interactions).toHaveLength(1);
    expect(ctx.interactions[0].whatTheySaid).toBe("We want this live by Q4");
  });

  it("orders interactions newest first so recency is legible to the model", () => {
    const data = {
      ...DATA,
      interactions: [
        interaction({ id: "old", date: "2026-01-01" }),
        interaction({ id: "new", date: "2026-08-01" }),
      ],
    } as DataShape;
    expect(buildIntentContext(data, "l1")!.interactions[0].date).toBe("2026-08-01");
  });
});
