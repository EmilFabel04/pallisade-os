import { NextResponse } from "next/server";
import { apiError, DB_FAILED } from "@/lib/api/errors";
import { patchPost } from "@/lib/content/daily/store";
import { KILL_REASONS, type ContentPost, type KillReason, type PostStatus } from "@/lib/content/daily/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_STATUSES: PostStatus[] = ["draft", "needs_work", "kept", "killed", "posted"];

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: { status?: string; killReason?: string | null; editedBody?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // Only these three fields are client-writable. Provenance — the body, the
  // claim, the sourceRefs, the gate's checks, the revision count — stays
  // server-owned, so a compromised or buggy client cannot rewrite the record
  // of what the engine actually produced and why.
  const changes: Partial<ContentPost> = {};
  if (body.status !== undefined) {
    if (!ALLOWED_STATUSES.includes(body.status as PostStatus)) {
      return NextResponse.json({ error: "bad_status" }, { status: 400 });
    }
    changes.status = body.status as PostStatus;
  }
  if (body.killReason !== undefined) {
    if (body.killReason !== null && !(KILL_REASONS as readonly string[]).includes(body.killReason)) {
      return NextResponse.json({ error: "bad_kill_reason" }, { status: 400 });
    }
    changes.killReason = body.killReason as KillReason | null;
  }
  if (body.editedBody !== undefined) changes.editedBody = body.editedBody;

  if (Object.keys(changes).length === 0) {
    return NextResponse.json({ error: "no_changes" }, { status: 400 });
  }

  try {
    const post = await patchPost(id, changes);
    if (!post) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ post });
  } catch (err) {
    return apiError(DB_FAILED, 500, err);
  }
}
