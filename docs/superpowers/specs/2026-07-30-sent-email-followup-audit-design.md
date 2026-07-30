# Sent-Email Follow-Up Audit — Design

**Date:** 2026-07-30
**Status:** Approved, ready for implementation planning

## Problem

The Sales Advisor can read the founder's Gmail *inbox*, but it is blind to what he
has **sent**. So it cannot answer the question that matters most for pipeline
hygiene: *who did I email, and who never came back to me?*

Concretely, `listThreads` in `src/lib/gmail/gmailApi.ts` hardcodes
`labelIds: "INBOX"`, so the existing `query_emails` tool cannot see sent mail at
all. This is new plumbing, not a prompt change.

The founder's sent folder is also polluted by Apollo mailwarming traffic, which
must be excluded before anything is surfaced.

## Goal

One new advisor tool that scans sent mail, works out who has gone quiet, and
proposes follow-up tasks for the founder to confirm.

## Non-goals

- **Sending or drafting email.** The OAuth grant is `gmail.readonly`
  (`src/lib/gmail/config.ts`). Real Gmail drafts would need `gmail.compose` plus
  re-authorising every connected inbox. Explicitly out of scope.
- **CRM writes.** No lead creation or `lastContact` / `nextFollowUp` updates.
- **Caching or indexing sent history.** The scan runs live. If it proves too slow
  in practice, caching is a separate follow-on piece of work.
- **Recipient→lead matching inside the tool.** The advisor already has
  `query_leads` and can cross-reference itself, so the resolver does not need the
  CRM snapshot threaded into it.

## Inclusion rule

A sent thread is a candidate when **all** of these hold:

1. It is in `in:sent`.
2. It is **not** labelled `Apollo Mailwarming`.
3. **Either** the subject contains `Pallisade`, **or** the founder's own message
   in that thread is signed off as `Emil` / `Emil Fabel`.

Rule 3 is a disjunction on purpose. A subject-only rule would miss hand-written
replies inside a prospect's own thread, where the subject becomes their words
(`Re: intro from Sarah`). The sign-off test covers those.

### Assumption: Apollo *sequence* sends are included

Apollo does two distinct things — mailwarming, and sequences (real cold outreach
to real prospects). Only label-marked **mailwarming** is excluded. Sequence
recipients are real people the founder emailed, and are exactly the people worth
following up, so they stay in.

### Sign-off detection — strict last line

After cutting the quoted-reply section, the **last non-empty line** of the
founder's own message body must be `Emil` or `Emil Fabel`, compared
case-insensitively with surrounding whitespace and trailing punctuation stripped.

This is deliberately strict, chosen by the founder over a looser
signature-block scan. The known trade-off: a signature with a title line beneath
the name does **not** match.

```
Best,
Emil                        <- matches (last non-empty line)

Emil Fabel
Founder, Pallisade Data     <- does NOT match (last line is the title)
```

Two mitigations, since a strict rule can silently match nothing:

- How many trailing non-empty lines are searched lives in a single exported
  constant, `SIGNOFF_SEARCH_LINES`, set to `1` for the strict rule. Loosening to a
  signature-block scan later is a one-value change, with no other edits.
- The tool result reports how many threads were excluded **only** by the sign-off
  rule. Under-matching then shows up as a number rather than as a mysteriously
  empty answer.

**Quoted-reply cutting** is conservative, and treats the two kinds of quote
evidence differently.

*Attribution markers* only ever introduce a trailing quote block, so everything
from the first one down is cut:

- `On <...> wrote:` — including the form where Gmail wraps `wrote:` onto its own line
- `-----Original Message-----`
- a `From:` line immediately followed by a `Sent:` / `Date:` line

*Quoted lines* — those beginning with `>` — are **dropped, not cut at**. A quoted
line can legitimately sit *above* the founder's own sign-off: an interleaved
point-by-point reply, or a customer testimonial he is quoting. Truncating at the
first `>` would discard his signature below it and silently classify a mail he did
sign as unsigned, which is the precise over-stripping failure this rule exists to
avoid.

A lone `From:` line is not a marker — it appears in ordinary prose. Nothing beyond
the above is removed.

## Identifying the founder's own messages

A message is "ours" when its `From` is one of the connected inbox addresses
(`listAccountInfo()`), lowercased and trimmed — **plus** any address discovered
through the `SENT` label.

That second source is essential, not belt-and-braces. Gmail's "send mail as"
lets the founder send from a company-domain alias on a personal account, in which
case his `From` header never matches the connected account's address. Matching on
the address alone would then find zero own-messages in every thread, which
cascades: `classifyThread` sees only "their" messages and returns `awaiting_you`
for threads nobody ever replied to, recipients come back empty so no row renders,
yet the thread still counts toward `matched`. The founder is told N threads matched
and shown fewer, with no diagnostic.

`gmail.readonly` cannot read Gmail's sendAs settings, so aliases cannot be
enumerated. But the audit's query is `in:sent`, so every thread it fetches contains
at least one message the founder sent, and **those messages carry the `SENT`
label** whatever address they went out as. Their `From` addresses are therefore
harvested per thread and accumulated into the own-address set, which the final
aggregation also uses to exclude the founder from his own recipient list.

A thread where no message can still be attributed to him is skipped and counted in
`excludedNoOwnMessage`, rather than producing a row that can never render.

## Reply classification

Per thread, messages are sorted by date and each message's `From` address is
compared against that own-address set.

| Thread state | Bucket | Surfaced |
|---|---|---|
| No message from anyone but the founder | `no_reply` | Yes |
| The last message in the thread is theirs | `awaiting_you` | Yes |
| They replied, but the founder's message is last | `stalled` | No — returned as a count only |

