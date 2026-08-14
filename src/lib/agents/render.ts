import type { AgentContext } from "./types";

const KEYS = ["today", "businessName", "founderName", "services"] as const;

/** Substitutes {{placeholder}} tokens. Unknown tokens are left in place so a
 *  typo is visible in the output rather than silently blanking the prompt. */
export function renderBody(body: string, ctx: AgentContext): string {
  let out = body;
  for (const k of KEYS) out = out.split(`{{${k}}}`).join(String(ctx[k]));
  return out;
}
