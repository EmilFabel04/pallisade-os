import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { normalizeDraft } from "@/lib/prep/normalize";
import type { PlaybookSections } from "@/lib/prep/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-4-6";
const SECTIONS = ["pronunciations", "glossary", "offerings"] as const;
type Section = (typeof SECTIONS)[number];

export async function GET() {
  return NextResponse.json({ configured: !!process.env.ANTHROPIC_API_KEY, model: MODEL });
}

interface PrepContext {
  businessName?: string;
  mainMarket?: string;
  services?: string;
}
interface PrepLead {
  company?: string;
  contactName?: string;
  contactRole?: string;
  industry?: string;
  painPoint?: string;
  objection?: string;
}
interface PrepRequest {
  intent?: "draft_section" | "meeting_prep";
  section?: Section;
  context?: PrepContext;
  lead?: PrepLead;
}

const cardSchemas = {
  pronunciations: {
    type: "array",
    description: "Tricky names, places, brands or terms to rehearse saying aloud.",
    items: {
      type: "object",
      properties: {
        term: { type: "string", description: "The word or name as written." },
        phonetic: { type: "string", description: "Plain-English respelling, e.g. 'ee-BIT-da'." },
        tip: { type: "string", description: "A short pronunciation tip." },
      },
      required: ["term", "phonetic"],
    },
  },
  glossary: {
    type: "array",
    description: "Industry language and acronyms the buyer will use.",
    items: {
      type: "object",
      properties: {
        term: { type: "string" },
        definition: { type: "string", description: "Plain, concise definition." },
        kind: { type: "string", enum: ["acronym", "term"] },
        industry: { type: "string", description: "Industry this belongs to, or empty for general." },
        example: { type: "string", description: "A natural sentence using the term." },
      },
      required: ["term", "definition", "kind"],
    },
  },
  offerings: {
    type: "array",
    description: "The founder's own tools/services to be able to pitch fluently.",
    items: {
      type: "object",
      properties: {
        name: { type: "string" },
        summary: { type: "string", description: "What it does, plainly." },
        valueProp: { type: "string", description: "Why it matters to the buyer." },
        priceAnchor: { type: "string", description: "A rough price anchor, or empty." },
        objection: { type: "string", description: "The objection likely to be raised." },
        response: { type: "string", description: "A crisp rebuttal to that objection." },
      },
      required: ["name", "summary", "valueProp"],
    },
  },
} as const;

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no_key" }, { status: 503 });

  let body: PrepRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const intent = body.intent ?? "draft_section";
  const ctx = body.context ?? {};
  const biz = ctx.businessName || "Pallisade Data";
  const market = ctx.mainMarket || "boutique asset managers and B2B service businesses";
  const services = ctx.services || "bespoke AI systems, workflow automation, custom software, dashboards and reporting tools";

  // Decide which sections to fill, and the grounding instructions.
  let sectionsWanted: readonly Section[];
  let task: string;

  if (intent === "meeting_prep") {
    const lead = body.lead ?? {};
    sectionsWanted = SECTIONS;
    task =
      `Build meeting-prep cards for an upcoming sales meeting.\n` +
      `Company: ${lead.company || "(unknown)"}\n` +
      `Contact: ${lead.contactName || "(unknown)"}${lead.contactRole ? `, ${lead.contactRole}` : ""}\n` +
      `Industry: ${lead.industry || "(unknown)"}\n` +
      `Stated pain point: ${lead.painPoint || "(none recorded)"}\n` +
      `Known objection: ${lead.objection || "(none recorded)"}\n\n` +
      `pronunciations: the contact's name (if non-obvious), the company name, and any tricky industry terms.\n` +
      `glossary: acronyms and jargon specific to ${lead.industry || "their industry"} this buyer will use.\n` +
      `offerings: of the founder's services (${services}), the 1-3 that best answer this buyer's pain — ` +
      `with the value prop framed for them and the objection they are most likely to raise.`;
  } else {
    const section = SECTIONS.includes(body.section as Section) ? (body.section as Section) : "glossary";
    sectionsWanted = [section];
    const per: Record<Section, string> = {
      pronunciations: `tricky names, places, brands or terms ${biz} encounters selling to ${market}.`,
      glossary: `the core industry language and acronyms used by ${market}.`,
      offerings: `the founder's services (${services}) — one card per distinct offering, with value prop, a price anchor if sensible, and the most likely objection plus a rebuttal.`,
    };
    task = `Draft the "${section}" section of the sales playbook: ${per[section]}`;
  }

  // Build a save_playbook tool whose schema only contains the wanted sections.
  const properties: Record<string, unknown> = {};
  for (const s of sectionsWanted) properties[s] = cardSchemas[s];
  const tool = {
    name: "save_playbook",
    description: "Save the drafted sales-prep cards.",
    input_schema: { type: "object" as const, properties, required: [...sectionsWanted] },
  };

  const system =
    `You prepare a B2B sales founder for meetings. Generate concise, accurate, immediately useful prep cards. ` +
    `Be specific and realistic — no filler. Only populate the requested sections. ${task}`;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system,
      tools: [tool] as unknown as Anthropic.Tool[],
      tool_choice: { type: "tool", name: "save_playbook" },
      messages: [{ role: "user", content: "Generate the cards now." }],
    });

    const toolUse = response.content.find(
      (blk): blk is Anthropic.ToolUseBlock => blk.type === "tool_use",
    );
    const draft: PlaybookSections = normalizeDraft(
      (toolUse?.input as Record<string, unknown>) ?? {},
    );
    return NextResponse.json(draft);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
