import { describe, it, expect } from "vitest";
import { COLLECTIONS } from "@/lib/db/sqlite";
import { buildSnapshot } from "@/lib/advisorClient";
import { collectCandidates } from "@/lib/content/daily/harvest";
import { DEFAULT_SETTINGS } from "@/lib/seed";
import type { DataShape, Quote } from "@/lib/types";

const EMPTY_SHAPE = {
  leads: [], interactions: [], projects: [], tasks: [], scorecards: [],
  painPoints: [], conversations: [], playbooks: [], targets: [], dialLists: [],
  positioningProfiles: [], voiceSamples: [], voiceProfile: [], contentThreads: [],
  brainThreads: [], newsFeed: [], newsInterests: [], newsBookmarks: [], notes: [],
  metricEntries: [], milestones: [], projectThreads: [],
  quotes: [], comparables: [],
  settings: DEFAULT_SETTINGS,
} as DataShape;

const QUOTE: Quote = {
  id: "q1", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
  leadId: "l1", name: "Investor reporting build",
  attributes: {
    buildStatus: "new", surfaces: 4, integrations: ["Xero"], dataSources: 2,
    aiDepth: "core", userCount: 12, supportLoad: "medium",
  },
  opexLines: [], aiUsage: null, intent: null, capex: null, band: null,
  status: "won", sentSetup: 120000, sentMonthly: 9000,
  closedSetup: 120000, closedMonthly: 9000, lostReason: "", notes: "",
};

describe("pricing collection registration", () => {
  it("registers both collections for persistence", () => {
    expect(COLLECTIONS).toContain("quotes");
    expect(COLLECTIONS).toContain("comparables");
  });

  it("exposes quotes to the Sales Advisor", () => {
    const snap = buildSnapshot({ ...EMPTY_SHAPE, quotes: [QUOTE] });
    expect(snap.quotes).toHaveLength(1);
    expect(snap.comparables).toEqual([]);
  });

  it("never feeds quote money to the content engine", () => {
    const items = collectCandidates({ ...EMPTY_SHAPE, quotes: [QUOTE] });
    const blob = JSON.stringify(items);
    expect(blob).not.toContain("120000");
    expect(blob).not.toContain("Investor reporting build");
  });

  it("ships pricing defaults, with the unset sentinels at zero", () => {
    expect(DEFAULT_SETTINGS.targetMarginPct).toBe(0.4);
    expect(DEFAULT_SETTINGS.capexMultipliers).toEqual({
      micro: 0.7, small: 1.0, mid: 1.4, enterprise: 2.0,
    });
    expect(DEFAULT_SETTINGS.minimumSetupFee).toBe(0);
    expect(DEFAULT_SETTINGS.usdToZar).toBe(0);
  });
});
