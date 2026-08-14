import { describe, it, expect } from "vitest";
import { queryLeads, queryTasks, getPipelineMetrics } from "@/lib/advisor/readTools";
import type { AdvisorSnapshot } from "@/lib/types";

function emptySnapshot(): AdvisorSnapshot {
  return {
    leads: [], interactions: [], projects: [], tasks: [], scorecards: [], painPoints: [], dialLists: [], milestones: [],
    quotes: [], comparables: [],
    settings: {
      businessName: "X", founderName: "Y", mainMarket: "Z", services: "S",
      accentColor: "#000", currency: "ZAR", secondaryCurrencyEnabled: false,
      targetMarginPct: 0.4, minimumSetupFee: 0, usdToZar: 0,
      capexMultipliers: { micro: 0.7, small: 1.0, mid: 1.4, enterprise: 2.0 },
    },
  };
}

const base = { id: "", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };

describe("queryLeads", () => {
  it("filters by status and trims to compact shape", () => {
    const snap = emptySnapshot();
    snap.leads = [
      { ...base, id: "l1", company: "Acme", contactName: "Jo", contactRole: "", email: "", phone: "",
        linkedinUrl: "", industry: "Finance", companyType: "", source: "referral", status: "interested",
        quality: "high", painPoint: "manual reports", objection: "", buyingSignal: "", lastContact: null,
        nextFollowUp: "2026-06-12", notes: "", solutionIdea: "", estimatedValue: 5000, owner: "" },
      { ...base, id: "l2", company: "Beta", contactName: "", contactRole: "", email: "", phone: "",
        linkedinUrl: "", industry: "", companyType: "", source: "cold call", status: "lost",
        quality: "low", painPoint: "", objection: "", buyingSignal: "", lastContact: null,
        nextFollowUp: null, notes: "", solutionIdea: "", estimatedValue: 0, owner: "" },
    ];
    const out = queryLeads(snap, { status: "interested" });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "l1", company: "Acme", status: "interested" });
    expect(out[0]).not.toHaveProperty("notes"); // compact shape drops bulky fields
  });

  // The Pipeline Analyst's standing diagnostic asks for the lead-creation rate
  // over the last 30 days vs the 30 before, and flags a lead whose lastContact
  // is older than its updatedAt. Both are unanswerable unless the compact row
  // carries these two timestamps — get_pipeline_metrics only counts today.
  it("carries createdAt and updatedAt so ageing and creation-rate are computable", () => {
    const snap = emptySnapshot();
    snap.leads = [
      { ...base, id: "l1", createdAt: "2026-07-20T09:00:00.000Z", updatedAt: "2026-08-11T09:00:00.000Z",
        company: "Acme", contactName: "", contactRole: "", email: "", phone: "",
        linkedinUrl: "", industry: "", companyType: "", source: "referral", status: "proposal",
        quality: "high", painPoint: "", objection: "", buyingSignal: "", lastContact: "2026-07-25",
        nextFollowUp: null, notes: "", solutionIdea: "", estimatedValue: 0, owner: "" },
    ];
    const [row] = queryLeads(snap, {});
    expect(row.createdAt).toBe("2026-07-20T09:00:00.000Z");
    expect(row.updatedAt).toBe("2026-08-11T09:00:00.000Z");
    // …and the record-edited-without-a-conversation signal is now derivable.
    expect(row.lastContact! < row.updatedAt).toBe(true);
    // Still compact: the bulky free-text fields stay dropped.
    for (const k of ["notes", "solutionIdea", "objection", "linkedinUrl"]) {
      expect(row).not.toHaveProperty(k);
    }
  });

  it("filters by hasFollowUp", () => {
    const snap = emptySnapshot();
    snap.leads = [
      { ...base, id: "l1", company: "Acme", contactName: "", contactRole: "", email: "", phone: "",
        linkedinUrl: "", industry: "", companyType: "", source: "referral", status: "new", quality: "high",
        painPoint: "", objection: "", buyingSignal: "", lastContact: null, nextFollowUp: "2026-06-12",
        notes: "", solutionIdea: "", estimatedValue: 0, owner: "" },
    ];
    expect(queryLeads(snap, { hasFollowUp: true })).toHaveLength(1);
    expect(queryLeads({ ...snap, leads: [{ ...snap.leads[0], nextFollowUp: null }] }, { hasFollowUp: true })).toHaveLength(0);
  });
});

describe("queryTasks", () => {
  it("filters by status", () => {
    const snap = emptySnapshot();
    snap.tasks = [
      { ...base, id: "t1", title: "Call Acme", linkKind: "none", linkId: null, category: "follow-up",
        priority: "high", status: "not started", dueDate: "2026-06-12", notes: "", milestoneId: null },
      { ...base, id: "t2", title: "Done thing", linkKind: "none", linkId: null, category: "admin",
        priority: "low", status: "done", dueDate: null, notes: "", milestoneId: null },
    ];
    const out = queryTasks(snap, { status: "not started" });
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Call Acme");
  });
});

describe("getPipelineMetrics", () => {
  it("returns counts and value", () => {
    const snap = emptySnapshot();
    const m = getPipelineMetrics(snap, {});
    expect(m).toHaveProperty("pipelineValue");
    expect(m).toHaveProperty("statusCounts");
    expect(Array.isArray(m.statusCounts)).toBe(true);
  });
});
