import type {
  Interaction,
  Lead,
  LeadStatus,
  Project,
  Scorecard,
  Task,
} from "./types";
import { LEAD_STATUSES } from "./types";
import { isToday, todayISO } from "./utils";

export function todayScorecard(scorecards: Scorecard[]): Scorecard | null {
  return scorecards.find((s) => s.date === todayISO()) ?? null;
}

export function latestScorecard(scorecards: Scorecard[]): Scorecard | null {
  if (!scorecards.length) return null;
  return [...scorecards].sort((a, b) => b.date.localeCompare(a.date))[0];
}

const DEAD_STATUSES: LeadStatus[] = ["won", "lost", "not a fit"];

export interface FollowUpItem {
  id: string;
  kind: "lead" | "task";
  title: string;
  subtitle: string;
  date: string;
  overdue: boolean;
  refId: string;
}

export function followUps(leads: Lead[], tasks: Task[]): FollowUpItem[] {
  const today = todayISO();
  const items: FollowUpItem[] = [];

  for (const l of leads) {
    if (!l.nextFollowUp) continue;
    if (DEAD_STATUSES.includes(l.status)) continue;
    if (l.nextFollowUp.slice(0, 10) <= today) {
      items.push({
        id: `lead-${l.id}`,
        kind: "lead",
        title: l.company,
        subtitle: `${l.contactName || "—"} · ${l.status}`,
        date: l.nextFollowUp,
        overdue: l.nextFollowUp.slice(0, 10) < today,
        refId: l.id,
      });
    }
  }

  for (const t of tasks) {
    if (t.status === "done" || !t.dueDate) continue;
    if (t.category !== "follow-up") continue;
    if (t.dueDate.slice(0, 10) <= today) {
      items.push({
        id: `task-${t.id}`,
        kind: "task",
        title: t.title,
        subtitle: `Task · ${t.priority} priority`,
        date: t.dueDate,
        overdue: t.dueDate.slice(0, 10) < today,
        refId: t.id,
      });
    }
  }

  return items.sort((a, b) => a.date.localeCompare(b.date));
}

export function followUpsDueToday(leads: Lead[], tasks: Task[]): number {
  return followUps(leads, tasks).length;
}

export function pipelineCounts(leads: Lead[]): { status: LeadStatus; count: number }[] {
  return LEAD_STATUSES.map((status) => ({
    status,
    count: leads.filter((l) => l.status === status).length,
  }));
}

export function activeProjects(projects: Project[]): Project[] {
  return projects.filter((p) => p.stage !== "closed");
}

export function openTasks(tasks: Task[]): Task[] {
  return tasks.filter((t) => t.status !== "done");
}

export function pipelineValue(leads: Lead[]): number {
  return leads
    .filter((l) => !DEAD_STATUSES.includes(l.status))
    .reduce((sum, l) => sum + (l.estimatedValue || 0), 0);
}

export interface ActivityItem {
  id: string;
  kind: string;
  icon: "lead" | "interaction" | "project" | "task" | "scorecard";
  title: string;
  subtitle: string;
  at: string;
}

export function recentActivity(
  leads: Lead[],
  interactions: Interaction[],
  projects: Project[],
  tasks: Task[],
  limit = 8,
): ActivityItem[] {
  const items: ActivityItem[] = [];

  for (const it of interactions)
    items.push({
      id: it.id,
      kind: "Interaction",
      icon: "interaction",
      title: `${it.type} — ${it.company}`,
      subtitle: it.contact || "",
      at: it.updatedAt,
    });
  for (const l of leads)
    items.push({
      id: l.id,
      kind: "Lead",
      icon: "lead",
      title: l.company,
      subtitle: `${l.status}${l.contactName ? ` · ${l.contactName}` : ""}`,
      at: l.updatedAt,
    });
  for (const t of tasks)
    items.push({
      id: t.id,
      kind: "Task",
      icon: "task",
      title: t.title,
      subtitle: `${t.status} · ${t.category}`,
      at: t.updatedAt,
    });
  for (const p of projects)
    items.push({
      id: p.id,
      kind: "Project",
      icon: "project",
      title: p.name,
      subtitle: `${p.stage} · ${p.company}`,
      at: p.updatedAt,
    });

  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

export interface DashboardMetrics {
  dials: number;
  emails: number;
  linkedinMessages: number;
  replies: number;
  callsBooked: number;
  leadsCreatedToday: number;
  activeProjects: number;
  followUpsDue: number;
}

export function dashboardMetrics(
  leads: Lead[],
  projects: Project[],
  tasks: Task[],
  scorecards: Scorecard[],
): DashboardMetrics {
  const sc = todayScorecard(scorecards);
  const leadsCreatedToday = leads.filter((l) => isToday(l.createdAt)).length;
  return {
    dials: sc?.dials ?? 0,
    emails: sc?.emails ?? 0,
    linkedinMessages: sc?.linkedinMessages ?? 0,
    replies: sc?.replies ?? 0,
    callsBooked: sc?.meetingsBooked ?? 0,
    leadsCreatedToday: Math.max(leadsCreatedToday, sc?.leadsCreated ?? 0),
    activeProjects: activeProjects(projects).length,
    followUpsDue: followUpsDueToday(leads, tasks),
  };
}

export interface AllTimeMetrics {
  meetingsBooked: number;
  callsMade: number;
  linkedinPosts: number;
  projectsBuilt: number;
  projectsPitched: number;
  waitingForFeedback: number;
  cashCollected: number;
}

const BUILT_STAGES: string[] = ["building", "testing", "demo-ready", "sent", "closed"];
const PITCHED_STAGES: string[] = ["demo-ready", "sent", "closed"];
const PITCHED_TYPES: string[] = ["proposal", "demo"];
const WAITING_STAGES: string[] = ["sent", "demo-ready"];

export function allTimeMetrics(
  scorecards: Scorecard[],
  projects: Project[],
): AllTimeMetrics {
  const sum = (pick: (s: Scorecard) => number) =>
    scorecards.reduce((acc, s) => acc + (pick(s) || 0), 0);

  return {
    meetingsBooked: sum((s) => s.meetingsBooked),
    callsMade: sum((s) => s.dials),
    linkedinPosts: sum((s) => s.linkedinPosts),
    projectsBuilt: projects.filter((p) => BUILT_STAGES.includes(p.stage)).length,
    projectsPitched: projects.filter(
      (p) => PITCHED_STAGES.includes(p.stage) || PITCHED_TYPES.includes(p.type),
    ).length,
    waitingForFeedback: projects.filter((p) => WAITING_STAGES.includes(p.stage)).length,
    cashCollected: sum((s) => s.revenueClosed),
  };
}
