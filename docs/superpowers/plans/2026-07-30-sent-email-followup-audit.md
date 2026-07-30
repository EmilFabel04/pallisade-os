# Sent-Email Follow-Up Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Sales Advisor a tool that scans the founder's sent Gmail, excludes Apollo mailwarming, and surfaces recipients who never replied or who are waiting on a reply — then proposes confirm-gated follow-up tasks.

**Architecture:** All filtering logic that could be wrong lives in one pure, unit-tested module (`sentScan.ts`) with no I/O. A separate server-only module (`sentAudit.ts`) does the Gmail paging and fetching and applies those pure filters. The tool is registered in the existing `EMAIL_TOOLS` array, so the advisor route already gates it behind "is an inbox connected" and already routes it to the async email resolver. Follow-ups reuse the existing confirm-gated `create_task` proposal flow — no new write path.

**Tech Stack:** TypeScript, Next.js App Router (`nodejs` runtime), Gmail REST v1 via the existing `gmailGet` helper, Anthropic SDK tool-use loop, vitest.

**Spec:** `docs/superpowers/specs/2026-07-30-sent-email-followup-audit-design.md`

## Global Constraints

- Warming label to exclude, verbatim: `Apollo Mailwarming`
- Subject keyword, verbatim: `Pallisade`
- Sign-off names: `Emil`, `Emil Fabel`
- Sign-off rule is **strict last non-empty line**; `SIGNOFF_SEARCH_LINES = 1`
- Thread scan cap: `400`; concurrent Gmail fetches: `8`
- OAuth grant stays `gmail.readonly` — no new scopes, no sending, no drafting
- No CRM writes; no caching or DB schema changes
- Buckets surfaced: `no_reply` and `awaiting_you` only. `stalled` is counted, never listed.
- Tests: vitest, `import { describe, it, expect } from "vitest"`, `@/` path alias
- Run tests with `npm test`; typecheck with `npx tsc --noEmit`
- Do not stage unrelated in-flight work. The tree already has modified API routes and a new `src/lib/api/` from a separate refactor — stage only the files each task names.

---

### Task 1: Quoted-reply cutting and sign-off detection

The subtle part of the whole feature. A sent message body contains the founder's
text *and* the quoted thread beneath it. The sign-off test must only see the
founder's own text.

**Files:**
- Create: `src/lib/gmail/sentScan.ts`
- Test: `src/lib/gmail/sentScan.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `WARMING_LABEL: string`, `SUBJECT_KEYWORD: string`, `SIGNOFF_NAMES: string[]`, `SIGNOFF_SEARCH_LINES: number`
  - `unquotedBody(text: string): string`
  - `signedByFounder(body: string): boolean`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/gmail/sentScan.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { unquotedBody, signedByFounder } from "@/lib/gmail/sentScan";

describe("unquotedBody", () => {
  it("cuts at a leading > quote marker", () => {
    const body = "Hi Jane,\n\nWorth a chat?\n\nBest,\nEmil\n\n> earlier text\n> more";
    expect(unquotedBody(body)).toBe("Hi Jane,\n\nWorth a chat?\n\nBest,\nEmil\n");
  });

  it("cuts at a single-line On ... wrote: marker", () => {
    const body = "Following up.\n\nEmil\n\nOn Tue, Jul 28, 2026 at 10:04 AM Jane Roe <jane@acme.com> wrote:\nsure";
    expect(unquotedBody(body)).toBe("Following up.\n\nEmil\n");
  });

  it("cuts when Gmail wraps wrote: onto the next line", () => {
    const body = "Following up.\n\nEmil\n\nOn Tue, Jul 28, 2026 Jane Roe <jane@acme.com>\nwrote:\nsure";
    expect(unquotedBody(body)).toBe("Following up.\n\nEmil\n");
  });

  it("cuts at an Outlook original-message divider", () => {
    const body = "Any thoughts?\n\nEmil\n\n-----Original Message-----\nFrom: Jane";
    expect(unquotedBody(body)).toBe("Any thoughts?\n\nEmil\n");
  });

  it("cuts at a From: line followed by Sent:", () => {
    const body = "Checking in.\n\nEmil\n\nFrom: Jane Roe\nSent: 28 July 2026 10:04\nTo: Emil";
    expect(unquotedBody(body)).toBe("Checking in.\n\nEmil\n");
  });

  it("leaves a body with no quoted section untouched", () => {
    const body = "Short note.\n\nEmil";
    expect(unquotedBody(body)).toBe(body);
  });

  it("does not treat a bare From: line as a quote marker", () => {
    const body = "From: the team at Pallisade\n\nWe build things.\n\nEmil";
    expect(unquotedBody(body)).toBe(body);
  });

  it("keeps the text below a quoted testimonial", () => {
    const body = "As one customer put it:\n> This saved us 10 hours a week.\n\nWorth a chat?\n\nBest,\nEmil";
    expect(unquotedBody(body)).toBe("As one customer put it:\n\nWorth a chat?\n\nBest,\nEmil");
  });
});

describe("signedByFounder", () => {
  it("matches a bare Emil on the last line", () => {
    expect(signedByFounder("Worth a chat?\n\nBest,\nEmil")).toBe(true);
  });

  it("matches Emil Fabel on the last line", () => {
    expect(signedByFounder("Worth a chat?\n\nEmil Fabel")).toBe(true);
  });

  it("matches a valediction and name on one line", () => {
    expect(signedByFounder("Worth a chat?\n\nBest, Emil")).toBe(true);
  });

  it("ignores trailing punctuation and whitespace", () => {
    expect(signedByFounder("Worth a chat?\n\nEmil.  \n\n")).toBe(true);
  });

  it("ignores case", () => {
    expect(signedByFounder("Worth a chat?\n\nEMIL")).toBe(true);
  });

  it("does NOT match when a title line sits below the name", () => {
    expect(signedByFounder("Worth a chat?\n\nEmil Fabel\nFounder, Pallisade Data")).toBe(false);
  });

  it("does not match another sender's sign-off", () => {
    expect(signedByFounder("Thanks for this.\n\nBest,\nJane")).toBe(false);
  });

  it("does not match Emil mentioned mid-sentence", () => {
    expect(signedByFounder("Emil here from Pallisade Data.\n\nSpeak soon,\nJane")).toBe(false);
  });

  it("only inspects the founder's own text, not the quoted reply", () => {
    const body = "Thanks Jane.\n\nJane\n\n> Best,\n> Emil";
    expect(signedByFounder(body)).toBe(false);
  });

  it("still finds the sign-off below a quoted testimonial", () => {
    const body = "As one customer put it:\n> This saved us 10 hours a week.\n\nWorth a chat?\n\nBest,\nEmil";
    expect(signedByFounder(body)).toBe(true);
  });

  it("still finds the sign-off in an interleaved point-by-point reply", () => {
    const body = "> your first question\nAnswer one.\n\n> your second question\nAnswer two.\n\nBest,\nEmil";
    expect(signedByFounder(body)).toBe(true);
  });

  it("returns false for an empty body", () => {
    expect(signedByFounder("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- sentScan`
