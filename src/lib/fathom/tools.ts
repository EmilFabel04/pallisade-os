/* ============================================================
   The Fathom tools (server-only).

   Two tools: search summaries across a window, and read one meeting in full.
   Never throws — every failure becomes a JSON `{ error }` the model reads and
   relays, the same contract as brain/tools.ts.

   There is no single-meeting endpoint on the Fathom API. GET /meetings is the
   only source of metadata and summaries, so reading one meeting re-pages the
   window to locate it by recording_id.
   ============================================================ */

import type { ToolDef } from "@/lib/advisor/tools";
import {
  listMeetings, getTranscript, isConfigured,
  FathomAuthError, FathomRateLimitError, FathomError,
  type FathomMeeting, type FathomTranscriptLine,
} from "./client";

type Args = Record<string, unknown>;

const MAX_PAGES = 5;
const MAX_TRANSCRIPT_CHARS = 40000;
const SUMMARY_EXCERPT_CHARS = 400;
const DEFAULT_SINCE_DAYS = 90;
const DEFAULT_LIMIT = 20;

export const FATHOM_TOOLS: ToolDef[] = [
  {
    name: "fathom_search_meetings",
    description:
      "Search the founder's recorded meetings by company and/or keyword and return compact " +
      "rows: id, title, date, attendees, companies and a summary excerpt. Omit both filters " +
      "for the most recent meetings. Returns `truncated: true` when the scan hit its page " +
      "limit — say so rather than implying you saw everything. Use fathom_read_meeting for " +
      "the full summary or the transcript.",
    input_schema: {
      type: "object",
      properties: {
        company: { type: "string", description: "company name or email domain, e.g. 'Acme' or 'acme.co'" },
        query: { type: "string", description: "keywords matched against the title and summary" },
        sinceDays: { type: "number", description: "how far back to look; default 90" },
        limit: { type: "number", description: "rows to return; default 20" },
      },
    },
  },
  {
    name: "fathom_read_meeting",
    description:
      "One meeting in full: summary, action items, and optionally the speaker-attributed " +
      "transcript. Pass a recordingId from fathom_search_meetings. Leave includeTranscript " +
      "off unless the summary is genuinely not enough — transcripts are long.",
    input_schema: {
      type: "object",
      properties: {
        recordingId: { type: "string", description: "the id from fathom_search_meetings" },
        sinceDays: { type: "number", description: "window to find it in; default 90" },
        includeTranscript: { type: "boolean", description: "default false" },
      },
      required: ["recordingId"],
    },
  },
];

export const FATHOM_TOOL_NAMES = new Set(FATHOM_TOOLS.map((t) => t.name));

const num = (v: unknown, fallback: number) => (typeof v === "number" && v > 0 ? v : fallback);
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

const titleOf = (m: FathomMeeting) => m.title || m.meeting_title || "(untitled)";
const dateOf = (m: FathomMeeting) =>
  (m.recording_start_time || m.scheduled_start_time || m.created_at || "").slice(0, 10);
const summaryOf = (m: FathomMeeting) => m.default_summary?.markdown_formatted ?? "";
const inviteesOf = (m: FathomMeeting) => m.calendar_invitees ?? [];
const companiesOf = (m: FathomMeeting) =>
  (m.crm_matches?.companies ?? []).map((c) => c.name).filter((n): n is string => !!n);

/** Company matching runs over the CRM match Fathom already made AND the invitee
 *  emails, because crm_matches is empty whenever the founder's CRM isn't the one
 *  Fathom is connected to — which is the normal case here. */
