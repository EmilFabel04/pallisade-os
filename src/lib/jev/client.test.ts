import { describe, it, expect, vi, afterEach } from "vitest";
import { evaluate, isConfigured, USD_PER_INPUT_TOKEN } from "@/lib/jev/client";
import { JevError } from "@/lib/jev/types";

const QUESTIONS = { is_urgent: { type: "noul", instructions: "Urgent?" } } as const;

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const BODY = {
  model: "jev-1.13.0",
  answers: { is_urgent: { type: "noul", noul: 0.95 } },
  usage: { input_tokens: 307, output_tokens: 20 },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("isConfigured", () => {
  it("is false without a key", () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    expect(isConfigured()).toBe(false);
  });

  it("is true with a key", () => {
    vi.stubEnv("TYPESAFE_API_KEY", "sk-test");
    expect(isConfigured()).toBe(true);
  });
});

describe("evaluate", () => {
  it("posts state and questions and returns the parsed answers", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "sk-test");
    const fetchMock = vi.fn().mockResolvedValue(ok(BODY));
    vi.stubGlobal("fetch", fetchMock);

    const res = await evaluate("payouts failing", QUESTIONS);

    expect(res.answers.is_urgent).toEqual({ type: "noul", noul: 0.95 });
    expect(res.usage.input_tokens).toBe(307);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    const sent = JSON.parse(init.body as string);
    expect(sent.state).toBe("payouts failing");
    expect(sent.questions).toEqual(QUESTIONS);
  });

  it("throws without a key rather than calling out", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(evaluate("x", QUESTIONS)).rejects.toThrow(JevError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries a 429 and returns the successful retry", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "sk-test");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
      .mockResolvedValueOnce(ok(BODY));
    vi.stubGlobal("fetch", fetchMock);

    const res = await evaluate("x", QUESTIONS);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.answers.is_urgent).toEqual({ type: "noul", noul: 0.95 });
  });

  it("gives up after three attempts on a persistent 529", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "sk-test");
    const fetchMock = vi.fn().mockResolvedValue(new Response("overloaded", { status: 529 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(evaluate("x", QUESTIONS)).rejects.toThrow(/529/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 400", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "sk-test");
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad question", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(evaluate("x", QUESTIONS)).rejects.toThrow(JevError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws on a body that is not the documented shape", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ model: "jev", usage: {} })));

    await expect(evaluate("x", QUESTIONS)).rejects.toThrow(/answers/);
  });

  it("prices input tokens at the published rate", () => {
    expect(USD_PER_INPUT_TOKEN * 1_000_000).toBeCloseTo(0.042, 6);
  });
});
