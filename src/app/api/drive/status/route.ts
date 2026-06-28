import { NextResponse } from "next/server";
import { isConfigured, hasDriveScope } from "@/lib/gmail/config";
import { listAccounts } from "@/lib/gmail/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  if (!isConfigured()) return NextResponse.json({ connected: false, accountId: null });
  const acct = listAccounts().find((a) => hasDriveScope(a.tokens.scope));
  return NextResponse.json({ connected: !!acct, accountId: acct?.id ?? null });
}
