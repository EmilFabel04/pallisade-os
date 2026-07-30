import { describe, it, expect } from "vitest";
import {
  header, parseAddress, parseAddressList, decodeBody, extractText, companyFromEmail,
} from "@/lib/gmail/parse";

describe("parseAddress", () => {
  it("splits a named address", () => {
    expect(parseAddress("Jane Roe <jane@acme.com>")).toEqual({ name: "Jane Roe", email: "jane@acme.com" });
  });
  it("strips quotes around the display name", () => {
    expect(parseAddress('"Roe, Jane" <jane@acme.com>')).toEqual({ name: "Roe, Jane", email: "jane@acme.com" });
  });
  it("handles a bare address", () => {
    expect(parseAddress("jane@acme.com")).toEqual({ name: "jane@acme.com", email: "jane@acme.com" });
  });
});

describe("parseAddressList", () => {
  it("respects commas inside quoted names", () => {
    const list = parseAddressList('"Roe, Jane" <jane@acme.com>, bob@beta.io');
    expect(list).toEqual([
      { name: "Roe, Jane", email: "jane@acme.com" },
      { name: "bob@beta.io", email: "bob@beta.io" },
    ]);
  });
  it("returns [] for empty input", () => {
    expect(parseAddressList("")).toEqual([]);
  });
});

describe("header", () => {
  it("is case-insensitive", () => {
    const h = [{ name: "From", value: "a@b.com" }, { name: "Subject", value: "Hi" }];
    expect(header(h, "from")).toBe("a@b.com");
    expect(header(h, "SUBJECT")).toBe("Hi");
    expect(header(h, "Cc")).toBe("");
  });
});

describe("decodeBody / extractText", () => {
  it("decodes base64url", () => {
    const data = Buffer.from("Hello, world").toString("base64url");
    expect(decodeBody(data)).toBe("Hello, world");
  });
  it("prefers text/plain in a multipart tree", () => {
    const payload = {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: Buffer.from("plain body").toString("base64url") } },
        { mimeType: "text/html", body: { data: Buffer.from("<p>html body</p>").toString("base64url") } },
      ],
    };
    expect(extractText(payload)).toBe("plain body");
  });
  it("falls back to stripped html", () => {
    const payload = {
      mimeType: "text/html",
      body: { data: Buffer.from("<p>Hi</p><p>there</p>").toString("base64url") },
    };
    expect(extractText(payload)).toBe("Hi\nthere");
  });
  it("turns <br> into newlines in html-only mail", () => {
    const payload = {
      mimeType: "text/html",
      body: { data: Buffer.from("Worth a chat?<br><br>Best,<br>Emil").toString("base64url") },
    };
    expect(extractText(payload)).toBe("Worth a chat?\n\nBest,\nEmil");
  });
});

describe("companyFromEmail", () => {
  it("derives a company from a business domain", () => {
    expect(companyFromEmail("jane@acme.com")).toBe("Acme");
    expect(companyFromEmail("jane@acme.co.uk")).toBe("Acme");
    expect(companyFromEmail("jane@mail.acme.com")).toBe("Acme");
  });
  it("returns empty for free providers", () => {
    expect(companyFromEmail("jane@gmail.com")).toBe("");
    expect(companyFromEmail("jane@outlook.com")).toBe("");
  });
});
