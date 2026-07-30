import { isConfigured, oauthClient } from "@/lib/gmail/config";
import { upsertAccount } from "@/lib/gmail/accounts";
import { profileEmail } from "@/lib/gmail/gmailApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Google redirects here after consent. Exchange the code, store the account,
 *  then hand back a tiny page that notifies the opener window and closes. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const denied = url.searchParams.get("error");
  const cookieState = readCookie(req.headers.get("cookie"), "gmail_oauth_state");

  if (denied) return page(false, `Google sign-in was cancelled (${denied}).`);
  if (!isConfigured()) return page(false, "Gmail is not configured on the server.");
  if (!code) return page(false, "Missing authorization code.");
  if (!state || state !== cookieState) return page(false, "Security check failed — please try connecting again.");

  try {
    const { tokens } = await oauthClient().getToken(code);
    const access = tokens.access_token ?? undefined;
    const email = access ? await profileEmail(access) : "";
    if (!email) return page(false, "Could not read the account email.");
    await upsertAccount(email, tokens);
    return page(true, email);
  } catch (e) {
    // Google's OAuth errors belong in the terminal, not rendered into a page.
    console.error("[api] gmail_callback_failed:", e);
    return page(false, "Failed to connect the account.");
  }
}

function readCookie(cookieHeader: string | null, name: string): string {
  if (!cookieHeader) return "";
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return "";
}

/** Self-closing popup page that messages the opener so the inbox refreshes. */
function page(ok: boolean, detail: string): Response {
  const payload = JSON.stringify({ type: "gmail-connected", ok, detail });
  const title = ok ? "Connected" : "Connection failed";
  const body = ok
    ? `Connected <strong>${escapeHtml(detail)}</strong>. You can close this window.`
    : `Could not connect: ${escapeHtml(detail)}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:ui-sans-serif,system-ui;background:#0c0c0e;color:#ededee;display:flex;
align-items:center;justify-content:center;height:100vh;margin:0}
.card{border:1px solid #2a2a30;border-radius:12px;padding:24px 28px;max-width:380px;text-align:center;
font-size:14px;line-height:1.5}.ok{color:#3fb950}.err{color:#e5484d}</style></head>
<body><div class="card"><p class="${ok ? "ok" : "err"}">${ok ? "✓" : "✕"}</p><p>${body}</p></div>
<script>
  try { if (window.opener) window.opener.postMessage(${payload}, "*"); } catch (e) {}
  setTimeout(function(){ window.close(); }, ${ok ? 900 : 4000});
</script></body></html>`;
  // Clear the state cookie now that the dance is done.
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "set-cookie": "gmail_oauth_state=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
    },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c),
  );
}
