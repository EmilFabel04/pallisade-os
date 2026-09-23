import { NextResponse } from "next/server";
import { apiError, UPSTREAM_FAILED } from "@/lib/api/errors";
import { isConfigured as gmailConfigured } from "@/lib/gmail/config";
import { auditSentFollowUps, type JudgeMode } from "@/lib/gmail/sentAudit";
import { saveRun } from "@/lib/gmail/followUpRuns";
import { uid, nowISO } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  try {
    const result = await auditSentFollowUps({
      limit: body.limit,
      judge: body.judge as JudgeMode | undefined,
    });
    const run = { id: uid(), at: nowISO(), result };
    await saveRun(run);
    return NextResponse.json(run);
  } catch (e) {
    return apiError(UPSTREAM_FAILED, 502, e);
  }
}
