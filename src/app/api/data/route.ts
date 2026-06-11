import { NextResponse } from "next/server";
import { loadAll, saveAll } from "@/lib/db/sqlite";
import type { DataShape } from "@/lib/types";

// SQLite needs the Node runtime + always-dynamic (never cached).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(loadAll());
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

async function persist(req: Request) {
  const body = (await req.json()) as DataShape;
  saveAll(body);
  return NextResponse.json({ ok: true });
}

export async function PUT(req: Request) {
  try {
    return await persist(req);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST mirrors PUT so navigator.sendBeacon() can flush on tab close.
export async function POST(req: Request) {
  try {
    return await persist(req);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
