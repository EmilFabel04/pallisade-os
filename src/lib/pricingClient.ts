import type { CapexRead, IntentRead } from "./types";
import type { Adjudication } from "./pricing/band";
import type { AdjudicateRequest } from "./pricing/adjudicateBrief";
import type { CapexQueryParams } from "./pricing/capexQuery";

async function post<T>(url: string, body: unknown, label: string): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "request_failed" }));
    if (err.error === "no_key") {
      throw new Error(
        `${label} needs an ANTHROPIC_API_KEY. Add it to .env.local and restart.`,
      );
    }
    throw new Error(typeof err.error === "string" ? err.error : `${label} failed.`);
  }

  return (await res.json()) as T;
}

export async function getPricingStatus(): Promise<{ configured: boolean }> {
  try {
    const res = await fetch("/api/pricing/intent", { method: "GET" });
    if (!res.ok) return { configured: false };
    return (await res.json()) as { configured: boolean };
  } catch {
    return { configured: false };
  }
}

export function fetchIntent(leadId: string): Promise<IntentRead> {
  return post<IntentRead>("/api/pricing/intent", { leadId }, "The intent read");
}

export function fetchCapex(params: CapexQueryParams): Promise<CapexRead> {
  return post<CapexRead>("/api/pricing/capex", params, "The capex research");
}

export function fetchAdjudication(req: AdjudicateRequest): Promise<Adjudication> {
  return post<Adjudication>("/api/pricing/adjudicate", req, "The price adjudication");
}
