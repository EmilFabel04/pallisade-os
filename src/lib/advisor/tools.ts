import type { AdvisorSnapshot, ProposedAction } from "@/lib/types";
import {
  queryLeads, queryTasks, queryProjects, queryInteractions,
  searchPainPoints, getPipelineMetrics,
} from "./readTools";

type Args = Record<string, unknown>;

export interface ToolDef {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

const obj = (properties: Record<string, unknown>, required?: string[]): ToolDef["input_schema"] =>
  ({ type: "object", properties, ...(required ? { required } : {}) });
const enumStr = (values: readonly string[], description = "") => ({ type: "string", enum: [...values], description });
const s = (description = "") => ({ type: "string", description });
const n = (description = "") => ({ type: "number", description });
const b = (description = "") => ({ type: "boolean", description });
const dateStr = (description = "") => ({ type: "string", description: `ISO date (YYYY-MM-DD). ${description}`.trim() });

/* ---------------- schemas ---------------- */

export const READ_TOOLS: ToolDef[] = [
  { name: "query_leads", description: "Search/filter CRM leads. Returns compact lead records (with ids).",
    input_schema: obj({
      status: s("e.g. new, contacted, interested, call booked, proposal, won, lost"),
      quality: enumStr(["low", "medium", "high"]),
      source: s(), industry: s("substring match"),
      hasFollowUp: b("only leads with a next follow-up date"),
      limit: n("default 25"),
    }) },
  { name: "query_tasks", description: "Search/filter tasks. Returns compact task records (with ids).",
    input_schema: obj({
      status: s("not started, in progress, blocked, done"),
      category: s("sales, product, delivery, admin, SEO, outreach, follow-up"),
      priority: enumStr(["low", "medium", "high"]), limit: n("default 30"),
    }) },
  { name: "query_projects", description: "Search/filter delivery projects.",
    input_schema: obj({ stage: s(), type: s(), priority: enumStr(["low", "medium", "high"]), limit: n() }) },
  { name: "query_interactions", description: "Recent call/interaction notes, newest first.",
    input_schema: obj({ leadId: s(), type: s(), company: s("substring match"), limit: n("default 20") }) },
  { name: "search_pain_points", description: "Search the pain-point bank.",
    input_schema: obj({ query: s("free-text"), industry: s(), urgency: enumStr(["low", "medium", "high"]), limit: n() }) },
  { name: "get_pipeline_metrics", description: "Dashboard metrics: pipeline counts/value, today's activity, follow-ups due.",
    input_schema: obj({}) },
];

// NB: read email tools (EMAIL_TOOLS) are appended by the route only when a
// Gmail inbox is connected — they resolve async and aren't part of resolveTool.
export const WRITE_TOOLS_DEFS: ToolDef[] = [
  { name: "create_task", description: "Propose creating a task.",
    input_schema: obj({
      title: s(), category: s(), priority: enumStr(["low", "medium", "high"]),
      dueDate: dateStr(), notes: s(), linkKind: enumStr(["lead", "project", "none"]), linkId: s(),
    }, ["title"]) },
  { name: "create_lead", description: "Propose creating a CRM lead.",
    input_schema: obj({
      company: s(), contactName: s(), contactRole: s(), email: s(), phone: s(),
      industry: s(), source: s(), status: s(), quality: enumStr(["low", "medium", "high"]),
      painPoint: s(), estimatedValue: n(), nextFollowUp: dateStr(), notes: s(),
    }, ["company"]) },
  { name: "update_lead", description: "Propose updating an existing lead. Use an id from query_leads.",
    input_schema: obj({
      id: s("lead id"),
      // contact / firmographics
      company: s(), contactName: s(), contactRole: s(), email: s(), phone: s(),
      linkedinUrl: s(), industry: s(), companyType: s(), source: s(), owner: s(),
      // pipeline
      status: s(), quality: enumStr(["low", "medium", "high"]),
      nextFollowUp: dateStr(), lastContact: dateStr(), painPoint: s(), buyingSignal: s(),
      objection: s(), solutionIdea: s(), estimatedValue: n(), notes: s(),
    }, ["id"]) },
  { name: "update_task", description: "Propose editing a task — reschedule, reprioritise, mark done, or edit. Use an id from query_tasks. Only pass the fields you want to change.",
    input_schema: obj({
      id: s("task id"), title: s(), category: s("sales, product, delivery, admin, SEO, outreach, follow-up"),
      priority: enumStr(["low", "medium", "high"]),
      status: enumStr(["not started", "in progress", "blocked", "done"]),
      dueDate: dateStr(), notes: s(),
    }, ["id"]) },
  { name: "log_interaction", description: "Propose logging a call/interaction note.",
    input_schema: obj({
      company: s(), contact: s(), leadId: s(), type: s(), date: dateStr(),
      rawNotes: s(), whatTheySaid: s(), painPoints: s(), buyingSignals: s(), followUpRequired: b(),
    }, ["company"]) },
  { name: "create_project", description: "Propose creating a delivery project.",
    input_schema: obj({
      name: s(), company: s(), type: s(), stage: s(), priority: enumStr(["low", "medium", "high"]),
      dueDate: dateStr(), nextAction: s(), deliverables: s(), notes: s(),
    }, ["name"]) },
];

export const TOOLS: ToolDef[] = [...READ_TOOLS, ...WRITE_TOOLS_DEFS];

export const READ_TOOL_NAMES = new Set(READ_TOOLS.map((t) => t.name));

/* Read tools for connected Gmail inboxes. Appended to the tool list by the route
   only when at least one inbox is connected, and resolved asynchronously
   (see resolveEmailTool) since they hit the Gmail API. */
export const EMAIL_TOOLS: ToolDef[] = [
  { name: "list_inboxes", description: "List the founder's connected Gmail inboxes (email addresses).",
    input_schema: obj({}) },
  { name: "query_emails", description: "Search recent emails across connected Gmail inboxes. Use Gmail search syntax in `query` (e.g. 'from:acme.com newer_than:14d'). Returns compact email summaries — never invent emails.",
    input_schema: obj({
      query: s("Gmail search query, optional"),
      account: s("limit to one inbox by its email address, optional"),
      limit: n("default 10"),
    }) },
  { name: "audit_sent_followups", description:
      "Audit the founder's SENT mail to find people who owe him a reply or who he left hanging. " +
      "Scans sent threads newest-first, skips Apollo mailwarming, and keeps threads whose subject " +
      "mentions Pallisade or where he signed off as Emil. Returns one row per recipient with a bucket: " +
      "'awaiting_you' (they replied last — most urgent) or 'no_reply' (they never replied). " +
      "Also returns scan diagnostics. Never invent recipients.",
    input_schema: obj({
      query: s("extra Gmail search terms to narrow the scan, e.g. 'subject:Pallisade' or 'newer_than:90d'. Optional."),
      limit: n("max threads to scan, default and maximum 400"),
    }) },
];

export const EMAIL_TOOL_NAMES = new Set(EMAIL_TOOLS.map((t) => t.name));

/* Google Calendar tools. Appended by the route only when a calendar-enabled
   account is connected. query_calendar resolves async (Calendar API);
   create_calendar_event is queued as a confirm-gated proposal and executed
   client-side via the calendar API on confirmation. */
const arr = (description = "") => ({ type: "array", items: { type: "string" }, description });

export const CALENDAR_READ_TOOLS: ToolDef[] = [
  { name: "query_calendar", description: "List the founder's upcoming Google Calendar events. Returns compact events — never invent meetings.",
    input_schema: obj({ days: n("look-ahead window, default 7"), query: s("free-text filter, optional") }) },
];

export const CALENDAR_WRITE_TOOLS: ToolDef[] = [
  { name: "create_calendar_event", description: "Propose creating a Google Calendar event (e.g. booking a call). Resolve relative times against today's date and pass `start` as a full ISO date-time. Queued for the founder's confirmation.",
    input_schema: obj({
      summary: s("event title"),
      start: s("ISO date-time, e.g. 2026-06-15T14:30:00"),
      durationMinutes: n("default 30"),
      description: s(), location: s(), attendees: arr("attendee email addresses"),
    }, ["summary", "start"]) },
];

export const CALENDAR_TOOLS: ToolDef[] = [...CALENDAR_READ_TOOLS, ...CALENDAR_WRITE_TOOLS];

export const CALENDAR_READ_TOOL_NAMES = new Set(CALENDAR_READ_TOOLS.map((t) => t.name));

// create_calendar_event is a mutation queued as a proposal, not executed here —
// it belongs in this set even though it lives in CALENDAR_WRITE_TOOLS, not
// WRITE_TOOLS_DEFS, so that resolveTool still routes it to the proposal queue.
export const WRITE_TOOL_NAMES = new Set([
  ...WRITE_TOOLS_DEFS.map((t) => t.name),
  ...CALENDAR_WRITE_TOOLS.map((t) => t.name),
]);

/* ---------------- descriptions for proposal cards ---------------- */

export function describeAction(tool: string, a: Args): string {
  const v = (k: string) => (a[k] == null ? "" : String(a[k]));
  switch (tool) {
    case "create_task": return `Create task: ${v("title") || "(untitled)"}${v("priority") ? ` · ${v("priority")} priority` : ""}${v("dueDate") ? ` · due ${v("dueDate")}` : ""}`;
    case "create_lead": return `Create lead: ${v("company") || "(no company)"}${v("contactName") ? ` — ${v("contactName")}` : ""}`;
    case "update_lead": {
      const fields = ["company", "contactName", "contactRole", "email", "phone", "linkedinUrl",
        "industry", "companyType", "source", "owner", "status", "quality", "nextFollowUp",
        "lastContact", "estimatedValue", "painPoint", "buyingSignal", "objection", "solutionIdea", "notes"]
        .filter((k) => a[k] != null).map((k) => `${k}=${v(k)}`).join(", ");
      return `Update lead ${v("id")}: ${fields || "(no changes)"}`;
    }
    case "update_task": {
      const fields = ["title", "status", "priority", "category", "dueDate", "notes"]
        .filter((k) => a[k] != null).map((k) => `${k}=${v(k)}`).join(", ");
      return `Update task ${v("id")}: ${fields || "(no changes)"}`;
    }
    case "log_interaction": return `Log ${v("type") || "interaction"} with ${v("company") || "—"}${v("contact") ? ` (${v("contact")})` : ""}`;
    case "create_project": return `Create project: ${v("name") || "(unnamed)"}${v("company") ? ` for ${v("company")}` : ""}`;
    case "create_calendar_event": return `Add to calendar: ${v("summary") || "(untitled)"}${v("start") ? ` · ${v("start").replace("T", " ").slice(0, 16)}` : ""}`;
    default: return tool;
  }
}

/* ---------------- dispatcher ---------------- */

/**
 * Resolve a tool call to a JSON string result.
 * Read tools run inline against the snapshot.
 * Write tools push a ProposedAction and return a synthetic "queued" result.
 */
export function resolveTool(
  name: string,
  args: Args,
  snapshot: AdvisorSnapshot,
  proposals: ProposedAction[],
): string {
  if (WRITE_TOOL_NAMES.has(name)) {
    const action: ProposedAction = {
      id: `act_${proposals.length + 1}_${name}`,
      tool: name,
      description: describeAction(name, args),
      args,
      status: "pending",
    };
    proposals.push(action);
    return JSON.stringify({ queued: true, note: "Proposed to the user for confirmation. Do not assume it is done.", description: action.description });
  }

  switch (name) {
    case "query_leads": return JSON.stringify(queryLeads(snapshot, args));
    case "query_tasks": return JSON.stringify(queryTasks(snapshot, args));
    case "query_projects": return JSON.stringify(queryProjects(snapshot, args));
    case "query_interactions": return JSON.stringify(queryInteractions(snapshot, args));
    case "search_pain_points": return JSON.stringify(searchPainPoints(snapshot, args));
    case "get_pipeline_metrics": return JSON.stringify(getPipelineMetrics(snapshot, args));

    default:
      return JSON.stringify({ error: `unknown tool: ${name}` });
  }
}
