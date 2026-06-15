import type { PlaybookSections, StageId } from "./session";

export interface PrepContext {
  businessName: string;
  mainMarket: string;
  services: string;
}

export interface PrepLead {
  company: string;
  contactName: string;
  contactRole: string;
  industry: string;
  painPoint: string;
  objection: string;
}

const EMPTY: PlaybookSections = { pronunciations: [], glossary: [], offerings: [] };

export async function getPrepStatus(): Promise<{ configured: boolean }> {
  try {
    const res = await fetch("/api/prep", { method: "GET" });
    if (!res.ok) return { configured: false };
    return (await res.json()) as { configured: boolean };
  } catch {
    return { configured: false };
  }
}

async function post(body: unknown): Promise<PlaybookSections> {
  const res = await fetch("/api/prep", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "request_failed" }));
    if (err.error === "no_key") {
      throw new Error("Drafting needs an ANTHROPIC_API_KEY. Add it to .env.local and restart.");
    }
    throw new Error(typeof err.error === "string" ? err.error : "The prep request failed.");
  }
  return { ...EMPTY, ...((await res.json()) as Partial<PlaybookSections>) };
}

/** `section` maps the UI stage id to the playbook section key. */
const SECTION_KEY: Record<StageId, "pronunciations" | "glossary" | "offerings"> = {
  pronunciation: "pronunciations",
  glossary: "glossary",
  offerings: "offerings",
};

export function draftSection(stage: StageId, context: PrepContext): Promise<PlaybookSections> {
  return post({ intent: "draft_section", section: SECTION_KEY[stage], context });
}

export function meetingPrep(lead: PrepLead, context: PrepContext): Promise<PlaybookSections> {
  return post({ intent: "meeting_prep", lead, context });
}
