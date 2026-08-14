/* ============================================================
   Roster endpoint. GET /api/agents?surface=<surface> -> { agents: AgentCard[] }.

   This is the only place agent data crosses into the browser. AgentCard is
   the browser-safe projection (src/lib/agents/types.ts) — it never carries
   `body` (the system prompt) or `tools` (the capability grant). listAgents()
   already returns AgentCard[], so there is nothing to project here; the
   route's job is just validating the surface param and mapping errors.
   ============================================================ */

import { NextResponse } from "next/server";
import { apiError, DB_FAILED } from "@/lib/api/errors";
import { listAgents } from "@/lib/agents/registry";
import { AGENT_SURFACES, type AgentSurface } from "@/lib/agents/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const surface = new URL(req.url).searchParams.get("surface") ?? "";
  if (!(AGENT_SURFACES as readonly string[]).includes(surface)) {
    return NextResponse.json({ error: "bad_surface" }, { status: 400 });
  }
  try {
    return NextResponse.json({ agents: await listAgents(surface as AgentSurface) });
  } catch (err) {
    return apiError(DB_FAILED, 500, err);
  }
}
