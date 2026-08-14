import type { AdvisorSnapshot, DataShape, ProposedAction } from "./types";

export interface AdvisorContext {
  businessName: string;
  founderName: string;
  services: string;
}

export interface AdvisorReply {
  content: string;
  actions: ProposedAction[];
}

/**
 * Build the data picture sent to the advisor: every business collection except
 * `conversations` (the advisor reads business data, not chat history). We pick the
 * keys explicitly so a caller passing the full store value — with its methods and
 * `ready` flag — doesn't leak those into the request body.
 */
export function buildSnapshot(data: DataShape): AdvisorSnapshot {
  const { leads, interactions, projects, tasks, scorecards, painPoints, dialLists, milestones, quotes, comparables, settings } = data;
  return { leads, interactions, projects, tasks, scorecards, painPoints, dialLists, milestones, quotes, comparables, settings };
}

export async function getAdvisorStatus(): Promise<{ configured: boolean }> {
  try {
    const res = await fetch("/api/advisor", { method: "GET" });
    if (!res.ok) return { configured: false };
    return (await res.json()) as { configured: boolean };
  } catch {
    return { configured: false };
  }
}

export async function sendAdvisorTurn(params: {
  messages: { role: "user" | "assistant"; content: string }[];
  snapshot: AdvisorSnapshot;
  context: AdvisorContext;
}): Promise<AdvisorReply> {
  const res = await fetch("/api/advisor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "request_failed" }));
    if (err.error === "agent_unconfigured") {
      throw new Error("The Sales Advisor needs an ANTHROPIC_API_KEY. Add it to .env.local and restart.");
    }
    throw new Error(typeof err.error === "string" ? err.error : "The advisor request failed.");
  }

  return (await res.json()) as AdvisorReply;
}
