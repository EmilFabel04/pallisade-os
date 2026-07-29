import type {
  Lead, Task, Project, Interaction, ProposedAction, CollectionKey,
  LeadSource, LeadStatus, LeadQuality, InteractionType,
  ProjectType, ProjectStage, Priority, TaskCategory, TaskStatus,
  Milestone, MilestoneStatus,
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
    milestoneId: orNull(a.milestoneId),
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
  // contact / firmographics
  if (a.company != null) p.company = str(a.company);
  if (a.contactName != null) p.contactName = str(a.contactName);
  if (a.contactRole != null) p.contactRole = str(a.contactRole);
  if (a.email != null) p.email = str(a.email);
  if (a.phone != null) p.phone = str(a.phone);
  if (a.linkedinUrl != null) p.linkedinUrl = str(a.linkedinUrl);
  if (a.industry != null) p.industry = str(a.industry);
  if (a.companyType != null) p.companyType = str(a.companyType);
  if (a.source != null) p.source = a.source as LeadSource;
  if (a.owner != null) p.owner = str(a.owner);
  // pipeline
  if (a.status != null) p.status = a.status as LeadStatus;
  if (a.quality != null) p.quality = a.quality as LeadQuality;
  if (a.nextFollowUp !== undefined) p.nextFollowUp = orNull(a.nextFollowUp);
  if (a.lastContact !== undefined) p.lastContact = orNull(a.lastContact);
  if (a.notes != null) p.notes = str(a.notes);
  if (a.painPoint != null) p.painPoint = str(a.painPoint);
  if (a.objection != null) p.objection = str(a.objection);
  if (a.buyingSignal != null) p.buyingSignal = str(a.buyingSignal);
  if (a.solutionIdea != null) p.solutionIdea = str(a.solutionIdea);
  if (a.estimatedValue != null) p.estimatedValue = Number(a.estimatedValue) || 0;
  return p;
}

export function buildTaskPatch(a: Args): Partial<Task> {
  const p: Partial<Task> = {};
  if (a.title != null) p.title = str(a.title);
  if (a.category != null) p.category = a.category as TaskCategory;
  if (a.priority != null) p.priority = a.priority as Priority;
  if (a.status != null) p.status = a.status as TaskStatus;
  if (a.dueDate !== undefined) p.dueDate = orNull(a.dueDate);
  if (a.notes != null) p.notes = str(a.notes);
  if (a.milestoneId !== undefined) p.milestoneId = orNull(a.milestoneId);
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
    repoPath: orNull(a.repoPath),
  };
}

const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x)) : [];

export function buildMilestone(a: Args): New<Milestone> {
  return {
    projectId: str(a.projectId),
    name: str(a.name),
    startDate: orNull(a.startDate),
    endDate: orNull(a.endDate),
    status: (a.status as MilestoneStatus) ?? "planned",
    order: Number(a.order) || 0,
    dependsOn: strArray(a.dependsOn),
    commitScope: str(a.commitScope),
    notes: str(a.notes),
  };
}

/** Only the keys actually present, so an update never blanks a field by omission. */
export function buildMilestonePatch(a: Args): Partial<Milestone> {
  const p: Partial<Milestone> = {};
  if (a.name !== undefined) p.name = str(a.name);
  if (a.startDate !== undefined) p.startDate = orNull(a.startDate);
  if (a.endDate !== undefined) p.endDate = orNull(a.endDate);
  if (a.status !== undefined) p.status = a.status as MilestoneStatus;
  if (a.order !== undefined) p.order = Number(a.order) || 0;
  if (a.dependsOn !== undefined) p.dependsOn = strArray(a.dependsOn);
  if (a.commitScope !== undefined) p.commitScope = str(a.commitScope);
  if (a.notes !== undefined) p.notes = str(a.notes);
  return p;
}

export function buildProjectPatch(a: Args): Partial<Project> {
  const p: Partial<Project> = {};
  if (a.name !== undefined) p.name = str(a.name);
  if (a.stage !== undefined) p.stage = a.stage as ProjectStage;
  if (a.priority !== undefined) p.priority = a.priority as Priority;
  if (a.startDate !== undefined) p.startDate = orNull(a.startDate);
  if (a.dueDate !== undefined) p.dueDate = orNull(a.dueDate);
  if (a.currentBlocker !== undefined) p.currentBlocker = str(a.currentBlocker);
  if (a.nextAction !== undefined) p.nextAction = str(a.nextAction);
  if (a.deliverables !== undefined) p.deliverables = str(a.deliverables);
  if (a.notes !== undefined) p.notes = str(a.notes);
  return p;
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

type Created = { id: string };
const idOf = (rec: unknown): string => (rec as Created)?.id ?? "";

/**
 * Apply a confirmed action through the store's existing CRUD.
 * Returns where the affected record lives so the UI can deep-link to it
 * (`/<page>?focus=<id>`), or null if nothing addressable was touched.
 */
export function applyAction(
  store: AdvisorStore,
  action: ProposedAction,
): { kind: CollectionKey; id: string } | null {
  const a = action.args ?? {};
  switch (action.tool) {
    case "create_task":
      return { kind: "tasks", id: idOf(store.create("tasks", buildTask(a))) };
    case "create_lead":
      return { kind: "leads", id: idOf(store.create("leads", buildLead(a))) };
    case "create_project":
      return { kind: "projects", id: idOf(store.create("projects", buildProject(a))) };
    case "log_interaction":
      return { kind: "interactions", id: idOf(store.create("interactions", buildInteraction(a))) };
    case "update_lead": {
      const id = str(a.id);
      if (!id) return null;
      store.update("leads", id, buildLeadPatch(a));
      return { kind: "leads", id };
    }
    case "update_task": {
      const id = str(a.id);
      if (!id) return null;
      store.update("tasks", id, buildTaskPatch(a));
      return { kind: "tasks", id };
    }
    // Milestones have no page of their own, so every milestone write deep-links
    // to its project. /projects?focus=<projectId> redirects to /projects/<id>.
    case "create_milestone": {
      const projectId = str(a.projectId);
      if (!projectId) return null;
      store.create("milestones", buildMilestone(a));
      return { kind: "projects", id: projectId };
    }
    case "update_milestone": {
      const id = str(a.id);
      const projectId = str(a.projectId);
      if (!id || !projectId) return null;
      store.update("milestones", id, buildMilestonePatch(a));
      return { kind: "projects", id: projectId };
    }
    case "update_project": {
      const id = str(a.id);
      if (!id) return null;
      store.update("projects", id, buildProjectPatch(a));
      return { kind: "projects", id };
    }
    default:
      return null;
  }
}
