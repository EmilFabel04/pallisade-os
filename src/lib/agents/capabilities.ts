/* ============================================================
   The tool bus (server-only).

   Maps a capability group to the tools it grants, and routes a tool call to
   the resolver that owns it. This is the single place that knows which
   resolver owns which tool — it replaces the four *_TOOL_NAMES sets that were
   duplicated across the advisor, brain and project-chat routes.
   ============================================================ */

import type { AdvisorSnapshot } from "@/lib/types";
import type { ToolDef } from "@/lib/advisor/tools";
import {
  READ_TOOLS, WRITE_TOOLS_DEFS, WRITE_TOOL_NAMES, READ_TOOL_NAMES, resolveTool,
} from "@/lib/advisor/tools";
import {
  EMAIL_TOOLS, EMAIL_TOOL_NAMES, CALENDAR_READ_TOOLS, CALENDAR_WRITE_TOOLS, CALENDAR_READ_TOOL_NAMES,
} from "@/lib/advisor/tools";
import { resolveEmailTool } from "@/lib/gmail/advisorEmail";
import { resolveCalendarTool } from "@/lib/calendar/advisorCalendar";
import { DRIVE_TOOLS, DRIVE_TOOL_NAMES, resolveBrainTool } from "@/lib/brain/tools";
import {
  PROJECT_CONTEXT_TOOLS, PROJECT_CONTEXT_TOOL_NAMES, resolveProjectContextTool,
} from "@/lib/projects/projectContext";
import { PROJECT_TOOLS, PROJECT_TOOL_NAMES, resolveProjectTool } from "@/lib/projects/tools";
import type { AgentContext, CapabilityGroup } from "./types";

type Args = Record<string, unknown>;

/** Anthropic-executed tool: different shape, and never answered with a tool_result. */
export interface ServerToolDef { type: string; name: string; max_uses?: number }
export type AgentTool = ToolDef | ServerToolDef;

const WEB_SEARCH: ServerToolDef = { type: "web_search_20250305", name: "web_search", max_uses: 5 };

/** Tools Anthropic runs on its own side. The runtime must not synthesise results for these. */
export const SERVER_TOOL_NAMES = new Set([WEB_SEARCH.name]);

/** Groups whose tools are only offered when the integration is connected. */
function grantsFor(group: CapabilityGroup, ctx: AgentContext): AgentTool[] {
  switch (group) {
    case "crm": return READ_TOOLS;
    // create_calendar_event rides with the other mutations, but only when the
    // calendar is actually connected.
    case "writes":
      return ctx.calendarEnabled ? [...WRITE_TOOLS_DEFS, ...CALENDAR_WRITE_TOOLS] : WRITE_TOOLS_DEFS;
    case "projects": return PROJECT_CONTEXT_TOOLS;
    // Scoped to the ONE project in ctx.projectSnapshot — the inverse of
    // `projects`, which is cross-project and read-only. Granting nothing
    // without a project in context is deliberate: nine tools that all answer
    // with an error is the failure mode this gate exists to prevent.
    case "delivery": return ctx.projectSnapshot ? PROJECT_TOOLS : [];
    case "drive": return DRIVE_TOOLS;
    case "web": return [WEB_SEARCH];
    case "email": return ctx.emailEnabled ? EMAIL_TOOLS : [];
    // READ tools only. create_calendar_event is a mutation and belongs to `writes`.
    case "calendar": return ctx.calendarEnabled ? CALENDAR_READ_TOOLS : [];
    // Specified in the design, implemented in follow-up specs. An agent may
    // declare them today and simply receive nothing.
    case "repo": return [];
    case "fathom": return [];
  }
}

export function toolsFor(groups: CapabilityGroup[], ctx: AgentContext): AgentTool[] {
  const seen = new Set<string>();
  const out: AgentTool[] = [];
  for (const g of groups) {
    for (const t of grantsFor(g, ctx)) {
      if (seen.has(t.name)) continue;
      seen.add(t.name);
      out.push(t);
    }
  }
  return out;
}

export async function dispatch(name: string, args: Args, ctx: AgentContext): Promise<string> {
  try {
    if (EMAIL_TOOL_NAMES.has(name)) return await resolveEmailTool(name, args);
    if (CALENDAR_READ_TOOL_NAMES.has(name)) return await resolveCalendarTool(name, args);
    if (PROJECT_CONTEXT_TOOL_NAMES.has(name)) return await resolveProjectContextTool(name, args);
    if (PROJECT_TOOL_NAMES.has(name)) {
      // Unreachable while toolsFor gates the grant on the same field, but a
      // resolver that dereferences null on a path it "cannot" reach is how the
      // next surface to grant `delivery` finds out the hard way.
      if (!ctx.projectSnapshot) throw new Error("no project in context for this tool");
      return await resolveProjectTool(name, args, ctx.projectSnapshot, ctx.proposals);
    }
    if (DRIVE_TOOL_NAMES.has(name)) return await resolveBrainTool(name, args, ctx.driveAccountId);

    // Writes are checked FIRST and deliberately skip the snapshot guard.
    // resolveTool's write branch pushes the ProposedAction and returns before
    // ever dereferencing the snapshot, and surfaces like Brain carry no
    // snapshot at all — guarding writes on it would silently degrade every
    // proposal to an error payload the moment a snapshot-less surface is
    // granted `writes`, with no symptom but the agent apologising.
    if (WRITE_TOOL_NAMES.has(name)) {
      return resolveTool(name, args, ctx.snapshot as AdvisorSnapshot, ctx.proposals);
    }
    if (READ_TOOL_NAMES.has(name)) {
      if (!ctx.snapshot) throw new Error("no snapshot available for this tool");
      return resolveTool(name, args, ctx.snapshot, ctx.proposals);
    }

    return JSON.stringify({ error: `unknown tool: ${name}` });
  } catch (err) {
    // A tool failure is reported to the agent, not thrown — it can then say it
    // could not reach the calendar rather than the whole turn dying.
    return JSON.stringify({ error: (err as Error).message });
  }
}
