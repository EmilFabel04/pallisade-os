import { describe, it, expect } from "vitest";
import type { Target } from "@/lib/types";
import { eligibleTargets, pickDaily } from "./select";

function target(over: Partial<Target>): Target {
  return {
    id: over.id ?? "t1",
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
    company: "Acme",
    contactName: "Jane Doe",
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

describe("eligibleTargets", () => {
  it("excludes not_interested, keeps everything else", () => {
    const pool = [
      target({ id: "a" }),
      target({ id: "b", disposition: "not_interested" }),
      target({ id: "c", callCount: 3 }), // still eligible — keeps cycling
      target({ id: "d", disposition: null }),
    ];
    expect(eligibleTargets(pool).map((t) => t.id)).toEqual(["a", "c", "d"]);
  });
});

describe("pickDaily", () => {
  it("returns at most `count` items", () => {
    const pool = Array.from({ length: 50 }, (_, i) => target({ id: `t${i}` }));
    expect(pickDaily(pool, 20).length).toBe(20);
  });

  it("returns the whole pool when smaller than count, no duplicates", () => {
    const pool = [target({ id: "a" }), target({ id: "b" }), target({ id: "c" })];
    const picked = pickDaily(pool, 20);
    expect(picked.length).toBe(3);
    expect(new Set(picked.map((t) => t.id)).size).toBe(3);
  });

  it("is deterministic with an injected rng and never duplicates", () => {
    const pool = Array.from({ length: 5 }, (_, i) => target({ id: `t${i}` }));
    const rng = () => 0; // always picks the first remaining item
    const picked = pickDaily(pool, 3, rng);
    expect(picked.map((t) => t.id)).toEqual(["t0", "t1", "t2"]);
  });
});
