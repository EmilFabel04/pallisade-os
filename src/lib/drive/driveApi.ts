/* ============================================================
   Authenticated Google Drive reads for a connected account.
   Reuses the Gmail OAuth layer's googleFetch (token refresh + 401 handling).
   Server-only.
   ============================================================ */

import { googleFetch } from "@/lib/gmail/client";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

const GOOGLE_DOC = "application/vnd.google-apps.document";
const READABLE_MIMES = [GOOGLE_DOC, "text/markdown", "text/plain"];

/** Build a Drive `q` filter limited to text-like files the Brain can read. */
export function driveQuery(query: string): string {
  const mimes = READABLE_MIMES.map((m) => `mimeType = '${m}'`).join(" or ");
  const safe = query.trim().replace(/'/g, "\\'");
  const term = safe
    ? ` and (name contains '${safe}' or fullText contains '${safe}')`
    : "";
  return `trashed = false and (${mimes})${term}`;
}

/** How to fetch a file's text, based on its mime type. */
export function driveFetchPlan(
  mimeType: string,
): { mode: "export"; exportMime: string } | { mode: "download" } {
  if (mimeType === GOOGLE_DOC) return { mode: "export", exportMime: "text/markdown" };
  return { mode: "download" };
}

export async function searchFiles(accountId: string, query: string): Promise<DriveFile[]> {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", driveQuery(query));
  url.searchParams.set("fields", "files(id,name,mimeType)");
  url.searchParams.set("pageSize", "20");
  url.searchParams.set("orderBy", "modifiedTime desc");
  const res = await googleFetch(accountId, url.toString());
  if (!res.ok) throw new Error(`drive_api_${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { files?: DriveFile[] };
  return data.files ?? [];
}

export async function readFileContent(accountId: string, fileId: string): Promise<string> {
  const metaUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  metaUrl.searchParams.set("fields", "mimeType,name");
  const metaRes = await googleFetch(accountId, metaUrl.toString());
  if (!metaRes.ok) throw new Error(`drive_api_${metaRes.status}`);
  const meta = (await metaRes.json()) as { mimeType: string };

  const plan = driveFetchPlan(meta.mimeType);
  const base = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`;
  const url = new URL(plan.mode === "export" ? `${base}/export` : base);
  if (plan.mode === "export") url.searchParams.set("mimeType", plan.exportMime);
  else url.searchParams.set("alt", "media");

  const res = await googleFetch(accountId, url.toString());
  if (!res.ok) throw new Error(`drive_api_${res.status}`);
  return res.text();
}
