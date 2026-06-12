import type { AdvisorSnapshot, ProposedAction, Scorecard, Task } from "@/lib/types";
import {
  generateCallSummary, generateBusinessReview, generateTomorrowPlan,
} from "@/lib/ai";
import { todayScorecard, openTasks, followUpsDueToday } from "@/lib/selectors";
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

export const TOOLS: ToolDef[] = [
  // ---- read ----
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

  // ---- skills ----
  { name: "generate_call_summary", description: "Turn rough interaction notes into a structured call summary.",
    input_schema: obj({
      rawNotes: s(), whatTheySaid: s(), painPoints: s(), objections: s(),
      buyingSignals: s(), company: s(), contact: s(),
    }, ["rawNotes"]) },
  { name: "generate_business_review", description: "Turn a messy end-of-day brain-dump into a structured business review.",
    input_schema: obj({ text: s("the daily update text") }, ["text"]) },
  { name: "generate_tomorrow_plan", description: "Produce tomorrow's top-3 priorities from current open tasks, follow-ups and the latest scorecard.",
    input_schema: obj({}) },

  // ---- write (proposed, need confirmation) ----
  // NB: read email tools (EMAIL_TOOLS) are appended by the route only when a
  // Gmail inbox is connected — they resolve async and aren't part of resolveTool.
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
];

export const EMAIL_TOOL_NAMES = new Set(EMAIL_TOOLS.map((t) => t.name));

const WRITE_TOOLS = new Set(["create_task", "create_lead", "update_lead", "update_task", "log_interaction", "create_project"]);

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
    default: return tool;
  }
}

/* ---------------- dispatcher ---------------- */

/**
 * Resolve a tool call to a JSON string result.
 * Read & skill tools run inline against the snapshot.
 * Write tools push a ProposedAction and return a synthetic "queued" result.
 */
export function resolveTool(
  name: string,
  args: Args,
  snapshot: AdvisorSnapshot,
  proposals: ProposedAction[],
): string {
  if (WRITE_TOOLS.has(name)) {
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

    // Skill tools run the deterministic local generators from ai.ts (not the
    // Claude-backed /api/ai route) on purpose: it keeps this loop synchronous and
    // avoids a nested model call inside each tool turn.
    case "generate_call_summary":
      return JSON.stringify(generateCallSummary({
        rawNotes: String(args.rawNotes ?? ""),
        whatTheySaid: args.whatTheySaid as string | undefined,
        painPoints: args.painPoints as string | undefined,
        objections: args.objections as string | undefined,
        buyingSignals: args.buyingSignals as string | undefined,
        company: args.company as string | undefined,
        contact: args.contact as string | undefined,
      }));
    case "generate_business_review":
      return JSON.stringify(generateBusinessReview(String(args.text ?? "")));
    case "generate_tomorrow_plan": {
      const sc: Scorecard | null = todayScorecard(snapshot.scorecards);
      const open: Task[] = openTasks(snapshot.tasks);
      const due = followUpsDueToday(snapshot.leads, snapshot.tasks);
      return JSON.stringify(generateTomorrowPlan({ scorecard: sc, openTasks: open, dueFollowUps: due }));
    }
    default:
      return JSON.stringify({ error: `unknown tool: ${name}` });
  }
}
