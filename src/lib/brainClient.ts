import type { AgentStopReason } from "@/lib/agents/types";

export interface BrainReply {
  content: string;
  /** Why the turn ended. Absent on a response from an older server build. */
  stoppedBy?: AgentStopReason;
}

export async function getBrainStatus(): Promise<{ configured: boolean; model: string }> {
  try {
    const res = await fetch("/api/brain", { method: "GET" });
    if (!res.ok) return { configured: false, model: "" };
    return (await res.json()) as { configured: boolean; model: string };
  } catch {
    return { configured: false, model: "" };
  }
}

export async function sendBrainTurn(params: {
  messages: { role: "user" | "assistant"; content: string }[];
  agentId?: string;
  attachments?: { name: string; content: string }[];
  // Presentation strings only. The Drive account is resolved server-side by
  // resolveDriveAccountId for any agent that declares `drive`. The browser
  // used to send it, and only on the brainstorm branch — which is why the
  // strategist's Drive tools answered "not connected" on every call.
  context: { businessName: string; founderName: string; services: string };
}): Promise<BrainReply> {
  const res = await fetch("/api/brain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "request_failed" }));
    if (err.error === "agent_unconfigured") {
      throw new Error("The Brain needs an ANTHROPIC_API_KEY. Add it to .env.local and restart.");
    }
    throw new Error(typeof err.error === "string" ? err.error : "The request failed.");
  }

  return (await res.json()) as BrainReply;
}

export async function getDriveStatus(): Promise<{ connected: boolean; accountId: string | null }> {
  try {
    const res = await fetch("/api/drive/status");
    if (!res.ok) return { connected: false, accountId: null };
    return (await res.json()) as { connected: boolean; accountId: string | null };
  } catch {
    return { connected: false, accountId: null };
  }
}