Expected: FAIL — cannot resolve `@/lib/gmail/sentScan`

- [ ] **Step 3: Write the implementation**

Create `src/lib/gmail/sentScan.ts`:

```ts
/* ============================================================
   Pure filtering logic for the sent-mail follow-up audit.
   No I/O — unit-tested. Mirrors the parse.ts convention.
   ============================================================ */

/** Gmail label whose threads are Apollo mailwarming traffic, never real outreach. */
export const WARMING_LABEL = "Apollo Mailwarming";

/** A subject containing this counts as the founder's own outreach. */
export const SUBJECT_KEYWORD = "Pallisade";

/** Accepted sign-offs, lowercased. */
export const SIGNOFF_NAMES = ["emil", "emil fabel"];

/** How many trailing non-empty lines the sign-off test inspects.
 *  1 = strict last line, chosen deliberately. Raising this to ~4 turns the test
 *  into a signature-block scan (matching a name above a title line) and is the
 *  single value to change if the strict rule under-matches in practice. */
export const SIGNOFF_SEARCH_LINES = 1;

/** Common valedictions stripped when they share a line with the name. */
const VALEDICTION =
  /^(best regards|kind regards|all the best|thank you|best|thanks|cheers|regards|warmly|sincerely)\s*[,\-–—]?\s*/i;

/** A line quoted from an earlier message. These are *dropped*, not truncated at:
 *  a quote can sit above the founder's own sign-off — an interleaved
 *  point-by-point reply, or a customer testimonial he is quoting — and cutting
 *  there would discard his signature and silently fail the sign-off test. */
const QUOTED_LINE = /^>/;

/** Markers that only ever introduce a trailing quote block, so everything from
 *  there down is cut. */
const ATTRIBUTION_MARKERS = [
  /^-{2,}\s*original message\s*-{2,}$/i,
];

/**
 * Return only the newly-written part of a message body: cut at the first
 * attribution marker, then drop any quoted lines above it. Conservative on
 * purpose — over-aggressive stripping would discard a real signature and break
 * the sign-off test.
 */
export function unquotedBody(text: string): string {
  const lines = text.split(/\r?\n/);
  let end = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (ATTRIBUTION_MARKERS.some((re) => re.test(line))) {
      end = i;
      break;
    }

    // Gmail attribution: "On <date> Name <addr> wrote:" — sometimes wrapped so
    // that "wrote:" lands on the following line.
    if (/^on\b/i.test(line)) {
      const next = (lines[i + 1] ?? "").trim();
      if (/wrote:\s*$/i.test(line) || /^wrote:\s*$/i.test(next)) {
        end = i;
        break;
      }
    }

    // Outlook-style header block: a From: line immediately followed by Sent:/Date:.
    // A lone From: line is left alone — it appears in ordinary prose.
    if (/^from:\s/i.test(line) && /^(sent|date):\s/i.test((lines[i + 1] ?? "").trim())) {
      end = i;
      break;
    }
  }

  return lines
    .slice(0, end)
    .filter((l) => !QUOTED_LINE.test(l.trim()))
    .join("\n");
}

/** Trim a line to a bare name for comparison. */
function normalizeSignoff(line: string): string {
  return line
    .trim()
    .replace(VALEDICTION, "")
    .replace(/[.,;:!\-–—]+$/u, "")
    .trim()
    .toLowerCase();
}

/**
 * True when the founder's own text ends with his sign-off.
 * Strict by design: inspects only the last SIGNOFF_SEARCH_LINES non-empty lines
 * of the unquoted body.
 */
export function signedByFounder(body: string): boolean {
  const lines = unquotedBody(body)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return lines
    .slice(-SIGNOFF_SEARCH_LINES)
    .some((l) => SIGNOFF_NAMES.includes(normalizeSignoff(l)));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- sentScan`
Expected: PASS, 20 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/gmail/sentScan.ts src/lib/gmail/sentScan.test.ts
git commit -m "feat(gmail): quoted-reply cutting and strict sign-off detection"
```

---

### Task 2: Thread inclusion rule with diagnostics

Decides whether a scanned thread is the founder's real outreach. The returned
`reason` is what makes under-matching visible instead of silent.

**Files:**
- Modify: `src/lib/gmail/sentScan.ts` (append)
- Test: `src/lib/gmail/sentScan.test.ts` (append)

**Interfaces:**
- Consumes: `signedByFounder`, `WARMING_LABEL`, `SUBJECT_KEYWORD` from Task 1
- Produces:
  - `type InclusionReason = "warming_label" | "subject" | "signoff" | "no_subject_no_signoff"`
  - `interface InclusionInput { subject: string; labelNames: string[]; ownMessageBodies: string[] }`
  - `interface InclusionResult { included: boolean; reason: InclusionReason }`
  - `judgeThread(input: InclusionInput): InclusionResult`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/gmail/sentScan.test.ts`:

