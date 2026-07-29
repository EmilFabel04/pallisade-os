import { describe, it, expect } from "vitest";
import { COLLECTIONS } from "./sqlite";

describe("sqlite COLLECTIONS registry", () => {
  it("includes the news collections so they persist", () => {
    expect(COLLECTIONS).toContain("newsFeed");
    expect(COLLECTIONS).toContain("newsInterests");
    expect(COLLECTIONS).toContain("newsBookmarks");
  });
});

describe("sqlite COLLECTIONS registry — project tracker", () => {
  it("includes the milestone and project-thread collections so they persist", () => {
    expect(COLLECTIONS).toContain("milestones");
    expect(COLLECTIONS).toContain("projectThreads");
  });
});