`stalled` is computed but not surfaced, per the founder's choice of buckets. It is
returned as a count so that set-aside threads are visible rather than silently
dropped.

## Aggregation

Results are grouped by recipient email address, excluding the founder's own
addresses. Each recipient carries their **most recent** qualifying thread:

- name and email
- company, derived via the existing `companyFromEmail` helper
- date last emailed, and days since
- subject and thread id
- bucket (`no_reply` / `awaiting_you`)

## Scan strategy

Live, on demand, newest first, with a cap.

- Thread ids are paged out of Gmail search via `pageToken`.
- Each candidate thread needs one `format=full` fetch — this single call yields
  both the body (for sign-off detection) and the per-message `From`/date headers
  (for reply classification).
- Fetches run through a **bounded pool of 8 concurrent requests**. Gmail allows
  250 quota units/user/second and `threads.get` costs 10 units, giving a ceiling
  of ~25/sec; 8 concurrent stays comfortably under it.
- The scan caps at **400 threads**.

The result always reports `scanned`, `matched`, the cap, and whether the cap was
hit. A capped scan must never read as complete coverage.

The cap is split evenly across connected inboxes, so "capped" cannot be derived
from the global total alone: with two inboxes and a cap of 400, an inbox truncated
at its 200-thread share while the other holds 10 threads yields a global `scanned`
of 210 — under the cap, yet coverage is incomplete. `capped` is therefore true when
**either** the global cap was reached **or** any single inbox exhausted its share.
An inbox returning exactly its allowance counts as capped: over-reporting
truncation is a harmless nudge to narrow the query, while under-reporting it is a
false claim of completeness.

**Known limitation.** If the sent folder is dominated by high-volume Apollo
sequence traffic, the 400 newest threads could crowd out older hand-written mail.
Mitigation: the tool accepts an optional Gmail `query` passthrough, so the advisor
can narrow the scan (for example `subject:Pallisade`) when the cap is hit.

## Output and confirmation

The advisor reports who has gone quiet, then proposes `create_task` follow-ups
through the **existing confirm-gated proposal flow** in
`src/lib/advisor/tools.ts`. Write tools return a synthetic `queued` result and
push a `ProposedAction`; nothing is written until the founder confirms in the UI.
No new write path is needed — `create_task` already does this.

## Structure

| File | Change | Role |
|---|---|---|
| `src/lib/gmail/sentScan.ts` | new | Pure logic: cut quoted replies, detect sign-off, classify a thread, group by recipient. No I/O. Follows the `parse.ts` convention. |
| `src/lib/gmail/sentScan.test.ts` | new | Unit tests for the above |
| `src/lib/gmail/gmailApi.ts` | edit | Add `listThreadIds()` with `pageToken` paging |
| `src/lib/gmail/sentAudit.ts` | new | Server-only orchestration: page ids, fetch through the bounded pool, apply the pure filters, aggregate |
| `src/lib/advisor/tools.ts` | edit | Register `audit_sent_followups` in `EMAIL_TOOLS` |
| `src/lib/gmail/advisorEmail.ts` | edit | Resolve the new tool |
| `src/app/api/advisor/route.ts` | edit | Prompt guidance for when to reach for the tool |

`listThreads` is left untouched. It is INBOX-only by design and the inbox UI
depends on that behaviour; sent-mail listing gets its own paging helper rather
than an overloaded parameter.

The split between `sentScan.ts` (pure, tested, no I/O) and `sentAudit.ts`
(I/O, orchestration) is the important boundary: every filtering decision that
could be wrong is testable without touching the Gmail API.

## Error handling

- `GmailAuthError` from any account propagates as a reconnect-needed signal;
  the existing Gmail layer already maps 401 to it.
- A failed individual thread fetch is skipped, not fatal — consistent with the
  `.catch(() => [])` pattern already used in `advisorEmail.ts` — but skipped
  threads are counted and reported so failures are not invisible.
- A failed thread *listing* is different in kind and must be recorded separately in
  `listingFailures`, and must force `capped` true. Swallowing it to an empty id list
  makes the inbox contribute nothing to any counter, so the result would claim
  complete, uncapped, failure-free coverage of an inbox that was never read.
- Rate limiting is retried once with a short backoff. Gmail allows ~250 quota
  units/second and `threads.get` costs 10, so a several-hundred-thread scan can trip
  the limit; with no retry the pool keeps draining at full speed and one trip
  cascades into losing most of the remaining scan.
- The public entry point clamps a non-finite `limit` to the default. `NaN`
  propagates through the cap arithmetic into `while (ids.length < NaN)`, which is
  immediately false, yielding an empty audit reported as "nobody needs a follow-up".
- With no inbox connected, the tool is not offered at all. The advisor route
  already gates `EMAIL_TOOLS` on `emailToolsAvailable()`.

## Testing

Unit tests against `sentScan.ts`, which is where the logic that can be wrong
lives:

- **Quoted-reply cutting** — each attribution-marker form; a signature preserved
  above the cut; a sign-off preserved *below* a quoted testimonial and inside an
  interleaved point-by-point reply
- **Sign-off detection** — bare `Emil`; `Emil Fabel`; trailing punctuation and
  whitespace; the documented title-line non-match; a non-Emil sign-off rejected
- **Inclusion rule** — subject-only match; sign-off-only match; neither; the
  mailwarming label excluded even when the other rules pass
- **Reply classification** — all three buckets; own-address matching is
  case-insensitive; a thread with only the founder's messages
- **Aggregation** — one recipient across several threads keeps the most recent;
  the founder's own addresses are dropped from recipients
- **Diagnostics** — the sign-off-only exclusion count is accurate
