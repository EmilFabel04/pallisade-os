import { describe, it, expect } from "vitest";
import { guessMapping, rowsToTargets, dedupeTargets, TARGET_FIELDS } from "./mapping";
import type { NewTarget } from "./mapping";
import type { Target } from "@/lib/types";

const target = (over: Partial<Target>): Target => ({
  id: "t", createdAt: "", updatedAt: "",
  company: "", contactName: "", contactRole: "", email: "",
  phone: "", linkedinUrl: "", industry: "", location: "", notes: "",
  ...over,
});

describe("TARGET_FIELDS", () => {
  it("lists the nine target fields", () => {
    expect(TARGET_FIELDS).toEqual([
      "company", "contactName", "contactRole", "email",
      "phone", "linkedinUrl", "industry", "location", "notes",
    ]);
  });
});

describe("guessMapping", () => {
  it("maps common header variants to fields", () => {
    expect(guessMapping(["Company Name", "Full Name", "Email Address", "LinkedIn URL"]))
      .toEqual(["company", "contactName", "email", "linkedinUrl"]);
    expect(guessMapping(["Job Title", "City"])).toEqual(["contactRole", "location"]);
  });

  it("marks unknown headers as ignore", () => {
    expect(guessMapping(["Mystery Column"])).toEqual(["ignore"]);
  });

  it("only maps the first column that claims a field (first wins)", () => {
    expect(guessMapping(["email", "Email Address"])).toEqual(["email", "ignore"]);
  });
});

describe("rowsToTargets", () => {
  it("applies the mapping, trims values, and blanks unmapped fields", () => {
    const { targets, blankSkipped } = rowsToTargets(
      [[" Acme ", "  Jane Doe  ", "drop me"]],
      ["company", "contactName", "ignore"],
    );
    expect(blankSkipped).toBe(0);
    expect(targets[0]).toEqual({
      company: "Acme", contactName: "Jane Doe", contactRole: "", email: "",
      phone: "", linkedinUrl: "", industry: "", location: "", notes: "",
    });
  });

  it("skips rows with neither company nor contactName, counting them", () => {
    const { targets, blankSkipped } = rowsToTargets(
      [["", ""], ["Acme", ""]],
      ["company", "contactName"],
    );
    expect(targets).toHaveLength(1);
    expect(targets[0].company).toBe("Acme");
    expect(blankSkipped).toBe(1);
  });
});

describe("dedupeTargets", () => {
  const t = (over: Partial<NewTarget>): NewTarget => ({
    company: "", contactName: "", contactRole: "", email: "",
    phone: "", linkedinUrl: "", industry: "", location: "", notes: "",
    ...over,
  });

  it("drops incoming rows matching an existing email (case-insensitive) or linkedinUrl", () => {
    const existing = [target({ email: "JANE@acme.com" }), target({ linkedinUrl: "in/bob" })];
    const incoming = [t({ email: "jane@acme.com" }), t({ linkedinUrl: "in/bob" }), t({ company: "New" })];
    const { toAdd, duplicates } = dedupeTargets(incoming, existing);
    expect(duplicates).toBe(2);
    expect(toAdd.map((x) => x.company)).toEqual(["New"]);
  });

  it("dedupes within the incoming batch too", () => {
    const { toAdd, duplicates } = dedupeTargets(
      [t({ email: "a@b.com" }), t({ email: "A@B.com" })],
      [],
    );
    expect(duplicates).toBe(1);
    expect(toAdd).toHaveLength(1);
  });

  it("never dedupes on empty email/linkedinUrl", () => {
    const { toAdd, duplicates } = dedupeTargets(
      [t({ company: "X" }), t({ company: "Y" })],
      [target({ company: "Z" })],
    );
    expect(duplicates).toBe(0);
    expect(toAdd).toHaveLength(2);
  });
});
