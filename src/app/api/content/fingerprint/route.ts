import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { apiError, UPSTREAM_FAILED } from "@/lib/api/errors";
import { generateFingerprint } from "@/lib/content/daily/fingerprint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no_key" }, { status: 503 });

  let samples: string[];
  try {
    samples = ((await req.json()) as { samples?: string[] }).samples ?? [];
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (samples.length === 0) {
    return NextResponse.json({ error: "no_samples" }, { status: 400 });
  }

  try {
    const client = new Anthropic({ apiKey });
    return NextResponse.json(await generateFingerprint(client, samples));
  } catch (err) {
    return apiError(UPSTREAM_FAILED, 502, err);
  }
}