```ts
import { judgeThread } from "@/lib/gmail/sentScan";

describe("judgeThread", () => {
  const base = { subject: "hello", labelNames: ["SENT"], ownMessageBodies: ["hi\n\nJane"] };

  it("includes a thread whose subject contains the keyword", () => {
    expect(judgeThread({ ...base, subject: "Pallisade Data — quick question" }))
      .toEqual({ included: true, reason: "subject" });
  });

  it("matches the subject keyword case-insensitively", () => {
    expect(judgeThread({ ...base, subject: "re: pallisade intro" }).included).toBe(true);
  });

  it("includes a thread signed off by the founder even with an unrelated subject", () => {
    expect(judgeThread({ ...base, subject: "Re: intro from Sarah", ownMessageBodies: ["Hi\n\nBest,\nEmil"] }))
      .toEqual({ included: true, reason: "signoff" });
  });

  it("checks every one of the founder's messages for a sign-off", () => {
    const input = { ...base, subject: "Re: intro", ownMessageBodies: ["first note\n\nJane", "second\n\nEmil"] };
    expect(judgeThread(input).included).toBe(true);
  });

  it("excludes a warming-labelled thread even when the subject matches", () => {
    const input = { subject: "Pallisade Data", labelNames: ["SENT", "Apollo Mailwarming"], ownMessageBodies: ["x\n\nEmil"] };
    expect(judgeThread(input)).toEqual({ included: false, reason: "warming_label" });
  });

  it("excludes a thread matching neither rule, and says why", () => {
    expect(judgeThread({ ...base, subject: "Re: intro from Sarah" }))
      .toEqual({ included: false, reason: "no_subject_no_signoff" });
  });

  it("excludes a thread with no messages from the founder", () => {
    expect(judgeThread({ ...base, subject: "Re: intro", ownMessageBodies: [] }))
      .toEqual({ included: false, reason: "no_subject_no_signoff" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- sentScan`
Expected: FAIL — `judgeThread` is not exported

- [ ] **Step 3: Write the implementation**

Append to `src/lib/gmail/sentScan.ts`:

```ts
export type InclusionReason = "warming_label" | "subject" | "signoff" | "no_subject_no_signoff";

export interface InclusionInput {
  subject: string;
  /** Resolved Gmail label *names* on the thread (not label ids). */
  labelNames: string[];
  /** Bodies of the messages the founder himself sent in this thread. */
  ownMessageBodies: string[];
}

export interface InclusionResult {
  included: boolean;
  reason: InclusionReason;
}

/**
 * Apply the inclusion rule: not warming-labelled, AND (subject keyword OR the
 * founder signed off). `reason` doubles as the diagnostic —
 * "no_subject_no_signoff" is exactly the set that a looser sign-off rule would
 * start admitting.
 */
export function judgeThread(input: InclusionInput): InclusionResult {
  if (input.labelNames.some((n) => n.toLowerCase() === WARMING_LABEL.toLowerCase())) {
    return { included: false, reason: "warming_label" };
  }

  if (input.subject.toLowerCase().includes(SUBJECT_KEYWORD.toLowerCase())) {
    return { included: true, reason: "subject" };
  }

  if (input.ownMessageBodies.some((b) => signedByFounder(b))) {
    return { included: true, reason: "signoff" };
  }

  return { included: false, reason: "no_subject_no_signoff" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- sentScan`
Expected: PASS, 27 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/gmail/sentScan.ts src/lib/gmail/sentScan.test.ts
git commit -m "feat(gmail): thread inclusion rule with exclusion diagnostics"
```

---

### Task 3: Reply classification

**Files:**
- Modify: `src/lib/gmail/sentScan.ts` (append)
- Test: `src/lib/gmail/sentScan.test.ts` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:
  - `type ThreadBucket = "no_reply" | "awaiting_you" | "stalled"`
  - `interface ScanMessage { from: string; to: MailAddress[]; date: string; text: string }` — `MailAddress` is the existing type from `./parse`; keeping it (rather than bare address strings) is what lets real recipient display names reach the output
  - `isOwn(email: string, ownEmails: Set<string>): boolean`
  - `classifyThread(messages: ScanMessage[], ownEmails: Set<string>): ThreadBucket`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/gmail/sentScan.test.ts`:

```ts
import { classifyThread, type ScanMessage } from "@/lib/gmail/sentScan";

const own = new Set(["emil@pallisade.com"]);

// classifyThread only reads `from` and `date`, so recipients stay empty here.
const msg = (from: string, date: string): ScanMessage =>
  ({ from, to: [], date, text: "" });

describe("classifyThread", () => {
  it("returns no_reply when only the founder has written", () => {
    const messages = [
      msg("emil@pallisade.com", "2026-07-01T09:00:00Z"),
      msg("emil@pallisade.com", "2026-07-08T09:00:00Z"),
    ];
    expect(classifyThread(messages, own)).toBe("no_reply");
  });

  it("returns awaiting_you when their message is last", () => {
    const messages = [
      msg("emil@pallisade.com", "2026-07-01T09:00:00Z"),
      msg("jane@acme.com", "2026-07-02T09:00:00Z"),
    ];
    expect(classifyThread(messages, own)).toBe("awaiting_you");
  });

  it("returns stalled when they replied but the founder answered last", () => {
    const messages = [
      msg("emil@pallisade.com", "2026-07-01T09:00:00Z"),
      msg("jane@acme.com", "2026-07-02T09:00:00Z"),
      msg("emil@pallisade.com", "2026-07-03T09:00:00Z"),
    ];
    expect(classifyThread(messages, own)).toBe("stalled");
  });

  it("orders by date rather than trusting array order", () => {
    const messages = [
      msg("jane@acme.com", "2026-07-02T09:00:00Z"),
      msg("emil@pallisade.com", "2026-07-01T09:00:00Z"),
    ];
    expect(classifyThread(messages, own)).toBe("awaiting_you");
  });

  it("matches the founder's own address case-insensitively", () => {
    const messages = [
      msg("Emil@Pallisade.com", "2026-07-01T09:00:00Z"),
      msg("emil@pallisade.com", "2026-07-02T09:00:00Z"),
    ];
    expect(classifyThread(messages, own)).toBe("no_reply");
  });

  it("treats every connected inbox as the founder", () => {
    const multi = new Set(["emil@pallisade.com", "emil@pallisadedata.io"]);
    const messages = [
      msg("emil@pallisade.com", "2026-07-01T09:00:00Z"),
      msg("emil@pallisadedata.io", "2026-07-02T09:00:00Z"),
    ];
    expect(classifyThread(messages, multi)).toBe("no_reply");
  });

  it("returns no_reply for an empty thread", () => {
    expect(classifyThread([], own)).toBe("no_reply");
  });

  it("keeps an undated message in Gmail's original position rather than first", () => {
    const messages: ScanMessage[] = [
      msg("jane@acme.com", "2026-07-02T09:00:00Z"),
      { from: "emil@pallisade.com", to: [], date: "", text: "" },
    ];
    expect(classifyThread(messages, own)).toBe("stalled");
  });

  it("classifies an undated final reply from them as awaiting_you", () => {
    const messages: ScanMessage[] = [
      msg("emil@pallisade.com", "2026-07-01T09:00:00Z"),
      { from: "jane@acme.com", to: [], date: "", text: "" },
    ];
    expect(classifyThread(messages, own)).toBe("awaiting_you");
  });

  it("orders a mixed dated/undated thread deterministically by position", () => {
    const messages: ScanMessage[] = [
      msg("emil@pallisade.com", "2026-07-05T09:00:00Z"),
      { from: "jane@acme.com", to: [], date: "", text: "" },
      msg("emil@pallisade.com", "2026-07-01T09:00:00Z"),
    ];
    expect(classifyThread(messages, own)).toBe("stalled");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- sentScan`
