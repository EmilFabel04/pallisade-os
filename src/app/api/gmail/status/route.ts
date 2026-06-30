import { NextResponse } from "next/server";
import { isConfigured, redirectUri } from "@/lib/gmail/config";
import { listAccountInfo } from "@/lib/gmail/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const configured = isConfigured();
  return NextResponse.json({
    configured,
    redirectUri: redirectUri(),
    accounts: configured ? await listAccountInfo() : [],
  });
}
