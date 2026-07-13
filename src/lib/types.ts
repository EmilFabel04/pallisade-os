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

/* ---------- content studio ---------- */

export type ContentType = "social" | "script" | "longform";

export interface PositioningProfile extends BaseRecord {
  name: string;   // e.g. "Pallisade — boutique asset managers"
  body: string;   // the pasted positioning document
}

export interface ContentThread extends BaseRecord {
  title: string;                      // auto-derived from the first user message
  messages: ChatMessage[];
  profileId: string | null;           // selected positioning profile
  contentType: ContentType;           // selected content type
}

/* ---------- the brain (CEO / strategist) ---------- */

export interface BrainAttachment {
  id: string;
  name: string;        // file name, e.g. "discovery-call-acme.md"
  content: string;     // raw text
  createdAt: string;
}

export interface BrainThread extends BaseRecord {
  title: string;                      // auto-derived from the first user message
  mode: "strategist" | "brainstorm";   // legacy rows read as "strategist" via threadMode()
  messages: ChatMessage[];
  attachments?: BrainAttachment[];      // brainstorm session source docs
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

/* ---------- meeting prep playbook ---------- */

export type Confidence = "new" | "learning" | "known";

/** Fields every playbook card shares. `confidence` is self-graded and drives drill order. */
export interface PlaybookCard {
  id: string;
  confidence: Confidence;
}

export interface PronunciationCard extends PlaybookCard {
  term: string;      // "Aigues-Mortes", "Saoirse", "EBITDA"
  phonetic: string;  // "eg-MORT", "SEER-sha"
  tip: string;       // "silent s; rhymes with 'court'"
}

export interface GlossaryCard extends PlaybookCard {
  term: string;
  definition: string;
  kind: "acronym" | "term";
  industry: string;  // "" for general
  example: string;   // a sentence using the term naturally
}

export interface OfferingCard extends PlaybookCard {
  name: string;
  summary: string;
  valueProp: string;
  priceAnchor: string; // "from R15k" / "" if N/A
  objection: string;   // the objection likely to be heard
  response: string;    // crisp rebuttal
}

export interface Playbook extends BaseRecord {
  pronunciations: PronunciationCard[];
  glossary: GlossaryCard[];
  offerings: OfferingCard[];
}

/* ---------- targets (imported prospect list) ---------- */

export interface Target extends BaseRecord {
  company: string;
  contactName: string;
  contactRole: string;
  email: string;
  phone: string;
  linkedinUrl: string;
  industry: string;
  location: string;
  notes: string;
  // ── dial-list call tracking (all optional; absent callCount means 0) ──
  callCount?: number;
  lastCalledAt?: string | null;
  disposition?: "not_interested" | null;
}

/* ---------- dial list (daily call snapshot) ---------- */

export interface DialEntry {
  targetId: string;
  label: string; // denormalized "Company — Contact", captured at snapshot time
  outcome?: "interested" | "not_interested" | null;
}

export interface DialList extends BaseRecord {
  date: string; // "YYYY-MM-DD" — exactly one per day
  entries: DialEntry[];
}

/* ---------- news ---------- */

export type NewsCategory =
  | "github"
  | "ai"
  | "finance"
  | "products"
  | "reddit"
  | "x";

export interface NewsItem {
  id: string;             // stable hash of url (dedupe across refreshes)
  title: string;
  url: string;
  source: string;         // e.g. "github", "r/MachineLearning", "TechCrunch", "x.com"
  category: NewsCategory;
  snippet: string;        // short description / excerpt
  whyItMatters?: string;  // one-line Claude blurb (top items only)
  score?: number;         // upstream signal (stars, upvotes) for sort
  publishedAt: string | null; // ISO when known
}

/** What the /api/news route returns (no BaseRecord fields). */
export interface NewsFeedData {
  items: NewsItem[];
  summary: string;        // top-picks digest (markdown), "" when no AI pass
  fetchedAt: string;      // ISO — drives the 6h staleness check
  degraded: string[];     // names of sources that failed this fetch
}

export interface NewsFeed extends BaseRecord, NewsFeedData {}

export interface NewsInterests extends BaseRecord {
  topics: string;          // free-text keywords, comma/newline separated
  githubLanguages: string; // e.g. "TypeScript, Python"
  githubTopics: string;    // e.g. "llm, agents, rag"
  subreddits: string;      // e.g. "MachineLearning, LocalLLaMA, SaaS"
  rssFeeds: string;        // newline-separated; each line "category|url" or just "url"
  aboutMe: string;         // blurb Claude uses to judge relevance
}

export interface NewsBookmark extends BaseRecord {
  item: NewsItem;          // snapshot, so it survives feed replacement
}

/* ---------- notebook ---------- */

export interface Note extends BaseRecord {
  title: string;   // free text; may be empty ("Untitled" shown in UI)
  body: string;    // markdown
  pinned: boolean; // pinned notes sort first
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
  playbooks: Playbook[];
  targets: Target[];
  dialLists: DialList[];
  positioningProfiles: PositioningProfile[];
  contentThreads: ContentThread[];
  brainThreads: BrainThread[];
  newsFeed: NewsFeed[];
  newsInterests: NewsInterests[];
  newsBookmarks: NewsBookmark[];
  notes: Note[];
  settings: Settings;
}

export type CollectionKey = Exclude<keyof DataShape, "settings">;

/** What the Sales Advisor route receives as the current data picture. */
export type AdvisorSnapshot = Omit<
  DataShape,
  | "conversations" | "playbooks" | "targets" | "positioningProfiles"
  | "contentThreads" | "brainThreads"
  | "newsFeed" | "newsInterests" | "newsBookmarks"
  | "notes"
>;