Expected: FAIL — `classifyThread` is not exported

- [ ] **Step 3: Write the implementation**

Append to `src/lib/gmail/sentScan.ts`. The `MailAddress` type import belongs at the
top of the file with the other imports:

```ts
// add to the top of src/lib/gmail/sentScan.ts:
// import type { MailAddress } from "./parse";

export type ThreadBucket = "no_reply" | "awaiting_you" | "stalled";

export interface ScanMessage {
  from: string;
  /** Full addresses, names preserved — the audit surfaces these to the founder. */
  to: MailAddress[];
  /** ISO date string. */
  date: string;
  text: string;
}

/** True when an address belongs to one of the founder's connected inboxes. */
export function isOwn(email: string, ownEmails: Set<string>): boolean {
  return ownEmails.has(email.trim().toLowerCase());
}

/**
 * Work out where a thread stands.
 *   no_reply     — nobody but the founder ever wrote
 *   awaiting_you — the other side wrote last; the ball is in his court
 *   stalled      — they replied, but the founder answered last
 *
 * Ordering falls back to the caller's message order whenever a date is missing.
 */
export function classifyThread(messages: ScanMessage[], ownEmails: Set<string>): ThreadBucket {
  if (messages.length === 0) return "no_reply";

  // A message can carry an empty date when Gmail supplied neither a usable
  // internalDate nor a parseable Date header. Empty strings sort before every ISO
  // date, so comparing them directly would hoist such a message to the front and
  // could flip the thread's bucket.
  //
  // Decide the ordering rule once for the whole thread rather than per pair.
  // Mixing "compare by date" and "compare by position" pairwise is not transitive
  // — with A(dated), B(undated), C(dated) you can get A<B, B<C, yet A>C, and JS
  // leaves the result of a non-transitive comparator implementation-defined. A
  // thread's last message decides awaiting_you vs stalled, so that must never be
  // engine-dependent. When any date is missing we trust threads.get's chronological
  // ordering for all of them.
  const anyUndated = messages.some((m) => !m.date);
  const ordered = messages
    .map((m, i) => ({ m, i }))
    .sort((a, b) => {
      if (anyUndated) return a.i - b.i;
      if (a.m.date < b.m.date) return -1;
      if (a.m.date > b.m.date) return 1;
      return a.i - b.i;
    })
    .map((x) => x.m);
  const theirs = ordered.filter((m) => !isOwn(m.from, ownEmails));
  if (theirs.length === 0) return "no_reply";

  const last = ordered[ordered.length - 1];
  return isOwn(last.from, ownEmails) ? "stalled" : "awaiting_you";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- sentScan`
Expected: PASS, 37 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/gmail/sentScan.ts src/lib/gmail/sentScan.test.ts
git commit -m "feat(gmail): classify sent threads by reply state"
```

---

### Task 4: Aggregate by recipient

Collapses threads into one row per person, keeping their most recent thread and
ordering the most actionable first.

**Files:**
- Modify: `src/lib/gmail/sentScan.ts` (append)
- Test: `src/lib/gmail/sentScan.test.ts` (append)

**Interfaces:**
- Consumes: `ThreadBucket`, `isOwn` from Task 3
- Produces:
  - `interface ScannedThread { threadId: string; subject: string; bucket: ThreadBucket; lastSent: string; recipients: MailAddress[] }`
  - `interface FollowUp { email: string; name: string; company: string; lastSent: string; daysSince: number; subject: string; threadId: string; bucket: ThreadBucket }`
  - `groupByRecipient(threads: ScannedThread[], ownEmails: Set<string>, todayIso: string): FollowUp[]`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/gmail/sentScan.test.ts`:

