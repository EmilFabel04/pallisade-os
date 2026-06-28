import { describe, it, expect } from "vitest";
import { driveQuery, driveFetchPlan } from "./driveApi";

describe("driveQuery", () => {
  it("restricts to doc/markdown/text mime types and excludes trashed", () => {
    const q = driveQuery("");
    expect(q).toContain("trashed = false");
    expect(q).toContain("application/vnd.google-apps.document");
    expect(q).toContain("text/markdown");
    expect(q).toContain("text/plain");
  });
  it("adds a name/fullText term and escapes single quotes", () => {
    const q = driveQuery("acme's notes");
    expect(q).toContain("name contains 'acme\\'s notes'");
    expect(q).toContain("fullText contains 'acme\\'s notes'");
  });
});

describe("driveFetchPlan", () => {
  it("exports Google Docs as markdown", () => {
    expect(driveFetchPlan("application/vnd.google-apps.document"))
      .toEqual({ mode: "export", exportMime: "text/markdown" });
  });
  it("downloads plain/markdown files directly", () => {
    expect(driveFetchPlan("text/markdown")).toEqual({ mode: "download" });
    expect(driveFetchPlan("text/plain")).toEqual({ mode: "download" });
  });
});
