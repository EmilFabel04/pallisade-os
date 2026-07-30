# Sent-Email Follow-Up Audit — Follow-Ups and First-Run Checklist

Companion to `2026-07-30-sent-email-followup-audit-design.md`. Everything here was
raised during review, triaged, and deliberately deferred rather than dropped.

**Status at merge:** 7 tasks, 30 commits, 359 tests passing, typecheck clean. Final
whole-branch review verdict: mergeable.

**Nothing in this feature has ever executed against real Gmail data.** The
end-to-end check needs a dev server, an `ANTHROPIC_API_KEY` and a connected inbox,
none of which existed in the build worktree. The checklist below is therefore not
optional politeness — it is the first real verification this code will get.

---

## Before this runs on real mail

Ordered by what would mislead you first.

1. **Start with `limit: 25`, not the default 400.** Ask the advisor: *"audit my sent
   follow-ups, scan only the last 25 threads."* Time it. A 400-thread scan is 400
   `format=full` fetches at concurrency 8, each preceded by a `getAccount` DB read
   and a token check. If that averages ~500ms per thread it is ~25 seconds *inside*
   the Anthropic tool loop. There is no `maxDuration` export on
   `src/app/api/advisor/route.ts` and no `vercel.json` — if this is ever deployed
   rather than run locally, the default platform timeout will kill it mid-scan.

2. **Check `excludedWarming` on the first real run.** If it is above zero, the
   server-side `-label:"Apollo Mailwarming"` exclusion is **not** working and
   warming threads are being fetched and then discarded by the client-side safety
   net. Gmail's handling of a negated quoted multi-word label is the untested
   assumption. If non-zero, try the hyphenated form `-label:apollo-mailwarming`.

3. **Check `excludedSignoffOnly` against your intuition.** Large, with a thin
   `followUps` list, means the strict last-line sign-off rule is under-matching.
   Before loosening `SIGNOFF_SEARCH_LINES`, rule out the HTML cause — that was a
   separate bug (`<br>` stripping, now fixed) with the same symptom.

4. **Verify `listingFailures` and `fetchFailures` are 0.** The advisor now reports
   these, but confirm the numbers agree with what it tells you.

5. **If you send from a "send mail as" alias**, confirm recipients you know you
   emailed from that alias appear in `followUps`. If `excludedNoOwnMessage` is above
   zero, the problem is `From` parsing, not aliases.

6. **Hand-check one `awaiting_you` row.** Open its `threadId` in Gmail and confirm
   the last message really is theirs and you really have not replied. This exercises
   the one assumption no test can settle: that `threads.get` returns messages
   chronologically.

7. **Do not confirm the first batch of `create_task` proposals blind.** The confirm
   gate is real and `applyAction.ts` writes real tasks. Read the descriptions once
   to check the names and companies are right — `company` is derived from the email
   domain and is a hint, not a verified name.

---

## Follow-ups

Ranked roughly by value. None blocks merge.

### Correctness

- **`daysSince` measures the wrong side for `awaiting_you`.** `lastSent` comes from
  the founder's message, so for a thread where *they* replied it reports "days since
  he last wrote", not "days he has been sitting on their reply" — which is the
  number that matters for the most urgent bucket. Spec-consistent, so changing it is
  a spec change, not a bug fix.
- **An all-unresolvable-date thread sorts last, not first.** `lastSent: ""` →
  `daysBetween` returns 0 → `daysSince: 0` → sorts last within its bucket, inverting
  the tool's core ordering. Rare (Gmail nearly always supplies `internalDate`).
  Treat an empty `lastSent` as maximally stale instead.
- **`ownEmails` mutation is order-dependent across threads.** An alias discovered
  partway through a scan means the same thread can bucket differently at `limit: 10`
  than at `limit: 400`. The error direction is toward over-surfacing, which is safe.
  Fix by harvesting all `SENT` `From` addresses for an account before its
  classification loop — the data is already in memory.
