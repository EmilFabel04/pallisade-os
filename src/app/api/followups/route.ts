import { NextResponse } from "next/server";
import { apiError, UPSTREAM_FAILED } from "@/lib/api/errors";
import { isConfigured as gmailConfigured } from "@/lib/gmail/config";
import { isConfigured as jevConfigured } from "@/lib/jev/client";
import { latestRun } from "@/lib/gmail/followUpRuns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The page's first paint: what is connected, and the last run if there is one. */
export async function GET() {
  try {
    return NextResponse.json({
      configured: { gmail: gmailConfigured(), jev: jevConfigured() },
      run: await latestRun(),
    });
  } catch (e) {
    return apiError(UPSTREAM_FAILED, 502, e);
  }
}
