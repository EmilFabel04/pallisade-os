import { describe, it, expect } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("parses simple rows", () => {
    expect(parseCsv("a,b\n1,2")).toEqual({ headers: ["a", "b"], rows: [["1", "2"]] });
  });

  it("handles quoted fields with embedded commas", () => {
    expect(parseCsv('a,b\n"x,y",2')).toEqual({ headers: ["a", "b"], rows: [["x,y", "2"]] });
  });

  it("handles quoted fields with embedded newlines", () => {
    expect(parseCsv('a,b\n"line1\nline2",2')).toEqual({
      headers: ["a", "b"],
      rows: [["line1\nline2", "2"]],
    });
  });

  it("handles escaped double-quotes", () => {
    expect(parseCsv('a\n"he said ""hi"""')).toEqual({
      headers: ["a"],
      rows: [['he said "hi"']],
    });
  });

  it("handles CRLF line endings and ignores a trailing newline", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual({ headers: ["a", "b"], rows: [["1", "2"]] });
  });

  it("pads short rows and truncates long rows to the header width", () => {
    expect(parseCsv("a,b,c\n1,2").rows).toEqual([["1", "2", ""]]);
    expect(parseCsv("a,b\n1,2,3").rows).toEqual([["1", "2"]]);
  });

  it("returns empty headers for empty input", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [] });
  });
});
