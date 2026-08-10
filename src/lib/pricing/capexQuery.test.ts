import { describe, it, expect } from "vitest";
import { capexQuery } from "./capexQuery";

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
});
