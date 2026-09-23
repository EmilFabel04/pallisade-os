import { NextResponse } from "next/server";
import { apiError, UPSTREAM_FAILED } from "@/lib/api/errors";
import { isConfigured as gmailConfigured } from "@/lib/gmail/config";
import { isConfigured as jevConfigured } from "@/lib/jev/client";
import { listAccountInfo } from "@/lib/gmail/accounts";
import { latestRun } from "@/lib/gmail/followUpRuns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The page's first paint: what is connected, and the last run if there is one.
 *
 *  `configured.gmail` is only an env check (GOOGLE_CLIENT_ID / SECRET present),
 *  not "an inbox is linked" — on a configured install with nothing linked it is
 *  always true, and a scan then finds zero threads and reads as "nobody is
 *  waiting on you". `accountCount` (as /api/gmail/status already reports) is
 *  what actually distinguishes "no inbox connected" from "linked, nothing owed". */
export async function GET() {
  try {
    const gmail = gmailConfigured();
    return NextResponse.json({
      configured: { gmail, jev: jevConfigured() },
      accountCount: gmail ? (await listAccountInfo()).length : 0,
      run: await latestRun(),
    });
  } catch (e) {
    return apiError(UPSTREAM_FAILED, 502, e);
  }
}
