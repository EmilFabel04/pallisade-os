import { NextResponse } from "next/server";
import { apiError, UPSTREAM_FAILED } from "@/lib/api/errors";
import { isConfigured as gmailConfigured } from "@/lib/gmail/config";
import { auditSentFollowUps, type JudgeMode } from "@/lib/gmail/sentAudit";
import { saveRun } from "@/lib/gmail/followUpRuns";
import { uid, nowISO } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Up to 400 Gmail threads fetched at concurrency 8, then up to 400 Jev calls
// at concurrency 12 (see SCAN_CAP, FETCH_CONCURRENCY, JUDGE_CONCURRENCY in
// sentAudit.ts / sentJudge.ts). The same precedent as content/daily/route.ts:16.
export const maxDuration = 300;

const MODES: JudgeMode[] = ["jev", "heuristic", "both"];

/** Run the audit, store it, hand it back. Synchronous on purpose: the wall
 *  clock is Gmail's, and a single-user app does not need a job queue. */
export async function POST(req: Request) {
  if (!gmailConfigured()) {
    return NextResponse.json({ error: "gmail_not_configured" }, { status: 503 });
  }

  let body: { limit?: number; judge?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  if (body.judge != null && !MODES.includes(body.judge as JudgeMode)) {
    return NextResponse.json({ error: "bad_judge_mode" }, { status: 400 });
  }

  let run: { id: string; at: string; result: Awaited<ReturnType<typeof auditSentFollowUps>> };
  try {
    const result = await auditSentFollowUps({
      limit: body.limit,
      judge: body.judge as JudgeMode | undefined,
    });
    run = { id: uid(), at: nowISO(), result };
  } catch (e) {
    return apiError(UPSTREAM_FAILED, 502, e);
  }

  // Persistence is best-effort: a multi-minute Gmail scan that finished
  // successfully must not be thrown away because the store hiccuped on the
  // write. The branch's whole thesis is that one dependency failing costs a
  // degradation, not the run — this route is where that applies to itself.
  try {
    await saveRun(run);
  } catch (e) {
    console.error("[followups] saveRun failed:", e instanceof Error ? e.message : e);
  }

  return NextResponse.json(run);
}
