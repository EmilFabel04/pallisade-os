/* ============================================================
   Async resolver for the advisor's Gmail read tools (server-only).
   Kept separate from lib/advisor/tools.ts (which is sync + snapshot
   based) because reading email hits the Gmail API.
   ============================================================ */

import { isConfigured } from "./config";
import { listAccountInfo } from "./accounts";
import { listThreads } from "./gmailApi";

type Args = Record<string, unknown>;

/** True when the advisor should be offered the email tools. */
export async function emailToolsAvailable(): Promise<boolean> {
  return isConfigured() && (await listAccountInfo()).length > 0;
}

export async function connectedEmails(): Promise<string[]> {
  return (await listAccountInfo()).map((a) => a.email);
}

export async function resolveEmailTool(name: string, args: Args): Promise<string> {
  if (name === "list_inboxes") {
    return JSON.stringify({ inboxes: await connectedEmails() });
  }

  if (name === "query_emails") {
    const accounts = await listAccountInfo();
    const byId = new Map(accounts.map((a) => [a.id, a.email]));
    const wanted = args.account ? String(args.account).toLowerCase() : null;
    const target = wanted ? accounts.filter((a) => a.email.toLowerCase() === wanted) : accounts;
    const q = args.query ? String(args.query) : undefined;
    const limit = Math.min(Number(args.limit) || 10, 25);

    const lists = await Promise.all(
      target.map((a) => listThreads(a.id, { q, maxResults: limit }).catch(() => [])),
    );
    const emails = lists
      .flat()
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, limit)
      .map((t) => ({
        from: t.from.name || t.from.email,
        fromEmail: t.from.email,
        subject: t.subject,
        date: t.date,
        snippet: t.snippet,
        unread: t.unread,
        inbox: byId.get(t.accountId) ?? t.accountId,
      }));

    return JSON.stringify({ emails });
  }

  return JSON.stringify({ error: `unknown email tool: ${name}` });
}