const companyHaystack = (m: FathomMeeting) =>
  [
    titleOf(m),
    ...inviteesOf(m).flatMap((i) => [i.name, i.email, i.email_domain]),
    ...(m.crm_matches?.companies ?? []).flatMap((c) => [c.name, c.domain]),
    ...(m.crm_matches?.contacts ?? []).flatMap((c) => [c.name, c.domain]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const queryHaystack = (m: FathomMeeting) =>
  [titleOf(m), summaryOf(m)].join(" ").toLowerCase();

function excerpt(s: string): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > SUMMARY_EXCERPT_CHARS
    ? `${flat.slice(0, SUMMARY_EXCERPT_CHARS)}…`
    : flat;
}

function renderTranscript(lines: FathomTranscriptLine[]): string {
  const out = lines
    .map((l) => `${l.speaker?.display_name ?? "Unknown"}: ${l.text ?? ""}`)
    .join("\n");
  return out.length > MAX_TRANSCRIPT_CHARS
    ? `${out.slice(0, MAX_TRANSCRIPT_CHARS)}\n[truncated]`
    : out;
}

/** Pages the window, capped. Returns what it saw and whether the cap bit. */
async function scanWindow(sinceDays: number): Promise<{
  meetings: FathomMeeting[];
  truncated: boolean;
}> {
  const createdAfter = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const meetings: FathomMeeting[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const { items, nextCursor } = await listMeetings({ createdAfter, cursor });
    meetings.push(...items);
    if (!nextCursor) return { meetings, truncated: false };
    cursor = nextCursor;
  }
  // Left the loop with a cursor still outstanding: there is more we did not read.
  return { meetings, truncated: true };
}

async function search(args: Args): Promise<string> {
  const company = text(args.company).toLowerCase();
  const query = text(args.query).toLowerCase();
  const { meetings, truncated } = await scanWindow(num(args.sinceDays, DEFAULT_SINCE_DAYS));

  const matched = meetings.filter(
    (m) =>
      (!company || companyHaystack(m).includes(company)) &&
      (!query || queryHaystack(m).includes(query)),
  );

  return JSON.stringify({
    meetings: matched.slice(0, num(args.limit, DEFAULT_LIMIT)).map((m) => ({
      id: m.recording_id,
      title: titleOf(m),
      date: dateOf(m),
      attendees: inviteesOf(m).map((i) => i.name || i.email).filter(Boolean),
      companies: companiesOf(m),
      summaryExcerpt: excerpt(summaryOf(m)),
    })),
    scanned: meetings.length,
    truncated,
  });
}

async function readMeeting(args: Args): Promise<string> {
  const id = text(args.recordingId);
  if (!id) return JSON.stringify({ error: "recordingId is required." });

  const sinceDays = num(args.sinceDays, DEFAULT_SINCE_DAYS);
  const { meetings } = await scanWindow(sinceDays);
  const meeting = meetings.find((m) => m.recording_id === id);

  if (!meeting) {
    return JSON.stringify({
      error: `No meeting with that id in the last ${sinceDays} days. Try a larger sinceDays.`,
    });
  }

  const body: Record<string, unknown> = {
    title: titleOf(meeting),
    date: dateOf(meeting),
    attendees: inviteesOf(meeting).map((i) => i.name || i.email).filter(Boolean),
    summary: summaryOf(meeting),
    actionItems: (meeting.action_items ?? []).map((a) => ({
      description: a.description,
      completed: a.completed,
      assignee: a.assignee?.name,
    })),
  };

  if (args.includeTranscript === true) {
    body.transcript = renderTranscript(await getTranscript(id));
  }
  return JSON.stringify(body);
}

/** Resolve a Fathom tool call to a JSON string. Never throws — a failure the
 *  model can read and relay beats a turn that dies. */
export async function resolveFathomTool(name: string, args: Args): Promise<string> {
  if (!isConfigured()) {
    return JSON.stringify({
      error: "Fathom is not connected. Add FATHOM_API_KEY to .env.local and restart.",
    });
  }
  try {
    if (name === "fathom_search_meetings") return await search(args);
    if (name === "fathom_read_meeting") return await readMeeting(args);
    return JSON.stringify({ error: `unknown tool: ${name}` });
  } catch (e) {
    if (e instanceof FathomAuthError) {
      return JSON.stringify({ error: "Fathom rejected the API key." });
    }
    if (e instanceof FathomRateLimitError) {
      return JSON.stringify({ error: "Fathom's rate limit was hit. Try again in a moment." });
    }
    if (e instanceof FathomError) {
      console.error("[fathom] request failed:", e.status);
      return JSON.stringify({ error: "Fathom could not be reached right now." });
    }
    console.error("[fathom] unexpected failure:", e);
    return JSON.stringify({ error: "Fathom could not be reached right now." });
  }
}
