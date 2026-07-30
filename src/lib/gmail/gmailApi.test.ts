import { describe, it, expect, vi, beforeEach } from "vitest";

const gmailGet = vi.fn();
vi.mock("@/lib/gmail/client", () => ({
  gmailGet: (...args: unknown[]) => gmailGet(...args),
  GmailAuthError: class extends Error {},
}));

const { listThreadIds } = await import("@/lib/gmail/gmailApi");

beforeEach(() => gmailGet.mockReset());

describe("listThreadIds", () => {
  it("returns ids from a single page", async () => {
    gmailGet.mockResolvedValueOnce({ threads: [{ id: "a" }, { id: "b" }] });
    const result = await listThreadIds("acct");
    expect(result.ids).toEqual(["a", "b"]);
    expect(result.truncated).toBe(false);
  });

  it("follows nextPageToken across pages", async () => {
    gmailGet
      .mockResolvedValueOnce({ threads: [{ id: "a" }], nextPageToken: "p2" })
      .mockResolvedValueOnce({ threads: [{ id: "b" }] });
    expect((await listThreadIds("acct", { max: 10 })).ids).toEqual(["a", "b"]);
    expect(gmailGet).toHaveBeenCalledTimes(2);
    expect(gmailGet.mock.calls[1][2]).toMatchObject({ pageToken: "p2" });
  });

  it("stops at max and truncates the final page", async () => {
    gmailGet
      .mockResolvedValueOnce({ threads: [{ id: "a" }, { id: "b" }], nextPageToken: "p2" })
      .mockResolvedValueOnce({ threads: [{ id: "c" }, { id: "d" }], nextPageToken: "p3" });
    expect((await listThreadIds("acct", { max: 3 })).ids).toEqual(["a", "b", "c"]);
    expect(gmailGet).toHaveBeenCalledTimes(2);
  });

  it("passes the search query through", async () => {
    gmailGet.mockResolvedValueOnce({ threads: [] });
    await listThreadIds("acct", { q: "in:sent" });
    expect(gmailGet.mock.calls[0][2]).toMatchObject({ q: "in:sent" });
  });

  it("does not send labelIds, so the query alone selects the mailbox", async () => {
    gmailGet.mockResolvedValueOnce({ threads: [] });
    await listThreadIds("acct", { q: "in:sent" });
    expect(gmailGet.mock.calls[0][2]).not.toHaveProperty("labelIds");
  });

  it("returns [] when the response has no threads", async () => {
    gmailGet.mockResolvedValueOnce({});
    expect((await listThreadIds("acct")).ids).toEqual([]);
  });

  it("stops following tokens after a run of empty pages", async () => {
    gmailGet.mockResolvedValue({ threads: [], nextPageToken: "more" });
    expect((await listThreadIds("acct", { max: 400 })).ids).toEqual([]);
    expect(gmailGet).toHaveBeenCalledTimes(5);
  });

  it("reports truncated when it bails on a run of empty pages", async () => {
    gmailGet.mockResolvedValue({ threads: [], nextPageToken: "more" });
    const result = await listThreadIds("acct", { max: 400 });
    expect(result.ids).toEqual([]);
    expect(result.truncated).toBe(true);
  });

  it("keeps paging through an occasional empty page", async () => {
    gmailGet
      .mockResolvedValueOnce({ threads: [], nextPageToken: "p2" })
      .mockResolvedValueOnce({ threads: [{ id: "a" }] });
    expect((await listThreadIds("acct", { max: 400 })).ids).toEqual(["a"]);
    expect(gmailGet).toHaveBeenCalledTimes(2);
  });

  it("asks for only the remaining budget once a page is consumed", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ id: `id${i}` }));
    gmailGet
      .mockResolvedValueOnce({ threads: full, nextPageToken: "p2" })
      .mockResolvedValueOnce({ threads: [{ id: "last" }] });
    await listThreadIds("acct", { max: 150 });
    expect(gmailGet.mock.calls[0][2]).toMatchObject({ maxResults: 100 });
    expect(gmailGet.mock.calls[1][2]).toMatchObject({ maxResults: 50 });
  });
});
