import { NextResponse } from "next/server";
import { apiError, UPSTREAM_FAILED } from "@/lib/api/errors";
import Anthropic from "@anthropic-ai/sdk";
import type { NewsInterests, NewsItem } from "@/lib/types";
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

  let structured: { items: NewsItem[]; degraded: string[] };
  try {
    structured = await fetchStructured(interests);
  } catch (err) {
    return apiError(UPSTREAM_FAILED, 502, err);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Graceful degradation: raw structured feed, no AI layer.
    return NextResponse.json(buildStructuredFeed(structured.items, structured.degraded, fetchedAt));
  }

  const client = new Anthropic({ apiKey });
  // curate() guards its own Claude loop and always falls back to the structured feed — it never throws, so no try/catch here (returning 502 would defeat graceful degradation).
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
