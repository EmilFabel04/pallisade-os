import { describe, it, expect, vi, afterEach } from "vitest";
import { getNewsStatus, refreshNews } from "./newsClient";

const interests = {
  id: "i", createdAt: "", updatedAt: "",
  topics: "", githubLanguages: "", githubTopics: "", subreddits: "", rssFeeds: "", aboutMe: "",
};

afterEach(() => vi.unstubAllGlobals());

describe("newsClient", () => {
  it("getNewsStatus returns a safe default when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    expect(await getNewsStatus()).toEqual({ configured: false, github: false, model: "" });
  });

  it("refreshNews posts interests and returns the feed data", async () => {
    const feed = { items: [], summary: "hi", fetchedAt: "t", degraded: [] };
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => feed }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await refreshNews(interests);
    expect(out).toEqual(feed);
    expect(fetchMock).toHaveBeenCalledWith("/api/news", expect.objectContaining({ method: "POST" }));
  });

  it("refreshNews throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "boom" }) })));
    await expect(refreshNews(interests)).rejects.toThrow();
  });
});
