import { NextResponse } from "next/server";
import { isConfigured } from "@/lib/gmail/config";
import { listAccountInfo, deleteAccount } from "@/lib/gmail/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isConfigured()) return NextResponse.json({ accounts: [] });
  return NextResponse.json({ accounts: await listAccountInfo() });
}

/** Disconnect an inbox: DELETE /api/gmail/accounts?id=<id> */
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  await deleteAccount(id);
  return NextResponse.json({ ok: true });
}
