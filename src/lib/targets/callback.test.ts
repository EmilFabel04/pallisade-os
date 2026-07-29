import { describe, it, expect } from "vitest";
import type { Target } from "@/lib/types";
import { CALLBACK_DAYS, callbackDueDate, callbackLead, callbackTask } from "./callback";

function target(over: Partial<Target> = {}): Target {
  return {
    id: over.id ?? "t1",
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
    company: over.company ?? "Acme",
    contactName: over.contactName ?? "Jane Doe",
    contactRole: "CTO",
    email: "jane@acme.com",
    phone: "+15551234567",
    linkedinUrl: "",
    industry: "SaaS",
    location: "NYC",
    notes: "Met at conf",
    ...over,
  };
}

describe("callbackDueDate", () => {
  it("is a week out from the given day", () => {
    expect(CALLBACK_DAYS).toBe(7);
    expect(callbackDueDate("2026-07-14")).toBe("2026-07-21");
  });

  it("crosses month and year boundaries", () => {
    expect(callbackDueDate("2026-07-28")).toBe("2026-08-04");
    expect(callbackDueDate("2026-12-28")).toBe("2027-01-04");
  });
});

describe("callbackLead", () => {
  it("carries the target's fields over and marks the lead contacted with the callback date", () => {
    const lead = callbackLead(target(), "Emil", "2026-07-21");
    expect(lead.company).toBe("Acme");
    expect(lead.contactName).toBe("Jane Doe");
    expect(lead.phone).toBe("+15551234567");
    expect(lead.notes).toBe("Met at conf");
    expect(lead.owner).toBe("Emil");
    // A callback request means we spoke to them — not a cold "new" lead.
    expect(lead.status).toBe("contacted");
    expect(lead.nextFollowUp).toBe("2026-07-21");
  });
});

describe("callbackTask", () => {
  it("builds an open follow-up task linked to the new lead", () => {
    const task = callbackTask(target(), "lead-9", "2026-07-21");
    expect(task).toEqual({
      title: "Call back Acme — Jane Doe",
      linkKind: "lead",
      linkId: "lead-9",
      category: "follow-up",
      priority: "medium",
      status: "not started",
      dueDate: "2026-07-21",
      notes: "",
      milestoneId: null,
    });
  });

  it("omits the dash when the target has no contact name", () => {
    const task = callbackTask(target({ contactName: "" }), "lead-9", "2026-07-21");
    expect(task.title).toBe("Call back Acme");
  });
});