- **A permanent 403 is retried as a rate limit.** On a scope misconfiguration this
  doubles the request count and adds ~25s before returning nothing. Narrow the regex
  to 429 plus `rateLimitExceeded` in the body.
- **`daysBetween` rounds instead of flooring**, so ~13 hours reads as "1 day since".
  Immaterial at 30-day thresholds but it is a number you read. The docstring
  ("floored at 0") describes the clamp, not the rounding, and should be fixed with it.

### Honesty of the diagnostics

- **`capped` JSDoc understates its causes.** It names two; there are now four
  (`cap`, `per_inbox`, `listing_failure`, `empty_page_bail`).
- **The prompt cites `cap` for a `per_inbox` truncation**, where the real ceiling was
  `cap / accounts.length`. With two inboxes you would hear "stopped at 400" when one
  stopped at 200. `perAccount` is not currently exposed on the result, so the advisor
  has no accurate number to cite. Only matters with 2+ connected inboxes.
- **`scanned` can exceed `cap`** by up to `accounts - 1`, because `perAccount` uses
  `ceil`. "Scanned 402 of 400" reads as a bug. Needs 3+ inboxes.
- **`excludedSignoffOnly` is misnamed** — it counts threads that failed *both* the
  subject and sign-off rules. The prompt's interpretation is right; the name is not.
- **`labelLookupFailed` is one boolean across all accounts** and does not say which
  inbox lost its warming safety net.

### Robustness and hygiene

- **`isOwn` is duplicated inline** in `sentAudit.ts` rather than imported from
  `sentScan.ts`. Identical today; drifts the moment `isOwn` gains normalisation.
  Its JSDoc should also state that `ownEmails` must arrive already lowercased.
- **`followUps` is unbounded**, unlike every sibling tool (`query_emails` caps at 25,
  `query_calendar` at 40). A 400-thread scan can return 200+ rows into an
  8-iteration loop with `max_tokens: 2048`. Cap at ~50 and report the true total.
- **`gmail_auth` surfaces as a raw string** in the chat bubble. The spec calls for a
  "reconnect this inbox" signal; it currently terminates as the literal text
  `gmail_auth` in `advisorClient.ts`.
- **`mapPool` has no abort.** After a `GmailAuthError` rejects the pool, surviving
  workers keep firing requests against the revoked token — up to ~390 doomed account
  lookups and token refreshes after the function has already thrown.
- **One `getAccount` DB round-trip per Gmail request**, 400× per scan. Sub-millisecond
  on local SQLite; on remote Turso these are serialised network round-trips and could
  dominate runtime. Measure on the first real run.
- **No test pins `truncated === false` on the reach-`max` path** — the precise
  semantic the final fix wave locked down, and the one a future refactor could
  silently invert.
- **`<br>` with attributes** (`<br clear="all">`) still rejoins lines. Low impact:
  `stripHtml` only runs on HTML-only mail, which emits bare `<br>`.
- **`Cc` recipients are dropped** — only `To` is read. Probably intentional; undocumented.
- **`"default and maximum 400"`** in the tool description duplicates `SCAN_CAP` as a
  string literal and will drift.
- **Loosening `SIGNOFF_SEARCH_LINES` is untested.** The spec promises a one-value
  change with no other edits; a test at `SIGNOFF_SEARCH_LINES = 4` semantics would
  protect that escape hatch.

---

## Explicitly dropped

Raised, considered, and judged not worth acting on:

- `classifyThread` building `theirs` with `.filter` where `.some` would do — thread
  arrays are single-digit.
- `fetchFailures` conflating a failed request with a successfully-fetched empty
  thread — both mean "a listed thread contributed nothing".
- `(err as Error).message` on a possibly-null throw — unreachable, since
  `gmailGet`/`googleFetch` only throw `Error` subclasses.
- `BUCKET_RANK` placing `stalled` last — `stalled` is filtered before aggregation and
  never reaches the sort; the entry exists only to make the `Record` total.