```ts
import { groupByRecipient, type ScannedThread } from "@/lib/gmail/sentScan";

const TODAY = "2026-07-30T12:00:00Z";
const ownSet = new Set(["emil@pallisade.com"]);

const thread = (over: Partial<ScannedThread> = {}): ScannedThread => ({
  threadId: "t1",
  subject: "Pallisade intro",
  bucket: "no_reply",
  lastSent: "2026-07-20T09:00:00Z",
  recipients: [{ name: "Jane Roe", email: "jane@acme.com" }],
  ...over,
});

describe("groupByRecipient", () => {
  it("derives company and days since last contact", () => {
    const [row] = groupByRecipient([thread()], ownSet, TODAY);
    expect(row).toEqual({
      email: "jane@acme.com",
      name: "Jane Roe",
      company: "Acme",
      lastSent: "2026-07-20T09:00:00Z",
      daysSince: 10,
      subject: "Pallisade intro",
      threadId: "t1",
      bucket: "no_reply",
    });
  });

  it("keeps only the most recent thread per recipient", () => {
    const rows = groupByRecipient([
      thread({ threadId: "old", lastSent: "2026-06-01T09:00:00Z", subject: "First" }),
      thread({ threadId: "new", lastSent: "2026-07-25T09:00:00Z", subject: "Second" }),
    ], ownSet, TODAY);
    expect(rows).toHaveLength(1);
    expect(rows[0].threadId).toBe("new");
    expect(rows[0].subject).toBe("Second");
  });

  it("drops the founder's own addresses from recipients", () => {
    const rows = groupByRecipient([
      thread({ recipients: [{ name: "Emil", email: "emil@pallisade.com" }, { name: "Jane Roe", email: "jane@acme.com" }] }),
    ], ownSet, TODAY);
    expect(rows.map((r) => r.email)).toEqual(["jane@acme.com"]);
  });

  it("emits a row per recipient on a multi-recipient thread", () => {
    const rows = groupByRecipient([
      thread({ recipients: [{ name: "Jane", email: "jane@acme.com" }, { name: "Bob", email: "bob@beta.io" }] }),
    ], ownSet, TODAY);
    expect(rows.map((r) => r.email).sort()).toEqual(["bob@beta.io", "jane@acme.com"]);
  });

  it("lowercases recipient addresses so duplicates collapse", () => {
    const rows = groupByRecipient([
      thread({ threadId: "a", recipients: [{ name: "Jane", email: "Jane@Acme.com" }] }),
      thread({ threadId: "b", lastSent: "2026-07-28T09:00:00Z", recipients: [{ name: "Jane", email: "jane@acme.com" }] }),
    ], ownSet, TODAY);
    expect(rows).toHaveLength(1);
    expect(rows[0].threadId).toBe("b");
  });

  it("puts awaiting_you ahead of no_reply, then the longest neglected first", () => {
    const rows = groupByRecipient([
      thread({ threadId: "a", bucket: "no_reply", lastSent: "2026-05-01T09:00:00Z", recipients: [{ name: "A", email: "a@x.com" }] }),
      thread({ threadId: "b", bucket: "awaiting_you", lastSent: "2026-07-28T09:00:00Z", recipients: [{ name: "B", email: "b@x.com" }] }),
      thread({ threadId: "c", bucket: "awaiting_you", lastSent: "2026-06-01T09:00:00Z", recipients: [{ name: "C", email: "c@x.com" }] }),
    ], ownSet, TODAY);
    expect(rows.map((r) => r.threadId)).toEqual(["c", "b", "a"]);
  });

  it("returns an empty company for a free email provider", () => {
    const rows = groupByRecipient([
      thread({ recipients: [{ name: "Jane", email: "jane@gmail.com" }] }),
    ], ownSet, TODAY);
    expect(rows[0].company).toBe("");
  });

  it("returns [] for no threads", () => {
    expect(groupByRecipient([], ownSet, TODAY)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- sentScan`
Expected: FAIL — `groupByRecipient` is not exported

- [ ] **Step 3: Write the implementation**

Append to `src/lib/gmail/sentScan.ts`. Note the `companyFromEmail` import belongs
at the top of the file with the other imports:

```ts
// add to the top of src/lib/gmail/sentScan.ts:
// import { companyFromEmail } from "./parse";

export interface ScannedThread {
  threadId: string;
  subject: string;
  bucket: ThreadBucket;
  /** ISO date of the founder's most recent message in the thread. */
  lastSent: string;
  recipients: MailAddress[];
}

export interface FollowUp {
  email: string;
  name: string;
  company: string;
  lastSent: string;
  daysSince: number;
  subject: string;
  threadId: string;
  bucket: ThreadBucket;
}

/** Whole days between two ISO dates, floored at 0. */
function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/** awaiting_you is the costlier miss, so it sorts first. */
const BUCKET_RANK: Record<ThreadBucket, number> = { awaiting_you: 0, no_reply: 1, stalled: 2 };

/**
 * One row per recipient, carrying their most recent thread. `todayIso` is passed
 * in rather than read from the clock so this stays pure and testable.
 */
export function groupByRecipient(
  threads: ScannedThread[],
  ownEmails: Set<string>,
  todayIso: string,
): FollowUp[] {
  const latest = new Map<string, FollowUp>();

  for (const t of threads) {
    for (const r of t.recipients) {
      const email = r.email.trim().toLowerCase();
      if (!email.includes("@") || isOwn(email, ownEmails)) continue;

      const existing = latest.get(email);
      if (existing && existing.lastSent >= t.lastSent) continue;

      latest.set(email, {
        email,
        name: r.name || email,
        company: companyFromEmail(email),
        lastSent: t.lastSent,
        daysSince: daysBetween(t.lastSent, todayIso),
        subject: t.subject,
        threadId: t.threadId,
        bucket: t.bucket,
      });
    }
  }

  return [...latest.values()].sort(
    (a, b) => BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket] || b.daysSince - a.daysSince,
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- sentScan`
Expected: PASS, 45 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/gmail/sentScan.ts src/lib/gmail/sentScan.test.ts
git commit -m "feat(gmail): aggregate sent threads into per-recipient follow-ups"
```

---

### Task 5: Paged sent-thread id listing

`listThreads` is INBOX-only (`labelIds: "INBOX"`) and returns at most one page.
The audit needs to page. `listThreads` is deliberately left alone — the inbox UI
depends on its current behaviour.

**Files:**
- Modify: `src/lib/gmail/gmailApi.ts` (append; do not touch `listThreads`)
- Test: `src/lib/gmail/gmailApi.test.ts` (create)

**Interfaces:**
- Consumes: `gmailGet` from `./client`
- Produces:
  - `listThreadIds(accountId: string, opts?: { q?: string; max?: number }): Promise<string[]>`
  - `isoFromInternal` promoted from private to **exported** so Task 6 reuses it instead of duplicating the same internalDate/Date-header fallback

This introduces `vi.mock` — a pattern not yet used in this repo. It is warranted
here because paging has off-by-one risks around the cap that are worth pinning
down, and mocking one module is cheaper than a live Gmail call.

- [ ] **Step 1: Write the failing test**

Create `src/lib/gmail/gmailApi.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const gmailGet = vi.fn();
vi.mock("@/lib/gmail/client", () => ({
  gmailGet: (...args: unknown[]) => gmailGet(...args),
  GmailAuthError: class extends Error {},
}));

