/* ============================================================
   Route error responses (server-only).

   A route answers with a stable code, never a raw error message.
   Upstream SDK, driver and OS errors carry things the caller has no
   use for — command lines, stack frames, absolute paths, request
   details — and every client here branches on the code anyway.

   The real error is not discarded: it goes to the server console,
   which on a local-first app is the terminal you already have open.
   ============================================================ */

import { NextResponse } from "next/server";

/** Shared codes for catch-all failure paths. Route-specific codes stay inline. */
export const UPSTREAM_FAILED = "upstream_failed";
export const DB_FAILED = "db_failed";

export function apiError(code: string, status: number, cause?: unknown) {
  if (cause !== undefined) console.error(`[api] ${code}:`, cause);
  return NextResponse.json({ error: code }, { status });
}
