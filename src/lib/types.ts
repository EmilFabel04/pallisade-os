/* ============================================================
   Pallisade OS — domain model
   Every entity carries id / createdAt / updatedAt so the local
   store and a future Supabase/Firebase backend share one shape.
   ============================================================ */

export interface BaseRecord {
  id: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

/* ---------- enums (string unions) ---------- */

export const LEAD_SOURCES = [
  "cold call",
  "LinkedIn",
  "email",
  "referral",
  "warm lead",
  "website",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_STATUSES = [
  "new",
  "contacted",
  "replied",
  "interested",
  "call booked",
  "proposal",
  "won",
  "lost",
  "not a fit",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_QUALITIES = ["low", "medium", "high"] as const;
export type LeadQuality = (typeof LEAD_QUALITIES)[number];

export const INTERACTION_TYPES = [
  "cold call",
  "discovery call",
  "email reply",
  "LinkedIn reply",
  "meeting",
  "demo",
] as const;
export type InteractionType = (typeof INTERACTION_TYPES)[number];

export const PROJECT_TYPES = [
  "demo",
  "paid project",
  "internal product",
  "proposal",
  "research",
] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_STAGES = [
  "idea",
  "discovery",
  "planning",
  "building",
  "testing",
  "demo-ready",
  "sent",
  "closed",
] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const PRIORITIES = ["low", "medium", "high"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const TASK_CATEGORIES = [
  "sales",
  "product",
  "delivery",
  "admin",
  "SEO",
  "outreach",
  "follow-up",
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const TASK_STATUSES = [
  "not started",
  "in progress",
  "blocked",
  "done",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const URGENCIES = ["low", "medium", "high"] as const;
export type Urgency = (typeof URGENCIES)[number];

/* ---------- entities ---------- */

export interface Lead extends BaseRecord {
  company: string;
  contactName: string;
  contactRole: string;
  email: string;
  phone: string;
  linkedinUrl: string;
  industry: string;
  companyType: string;
  source: LeadSource;
  status: LeadStatus;
  quality: LeadQuality;
  painPoint: string;
  objection: string;
  buyingSignal: string;
  lastContact: string | null; // ISO date
  nextFollowUp: string | null; // ISO date
  notes: string;
  solutionIdea: string;
  estimatedValue: number; // in base currency
  owner: string;
}

export interface Interaction extends BaseRecord {
  leadId: string | null;
  company: string;
  contact: string;
  date: string; // ISO date
  type: InteractionType;
  rawNotes: string;
  whatTheySaid: string;
  painPoints: string;
  objections: string;
  buyingSignals: string;
  followUpRequired: boolean;
  followUpDate: string | null;
  /** Output of the mock AI summariser, if generated */
  summary?: CallSummary;
}

export interface CallSummary {
  cleanSummary: string;
  keyPainPoints: string[];
  objections: string[];
  buyingSignals: string[];
  suggestedFollowUpMessage: string;
  suggestedNextStep: string;
  offerAngle: string;
  generatedAt: string;
}

export interface Project extends BaseRecord {
  name: string;
  company: string;
  type: ProjectType;
  stage: ProjectStage;
  priority: Priority;
  startDate: string | null;
  dueDate: string | null;
  currentMilestone: string;
  currentBlocker: string;
  nextAction: string;
  deliverables: string;
  notes: string;
}

export interface Task extends BaseRecord {
  title: string;
  /** linked lead or project — kind disambiguates the id */
  linkKind: "lead" | "project" | "none";
  linkId: string | null;
  category: TaskCategory;
  priority: Priority;
  status: TaskStatus;
  dueDate: string | null;
  notes: string;
}

export interface Scorecard extends BaseRecord {
  date: string; // ISO date (one per day)
  dials: number;
  emails: number;
  linkedinMessages: number;
  replies: number;
  conversations: number;
  leadsCreated: number;
  meetingsBooked: number;
  proposalsSent: number;
  productHours: number;
  seoWork: string;
  revenueClosed: number;
  wins: string;
  problems: string;
  lessons: string;
  avoidTomorrow: string;
}

export interface PainPoint extends BaseRecord {
  painPoint: string;
  industry: string;
  companyType: string;
  whoMentioned: string;
  frequency: number;
  workaround: string;
  possibleSolution: string;
  urgency: Urgency;
  willingnessToPay: Urgency; // low / medium / high
  notes: string;
}

export interface BusinessReview {
  whatHappened: string[];
  movedForward: string[];
  wastedTime: string[];
  bestOpportunities: string[];
  risks: string[];
  followUps: string[];
  topPriorities: string[];
  outreachFocus: string;
  buildFocus: string;
  generatedAt: string;
}

/* ---------- sales advisor chat ---------- */

export interface ProposedAction {
  id: string;
  tool: string;                       // e.g. "create_task"
  description: string;                // human-readable, shown on the card
  args: Record<string, unknown>;
  status: "pending" | "confirmed" | "dismissed";
  /** Set after a write is confirmed, so the card can deep-link to the record. */
  result?: { kind: CollectionKey; id: string };
  /** External link for actions that live outside the OS (e.g. a calendar event). */
  externalUrl?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: ProposedAction[];         // assistant turns only
  createdAt: string;                  // ISO
}

export interface Conversation extends BaseRecord {
  title: string;                      // auto-derived from the first user message
  messages: ChatMessage[];
}

export interface Settings {
  businessName: string;
  founderName: string;
  mainMarket: string;
  services: string;
  accentColor: string;
  currency: "ZAR" | "USD";
  secondaryCurrencyEnabled: boolean;
}

/* ---------- collections registry ---------- */

export interface DataShape {
  leads: Lead[];
  interactions: Interaction[];
  projects: Project[];
  tasks: Task[];
  scorecards: Scorecard[];
  painPoints: PainPoint[];
  conversations: Conversation[];
  settings: Settings;
}

export type CollectionKey = Exclude<keyof DataShape, "settings">;

/** What the Sales Advisor route receives as the current data picture. */
export type AdvisorSnapshot = Omit<DataShape, "conversations">;
