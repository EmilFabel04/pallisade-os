import { describe, it, expect } from "vitest";
import { formatAttachmentsBlock } from "./attachments";

describe("formatAttachmentsBlock", () => {
  it("returns empty string with no attachments", () => {
    expect(formatAttachmentsBlock([])).toBe("");
  });
  it("labels each document by name", () => {
    const out = formatAttachmentsBlock([{ name: "call.md", content: "hello" }]);
    expect(out).toContain("call.md");
    expect(out).toContain("hello");
  });
  it("truncates past the char budget with a marker", () => {
    const out = formatAttachmentsBlock([{ name: "big.md", content: "x".repeat(50) }], 10);
    expect(out).toContain("[truncated]");
  });
});
