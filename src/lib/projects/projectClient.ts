import type { ProposedAction } from "@/lib/types";
import type { AgentStopReason } from "@/lib/agents/types";

export interface ProjectChatRequest {
  messages: { role: "user" | "assistant"; content: string }[];
  /** Which project — never what is in it. The route reads the rest from the DB. */
  projectId: string;
  context: { businessName: string; founderName: string };
}

export interface ProjectChatReply {
  content: string;
  actions: ProposedAction[];
  stoppedBy?: AgentStopReason;
}

export async function sendProjectMessage(req: ProjectChatRequest): Promise<ProjectChatReply> {
  const res = await fetch("/api/projects/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "request_failed");
  return { content: json.content ?? "", actions: json.actions ?? [], stoppedBy: json.stoppedBy };
}

export async function projectChatConfigured(): Promise<boolean> {
  try {
    const res = await fetch("/api/projects/chat");
    return !!(await res.json()).configured;
  } catch {
    return false;
  }
}
