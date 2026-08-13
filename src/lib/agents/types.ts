import type { AdvisorSnapshot, ProposedAction } from "@/lib/types";

export const CAPABILITY_GROUPS = [
  "crm", "email", "calendar", "drive", "projects", "web", "writes", "repo", "fathom",
] as const;
export type CapabilityGroup = (typeof CAPABILITY_GROUPS)[number];

export const AGENT_SURFACES = ["brain", "advisor", "project"] as const;
export type AgentSurface = (typeof AGENT_SURFACES)[number];

export interface AgentSpec {
  id: string;
  name: string;
  description: string;
  color: string;
  emoji: string;
  vibe: string;
  surface: AgentSurface;
  tools: CapabilityGroup[];
  model?: string;
  body: string;
}

/** Browser-safe projection. Never carries `body` or `tools`. */
export interface AgentCard {
  id: string;
  name: string;
  description: string;
  color: string;
  emoji: string;
  vibe: string;
}

/**
 * Everything a tool resolver may need, assembled SERVER-SIDE.
 * The client sends an agentId and messages; it never supplies this.
 */
export interface AgentContext {
  today: string;
  businessName: string;
  founderName: string;
  services: string;
  snapshot: AdvisorSnapshot | null;
  proposals: ProposedAction[];
  emailEnabled: boolean;
  calendarEnabled: boolean;
  driveAccountId: string | null;
}
