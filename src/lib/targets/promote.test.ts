import { describe, it, expect } from "vitest";
import { targetToLead } from "./promote";
import type { Target } from "@/lib/types";

const target = (over: Partial<Target>): Target => ({
  id: "t", createdAt: "", updatedAt: "",
  company: "Acme", contactName: "Jane", contactRole: "CFO", email: "jane@acme.com",
  phone: "123", linkedinUrl: "", industry: "Finance", location: "London", notes: "warm",
  ...over,
});

describe("targetToLead", () => {
  it("carries target fields over and applies sensible Lead defaults", () => {
    const lead = targetToLead(target({}), "Emil");
    expect(lead).toMatchObject({
      company: "Acme", contactName: "Jane", contactRole: "CFO", email: "jane@acme.com",
      phone: "123", industry: "Finance", notes: "warm",
      status: "new", quality: "medium", owner: "Emil", estimatedValue: 0,
      companyType: "", painPoint: "", objection: "", buyingSignal: "", solutionIdea: "",
      lastContact: null, nextFollowUp: null,
    });
  });

  it("sources from website when there is no LinkedIn URL", () => {
    expect(targetToLead(target({ linkedinUrl: "" }), "Emil").source).toBe("website");
  });

  it("sources from LinkedIn when a LinkedIn URL is present", () => {
    expect(targetToLead(target({ linkedinUrl: "in/jane" }), "Emil").source).toBe("LinkedIn");
  });
});
