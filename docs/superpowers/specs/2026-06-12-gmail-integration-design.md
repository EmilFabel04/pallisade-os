# Gmail Integration — Design

**Date:** 2026-06-12
**Status:** Approved (scope confirmed via brainstorming Q&A)

## Goal

Let the solo founder connect one or more Gmail inboxes to Pallisade OS so they can:

- **(B) View** email threads inside the OS — a new `/inbox` section.
- **(A) Capture** — create a CRM Lead from an email/sender in one click.
- **(D) Log** — record an email against a matching existing Lead as an Interaction.
- **Advisor** — let the Sales Advisor read recent emails to ground answers and drafts.

LinkedIn is explicitly **out of scope**: LinkedIn offers no official API for inbox,
messages, or connections to a solo app. Revisit only via a manual-capture path later.

## Connection method

**Gmail API over OAuth 2.0** (chosen over IMAP/app-password for richer data,
multi-account, and future send support).

- Library: `google-auth-library` (`OAuth2Client`) for the auth-code flow and
  automatic access-token refresh. Gmail REST endpoints (`gmail.googleapis.com/gmail/v1`)
  are called directly with `fetch` — avoids the heavy full `googleapis` package.
- Scopes: `https://www.googleapis.com/auth/gmail.readonly` and
  `https://www.googleapis.com/auth/userinfo.email` (to label the account).
- Redirect URI (local app): `http://localhost:3000/api/gmail/callback`.
- Credentials come from `.env.local`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  optional `GMAIL_REDIRECT_URI` (defaults to the localhost URI above).

The integration is **dormant until credentials are present** — every route reports
`configured: false` and the UI shows a guided setup notice instead of breaking.

## Data & secrets

- New **server-only** SQLite table `gmail_accounts(id, email, tokens_json,
  created_at, updated_at)` in the existing `data/pallisade.db`.
- Tokens never enter the client `DataShape` / `/api/data` sync — they live only in
  server routes. Stored plaintext, consistent with the existing local-app posture
  (the Anthropic key is already plaintext in `.env.local`).
- Module: `src/lib/gmail/accounts.ts` (server-only) — CRUD over the table.

## Components

```
src/lib/gmail/
  config.ts      # reads creds, isConfigured(), oauth client + redirect URI
  accounts.ts    # server-only token store (gmail_accounts table)
  client.ts      # authed fetch helper per account (auto-refresh + persist)
  gmailApi.ts    # listThreads / getThread / getProfile (REST shaping)
  parse.ts       # header/address/body helpers (pure, unit-tested)

src/app/api/gmail/
  status/route.ts     # GET configured + connected account count
  connect/route.ts    # GET -> 302 to Google consent (state = CSRF)
  callback/route.ts    # GET -> exchange code, store account, close popup
  accounts/route.ts   # GET list, DELETE disconnect
  threads/route.ts    # GET recent threads for an account (+ optional q)
  thread/route.ts     # GET full thread messages

src/app/inbox/page.tsx          # the section
src/components/inbox/*           # AccountBar, ThreadList, ThreadReader
```

## Flows

**Connect:** UI opens `/api/gmail/connect` in a popup → Google consent →
`/api/gmail/callback` exchanges the code, calls userinfo for the email, upserts the
account, returns a tiny HTML page that `postMessage`s the opener and closes. UI
refetches accounts.

**View:** `/inbox` lists accounts; selecting one (or "All") loads recent threads via
`/api/gmail/threads`; selecting a thread loads `/api/gmail/thread`.

**Create lead (A):** from a thread, prefill a new Lead (company from sender domain,
contactName from display name, email, `source: "email"`) via the existing
`store.create("leads", …)`, then deep-link to `/leads?focus=<id>`.

**Log to lead (D):** the reader matches thread participants against existing leads by
email. When matched, a one-click **Log to lead** creates an Interaction
(`type: "email reply"`, leadId, company, contact, date, rawNotes = subject + snippet).
No silent auto-sync — every write is explicit, matching the app's confirm-first ethos.

**Advisor reads email:** add a `query_emails` read tool. Because Gmail calls are
async and snapshot-free, the advisor route resolves this tool via a dedicated async
path (`resolveGmailTool`) rather than the sync `resolveTool`; the system prompt lists
connected accounts so the model knows email is available.

## Error handling

- Missing creds → `configured:false`, setup notice (no throw).
- No connected accounts → empty-state prompting Connect.
- Expired/revoked tokens → refresh attempt; on failure the account is flagged
  "reconnect needed" and the route returns a 401 the UI renders inline.
- Gmail API errors → surfaced as an inline error string, never a crash.

## Testing

- `parse.ts` pure helpers unit-tested (address parsing, header lookup, body decode,
  domain→company guess).
- Advisor `query_emails` tool schema covered in `tools.test.ts`.
- OAuth/route flows verified manually against a real Google project (cannot be unit
  tested without live creds).

## Out of scope (YAGNI for v1)

Sending email, label management, background polling/auto-sync, attachment handling,
token encryption at rest, search beyond a simple Gmail `q` passthrough.
