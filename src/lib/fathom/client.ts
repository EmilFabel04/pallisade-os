/* ============================================================
   Fathom public API client (server-only).

   https://api.fathom.ai/external/v1, X-Api-Key auth. Reads process.env, so it
   must never be imported from a client component.

   Field names here are taken from the API reference verbatim, not inferred.
   `recording_id` is not `id`; `default_summary.markdown_formatted` is not
   `.markdown`; `speaker` is an object, not a string. Every field is optional:
   the API may add fields, and may omit ones this code does not require.
   ============================================================ */

import { apiKey, isConfigured } from "./config";

export { isConfigured };

const BASE = "https://api.fathom.ai/external/v1";

/** A hanging request inside an 8-iteration agent loop stalls the whole turn. */
const TIMEOUT_MS = 10000;

export class FathomAuthError extends Error {
  constructor() { super("Fathom rejected the API key"); }
}
export class FathomRateLimitError extends Error {
  constructor() { super("Fathom rate limit exceeded"); }
}
export class FathomError extends Error {
  constructor(readonly status: number) { super(`Fathom returned ${status}`); }
}

export interface FathomInvitee {
  name?: string;
  email?: string;
  email_domain?: string;
  is_external?: boolean;
}

export interface FathomCrmEntity {
  name?: string;
  domain?: string;
}

export interface FathomMeeting {
  recording_id?: string;
  title?: string;
  meeting_title?: string;
  url?: string;
  share_url?: string;
  created_at?: string;
  scheduled_start_time?: string;
  recording_start_time?: string;
  calendar_invitees?: FathomInvitee[];
  recorded_by?: { name?: string; email?: string };
  default_summary?: { template_name?: string; markdown_formatted?: string };
  action_items?: {
    description?: string;
    completed?: boolean;
    assignee?: { name?: string };
  }[];
  crm_matches?: {
    contacts?: FathomCrmEntity[];
    companies?: FathomCrmEntity[];
    deals?: FathomCrmEntity[];
    error?: string;
  };
}

export interface FathomTranscriptLine {
  speaker?: { display_name?: string; matched_calendar_invitee_email?: string | null };
  text?: string;
  timestamp?: string;
}

async function call<T>(path: string, params: Record<string, string | undefined> = {}): Promise<T> {
  // Reading the key first means a missing key never becomes a network call.
  const key = apiKey();

  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, v);
  }

  const res = await fetch(url, {
    headers: { "X-Api-Key": key, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    if (res.status === 401) throw new FathomAuthError();
    if (res.status === 429) throw new FathomRateLimitError();
    throw new FathomError(res.status);
  }
  return (await res.json()) as T;
}

export async function listMeetings(params: {
  createdAfter?: string;
  createdBefore?: string;
  cursor?: string;
}): Promise<{ items: FathomMeeting[]; nextCursor: string | null }> {
  const body = await call<{ items?: FathomMeeting[]; next_cursor?: string | null }>("/meetings", {
    created_after: params.createdAfter,
    created_before: params.createdBefore,
    cursor: params.cursor,
    // These three default to FALSE on Fathom's side. Without them the response
    // carries no default_summary, no crm_matches and no action_items — the
    // tools would return structurally empty fields indistinguishable from a
    // meeting that genuinely had none.
    include_summary: "true",
    include_crm_matches: "true",
    include_action_items: "true",
  });
  return { items: body.items ?? [], nextCursor: body.next_cursor ?? null };
}

/** The transcript for one recording.
 *
 *  `destination_url` is deliberately never sent: with it, Fathom answers
 *  asynchronously via callback and returns no transcript, which would surface
 *  here as a meeting that was silently empty. */
export async function getTranscript(recordingId: string): Promise<FathomTranscriptLine[]> {
  const body = await call<{ transcript?: FathomTranscriptLine[] }>(
    `/recordings/${encodeURIComponent(recordingId)}/transcript`,
  );
  return body.transcript ?? [];
}
