import type {
  Lead, Task, Project, Interaction, ProposedAction,
  LeadSource, LeadStatus, LeadQuality, InteractionType,
  ProjectType, ProjectStage, Priority, TaskCategory, TaskStatus,
} from "@/lib/types";
import { todayISO } from "@/lib/utils";

type Args = Record<string, unknown>;
type New<T> = Omit<T, "id" | "createdAt" | "updatedAt">;

const str = (v: unknown) => (v == null ? "" : String(v));
const orNull = (v: unknown) => (v == null || v === "" ? null : String(v));

/** Minimal store surface applyAction needs (matches the real store's CRUD). */
export interface AdvisorStore {
  create: (key: string, value: unknown) => unknown;
  update: (key: string, id: string, patch: unknown) => void;
}

export function buildTask(a: Args): New<Task> {
  return {
    title: str(a.title),
    linkKind: (a.linkKind as Task["linkKind"]) ?? "none",
    linkId: orNull(a.linkId),
    category: (a.category as TaskCategory) ?? "follow-up",
    priority: (a.priority as Priority) ?? "medium",
    status: (a.status as TaskStatus) ?? "not started",
    dueDate: orNull(a.dueDate),
    notes: str(a.notes),
  };
}

export function buildLead(a: Args): New<Lead> {
  return {
    company: str(a.company),
    contactName: str(a.contactName),
    contactRole: str(a.contactRole),
    email: str(a.email),
    phone: str(a.phone),
    linkedinUrl: str(a.linkedinUrl),
    industry: str(a.industry),
    companyType: str(a.companyType),
    source: (a.source as LeadSource) ?? "warm lead",
    status: (a.status as LeadStatus) ?? "new",
    quality: (a.quality as LeadQuality) ?? "medium",
    painPoint: str(a.painPoint),
    objection: str(a.objection),
    buyingSignal: str(a.buyingSignal),
    lastContact: orNull(a.lastContact),
    nextFollowUp: orNull(a.nextFollowUp),
    notes: str(a.notes),
    solutionIdea: str(a.solutionIdea),
    estimatedValue: Number(a.estimatedValue) || 0,
    owner: str(a.owner),
  };
}

export function buildLeadPatch(a: Args): Partial<Lead> {
  const p: Partial<Lead> = {};
  if (a.status != null) p.status = a.status as LeadStatus;
  if (a.quality != null) p.quality = a.quality as LeadQuality;
  if (a.nextFollowUp !== undefined) p.nextFollowUp = orNull(a.nextFollowUp);
  if (a.lastContact !== undefined) p.lastContact = orNull(a.lastContact);
  if (a.notes != null) p.notes = str(a.notes);
  if (a.painPoint != null) p.painPoint = str(a.painPoint);
  if (a.objection != null) p.objection = str(a.objection);
  if (a.buyingSignal != null) p.buyingSignal = str(a.buyingSignal);
  if (a.estimatedValue != null) p.estimatedValue = Number(a.estimatedValue) || 0;
  return p;
}

export function buildProject(a: Args): New<Project> {
  return {
    name: str(a.name),
    company: str(a.company),
    type: (a.type as ProjectType) ?? "paid project",
    stage: (a.stage as ProjectStage) ?? "idea",
    priority: (a.priority as Priority) ?? "medium",
    startDate: orNull(a.startDate),
    dueDate: orNull(a.dueDate),
    currentMilestone: str(a.currentMilestone),
    currentBlocker: str(a.currentBlocker),
    nextAction: str(a.nextAction),
    deliverables: str(a.deliverables),
    notes: str(a.notes),
  };
}

export function buildInteraction(a: Args): New<Interaction> {
  return {
    leadId: orNull(a.leadId),
    company: str(a.company),
    contact: str(a.contact),
    date: a.date ? str(a.date) : todayISO(),
    type: (a.type as InteractionType) ?? "discovery call",
    rawNotes: str(a.rawNotes),
    whatTheySaid: str(a.whatTheySaid),
    painPoints: str(a.painPoints),
    objections: str(a.objections),
    buyingSignals: str(a.buyingSignals),
    followUpRequired: Boolean(a.followUpRequired),
    followUpDate: orNull(a.followUpDate),
  };
}

/** Apply a confirmed action through the store's existing CRUD. */
export function applyAction(store: AdvisorStore, action: ProposedAction): void {
  const a = action.args ?? {};
  switch (action.tool) {
    case "create_task": store.create("tasks", buildTask(a)); break;
    case "create_lead": store.create("leads", buildLead(a)); break;
    case "create_project": store.create("projects", buildProject(a)); break;
    case "log_interaction": store.create("interactions", buildInteraction(a)); break;
    case "update_lead": {
      const id = str(a.id);
      if (id) store.update("leads", id, buildLeadPatch(a));
      break;
    }
    default: break;
  }
}
