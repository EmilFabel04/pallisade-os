import { NextResponse } from "next/server";
import { connectedDriveAccountId } from "@/lib/brain/availability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const accountId = await connectedDriveAccountId();
  return NextResponse.json({ connected: accountId !== null, accountId });
}
