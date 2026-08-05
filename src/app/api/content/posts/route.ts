import { NextResponse } from "next/server";
import { apiError, DB_FAILED } from "@/lib/api/errors";
import { listPosts, latestRun } from "@/lib/content/daily/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const date = new URL(req.url).searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "bad_date" }, { status: 400 });
  }
  try {
    const [posts, run] = await Promise.all([listPosts(date), latestRun(date)]);
    return NextResponse.json({ posts, run });
  } catch (err) {
    return apiError(DB_FAILED, 500, err);
  }
}