const { listThreadIds } = await import("@/lib/gmail/gmailApi");

beforeEach(() => gmailGet.mockReset());

describe("listThreadIds", () => {
  it("returns ids from a single page", async () => {
    gmailGet.mockResolvedValueOnce({ threads: [{ id: "a" }, { id: "b" }] });
    expect(await listThreadIds("acct")).toEqual(["a", "b"]);
  });

  it("follows nextPageToken across pages", async () => {
    gmailGet
      .mockResolvedValueOnce({ threads: [{ id: "a" }], nextPageToken: "p2" })
      .mockResolvedValueOnce({ threads: [{ id: "b" }] });
    expect(await listThreadIds("acct", { max: 10 })).toEqual(["a", "b"]);
    expect(gmailGet).toHaveBeenCalledTimes(2);
    expect(gmailGet.mock.calls[1][2]).toMatchObject({ pageToken: "p2" });
  });

  it("stops at max and truncates the final page", async () => {
    gmailGet
      .mockResolvedValueOnce({ threads: [{ id: "a" }, { id: "b" }], nextPageToken: "p2" })
      .mockResolvedValueOnce({ threads: [{ id: "c" }, { id: "d" }], nextPageToken: "p3" });
    expect(await listThreadIds("acct", { max: 3 })).toEqual(["a", "b", "c"]);
    expect(gmailGet).toHaveBeenCalledTimes(2);
  });

  it("passes the search query through", async () => {
    gmailGet.mockResolvedValueOnce({ threads: [] });
    await listThreadIds("acct", { q: "in:sent" });
    expect(gmailGet.mock.calls[0][2]).toMatchObject({ q: "in:sent" });
  });

  it("does not send labelIds, so the query alone selects the mailbox", async () => {
    gmailGet.mockResolvedValueOnce({ threads: [] });
    await listThreadIds("acct", { q: "in:sent" });
    expect(gmailGet.mock.calls[0][2]).not.toHaveProperty("labelIds");
  });

  it("returns [] when the response has no threads", async () => {
    gmailGet.mockResolvedValueOnce({});
    expect(await listThreadIds("acct")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- gmailApi`
Expected: FAIL — `listThreadIds` is not exported

- [ ] **Step 3: Write the implementation**

Two changes in `src/lib/gmail/gmailApi.ts`.

First, export the existing `isoFromInternal` helper (around line 56) by adding the
`export` keyword — Task 6 needs the same internalDate-with-Date-header-fallback
logic, and duplicating it would be a defect:

```ts
export function isoFromInternal(ms: string | undefined, fallbackHeader: string): string {
```

Change nothing else about that function — its body and every existing caller stay
as they are.

Second, append `listThreadIds`:

```ts
/**
 * Thread ids matching a Gmail search, paged. No labelIds — the `q` selects the
 * mailbox (e.g. "in:sent"), unlike listThreads which is pinned to INBOX.
 */
export async function listThreadIds(
  accountId: string,
  opts: { q?: string; max?: number } = {},
): Promise<string[]> {
  const max = opts.max ?? 100;
  const ids: string[] = [];
  let pageToken: string | undefined;

  while (ids.length < max) {
    const page = await gmailGet<{ threads?: { id: string }[]; nextPageToken?: string }>(
      accountId,
      "threads",
      { maxResults: Math.min(100, max - ids.length), q: opts.q, pageToken },
    );
    for (const t of page.threads ?? []) {
      if (ids.length >= max) break;
      ids.push(t.id);
    }
    if (!page.nextPageToken || ids.length >= max) break;
    pageToken = page.nextPageToken;
  }

  return ids;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- gmailApi`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/gmail/gmailApi.ts src/lib/gmail/gmailApi.test.ts
git commit -m "feat(gmail): paged thread-id listing driven by search query"
```

---

### Task 6: Sent-audit orchestration

The I/O layer. Follows the existing convention that server-only Gmail modules
(`gmailApi.ts`, `advisorEmail.ts`) carry no unit tests — every decision that
could be wrong already lives in the tested pure module. Verified end-to-end in
Task 7.

**Files:**
- Create: `src/lib/gmail/sentAudit.ts`

**Interfaces:**
- Consumes: `listAccountInfo` from `./accounts`; `gmailGet` and `GmailAuthError` from `./client`; `listThreadIds` and the newly-exported `isoFromInternal` from Task 5; `judgeThread`, `classifyThread`, `groupByRecipient`, `WARMING_LABEL` and the `FollowUp` / `ScanMessage` / `ScannedThread` types from `./sentScan` (Tasks 1–4); `header`, `parseAddress`, `parseAddressList`, `extractText`, `GmailPayload` from `./parse`
- Note: the existing `getThread` is deliberately **not** reused — it discards `labelIds`, which the warming safety net needs. This module fetches the raw thread instead.
- Error handling: a failed thread or listing request is skipped and counted in `fetchFailures`, but a `GmailAuthError` is rethrown so a revoked token surfaces as reconnect-needed rather than as an empty audit.
- Produces:
  - `interface SentAuditResult { scanned: number; matched: number; cap: number; capped: boolean; fetchFailures: number; excludedSignoffOnly: number; excludedWarming: number; stalledNotShown: number; followUps: FollowUp[] }`
  - `auditSentFollowUps(opts?: { query?: string; limit?: number }): Promise<SentAuditResult>`
  - `SCAN_CAP: number`, `FETCH_CONCURRENCY: number`

- [ ] **Step 1: Write the implementation**

Create `src/lib/gmail/sentAudit.ts`:

```ts
/* ============================================================
   Sent-mail follow-up audit (server-only).

   Pages the founder's sent threads, fetches each candidate once, and applies
   the pure filters in sentScan.ts. Excludes Apollo mailwarming twice over:
   in the Gmail query (so warming threads are never fetched) and again against
   resolved label names, as a safety net.
   ============================================================ */

import { listAccountInfo } from "./accounts";
import { gmailGet, GmailAuthError } from "./client";
import { listThreadIds, isoFromInternal } from "./gmailApi";
import {
  header, parseAddress, parseAddressList, extractText,
  type GmailPayload,
} from "./parse";
import {
  judgeThread, classifyThread, groupByRecipient, WARMING_LABEL,
  type FollowUp, type ScanMessage, type ScannedThread,
} from "./sentScan";

/** Newest-first thread ceiling for one audit. */
export const SCAN_CAP = 400;

/** Gmail allows ~250 quota units/sec and threads.get costs 10, so ~25/sec is the
 *  ceiling. 8 in flight stays well under it. */
export const FETCH_CONCURRENCY = 8;

export interface SentAuditResult {
  scanned: number;
  matched: number;
  cap: number;
  capped: boolean;
  fetchFailures: number;
  /** Threads that failed both the subject and sign-off rules. A looser sign-off
   *  rule would start admitting these — the number to watch if results look thin. */
  excludedSignoffOnly: number;
  excludedWarming: number;
  /** Threads where they replied but the founder answered last: counted, not listed. */
  stalledNotShown: number;
  followUps: FollowUp[];
}

interface RawMessage {
  id: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: GmailPayload;
}

interface RawThread {
  id: string;
  messages?: RawMessage[];
}

/**
 * Swallow a per-request failure, but never an auth failure. A revoked token must
 * surface as "reconnect this inbox" — silently returning an empty audit would
 * read as "nobody needs a follow-up", the worst possible wrong answer here.
 */
function skipUnlessAuth<T>(fallback: T) {
  return (err: unknown): T => {
    if (err instanceof GmailAuthError) throw err;
    return fallback;
  };
}

/** Run `fn` over `items` with at most `size` promises in flight. */
async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Gmail label id → display name, for one account. */
async function labelNames(accountId: string): Promise<Map<string, string>> {
  const res = await gmailGet<{ labels?: { id: string; name: string }[] }>(accountId, "labels")
    .catch(skipUnlessAuth({ labels: [] as { id: string; name: string }[] }));
  return new Map((res.labels ?? []).map((l) => [l.id, l.name]));
}

function toScanMessages(messages: RawMessage[]): ScanMessage[] {
  return messages.map((m) => {
    const h = m.payload?.headers;
    return {
      from: parseAddress(header(h, "From")).email,
      // Full addresses, not bare emails — display names reach the founder's report.
      to: parseAddressList(header(h, "To")),
      date: isoFromInternal(m.internalDate, header(h, "Date")),
      text: extractText(m.payload),
    };
  });
}

export async function auditSentFollowUps(
  opts: { query?: string; limit?: number } = {},
): Promise<SentAuditResult> {
  const accounts = await listAccountInfo();
  const ownEmails = new Set(accounts.map((a) => a.email.toLowerCase()));
  const cap = Math.min(Math.max(1, opts.limit ?? SCAN_CAP), SCAN_CAP);

  // Exclude warming server-side so those threads are never fetched.
  const q = [`in:sent`, `-label:"${WARMING_LABEL}"`, opts.query?.trim()]
    .filter(Boolean)
    .join(" ");

  const perAccount = Math.max(1, Math.ceil(cap / Math.max(1, accounts.length)));

  let scanned = 0;
  let fetchFailures = 0;
  let excludedSignoffOnly = 0;
  let excludedWarming = 0;
  let stalledNotShown = 0;
  const kept: ScannedThread[] = [];

  for (const account of accounts) {
    const [ids, labels] = await Promise.all([
      listThreadIds(account.id, { q, max: perAccount }).catch(skipUnlessAuth([] as string[])),
      labelNames(account.id),
    ]);

    const threads = await mapPool(ids, FETCH_CONCURRENCY, (id) =>
      gmailGet<RawThread>(account.id, `threads/${id}`, { format: "full" })
        .catch(skipUnlessAuth<RawThread | null>(null)),
    );

    for (const raw of threads) {
      if (!raw?.messages?.length) {
        fetchFailures++;
        continue;
      }
      scanned++;

      const messages = toScanMessages(raw.messages);
      const ourMessages = messages.filter((m) => ownEmails.has(m.from.trim().toLowerCase()));
      const names = [
        ...new Set(raw.messages.flatMap((m) => (m.labelIds ?? []).map((id) => labels.get(id) ?? id))),
      ];
      const subject = header(raw.messages[0].payload?.headers, "Subject");

      const verdict = judgeThread({
        subject,
        labelNames: names,
        ownMessageBodies: ourMessages.map((m) => m.text),
      });
      if (!verdict.included) {
        if (verdict.reason === "warming_label") excludedWarming++;
        else excludedSignoffOnly++;
        continue;
      }

      const bucket = classifyThread(messages, ownEmails);
      if (bucket === "stalled") {
        stalledNotShown++;
        continue;
      }

      const lastOurs = ourMessages.map((m) => m.date).sort().pop() ?? "";
      kept.push({
        threadId: raw.id,
        subject: subject || "(no subject)",
        bucket,
        lastSent: lastOurs,
        recipients: ourMessages.flatMap((m) => m.to),
      });
    }
  }

  const followUps = groupByRecipient(kept, ownEmails, new Date().toISOString());

  return {
    scanned,
    matched: kept.length,
    cap,
    capped: scanned >= cap,
    fetchFailures,
    excludedSignoffOnly,
    excludedWarming,
    stalledNotShown,
    followUps,
  };
}
```

Note on recipient names: `toScanMessages` keeps full `MailAddress` values, so a
`To` header of `Jane Roe <jane@acme.com>` reaches the output as the name "Jane Roe".
`groupByRecipient` falls back to the bare address only when the header carried no
display name.

Note on test coverage: this module has no unit tests, and that is deliberate. Every
decision that can be wrong — quote cutting, sign-off matching, inclusion, bucketing,
aggregation — lives in `sentScan.ts` and is tested there. What remains here is Gmail
paging and glue, matching the existing convention that server-only Gmail modules
(`advisorEmail.ts`, `calendar/advisorCalendar.ts`) carry no unit tests. Task 5 tests
`listThreadIds` specifically because pagination has off-by-one risk around the cap
that pure review cannot settle.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Confirm the pure-logic tests still pass**

Run: `npm test`
Expected: PASS, whole suite green

- [ ] **Step 4: Commit**

```bash
git add src/lib/gmail/sentAudit.ts
git commit -m "feat(gmail): sent follow-up audit orchestration with bounded fetch pool"
```

---

### Task 7: Wire the tool into the advisor

**Files:**
- Modify: `src/lib/advisor/tools.ts` (the `EMAIL_TOOLS` array, around line 112)
- Modify: `src/lib/gmail/advisorEmail.ts` (add a branch in `resolveEmailTool`)
- Modify: `src/app/api/advisor/route.ts` (the `emailEnabled` prompt block, around line 90)

**Interfaces:**
- Consumes: `auditSentFollowUps`, `SCAN_CAP` from `@/lib/gmail/sentAudit`
- Produces: the `audit_sent_followups` tool, reachable by the model

Registering in `EMAIL_TOOLS` is all that is needed for routing: `EMAIL_TOOL_NAMES`
is derived from that array, and `route.ts:137` already dispatches those names to
`resolveEmailTool`. No change to the dispatch logic.

- [ ] **Step 1: Register the tool**

In `src/lib/advisor/tools.ts`, add as a third entry in the `EMAIL_TOOLS` array:

```ts
  { name: "audit_sent_followups", description:
      "Audit the founder's SENT mail to find people who owe him a reply or who he left hanging. " +
      "Scans sent threads newest-first, skips Apollo mailwarming, and keeps threads whose subject " +
      "mentions Pallisade or where he signed off as Emil. Returns one row per recipient with a bucket: " +
      "'awaiting_you' (they replied last — most urgent) or 'no_reply' (they never replied). " +
      "Also returns scan diagnostics. Never invent recipients.",
    input_schema: obj({
      query: s("extra Gmail search terms to narrow the scan, e.g. 'subject:Pallisade' or 'newer_than:90d'. Optional."),
      limit: n("max threads to scan, default and maximum 400"),
    }) },
```

- [ ] **Step 2: Resolve the tool**

In `src/lib/gmail/advisorEmail.ts`, add the import at the top:

```ts
import { auditSentFollowUps } from "./sentAudit";
```

and add this branch before the final `return` in `resolveEmailTool`:

```ts
  if (name === "audit_sent_followups") {
    const result = await auditSentFollowUps({
      query: args.query ? String(args.query) : undefined,
      limit: args.limit == null ? undefined : Number(args.limit),
    });
    return JSON.stringify(result);
  }
```

- [ ] **Step 3: Tell the advisor when to use it**

In `src/app/api/advisor/route.ts`, inside the `if (emailEnabled)` block, append to
`systemFull`:

```ts
    systemFull +=
      `\n\nTo find people who have gone quiet, use audit_sent_followups — it reads real SENT mail, ` +
      `excludes Apollo mailwarming, and buckets each recipient as 'awaiting_you' (they replied and are ` +
      `waiting on the founder — lead with these) or 'no_reply' (never came back). Report the real names, ` +
      `companies and days since contact it returns, then propose a create_task follow-up for each person ` +
      `worth chasing, so the founder can confirm them. Cross-reference query_leads to say whether each ` +
      `person is already in the pipeline. If the result has capped: true, say so plainly — the scan hit ` +
      `its ${SCAN_CAP}-thread ceiling and older mail was not read. If followUps is empty but ` +
      `excludedSignoffOnly is large, say that too: it means the strict "signed off as Emil" rule filtered ` +
      `almost everything out, which is a tuning problem, not an empty pipeline.`;
```

Add the import at the top of the route:

```ts
import { SCAN_CAP } from "@/lib/gmail/sentAudit";
```

- [ ] **Step 4: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; whole suite green

- [ ] **Step 5: Verify end-to-end against real mail**

Run: `npm run dev`

In the Sales Advisor, ask: *"Go through everything I've sent and tell me who never replied and who I've left hanging."*

Confirm all of:
- The advisor calls `audit_sent_followups` and reports real recipients
- No mailwarming recipients appear
- `awaiting_you` people are led with
- `create_task` proposals appear as **pending confirmation cards**, not as completed writes
- If nothing comes back, check `excludedSignoffOnly` in the response — a large
  number there means the strict sign-off rule is filtering too hard, and
  `SIGNOFF_SEARCH_LINES` in `sentScan.ts` is the one value to raise

- [ ] **Step 6: Commit**

```bash
git add src/lib/advisor/tools.ts src/lib/gmail/advisorEmail.ts src/app/api/advisor/route.ts
git commit -m "feat(advisor): audit_sent_followups tool for chasing quiet recipients"
```

---

## Deferred

Not in this plan, by decision in the spec:

- Caching the scan in the DB for unlimited history — revisit only if the live scan proves too slow
- Real Gmail drafts (needs `gmail.compose` and re-authorising every inbox)
- CRM writes from the audit (`lastContact` / `nextFollowUp` updates)
- A settings UI for the warming label and subject keyword — both are constants in `sentScan.ts` for now
