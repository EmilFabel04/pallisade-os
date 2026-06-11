import { describe, it, expect } from "vitest";
import { queryLeads, queryTasks, getPipelineMetrics } from "@/lib/advisor/readTools";
import type { AdvisorSnapshot } from "@/lib/types";

function emptySnapshot(): AdvisorSnapshot {
  return {
    leads: [], interactions: [], projects: [], tasks: [], scorecards: [], painPoints: [],
    settings: {
      businessName: "X", founderName: "Y", mainMarket: "Z", services: "S",
      accentColor: "#000", currency: "ZAR", secondaryCurrencyEnabled: false,
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
        priority: "high", status: "not started", dueDate: "2026-06-12", notes: "" },
      { ...base, id: "t2", title: "Done thing", linkKind: "none", linkId: null, category: "admin",
        priority: "low", status: "done", dueDate: null, notes: "" },
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
