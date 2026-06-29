import type { NewsFeedData, NewsInterests } from "./types";

export async function getNewsStatus(): Promise<{ configured: boolean; github: boolean; model: string }> {
  try {
    const res = await fetch("/api/news", { method: "GET" });
    if (!res.ok) return { configured: false, github: false, model: "" };
    return (await res.json()) as { configured: boolean; github: boolean; model: string };
  } catch {
    return { configured: false, github: false, model: "" };
  }
}

export async function refreshNews(interests: NewsInterests): Promise<NewsFeedData> {
  const res = await fetch("/api/news", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ interests }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "request_failed" }));
    throw new Error(typeof err.error === "string" ? err.error : "The news refresh failed.");
  }
  return (await res.json()) as NewsFeedData;
}
