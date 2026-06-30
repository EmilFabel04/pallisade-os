import { describe, it, expect } from "vitest";
import type { DialList, Target } from "@/lib/types";
import { findToday, buildEntries } from "./snapshot";

function target(over: Partial<Target>): Target {
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
    notes: "",
    ...over,
  };
}

function dialList(over: Partial<DialList>): DialList {
  return {
    id: over.id ?? "d1",
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
    date: over.date ?? "2026-06-30",
    entries: over.entries ?? [],
  };
}

describe("findToday", () => {
  it("returns the list matching the date, else null", () => {
    const lists = [dialList({ id: "a", date: "2026-06-29" }), dialList({ id: "b", date: "2026-06-30" })];
    expect(findToday(lists, "2026-06-30")?.id).toBe("b");
    expect(findToday(lists, "2026-07-01")).toBeNull();
  });
});

describe("buildEntries", () => {
  it("maps picked targets to entries with a denormalized label and null outcome", () => {
    const targets = [target({ id: "a", company: "Acme", contactName: "Jane Doe" })];
    const entries = buildEntries(targets, 20);
    expect(entries).toEqual([{ targetId: "a", label: "Acme — Jane Doe", outcome: null }]);
  });

  it("excludes not_interested targets and caps at count", () => {
    const targets = [
      target({ id: "a" }),
      target({ id: "b", disposition: "not_interested" }),
      target({ id: "c" }),
    ];
    const entries = buildEntries(targets, 1, () => 0);
    expect(entries.length).toBe(1);
    expect(entries[0].targetId).toBe("a");
  });
});
