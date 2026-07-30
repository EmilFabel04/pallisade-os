import type { ProposedAction } from "@/lib/types";
import type { ProjectSnapshot } from "./tools";

export interface ProjectChatRequest {
  messages: { role: "user" | "assistant"; content: string }[];
  snapshot: ProjectSnapshot;
  context: { businessName: string; founderName: string };
}

export interface ProjectChatReply {
  content: string;
  actions: ProposedAction[];
}

export async function sendProjectMessage(req: ProjectChatRequest): Promise<ProjectChatReply> {
  const res = await fetch("/api/projects/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "request_failed");
  return { content: json.content ?? "", actions: json.actions ?? [] };
}

export async function projectChatConfigured(): Promise<boolean> {
  try {
    const res = await fetch("/api/projects/chat");
    return !!(await res.json()).configured;
  } catch {
    return false;
  }
}
