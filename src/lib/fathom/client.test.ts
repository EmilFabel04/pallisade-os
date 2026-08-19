import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  listMeetings, getTranscript,
  FathomAuthError, FathomRateLimitError, FathomError,
} from "./client";
import { isConfigured as configured } from "./config";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  process.env.FATHOM_API_KEY = "test-key";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.FATHOM_API_KEY;
});

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const fail = (status: number) => ({ ok: false, status, json: async () => ({}) });

describe("isConfigured", () => {
  it("is true only when FATHOM_API_KEY is set", () => {
    expect(configured()).toBe(true);
    delete process.env.FATHOM_API_KEY;
    expect(configured()).toBe(false);
  });
});

describe("listMeetings", () => {
  it("calls the documented URL with the API key header", async () => {
    fetchMock.mockResolvedValue(ok({ items: [], next_cursor: null }));
    await listMeetings({ createdAfter: "2026-05-21T00:00:00.000Z" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("https://api.fathom.ai/external/v1/meetings");
    expect(String(url)).toContain("created_after=2026-05-21T00%3A00%3A00.000Z");
    expect(init.headers["X-Api-Key"]).toBe("test-key");
  });

  it("passes a cursor through and returns the next one", async () => {
    fetchMock.mockResolvedValue(ok({ items: [], next_cursor: "cur-2" }));
    const page = await listMeetings({ cursor: "cur-1" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("cursor=cur-1");
    expect(page.nextCursor).toBe("cur-2");
  });

  it("returns null for nextCursor when the API omits it", async () => {
    fetchMock.mockResolvedValue(ok({ items: [] }));
    expect((await listMeetings({})).nextCursor).toBeNull();
  });

  it("returns the items array untouched", async () => {
    fetchMock.mockResolvedValue(ok({ items: [{ recording_id: "rec-1" }], next_cursor: null }));
    const page = await listMeetings({});
    expect(page.items[0].recording_id).toBe("rec-1");
  });

  it("throws FathomAuthError on 401", async () => {
    fetchMock.mockResolvedValue(fail(401));
    await expect(listMeetings({})).rejects.toBeInstanceOf(FathomAuthError);
  });

  it("throws FathomRateLimitError on 429", async () => {
    fetchMock.mockResolvedValue(fail(429));
    await expect(listMeetings({})).rejects.toBeInstanceOf(FathomRateLimitError);
  });

  it("throws FathomError carrying the status on any other non-2xx", async () => {
    fetchMock.mockResolvedValue(fail(503));
    await expect(listMeetings({})).rejects.toMatchObject({ status: 503 });
  });

  it("throws rather than calling fetch when no key is set", async () => {
    delete process.env.FATHOM_API_KEY;
    await expect(listMeetings({})).rejects.toThrow(/FATHOM_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getTranscript", () => {
  // speaker is an OBJECT with display_name, not a string. The fixture omits any
  // string-shaped speaker so code that treats it as one yields undefined here.
  it("unwraps the transcript array from the response envelope", async () => {
    fetchMock.mockResolvedValue(ok({
      transcript: [
        { speaker: { display_name: "Emil", matched_calendar_invitee_email: null },
          text: "Let's talk pricing", timestamp: "00:01:12" },
      ],
    }));
    const lines = await getTranscript("rec-1");
    expect(lines).toHaveLength(1);
    expect(lines[0].speaker?.display_name).toBe("Emil");
    expect(lines[0].text).toBe("Let's talk pricing");
  });

  it("requests the documented recordings path", async () => {
    fetchMock.mockResolvedValue(ok({ transcript: [] }));
    await getTranscript("rec-9");
    expect(String(fetchMock.mock.calls[0][0]))
      .toContain("https://api.fathom.ai/external/v1/recordings/rec-9/transcript");
  });

  // destination_url switches the endpoint to an async callback that returns no
  // transcript at all. Sending it would look like an empty meeting.
  it("never sends destination_url", async () => {
    fetchMock.mockResolvedValue(ok({ transcript: [] }));
    await getTranscript("rec-9");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("destination_url");
  });

  it("returns an empty array when the envelope has no transcript", async () => {
    fetchMock.mockResolvedValue(ok({}));
    expect(await getTranscript("rec-1")).toEqual([]);
  });
});
