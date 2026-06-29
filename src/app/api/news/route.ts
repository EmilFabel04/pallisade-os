import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { NewsInterests } from "@/lib/types";
import { fetchStructured } from "@/lib/news/sources";
import { curate, buildStructuredFeed } from "@/lib/news/curate";
import { nowISO, todayISO } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.NEWS_MODEL || "claude-sonnet-4-6";

export async function GET() {
  return NextResponse.json({
    configured: !!process.env.ANTHROPIC_API_KEY,
    github: !!process.env.GITHUB_TOKEN,
    model: MODEL,
  });
}

interface NewsRequest {
  interests?: NewsInterests;
}

export async function POST(req: Request) {
  let body: NewsRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!body.interests) {
    return NextResponse.json({ error: "missing_interests" }, { status: 400 });
  }

  const interests = body.interests;
  const fetchedAt = nowISO();

  let structured: { items: import("@/lib/types").NewsItem[]; degraded: string[] };
  try {
    structured = await fetchStructured(interests);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Graceful degradation: raw structured feed, no AI layer.
    return NextResponse.json(buildStructuredFeed(structured.items, structured.degraded, fetchedAt));
  }

  const client = new Anthropic({ apiKey });
  const feed = await curate({
    client,
    model: MODEL,
    interests,
    items: structured.items,
    degraded: structured.degraded,
    today: todayISO(),
    fetchedAt,
  });
  return NextResponse.json(feed);
}
