/* ============================================================
   Single-agent endpoint. Backs the Settings persona editor.

   GET    /api/agents/:id  -> the full spec (id, name, ..., tools, body,
                               overridden) — this is the ONLY place a system
                               prompt crosses into the browser. The roster
                               route (GET /api/agents?surface=) stays the
                               six-key AgentCard projection; do not widen it.
   PUT    /api/agents/:id  { body } -> saves a body override.
   DELETE /api/agents/:id  -> clears the override, reverting to the file body.

   Only `body` is ever written. `tools` (the capability grant) comes back
   read-only from GET and is never accepted as input here — frontmatter,
   and therefore the tool grant, stays file-owned. That is what makes an
   edit in Settings incapable of widening an agent's capabilities; see
   src/lib/agents/overrides.ts's header comment for the same property from
   the storage side.

   Both PUT and DELETE call resetRegistryCache() after writing, or the
   running process keeps serving the cached body until restart.
   ============================================================ */

import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/errors";
import { getAgent, AgentNotFound, resetRegistryCache } from "@/lib/agents/registry";
import { saveOverride, clearOverride, loadOverrides } from "@/lib/agents/overrides";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: RouteParams) {
  const { id } = await params;
  try {
    const spec = await getAgent(id);
    const overrides = await loadOverrides();
    return NextResponse.json({ ...spec, overridden: overrides.has(id) });
  } catch (err) {
    // AgentNotFound means the id genuinely doesn't exist. Anything else — a
    // readdir failure, a malformed .md throwing from buildSpec, a
    // loadOverrides DB error — is a real server failure and must not be
    // silently relabeled "not found" with an empty console.
    if (err instanceof AgentNotFound) return apiError("agent_not_found", 404);
    return apiError("agent_failed", 502, err);
  }
}

export async function PUT(req: Request, { params }: RouteParams) {
  const { id } = await params;

  let payload: { body?: unknown };
  try {
    payload = await req.json();
  } catch {
    return apiError("bad_request", 400);
  }

  const body = typeof payload.body === "string" ? payload.body : "";
  // An empty override must never be storable: registry.ts resolves it with
  // `body ? {...spec, body} : spec`, so an empty string silently reads back
  // as "no override" — the founder would see no error and the agent would
  // keep behaving as before, with nothing to explain why.
  if (!body.trim()) return apiError("empty_body", 400);

  try {
    await getAgent(id);
  } catch (err) {
    if (err instanceof AgentNotFound) return apiError("agent_not_found", 404);
    return apiError("agent_failed", 502, err);
  }

  try {
    await saveOverride(id, body);
  } catch (err) {
    return apiError("agent_failed", 502, err);
  }

  resetRegistryCache();
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  const { id } = await params;

  try {
    await getAgent(id);
  } catch (err) {
    if (err instanceof AgentNotFound) return apiError("agent_not_found", 404);
    return apiError("agent_failed", 502, err);
  }

  try {
    await clearOverride(id);
  } catch (err) {
    return apiError("agent_failed", 502, err);
  }

  resetRegistryCache();
  return NextResponse.json({ ok: true });
}
