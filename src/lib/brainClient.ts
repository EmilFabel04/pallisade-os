export async function getBrainStatus(): Promise<{ configured: boolean; model: string }> {
  try {
    const res = await fetch("/api/brain", { method: "GET" });
    if (!res.ok) return { configured: false, model: "" };
    return (await res.json()) as { configured: boolean; model: string };
  } catch {
    return { configured: false, model: "" };
  }
}

export async function sendBrainTurn(params: {
  messages: { role: "user" | "assistant"; content: string }[];
  mode?: "strategist" | "brainstorm";
  attachments?: { name: string; content: string }[];
  context: { businessName: string; founderName: string; driveAccountId?: string };
}): Promise<{ content: string }> {
  const res = await fetch("/api/brain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "request_failed" }));
    if (err.error === "agent_unconfigured") {
      throw new Error("The Brain needs an ANTHROPIC_API_KEY. Add it to .env.local and restart.");
    }
    throw new Error(typeof err.error === "string" ? err.error : "The request failed.");
  }

  return (await res.json()) as { content: string };
}

export async function getDriveStatus(): Promise<{ connected: boolean; accountId: string | null }> {
  try {
    const res = await fetch("/api/drive/status");
    if (!res.ok) return { connected: false, accountId: null };
    return (await res.json()) as { connected: boolean; accountId: string | null };
  } catch {
    return { connected: false, accountId: null };
  }
}
