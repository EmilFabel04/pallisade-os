import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendProjectMessage } from "./projectClient";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

const ok = (json: unknown) => ({ ok: true, json: async () => json });

describe("sendProjectMessage", () => {
  it("sends a projectId and no snapshot", async () => {
    fetchMock.mockResolvedValue(ok({ content: "hi", actions: [], stoppedBy: "end" }));
    await sendProjectMessage({
      projectId: "p1",
      messages: [{ role: "user", content: "status?" }],
      context: { businessName: "Pallisade", founderName: "Emil" },
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.projectId).toBe("p1");
    expect(body).not.toHaveProperty("snapshot");
  });

  it("carries the stop reason through so the UI can say the answer was cut short", async () => {
    fetchMock.mockResolvedValue(ok({ content: "partial", actions: [], stoppedBy: "max_iterations" }));
    const reply = await sendProjectMessage({
      projectId: "p1",
      messages: [{ role: "user", content: "status?" }],
      context: { businessName: "P", founderName: "E" },
    });
    expect(reply.stoppedBy).toBe("max_iterations");
  });

  it("throws the server's error code so the component can match on it", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "agent_unconfigured" }) });
    await expect(sendProjectMessage({
      projectId: "p1",
      messages: [{ role: "user", content: "hi" }],
      context: { businessName: "P", founderName: "E" },
    })).rejects.toThrow("agent_unconfigured");
  });
});
