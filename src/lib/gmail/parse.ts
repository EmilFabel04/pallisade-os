/* ============================================================
   Pure helpers for shaping Gmail API payloads. No I/O — unit-tested.
   ============================================================ */

export interface MailAddress {
  name: string;
  email: string;
}

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPayload {
  mimeType?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPayload[];
}

const FREE_PROVIDERS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com",
  "outlook.com", "live.com", "icloud.com", "me.com", "aol.com",
  "proton.me", "protonmail.com", "gmx.com", "mail.com",
]);

/** Case-insensitive header lookup. */
export function header(headers: GmailHeader[] | undefined, name: string): string {
  const lower = name.toLowerCase();
  return headers?.find((h) => h.name.toLowerCase() === lower)?.value ?? "";
}

/** Parse a single address: `Name <a@b.com>` or `a@b.com`. */
export function parseAddress(raw: string): MailAddress {
  const s = raw.trim();
  const m = s.match(/^(.*?)<([^>]+)>$/);
  if (m) {
    const name = m[1].trim().replace(/^"|"$/g, "").trim();
    const email = m[2].trim();
    return { name: name || email, email };
  }
  return { name: s, email: s };
}

/** Parse a comma-separated address list, respecting quoted display names. */
export function parseAddressList(raw: string): MailAddress[] {
  if (!raw.trim()) return [];
  const parts: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (const ch of raw) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === "," && !inQuotes) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => parseAddress(p)).filter((a) => a.email);
}

/** Decode a Gmail base64url body part to a UTF-8 string. */
export function decodeBody(data: string | undefined): string {
  if (!data) return "";
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Buffer.from(b64, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(p|div|br|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Walk a MIME tree and return readable plain text (prefers text/plain). */
export function extractText(payload: GmailPayload | undefined): string {
  if (!payload) return "";

  const plain = findPart(payload, "text/plain");
  if (plain?.body?.data) return decodeBody(plain.body.data).trim();

  const html = findPart(payload, "text/html");
  if (html?.body?.data) return stripHtml(decodeBody(html.body.data));

  if (payload.body?.data) return decodeBody(payload.body.data).trim();
  return "";
}

function findPart(payload: GmailPayload, mimeType: string): GmailPayload | null {
  if (payload.mimeType === mimeType && payload.body?.data) return payload;
  for (const part of payload.parts ?? []) {
    const found = findPart(part, mimeType);
    if (found) return found;
  }
  return null;
}

/** Best-effort company name from an email domain. Returns "" for free providers. */
export function companyFromEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  const domain = email.slice(at + 1).toLowerCase();
  if (!domain || FREE_PROVIDERS.has(domain)) return "";
  // second-level label: acme.co.uk -> acme, mail.acme.com -> acme
  const labels = domain.split(".").filter(Boolean);
  if (labels.length < 2) return "";
  const sld = labels.length >= 3 && labels[labels.length - 2].length <= 3
    ? labels[labels.length - 3] // e.g. acme.co.uk
    : labels[labels.length - 2];
  return sld.charAt(0).toUpperCase() + sld.slice(1);
}
