import type {
  InteractionType,
  LeadQuality,
  LeadStatus,
  MilestoneStatus,
  Priority,
  ProjectStage,
  QuoteStatus,
  TaskStatus,
  Urgency,
} from "./types";

export type Tone =
  | "neutral"
  | "positive"
  | "warning"
  | "accent"
  | "info"
  | "muted";

export const TONE_STYLE: Record<Tone, { color: string; border: string; bg: string }> = {
  neutral: { color: "#b6b6bd", border: "#2e2e35", bg: "transparent" },
  positive: { color: "#3dd68c", border: "#1e6b46", bg: "rgba(61,214,140,0.08)" },
  warning: { color: "#e3b341", border: "#6b5417", bg: "rgba(227,179,65,0.08)" },
  accent: { color: "#f0595e", border: "#6e2628", bg: "rgba(229,72,77,0.1)" },
  info: { color: "#7db4e6", border: "#2c4a66", bg: "rgba(91,155,213,0.08)" },
  muted: { color: "#87878f", border: "#26262b", bg: "transparent" },
};

export function leadStatusTone(s: LeadStatus): Tone {
  switch (s) {
    case "won":
      return "positive";
    case "interested":
    case "call booked":
    case "proposal":
      return "accent";
    case "replied":
      return "info";
    case "contacted":
    case "new":
      return "neutral";
    case "lost":
    case "not a fit":
      return "muted";
    default:
      return "neutral";
  }
}

export function qualityTone(q: LeadQuality): Tone {
  return q === "high" ? "positive" : q === "medium" ? "warning" : "muted";
}

export function priorityTone(p: Priority): Tone {
  return p === "high" ? "accent" : p === "medium" ? "warning" : "muted";
}

export function urgencyTone(u: Urgency): Tone {
  return u === "high" ? "accent" : u === "medium" ? "warning" : "muted";
}

export function taskStatusTone(s: TaskStatus): Tone {
  switch (s) {
    case "done":
      return "positive";
    case "in progress":
      return "info";
    case "blocked":
      return "accent";
    case "not started":
      return "neutral";
    default:
      return "neutral";
  }
}

export function milestoneStatusTone(s: MilestoneStatus): Tone {
  switch (s) {
    case "done":
      return "positive";
    case "in progress":
      return "accent";
    case "blocked":
      return "warning";
    case "planned":
      return "neutral";
    default:
      return "neutral";
  }
}

export function projectStageTone(s: ProjectStage): Tone {
  switch (s) {
    case "closed":
      return "positive";
    case "sent":
    case "demo-ready":
      return "accent";
    case "building":
    case "testing":
      return "info";
    case "idea":
    case "discovery":
    case "planning":
      return "neutral";
    default:
      return "neutral";
  }
}

export function interactionTone(t: InteractionType): Tone {
  switch (t) {
    case "demo":
    case "discovery call":
      return "accent";
    case "meeting":
      return "info";
    case "email reply":
    case "LinkedIn reply":
      return "positive";
    case "cold call":
      return "neutral";
    default:
      return "neutral";
  }
}

export function quoteStatusTone(s: QuoteStatus): Tone {
  switch (s) {
    case "won":
      return "positive";
    case "lost":
      return "muted";
    case "sent":
      return "info";
    default:
      return "neutral";
  }
}
