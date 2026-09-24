# Deploying Pallisade OS to Vercel

A one-time setup to host the app privately on Vercel with single-user Google login
and a Turso database. After this, `git push` auto-deploys.

The code is already done: libSQL/Turso storage, Auth.js Google login (email
allowlist), a route-gating middleware, and security headers. What's left is
creating the cloud resources (your accounts) and pasting the secrets into Vercel.

---

## 0. Prerequisites

```bash
npm i -g vercel        # Vercel CLI
npm i -g turso         # Turso CLI  (or: brew install tursodatabase/tap/turso)
```

---

## 1. Create the Turso database

```bash
turso auth login
turso db create pallisade-os

# Grab the two values you'll paste into Vercel:
turso db show pallisade-os --url          # -> TURSO_DATABASE_URL  (libsql://...)
turso db tokens create pallisade-os       # -> TURSO_AUTH_TOKEN
```

The schema is created automatically on first use (tables are `CREATE TABLE IF NOT
EXISTS`). You start with an empty database — see **§6** to migrate your existing
local data if you want it.

---

## 2. Create the Google OAuth client for login (Auth.js)

This is a **separate** client from your Gmail/Calendar/Drive one.

1. Google Cloud Console → **APIs & Services → Credentials → Create Credentials →
   OAuth client ID → Web application**.
2. **Authorized redirect URIs** — add both:
   - `http://localhost:3000/api/auth/callback/google`
   - `https://<your-vercel-domain>/api/auth/callback/google`
     (you'll know the domain after the first deploy — come back and add it, or add
     your custom domain now if you have one).
3. Copy the **Client ID** → `AUTH_GOOGLE_ID` and **Client secret** →
   `AUTH_GOOGLE_SECRET`.

Generate the session secret:

```bash
npx auth secret      # prints AUTH_SECRET (also offers to write .env.local)
```

Set `AUTH_ALLOWED_EMAIL` to the single Google account allowed to log in.

---

## 3. Update the EXISTING Gmail/Calendar/Drive OAuth client

So Inbox/Agenda/Drive keep working in production, add the production redirect URI
to your **existing** Google client (the one in `GOOGLE_CLIENT_ID`):

- `https://<your-vercel-domain>/api/gmail/callback`

(Optionally set `GMAIL_REDIRECT_URI` in Vercel to that URL.)

---

## 4. Create the Vercel project + environment variables

```bash
vercel link            # link this repo to a new/existing Vercel project
```

Add every variable below to **Production** (and Preview, if you use it). Via CLI
`vercel env add <NAME> production`, or paste them in the Vercel dashboard →
Project → Settings → Environment Variables:

| Variable | Value |
|---|---|
| `AUTH_SECRET` | from `npx auth secret` |
| `AUTH_GOOGLE_ID` | login OAuth client id (§2) |
| `AUTH_GOOGLE_SECRET` | login OAuth client secret (§2) |
| `AUTH_ALLOWED_EMAIL` | the one email allowed to log in |
| `TURSO_DATABASE_URL` | from §1 (`libsql://...`) |
| `TURSO_AUTH_TOKEN` | from §1 |
| `ANTHROPIC_API_KEY` | your Claude key (AI features + News curation) |
| `GITHUB_TOKEN` | optional — raises GitHub rate limit for News |
| `GOOGLE_CLIENT_ID` | existing Gmail/Calendar/Drive client |
| `GOOGLE_CLIENT_SECRET` | existing Gmail/Calendar/Drive client |
| `OPENAI_API_KEY` | optional — voice transcription |
| `TYPESAFE_API_KEY` | optional — Jev judges the `/follow-ups` sent-mail audit per thread; without it the audit falls back to the keyword heuristic, nothing breaks |

> A full `/follow-ups` scan pages up to 400 Gmail threads and, with
> `TYPESAFE_API_KEY` set, makes up to 400 Jev calls on top of that — `POST
> /api/followups/run` can run for tens of seconds to a few minutes on a large
> inbox. It sets `maxDuration = 300` accordingly; a platform request-timeout
> setting below that will cut a large scan off mid-run.

> Do **not** set `NODE_ENV` — Vercel sets it to `production`, which makes the auth
> gate enforce. The local dev bypass can never trigger in production.

---

## 5. Deploy

```bash
vercel --prod
```

Then finish wiring the OAuth redirects:
- Add `https://<the-domain-vercel-gave-you>/api/auth/callback/google` to the §2 client.
- Add `https://<the-domain>/api/gmail/callback` to the §3 client.

Visit the domain → you should be redirected to `/login` → "Sign in with Google" →
only `AUTH_ALLOWED_EMAIL` is let in; any other Google account is rejected.

---

## 6. (Optional) Migrate your existing local data to Turso

Your local data lives in `data/pallisade.db`. To copy it into Turso:

```bash
# Dump the local SQLite database to SQL...
sqlite3 data/pallisade.db .dump > pallisade-dump.sql
# ...and load it into Turso:
turso db shell pallisade-os < pallisade-dump.sql
```

If the dump includes `BEGIN TRANSACTION;`/`COMMIT;` that conflict, you can instead
open `turso db shell pallisade-os` and paste the `INSERT` statements. Verify with
`turso db shell pallisade-os "SELECT count(*) FROM leads;"`.

(If you'd rather start fresh in the cloud, skip this — the app creates empty tables
on first load.)

---

## 7. Day-to-day

- `git push` → Vercel auto-deploys.
- Rotate secrets anytime in Vercel → Settings → Environment Variables (redeploy to apply).
- Local dev still uses the on-disk SQLite file and (with `AUTH_GOOGLE_ID` unset)
  skips the login gate, so `npm run dev` just works.

## Security posture recap

- Every page and API route is gated by `src/middleware.ts`; only `AUTH_ALLOWED_EMAIL`
  can authenticate (Auth.js `signIn` allowlist, requires a verified email).
- Sessions are stateless JWTs (no session table); `trustHost` is on for Vercel.
- Secrets live only in Vercel env vars — never in git (`.env*.local` and `/data`
  are gitignored; history was scanned clean).
- Security headers (HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy,
  Permissions-Policy, CSP `frame-ancestors 'none'`) on every response.
- OAuth tokens (Gmail/Calendar/Drive) are stored server-side in the DB and never
  sent to the client.
