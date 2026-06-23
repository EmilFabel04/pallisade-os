import type { AdvisorSnapshot, ContentType } from "./types";
import { buildSnapshot } from "./advisorClient";

export { buildSnapshot };

export async function getContentStatus(): Promise<{ configured: boolean }> {
  try {
    const res = await fetch("/api/content", { method: "GET" });
    if (!res.ok) return { configured: false };
    return (await res.json()) as { configured: boolean };
  } catch {
    return { configured: false };
  }
}

export async function sendContentTurn(params: {
  messages: { role: "user" | "assistant"; content: string }[];
  snapshot: AdvisorSnapshot;
  profile: { name: string; body: string };
  contentType: ContentType;
  context: { businessName: string; founderName: string; services: string };
}): Promise<{ content: string }> {
  const res = await fetch("/api/content", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "request_failed" }));
    if (err.error === "no_key") {
      throw new Error(
        "The Content Studio needs an ANTHROPIC_API_KEY. Add it to .env.local and restart.",
      );
    }
    throw new Error(typeof err.error === "string" ? err.error : "The content request failed.");
  }

  return (await res.json()) as { content: string };
}
