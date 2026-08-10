import { describe, it, expect } from "vitest";
import { capexQuery, type CapexQueryParams } from "./capexQuery";

describe("capexQuery", () => {
  it("leads with the company name", () => {
    const q = capexQuery({ company: "Quillmere Capital", industry: "Asset Management", companyType: "Boutique fund manager" });
    expect(q).toContain("Quillmere Capital");
    expect(q).toContain("Asset Management");
    expect(q).toContain("Boutique fund manager");
  });

  it("omits blank fields rather than emitting empty labels", () => {
    const q = capexQuery({ company: "Acme", industry: "", companyType: "" });
    expect(q).toContain("Acme");
    expect(q).not.toContain("Industry:");
    expect(q).not.toContain("Type:");
  });

  it("returns an empty string with no company, so the route can reject early", () => {
    expect(capexQuery({ company: "  ", industry: "x", companyType: "y" })).toBe("");
  });

  it("treats a missing company as absent rather than throwing", () => {
    expect(capexQuery({} as unknown as CapexQueryParams)).toBe("");
  });

  it("treats a null company as absent rather than throwing", () => {
    expect(capexQuery({ company: null } as unknown as CapexQueryParams)).toBe("");
  });

  it("treats null/undefined industry and companyType as absent rather than throwing", () => {
    const q = capexQuery({ company: "Acme", industry: null, companyType: undefined } as unknown as CapexQueryParams);
    expect(q).toBe("Company: Acme");
    expect(q).not.toContain("Industry:");
    expect(q).not.toContain("Type:");
  });

  it("treats a null body as absent rather than throwing", () => {
    expect(capexQuery(null as unknown as CapexQueryParams)).toBe("");
  });
});
