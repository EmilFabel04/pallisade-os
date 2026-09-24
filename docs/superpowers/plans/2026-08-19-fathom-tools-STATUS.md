# Fathom Meeting Tools — Status and Outstanding Work

**As of:** 2026-08-19
**Branch:** `feat/fathom-tools`
**Plan:** [2026-08-19-fathom-tools.md](2026-08-19-fathom-tools.md)
**Spec:** [../specs/2026-08-19-fathom-tools-design.md](../specs/2026-08-19-fathom-tools-design.md)

All 5 tasks are complete. This file records what each task built, the mutation sweep,
every real defect the branch's reviews found, the deferred minors, and — prominently,
because it is the largest open risk on this branch — what no amount of unit testing here
can settle.

**This branch stacks on `feat/projects-chat-migration` (PR #8), which has not merged to
`main`.** It extends `AgentContext`, `capabilities.ts` and the anti-blindness assertion
PR #8 introduces; none of that shape exists on `main` yet. `git merge-base main HEAD` is
`9f58ecb` (the tip of PR #7, `feat/agent-registry`), not this branch's own base
`ae4ce89`. **Do not rebase this branch onto `main`.** PR #8 must merge first.

## Where it stands

Suite: **1096 tests passing** (102 files; baseline before this branch was 1051, per the
controller's correction to the brief — the brief itself predicted no number). `tsc
--noEmit` clean. Production build passes, `/api/advisor`, `/api/brain` and
`/api/projects/chat` all present as dynamic routes. Zero surviving mutants across a
23-mutant sweep spread over four tasks. Real production database (`data/pallisade.db`)
untouched throughout — row counts verified before and after the full gate run: leads 11,
quotes 3, projects 5, milestones 7, file mtime unchanged (`Aug 14 15:43`, five days
before this branch's first commit).

| Task | State |
| --- | --- |
| 1 · The Fathom HTTP client | ✅ complete |
| 2 · The two tools and their resolver | ✅ complete, 2 fix rounds |
| 3 · Wire the group onto the bus, gated | ✅ complete |
| 4 · Routes and personas | ✅ complete, 1 fix round |
| 5 · Whole-branch verification | ✅ this document |

Full verbatim command output for this task is in
`.superpowers/sdd/2026-08-19-fathom-tools/task-5-report.md`.

## Per task

### Task 1 — The Fathom HTTP client

Commit `f3224e0`. New `src/lib/fathom/config.ts` (`isConfigured()`, `apiKey()`) and
`src/lib/fathom/client.ts` — a plain-`fetch` client against
`https://api.fathom.ai/external/v1`, no new runtime dependency. `listMeetings` and
`getTranscript` unwrap the documented envelope shapes (`{items, next_cursor}` →
`{items, nextCursor}`; `{transcript: [...]}` → a bare array). Three error classes
(`FathomAuthError`, `FathomRateLimitError`, `FathomError`) map 401/429/other non-2xx.
`apiKey()` is read **before** the network call, so a missing key never reaches `fetch`.

**Mutants (5, all killed):** swapping `next_cursor`→`nextCursor` broke pagination
round-tripping; a 401 branch that threw the generic `FathomError` instead of
`FathomAuthError` failed the auth-error test; removing the `apiKey()` guard let a
key-less request reach the mocked `fetch`, which returned `undefined` and crashed on
`res.ok` — the exact failure the guard exists to prevent, not a cosmetically different
error; returning the raw transcript envelope instead of unwrapping `.transcript` failed
two tests as an unavoidable joint consequence of one mutation; adding
`destination_url` to the transcript request (which switches Fathom's endpoint to an
async callback that returns no transcript) failed the "never sends destination_url" test.

**Review:** clean, Approved, no findings. Reviewer separately audited all five documented
wire names against the diff (`recording_id`, `default_summary.markdown_formatted`, the
transcript envelope object, `speaker` as an object not a string, `items`/`next_cursor`
snake-case on the wire with camelCase only on the exported surface) — no confusion in
either direction.

### Task 2 — The two tools and their resolver

Initial commit `47d4959`; fix rounds `7f35f59`, `a8f1557`. New `src/lib/fathom/tools.ts`:
`scanWindow` pages `listMeetings` up to `MAX_PAGES = 5`, reporting `truncated: true` when
the cap bites; `search` filters by `company` (via `crm_matches` plus invitee name/email/
domain) and `query` (title + summary), case-insensitive, ANDed; `readMeeting` re-scans
the window to find a `recording_id` (no single-meeting endpoint exists on the Fathom API)
and optionally fetches and clips the transcript at `MAX_TRANSCRIPT_CHARS = 40000`.
`resolveFathomTool` never throws — every failure becomes a JSON `{error}` string.

**Mutants (8 initial, all killed):** wrong summary field name; `id` read from a
nonexistent `.id` instead of `.recording_id`; truncation flag forced false at the page
cap; dropping the invitee-email fallback in company matching; dropping the summary
lookup in query matching; forcing the transcript to always fetch regardless of
`includeTranscript`; removing the transcript clip; removing the `isConfigured()` guard
before dispatch. Each failed exactly its named test.

**Review (opus):** spec ✅ — byte-verbatim from the brief, wire names correct, no fixture
doctored, all 8 mutants died for the right reasons. Quality: **Needs fixes**, 4 Important
findings (all real, all in the plan — see the defect table). Fix round 1 addressed all 4
Importants plus 2 Minors pulled into the same round, with 3 mutants re-run live to prove
the fixes load-bearing. Fix round 2 closed a one-line gap in Important 1's own fix (the
"widen" branch's assertion was too weak to independently distinguish it from the "narrow"
branch's message), with its own mutant confirming the new assertion is what catches it.

### Task 3 — Wire the group onto the bus, gated

Commit `4d91f5a`. `AgentContext` gains `fathomEnabled: boolean`. `grantsFor("fathom", ctx)`
returns `FATHOM_TOOLS` only when the flag is true, else `[]` — closing the same
"capability granted but not wired" failure mode the prior branch's handover named `repo`
and `fathom` as the next two to produce. `dispatch` gains a `FATHOM_TOOL_NAMES` branch.
New `src/lib/brain/availability.ts` export `resolveFathomEnabled(spec)` —
`spec.tools.includes("fathom") && isConfigured()`, synchronous (an env read, not a DB
read, so it needs no `Promise.all`). All three agent routes wire it in — done here, ahead
of Task 4's own step for it (noted below).

The pre-flight conflict scan flagged that `capabilities.test.ts`'s dispatch-routing test,
as originally specified, relied on `FATHOM_API_KEY` happening to be unset in whoever's
shell runs the suite — true today, but an accident of environment, not a guaranteed
property of the test. Per the controller's ruling, the test now force-deletes the env var
and stubs `fetch`, asserting it was never called, restored in a `finally`.

**Mutants (4, all killed):** ungating `grantsFor`'s `fathom` case; deleting the
`FATHOM_TOOL_NAMES` dispatch branch; reverting the disjointness fixture's `fathomEnabled`
to `false`; dropping `resolveFathomEnabled`'s `spec.tools.includes("fathom")` clause
(confirmed first that the *entire pre-existing 1091-test suite* did not catch this on its
own — the new `availability.test.ts` this task adds is what catches it).

**Review:** clean, Approved, no Critical/Important. Reviewer independently traced source
(not the report) to confirm both controller rulings — the network-isolation test's two
independent controls, and that vitest's default file isolation prevents the deleted env
var from leaking into sibling tests.

### Task 4 — Routes and personas

Initial commit `1e71893`; fix round `9cd7249`. Added `fathom` to the `tools` frontmatter
of `sales-advisor`, `discovery-coach` and `pipeline-analyst`, plus one body paragraph
each (copied character-for-character from the brief) on when to reach for the two tools.
Two new tests in `advisor/route.test.ts` pin the gate end-to-end: grants the fathom tools
when the key is set, grants none when it is absent. The three routes needed no change —
Task 3's implementer had already wired the real `resolveFathomEnabled(spec)` rather than
the literal `false` the brief's own Step 6 called for at that point in the sequence.

**Mutants (2, both killed):** removing `fathom` from `sales-advisor.md`'s tools array
failed the "grants the fathom tools" route test; hardcoding `fathomEnabled: true` in the
route (bypassing the resolver) failed the "grants no fathom tools when absent" test.

**Review:** spec ✅ on execution — tool names byte-exact against the real exports,
`FATHOM_API_KEY` cleanup failure-safe in a `finally`, the three routes verified
untouched, `roster.test.ts`'s 177 lines read in full to confirm it needed no change (it
didn't — the "every group grants something" guard lives in `capabilities.test.ts`, not
here). Quality: **Needs fixes**, 1 Important finding, on the brief's own persona prose,
not execution — see the defect table. Fixed in one round; no mutant applicable (persona
prose carries no test coverage by design — the reviewer had to read all three bodies
character by character to catch the gap in the first place).

## Defect table

Seven real defects were found across the branch's reviews (Tasks 1 and 3 reviewed clean
with no Important/Critical findings). "Caught where" follows the convention the prior two
branches' STATUS docs used: **plan** means the review found the plan's own text — a
prescribed code sample or the test code specifying what to assert — was wrong;
**implementation** would mean a reviewer found working code that departed from a correct
plan. Every implementer on this branch built what the brief specified, verbatim, by
instruction; no defect here originated in a departure from the plan.

| # | Found in | Defect | Caught where | Fixed in |
| --- | --- | --- | --- | --- |
| 1 | Task 2 | `readMeeting` discarded the `truncated` flag from `scanWindow`, so a capped scan that never found the id returned the unconditional "No meeting with that id... Try a larger sinceDays" — advice that, when the real cause is the 5-page cap, pushes the target *further* past the window instead of narrowing into it. Fixing this took two rounds: round 1 branched the message correctly but pinned only the narrow-branch wording, and the widen-branch test's `.toMatch(/sinceDays/)` also matched the new narrow message's text, so collapsing the ternary to always-narrow still passed the whole suite. | Plan — code sample (`tools.ts` Step 3) and test code (round 1's own gap) | `7f35f59`, `a8f1557` |
| 2 | Task 2 | `search` sliced matched results to `limit` without ever reporting how many meetings actually matched before the cut — 45 real matches and 20 returned looked identical to the model, which had no way to know 25 were silently dropped. | Plan — code sample (`search`'s return payload, `tools.ts` Step 3) | `7f35f59` |
| 3 | Task 2 | Every `scanned` assertion in the original test file ran filter-free, so a mutation that collapsed `scanned` to the post-filter count (`matched.length`) instead of the pre-filter count (`meetings.length`) shipped with the suite green. | Plan — test code | `7f35f59` |
| 4 | Task 2 | The `crm_matches`-filter test used `"Acme"` as its filter string, which the fixture also matches via title ("Acme discovery call") and invitee email (`sam@acme.co`) — so the test passed even with the entire CRM-matching branch deleted. Changed to `"Acme Ltd"`, a string that exists only in `crm_matches.companies[0].name`. | Plan — test code | `7f35f59` |
| 5 (minor, ruled in) | Task 2 | `sinceDays` on `fathom_read_meeting` was granted in the tool schema but no test proved it was actually wired into the underlying `listMeetings` call. | Plan — test code | `7f35f59` |
| 6 (minor, ruled in) | Task 2 | The unreachable-API test leaked a `console.error` line into the suite's stderr and never asserted that the raw HTTP status stayed out of the model-visible error string — only the positive "matches /could not be reached/i" was checked, so a mutant that appended the status code to the message would have passed. | Plan — test code | `7f35f59` |
| 7 | Task 4 | `discovery-coach.md`'s Fathom paragraph, copied verbatim from the brief, omitted the sentence both other personas carry: that a `truncated` search result means absence of a question is not evidence it was never asked. A capped scan would coach the founder off a partial call history presented as the whole one. | Plan — prose (persona paragraph, Step 7) | `9cd7249` |

**Ratio after the whole-branch review: 13 of 13 defects (100%) were in the plan; 0 in the
implementation.** (This section was written before that review ran; it found six more. See
"Final whole-branch review" below.)
The two prior branches ran 11-of-14 (79%) and 8-of-8 (100%) in the plan. This branch
continues the second branch's pattern exactly: every reviewer who traced the actual
resolver, route, or dispatch logic against the plan's instructions found it correct — the
implementers built what they were told, accurately, including copying persona prose
character-for-character. Every finding is either a hole in a prescribed code sample or a
test that couldn't fail for the reason its own name claimed.

**The single most useful observation on this branch:** defects 1, 2 and 7 are not three
unrelated bugs — they are the *same* defect, found three times. The spec's governing
doctrine, stated plainly in its own "Decisions" section, is that **a partial scan must
never be presented as a complete answer**. The plan then violated that doctrine three
times on its way from spec to code:

- In `readMeeting`, the truncation flag reached the function and was thrown away before
  the not-found branch, turning "the scan was capped" into a false "this meeting does not
  exist," with advice that made the problem worse.
- In `search`, the match count was computed and then discarded before the response was
  built, turning "there are more results than shown" into silence.
- In `discovery-coach.md`, the *instruction to say so* — present in the other two
  personas' paragraphs, and required by the same doctrine — was simply absent from one of
  three copies of prose that should have been identical on this point.

Three different layers (a return-value bug, a missing field, a missing sentence), three
different mechanisms of failure (wrong error message, silent truncation, uninformed
coaching), and one root cause: the doctrine was stated once, correctly, in the spec, and
had to be re-implemented independently in three separate places, and slipped in two of
the three the first time each was written. This is the same species the branch before
this one named — "an assertion that passes against the thing it is meant to detect" (for
defects 3 and 4) — plus a second, more specific pattern worth naming on its own: **a
cross-cutting doctrine stated once in the spec does not survive being copied into
multiple independent code paths without a shared enforcement point.** Nothing in this
branch's design forces `truncated` to be threaded through every consumer — each call site
has to remember. Two of three did, on the first pass, in code; one of three did, on the
first pass, in prose. If a fourth consumer of Fathom data is added later (Meeting Prep is
named as the next follow-up), there is no structural reason to expect it will get this
right without the same adversarial review that caught it here three times.

## Deferred minors (carried forward, not lost)

None of the following blocks. Grouped by the task that surfaced them.

**Task 1**
- The three error classes (`FathomAuthError`, `FathomRateLimitError`, `FathomError`)
  never set `this.name`, so `err.name` reads `"Error"`. Harmless for `instanceof` checks
  (the only thing the codebase does with them); matters only if something ever logs or
  serializes by name.
- Malformed JSON on an ok (2xx) response throws an unwrapped `SyntaxError` rather than a
  `FathomError`. Task 2's resolver catches generically, so it still becomes "could not be
  reached" prose — acceptable, not invisible.
- The unused `isConfigured` import dropped from `client.test.ts` (imported from both
  `./client` and `./config` in the brief, only the `./config` alias used) leaves
  `client.ts`'s re-export line with no direct test of its own. Behaviorally identical
  either way — the re-export delegates straight to `./config`'s implementation.

**Task 2**
- The exact-5-pages-then-null truncation boundary is unpinned: a mutant that reports
  `truncated` on a `null` cursor arriving exactly at the last allowed page would survive.
- `excerpt`'s 400-char cap is never exercised by a test; deleting the truncation there
  leaves the suite green. Notable asymmetry with the transcript clip, which marks its cut
  with `[truncated]` and is tested.
- `limit` on `fathom_search_meetings` is unclamped and model-controlled —
  `limit: 500` returns up to five pages of rows at roughly 400 characters of excerpt
  each. The read path has `MAX_TRANSCRIPT_CHARS`; the search path has no total-payload
  ceiling.
- `date`, `attendees` and `companies` are emitted in the search payload but never
  asserted by any test — `date: ""` for every row would survive. `dateOf`'s fallback
  chain is exercised only through `created_at`; no fixture carries
  `recording_start_time` or `scheduled_start_time`.
- `num()` (parsing `limit`/`sinceDays` from tool args) silently swallows `0` and
  negatives — `limit: 0` yields the default 20 rows, `sinceDays: 0` yields the default
  90 days, rather than either an error or the literal zero-width window the caller asked
  for.
- The missing-`recordingId` branch of `fathom_read_meeting` is untested, and
  `isConfigured()` is checked before the unknown-tool-name branch, so an unknown tool
  name with no key configured reports "not connected" rather than "unknown tool." Both
  harmless in practice since Task 3 dispatches exclusively through `FATHOM_TOOL_NAMES`,
  which only contains the two real names.

**Task 4**
- No test constrains where in a persona's body the Fathom paragraph sits, only its
  presence and content — a future edit could relocate it without any test noticing
  (harmless; prose position carries no behavior).

## Not verified — no call has ever been made against the real Fathom API

This is the largest gap left open by this branch, and it is structural, not incidental:
**every single test, across all four implementation tasks, stubs `fetch` or mocks the
`./client` module.** `client.test.ts` stubs the global `fetch`. `tools.test.ts` mocks
`./client` wholesale via `vi.mock`. `capabilities.test.ts`'s dispatch test force-deletes
`FATHOM_API_KEY` specifically so it *cannot* reach the network, then separately stubs
`fetch` as a second, independent guard. `advisor/route.test.ts`'s two gate tests never
get far enough into `runAgent` to dispatch a tool at all. There is no path through this
branch's test suite, accidental or deliberate, that touches `api.fathom.ai`.

Concretely, this means:

- **The wire field mapping is verified against Fathom's published API reference, not
  against a live response.** `recording_id` vs. `id`, `default_summary.markdown_formatted`
  vs. `.markdown`, the transcript envelope's `speaker` as an object rather than a string,
  `crm_matches`' shape — all of this was typed from documentation and pinned in fixtures
  written to match that documentation. If Fathom's actual API disagrees with its own
  published reference in any field this code reads, every test here will continue to
  pass while the feature silently returns wrong or empty data against the real service.
- **Pagination behavior (`next_cursor`, the 5-page cap) has never been exercised against
  a real multi-page response.** The fixtures simulate cursors; nothing has confirmed
  Fathom's actual cursor semantics match what `scanWindow` assumes.
- **Auth and rate-limit handling (401, 429) have never seen a real Fathom error
  response body**, only synthetic non-2xx status codes in test fixtures.
- **The transcript endpoint's `destination_url` behavior is trusted from the
  documentation, not observed** — the spec is explicit that sending it switches the
  endpoint to an asynchronous callback mode with no transcript in the response, and the
  client is written to never send it, but nothing has confirmed what actually happens if
  it were sent, or that omitting it produces the synchronous response the code expects.
- **There is no `FATHOM_API_KEY` in `.env.local`.** This task added the variable to
  `.env.example` (see below) — it did not exist there before this branch, which is part
  of why this integration has never run in this repository, in any form, against the
  real service.

**What a real key would settle that no test here can:** run the app locally with
`FATHOM_API_KEY` set to a real key, and call `fathom_search_meetings` through one of the
three gated personas (Advisor is the simplest — it already has a real conversation flow
in daily use). A single successful call with a non-empty `meetings` array whose fields
are populated (not blank strings from a field-name mismatch) would confirm the wire
mapping is right. A second call with `includeTranscript: true` against a real recording
would confirm the transcript endpoint's shape and the "never send `destination_url`"
behavior. Provoking a 401 (temporarily corrupt the key) and a 429 (if reachable) would
confirm the error-mapping table against real HTTP responses rather than synthetic ones.
None of this has been done. It should be done once `FATHOM_API_KEY` exists in
`.env.local` and before this feature is treated as load-bearing for a real sales
conversation.

## `.env.example`

Added, per this task's own instructions (not a gate finding — a required deliverable):

```
# --- Fathom meeting tools (optional) ---
# Lets the sales advisor, discovery coach and pipeline analyst search and read your
# recorded sales calls (fathom_search_meetings / fathom_read_meeting). Get a key at
# https://developers.fathom.ai — available on every Fathom tier, sent as the
# X-Api-Key header. Without it the fathom capability grants no tools.
FATHOM_API_KEY=
```

`.env.local` was not touched.


## Final whole-branch review

Run on `4d6d093..e09ad36` after Task 5. Verdict: findings must be fixed first — one Critical,
four Important, four Minor. Fixed in one wave (`3161cf1`), scoped re-review confirmed all six
closed, no new breakage. Suite 1096 → 1107.

### The Critical, and why it is the most instructive defect on this branch

**`listMeetings` never asked Fathom for the summary, the CRM matches or the action items.**

`GET /meetings` gates `default_summary`, `crm_matches` and `action_items` behind
`include_summary`, `include_crm_matches` and `include_action_items` — **all three default to
`false`**, and all three fields are `nullable: true` in the Meeting schema. The string
`include_` appeared nowhere in the spec, the plan, the implementation or this document.

Shipped as written, against the real API:

- `summaryOf()` returns `""` for every meeting, so `summaryExcerpt` is empty on every search
  row and `summary` is empty on every `fathom_read_meeting` result.
- `queryHaystack` degrades to title-only, silently breaking the spec's explicit requirement
  that `query` match summary text.
- `companiesOf()` is always `[]`, so the entire `crm_matches` branch of `companyHaystack` is
  dead code and company matching survives only on title and invitee email.
- `actionItems` is always `[]`.
- `fathom_read_meeting` without `includeTranscript` — which defaults to false — returns a
  title, a date, attendees and two empty fields. Nothing about what was said.

Every one of the 1096 tests passed, because `tools.test.ts` mocks the client and hands back
fixtures that already carry all three fields, and `client.test.ts` stubs `fetch` and only
asserted the URL carried `created_after`.

This is the exact risk the spec's own "Wire field names" section was written to prevent —
"the likeliest way this work compiles, passes its own fixtures, and returns nothing against
the real API". Four field-name audits were run across the branch and all four passed. **The
names were right. Nothing asked what makes the named fields appear.**

It is also the **fourth** violation of this feature's governing doctrine, and the worst of
the four. The first three misreported a partial scan. This one hands the model structurally
empty fields presented as data: `summaryExcerpt: ""` is indistinguishable from a meeting that
genuinely had no summary, while all three personas tell the founder that the meeting is the
source of truth and the typed interaction note is not.

### The remaining five

| # | Defect | Caught where | Why it mattered |
| --- | --- | --- | --- |
| 9 | The two tools embedded opposite, undocumented ordering assumptions. `search` promised "the most recent meetings" while slicing an unsorted prefix (true only newest-first); `readMeeting`'s capped-scan branch advised narrowing `sinceDays` (helps only oldest-first). Fathom documents no sort parameter and no default ordering. | Plan | At most one could be right and neither was backed. Under newest-first the "narrow" advice is a no-op the model loops on. Fixed by sorting before slicing, and by making the capped-scan advice direction-neutral. |
| 10 | `query` matched the full summary while the model only ever saw the first 400 characters. | Plan | A row matches on text at character 3000 and comes back with an excerpt that never mentions it — the model has a result it cannot justify. |
| 11 | A transcript failure discarded a meeting that had already been found and reported it as Fathom being unreachable. | Plan | Fathom *was* reached and the meeting *was* found; its summary was thrown away and the model relayed "Fathom is unreachable" to the founder as a fact about their integration. |
| 12 | No end-to-end fathom grant test on the brain surface, though two of the three grantee personas are brain-surface agents. | Plan | The branch's own defence against "a capability granted but not wired" was asserted on one of the two surfaces that grant it. |
| 13 | `num()` neither coerced nor clamped: `sinceDays: "30"` silently became 90, and `limit` was unbounded. | Plan | Harmless only while summaries were empty. Fixing the Critical would have made `limit: 500` mean 500 × 400 characters of real summary in one tool result, so both had to land together. |

### Residual, recorded not fixed

The `sinceDays` and `limit` schema descriptions still name only their defaults and do not
mention the new `MAX_SINCE_DAYS = 365` / `MAX_LIMIT = 50` caps, so the model is not told a
large value it supplies will be clamped. Non-blocking: `matched` and `scanned` still report
true totals, so a clamped result is never misrepresented as complete.

### What this branch says about where review effort belongs

Three branches now: 11-of-14, 8-of-8, 13-of-13. Every defect in the plan; none in an
implementer departing from it.

This branch sharpens the lesson. Four of its thirteen defects are the *same* defect — the
spec states a doctrine in its opening argument and then violates it in four separate places
further down. A spec's stated invariants need checking against the spec's own later sections
the way a typechecker checks a type against its uses, and re-reading one's own document does
not do it: every one of the four was found by a reviewer reading code, never by the author
reading prose.

The Critical adds a second, narrower lesson with a general shape: **auditing that field names
are correct is not the same as auditing that the request will return those fields.** The
branch ran four name audits and passed all four while the request was structurally incapable
of returning the data.
