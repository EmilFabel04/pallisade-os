import type {
  AdvisorSnapshot, Lead, Task, Project, Interaction, PainPoint,
} from "@/lib/types";
import {
  pipelineCounts, pipelineValue, dashboardMetrics, followUps,
} from "@/lib/selectors";

/* ---------- compact projections (keep tool results small) ---------- */

const compactLead = (l: Lead) => ({
  id: l.id, company: l.company, contact: l.contactName, status: l.status,
  quality: l.quality, source: l.source, industry: l.industry,
  nextFollowUp: l.nextFollowUp, lastContact: l.lastContact,
  estimatedValue: l.estimatedValue, painPoint: l.painPoint, buyingSignal: l.buyingSignal,
});
const compactTask = (t: Task) => ({
  id: t.id, title: t.title, status: t.status, category: t.category,
  priority: t.priority, dueDate: t.dueDate, linkKind: t.linkKind, linkId: t.linkId,
});
const compactProject = (p: Project) => ({
  id: p.id, name: p.name, company: p.company, type: p.type, stage: p.stage,
  priority: p.priority, dueDate: p.dueDate, nextAction: p.nextAction, currentBlocker: p.currentBlocker,
});
const compactInteraction = (it: Interaction) => ({
  id: it.id, leadId: it.leadId, company: it.company, contact: it.contact,
  date: it.date, type: it.type, painPoints: it.painPoints, buyingSignals: it.buyingSignals,
});
const compactPain = (p: PainPoint) => ({
  id: p.id, painPoint: p.painPoint, industry: p.industry, urgency: p.urgency,
  frequency: p.frequency, possibleSolution: p.possibleSolution,
});

const lc = (v: unknown) => String(v ?? "").toLowerCase();

/* ---------- resolvers ---------- */

export function queryLeads(s: AdvisorSnapshot, a: Record<string, unknown>) {
  let out = s.leads;
  if (a.status) out = out.filter((l) => l.status === a.status);
  if (a.quality) out = out.filter((l) => l.quality === a.quality);
  if (a.source) out = out.filter((l) => l.source === a.source);
  if (a.industry) out = out.filter((l) => lc(l.industry).includes(lc(a.industry)));
  if (a.hasFollowUp) out = out.filter((l) => !!l.nextFollowUp);
  return out.slice(0, Number(a.limit) || 25).map(compactLead);
}

export function queryTasks(s: AdvisorSnapshot, a: Record<string, unknown>) {
  let out = s.tasks;
  if (a.status) out = out.filter((t) => t.status === a.status);
  if (a.category) out = out.filter((t) => t.category === a.category);
  if (a.priority) out = out.filter((t) => t.priority === a.priority);
  return out.slice(0, Number(a.limit) || 30).map(compactTask);
}

export function queryProjects(s: AdvisorSnapshot, a: Record<string, unknown>) {
  let out = s.projects;
  if (a.stage) out = out.filter((p) => p.stage === a.stage);
  if (a.type) out = out.filter((p) => p.type === a.type);
  if (a.priority) out = out.filter((p) => p.priority === a.priority);
  return out.slice(0, Number(a.limit) || 30).map(compactProject);
}

export function queryInteractions(s: AdvisorSnapshot, a: Record<string, unknown>) {
  let out = s.interactions;
  if (a.leadId) out = out.filter((it) => it.leadId === a.leadId);
  if (a.type) out = out.filter((it) => it.type === a.type);
  if (a.company) out = out.filter((it) => lc(it.company).includes(lc(a.company)));
  return out
    .slice()
    .sort((x, y) => String(y.date).localeCompare(String(x.date)))
    .slice(0, Number(a.limit) || 20)
    .map(compactInteraction);
}

export function searchPainPoints(s: AdvisorSnapshot, a: Record<string, unknown>) {
  let out = s.painPoints;
  if (a.query) out = out.filter((p) => lc(p.painPoint).includes(lc(a.query)) || lc(p.possibleSolution).includes(lc(a.query)));
  if (a.industry) out = out.filter((p) => lc(p.industry).includes(lc(a.industry)));
  if (a.urgency) out = out.filter((p) => p.urgency === a.urgency);
  return out.slice(0, Number(a.limit) || 25).map(compactPain);
}

export function getPipelineMetrics(s: AdvisorSnapshot, _a: Record<string, unknown>) {
  return {
    metrics: dashboardMetrics(s.leads, s.projects, s.tasks, s.scorecards),
    statusCounts: pipelineCounts(s.leads),
    pipelineValue: pipelineValue(s.leads),
    followUpsDue: followUps(s.leads, s.tasks).map((f) => ({
      title: f.title, subtitle: f.subtitle, date: f.date, overdue: f.overdue, kind: f.kind,
    })),
  };
}
