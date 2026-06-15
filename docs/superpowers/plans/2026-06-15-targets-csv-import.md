# Targets CSV Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight, searchable **Targets** list to Pallisade OS, populated by importing a CSV, with auto-guessed column mapping, dedupe, and a one-click "promote to Lead".

**Architecture:** A new `targets` collection wired into the existing SQLite-backed store exactly like the `playbooks` collection. All CSV parsing/mapping/dedupe/promote logic is pure and lives in tested modules under `src/lib/targets/`; the import runs entirely client-side and saves through the existing store. A new `/targets` page (Pipeline nav group) hosts a searchable table and an Import CSV modal.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, `node:sqlite`, Tailwind v4, vitest, lucide-react.

---

## File Structure

**Create:**
- `src/lib/targets/csv.ts` — pure RFC-4180-ish CSV parser.
- `src/lib/targets/csv.test.ts` — tests.
- `src/lib/targets/mapping.ts` — `TARGET_FIELDS`, `NewTarget`/`TargetField` types, `guessMapping`, `rowsToTargets`, `dedupeTargets`.
- `src/lib/targets/mapping.test.ts` — tests.
- `src/lib/targets/promote.ts` — `NewLead` type, `targetToLead`.
- `src/lib/targets/promote.test.ts` — tests.
- `src/components/targets/ImportCsvModal.tsx` — the import modal (pick → map → import).
- `src/app/targets/page.tsx` — the Targets page (table, search, promote, delete, clear).

**Modify:**
- `src/lib/types.ts` — add `Target`; add `targets` to `DataShape`; extend `AdvisorSnapshot` omit.
- `src/lib/store.tsx` — `EMPTY` gains `targets: []`; add `useTargets()` selector; import `Target`.
- `src/lib/db/sqlite.ts` — add `"targets"` to `COLLECTIONS`.
- `src/lib/seed.ts` — add `targets: []` to the `seedData()` return literal.
- `src/lib/db/apiAdapter.ts` — add `targets: []` to the empty `DataShape` literal.
- `src/components/layout/Topbar.tsx` — add `targets` entries to `HIT_ROUTE` and `HIT_LABEL`.
- `src/components/layout/nav.ts` — import the `Target` icon; add the Targets nav item.

---

## Task 1: Target type + DataShape

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add the `Target` interface**

In `src/lib/types.ts`, immediately **above** the `/* ---------- collections registry ---------- */` comment (the same place the `Playbook` block sits), insert:

```ts
/* ---------- targets (imported prospect list) ---------- */

export interface Target extends BaseRecord {
  company: string;
  contactName: string;
  contactRole: string;
  email: string;
  phone: string;
  linkedinUrl: string;
  industry: string;
  location: string;
  notes: string;
}
```

- [ ] **Step 2: Register the collection in `DataShape`**

In the `DataShape` interface, add `targets` after the `playbooks` line:

```ts
  conversations: Conversation[];
  playbooks: Playbook[];
  targets: Target[];
  settings: Settings;
```

- [ ] **Step 3: Verify the project type-checks**

Run: `npx tsc --noEmit`
Expected: errors ONLY in the files that build a `DataShape`/`AdvisorSnapshot` literal or an exhaustive `Record<CollectionKey,…>` — i.e. `store.tsx`, `seed.ts`, `db/apiAdapter.ts`, `components/layout/Topbar.tsx`, `advisorClient.ts`, `advisor/readTools.test.ts`, `advisor/tools.test.ts`. These are ALL fixed in Task 2. No errors inside `types.ts` itself.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(targets): add Target domain type"
```

---

## Task 2: Store + persistence wiring (close the ripple)

**Files:**
- Modify: `src/lib/types.ts` (the `AdvisorSnapshot` type)
- Modify: `src/lib/store.tsx` (`EMPTY` + a selector + import)
- Modify: `src/lib/db/sqlite.ts` (`COLLECTIONS`)
- Modify: `src/lib/seed.ts` (the `seedData` return literal)
- Modify: `src/lib/db/apiAdapter.ts` (its empty `DataShape` literal)
- Modify: `src/components/layout/Topbar.tsx` (`HIT_ROUTE`, `HIT_LABEL`)

> **Why these files:** making `targets` a required `DataShape` field (Task 1) breaks every literal and exhaustive `Record<CollectionKey,…>`. This task closes that ripple so `tsc` is clean. Targets are deliberately excluded from `AdvisorSnapshot` (a large cold list would balloon advisor token cost on every turn).

- [ ] **Step 0: Exclude `targets` from the advisor snapshot**

In `src/lib/types.ts`, change `AdvisorSnapshot` (currently `Omit<DataShape, "conversations" | "playbooks">`) to:

```ts
export type AdvisorSnapshot = Omit<DataShape, "conversations" | "playbooks" | "targets">;
```

This resolves the `tsc` errors in `advisorClient.ts`, `readTools.test.ts` and `tools.test.ts` without touching them.

- [ ] **Step 1: Add `targets` to the empty store + import the type**

In `src/lib/store.tsx`, add `Target` to the `import type { ... } from "./types"` block. Then in the `EMPTY` constant add `targets: []` after `playbooks: []`:

```ts
  conversations: [],
  playbooks: [],
  targets: [],
  settings: DEFAULT_SETTINGS,
```

- [ ] **Step 2: Add the `useTargets` selector**

At the very bottom of `src/lib/store.tsx`, after the `usePlaybook` selector, add:

```ts
export const useTargets = () => useStore().targets as Target[];
```

- [ ] **Step 3: Add `targets` to the SQLite collections**

In `src/lib/db/sqlite.ts`, add `"targets"` to the `COLLECTIONS` array after `"playbooks"`:

```ts
  "conversations",
  "playbooks",
  "targets",
] as const;
```

- [ ] **Step 4: Add `targets: []` to the other `DataShape` literals**

In `src/lib/seed.ts`, in the `seedData()` return literal add `targets: []` next to the existing `playbooks: []`.

In `src/lib/db/apiAdapter.ts`, in the empty `DataShape` literal add `targets: []` next to the existing `playbooks: []`.

- [ ] **Step 5: Add `targets` entries to the Topbar records**

In `src/components/layout/Topbar.tsx`, add to `HIT_ROUTE` (next to the `playbooks: "/prep",` line):

```ts
  targets: "/targets",
```

and to `HIT_LABEL` (next to `playbooks: "Playbook",`):

```ts
  targets: "Target",
```

(`store.search()` does not emit target hits — global search intentionally excludes targets — but the exhaustive `Record<SearchHit["kind"], string>` type requires the key.)

- [ ] **Step 6: Verify type-check is clean**

Run: `npx tsc --noEmit`
Expected: PASS, zero errors. If any remain, add `targets: []` to the offending `DataShape` literal the same way and re-run.

- [ ] **Step 7: Run the test suite (no regression)**

Run: `npm test`
Expected: all existing tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/types.ts src/lib/store.tsx src/lib/db/sqlite.ts src/lib/seed.ts src/lib/db/apiAdapter.ts src/components/layout/Topbar.tsx
git commit -m "feat(targets): wire targets collection into store, sqlite and snapshot"
```

---

## Task 3: CSV parser (TDD)

Pure RFC-4180-ish parser. No React, no I/O.

**Files:**
- Create: `src/lib/targets/csv.ts`
- Test: `src/lib/targets/csv.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/targets/csv.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("parses simple rows", () => {
    expect(parseCsv("a,b\n1,2")).toEqual({ headers: ["a", "b"], rows: [["1", "2"]] });
  });

  it("handles quoted fields with embedded commas", () => {
    expect(parseCsv('a,b\n"x,y",2')).toEqual({ headers: ["a", "b"], rows: [["x,y", "2"]] });
  });

  it("handles quoted fields with embedded newlines", () => {
    expect(parseCsv('a,b\n"line1\nline2",2')).toEqual({
      headers: ["a", "b"],
      rows: [["line1\nline2", "2"]],
    });
  });

  it("handles escaped double-quotes", () => {
    expect(parseCsv('a\n"he said ""hi"""')).toEqual({
      headers: ["a"],
      rows: [['he said "hi"']],
    });
  });

  it("handles CRLF line endings and ignores a trailing newline", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual({ headers: ["a", "b"], rows: [["1", "2"]] });
  });

  it("pads short rows and truncates long rows to the header width", () => {
    expect(parseCsv("a,b,c\n1,2").rows).toEqual([["1", "2", ""]]);
    expect(parseCsv("a,b\n1,2,3").rows).toEqual([["1", "2"]]);
  });

  it("returns empty headers for empty input", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/targets/csv.test.ts`
Expected: FAIL — `Cannot find module './csv'`.

- [ ] **Step 3: Implement `csv.ts`**

Create `src/lib/targets/csv.ts`:

```ts
export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

/** Parse CSV text (RFC-4180-ish): quoted fields, embedded commas/newlines, escaped "". */
export function parseCsv(text: string): ParsedCsv {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  const pushField = () => { record.push(field); field = ""; };
  const pushRecord = () => { records.push(record); record = []; };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }       // escaped quote
        else inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") pushField();
    else if (c === "\r") { /* skip; the following \n ends the record */ }
    else if (c === "\n") { pushField(); pushRecord(); }
    else field += c;
  }
  // Flush a final field/record that wasn't newline-terminated.
  if (field.length > 0 || record.length > 0) { pushField(); pushRecord(); }

  // Drop fully-blank records (e.g. produced by a trailing newline).
  const nonEmpty = records.filter((r) => !(r.length === 1 && r[0] === ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const headers = nonEmpty[0];
  const width = headers.length;
  const rows = nonEmpty.slice(1).map((r) => {
    const copy = r.slice(0, width);
    while (copy.length < width) copy.push("");
    return copy;
  });
  return { headers, rows };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/targets/csv.test.ts`
Expected: PASS (all green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/targets/csv.ts src/lib/targets/csv.test.ts
git commit -m "feat(targets): RFC-4180-ish CSV parser (TDD)"
```

---

## Task 4: Column mapping, row building, dedupe (TDD)

**Files:**
- Create: `src/lib/targets/mapping.ts`
- Test: `src/lib/targets/mapping.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/targets/mapping.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { guessMapping, rowsToTargets, dedupeTargets, TARGET_FIELDS } from "./mapping";
import type { NewTarget } from "./mapping";
import type { Target } from "@/lib/types";

const target = (over: Partial<Target>): Target => ({
  id: "t", createdAt: "", updatedAt: "",
  company: "", contactName: "", contactRole: "", email: "",
  phone: "", linkedinUrl: "", industry: "", location: "", notes: "",
  ...over,
});

describe("TARGET_FIELDS", () => {
  it("lists the nine target fields", () => {
    expect(TARGET_FIELDS).toEqual([
      "company", "contactName", "contactRole", "email",
      "phone", "linkedinUrl", "industry", "location", "notes",
    ]);
  });
});

describe("guessMapping", () => {
  it("maps common header variants to fields", () => {
    expect(guessMapping(["Company Name", "Full Name", "Email Address", "LinkedIn URL"]))
      .toEqual(["company", "contactName", "email", "linkedinUrl"]);
    expect(guessMapping(["Job Title", "City"])).toEqual(["contactRole", "location"]);
  });

  it("marks unknown headers as ignore", () => {
    expect(guessMapping(["Mystery Column"])).toEqual(["ignore"]);
  });

  it("only maps the first column that claims a field (first wins)", () => {
    expect(guessMapping(["email", "Email Address"])).toEqual(["email", "ignore"]);
  });
});

describe("rowsToTargets", () => {
  it("applies the mapping, trims values, and blanks unmapped fields", () => {
    const { targets, blankSkipped } = rowsToTargets(
      [[" Acme ", "  Jane Doe  ", "drop me"]],
      ["company", "contactName", "ignore"],
    );
    expect(blankSkipped).toBe(0);
    expect(targets[0]).toEqual({
      company: "Acme", contactName: "Jane Doe", contactRole: "", email: "",
      phone: "", linkedinUrl: "", industry: "", location: "", notes: "",
    });
  });

  it("skips rows with neither company nor contactName, counting them", () => {
    const { targets, blankSkipped } = rowsToTargets(
      [["", ""], ["Acme", ""]],
      ["company", "contactName"],
    );
    expect(targets).toHaveLength(1);
    expect(targets[0].company).toBe("Acme");
    expect(blankSkipped).toBe(1);
  });
});

describe("dedupeTargets", () => {
  const t = (over: Partial<NewTarget>): NewTarget => ({
    company: "", contactName: "", contactRole: "", email: "",
    phone: "", linkedinUrl: "", industry: "", location: "", notes: "",
    ...over,
  });

  it("drops incoming rows matching an existing email (case-insensitive) or linkedinUrl", () => {
    const existing = [target({ email: "JANE@acme.com" }), target({ linkedinUrl: "in/bob" })];
    const incoming = [t({ email: "jane@acme.com" }), t({ linkedinUrl: "in/bob" }), t({ company: "New" })];
    const { toAdd, duplicates } = dedupeTargets(incoming, existing);
    expect(duplicates).toBe(2);
    expect(toAdd.map((x) => x.company)).toEqual(["New"]);
  });

  it("dedupes within the incoming batch too", () => {
    const { toAdd, duplicates } = dedupeTargets(
      [t({ email: "a@b.com" }), t({ email: "A@B.com" })],
      [],
    );
    expect(duplicates).toBe(1);
    expect(toAdd).toHaveLength(1);
  });

  it("never dedupes on empty email/linkedinUrl", () => {
    const { toAdd, duplicates } = dedupeTargets(
      [t({ company: "X" }), t({ company: "Y" })],
      [target({ company: "Z" })],
    );
    expect(duplicates).toBe(0);
    expect(toAdd).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/targets/mapping.test.ts`
Expected: FAIL — `Cannot find module './mapping'`.

- [ ] **Step 3: Implement `mapping.ts`**

Create `src/lib/targets/mapping.ts`:

```ts
import type { Target } from "@/lib/types";

export type NewTarget = Omit<Target, "id" | "createdAt" | "updatedAt">;
export type TargetField = keyof NewTarget;

export const TARGET_FIELDS: TargetField[] = [
  "company", "contactName", "contactRole", "email",
  "phone", "linkedinUrl", "industry", "location", "notes",
];

export type ColumnMapping = (TargetField | "ignore")[];

/** Header (normalised) → field. Covers common CSV export variants. */
const SYNONYMS: Record<string, TargetField> = {
  company: "company", companyname: "company", organisation: "company", organization: "company", account: "company",
  contactname: "contactName", fullname: "contactName", name: "contactName", contact: "contactName", person: "contactName",
  contactrole: "contactRole", role: "contactRole", title: "contactRole", jobtitle: "contactRole", position: "contactRole",
  email: "email", emailaddress: "email", mail: "email",
  phone: "phone", phonenumber: "phone", mobile: "phone", tel: "phone",
  linkedinurl: "linkedinUrl", linkedin: "linkedinUrl", profileurl: "linkedinUrl", profile: "linkedinUrl",
  industry: "industry", sector: "industry", vertical: "industry",
  location: "location", city: "location", country: "location", region: "location",
  notes: "notes", note: "notes", comment: "notes", comments: "notes", description: "notes",
};

function normalise(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Guess a field per column from its header; first column to claim a field wins. */
export function guessMapping(headers: string[]): ColumnMapping {
  const used = new Set<TargetField>();
  return headers.map((h) => {
    const field = SYNONYMS[normalise(h)];
    if (field && !used.has(field)) { used.add(field); return field; }
    return "ignore";
  });
}

const BLANK: NewTarget = {
  company: "", contactName: "", contactRole: "", email: "",
  phone: "", linkedinUrl: "", industry: "", location: "", notes: "",
};

/** Apply a mapping to raw rows; trim values; skip rows with no company AND no contactName. */
export function rowsToTargets(
  rows: string[][],
  mapping: ColumnMapping,
): { targets: NewTarget[]; blankSkipped: number } {
  const targets: NewTarget[] = [];
  let blankSkipped = 0;
  for (const row of rows) {
    const t: NewTarget = { ...BLANK };
    mapping.forEach((field, col) => {
      if (field !== "ignore") t[field] = (row[col] ?? "").trim();
    });
    if (!t.company && !t.contactName) { blankSkipped++; continue; }
    targets.push(t);
  }
  return { targets, blankSkipped };
}

/** Drop incoming rows whose non-empty email/linkedinUrl already exists (case-insensitive),
 *  checking both the existing store and earlier rows in the same batch. */
export function dedupeTargets(
  incoming: NewTarget[],
  existing: Target[],
): { toAdd: NewTarget[]; duplicates: number } {
  const emails = new Set<string>();
  const links = new Set<string>();
  for (const e of existing) {
    if (e.email) emails.add(e.email.toLowerCase());
    if (e.linkedinUrl) links.add(e.linkedinUrl.toLowerCase());
  }
  const toAdd: NewTarget[] = [];
  let duplicates = 0;
  for (const t of incoming) {
    const em = t.email.toLowerCase();
    const ln = t.linkedinUrl.toLowerCase();
    if ((em && emails.has(em)) || (ln && links.has(ln))) { duplicates++; continue; }
    if (em) emails.add(em);
    if (ln) links.add(ln);
    toAdd.push(t);
  }
  return { toAdd, duplicates };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/targets/mapping.test.ts`
Expected: PASS (all green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/targets/mapping.ts src/lib/targets/mapping.test.ts
git commit -m "feat(targets): column mapping, row building and dedupe (TDD)"
```

---

## Task 5: Promote a target to a lead (TDD)

**Files:**
- Create: `src/lib/targets/promote.ts`
- Test: `src/lib/targets/promote.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/targets/promote.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { targetToLead } from "./promote";
import type { Target } from "@/lib/types";

const target = (over: Partial<Target>): Target => ({
  id: "t", createdAt: "", updatedAt: "",
  company: "Acme", contactName: "Jane", contactRole: "CFO", email: "jane@acme.com",
  phone: "123", linkedinUrl: "", industry: "Finance", location: "London", notes: "warm",
  ...over,
});

describe("targetToLead", () => {
  it("carries target fields over and applies sensible Lead defaults", () => {
    const lead = targetToLead(target({}), "Emil");
    expect(lead).toMatchObject({
      company: "Acme", contactName: "Jane", contactRole: "CFO", email: "jane@acme.com",
      phone: "123", industry: "Finance", location: "London", notes: "warm",
      status: "new", quality: "medium", owner: "Emil", estimatedValue: 0,
      companyType: "", painPoint: "", objection: "", buyingSignal: "", solutionIdea: "",
      lastContact: null, nextFollowUp: null,
    });
  });

  it("sources from website when there is no LinkedIn URL", () => {
    expect(targetToLead(target({ linkedinUrl: "" }), "Emil").source).toBe("website");
  });

  it("sources from LinkedIn when a LinkedIn URL is present", () => {
    expect(targetToLead(target({ linkedinUrl: "in/jane" }), "Emil").source).toBe("LinkedIn");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/targets/promote.test.ts`
Expected: FAIL — `Cannot find module './promote'`.

- [ ] **Step 3: Implement `promote.ts`**

Create `src/lib/targets/promote.ts`:

```ts
import type { Lead, Target } from "@/lib/types";

export type NewLead = Omit<Lead, "id" | "createdAt" | "updatedAt">;

// NOTE: the Lead schema has NO `location` field, so the target's `location`
// is intentionally not carried over (it has nowhere to go). Every other
// target field maps 1:1; the rest are sensible defaults.
/** Build a Lead from a Target. Source derives from whether a LinkedIn URL exists. */
export function targetToLead(target: Target, founderName: string): NewLead {
  return {
    company: target.company,
    contactName: target.contactName,
    contactRole: target.contactRole,
    email: target.email,
    phone: target.phone,
    linkedinUrl: target.linkedinUrl,
    industry: target.industry,
    companyType: "",
    source: target.linkedinUrl ? "LinkedIn" : "website",
    status: "new",
    quality: "medium",
    painPoint: "",
    objection: "",
    buyingSignal: "",
    lastContact: null,
    nextFollowUp: null,
    notes: target.notes,
    solutionIdea: "",
    estimatedValue: 0,
    owner: founderName,
  };
}
```

> Sanity check: the test's `toMatchObject` deliberately does **not** assert a `location` field on the Lead (Leads have none). If `tsc` complains about `location`, you left it in — remove it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/targets/promote.test.ts`
Expected: PASS. (`npx tsc --noEmit` must also be clean — if `location` was left in, TS will reject it; remove it.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/targets/promote.ts src/lib/targets/promote.test.ts
git commit -m "feat(targets): promote a target into a lead (TDD)"
```

---

## Task 6: Import CSV modal

A 2-screen modal: **pick** a file → **map** columns (preview + per-column dropdown) → import. UI only, no tests.

**Files:**
- Create: `src/components/targets/ImportCsvModal.tsx`

- [ ] **Step 1: Implement the modal**

Create `src/components/targets/ImportCsvModal.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Upload, Check } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Field";
import type { Target } from "@/lib/types";
import { parseCsv } from "@/lib/targets/csv";
import {
  guessMapping, rowsToTargets, dedupeTargets,
  TARGET_FIELDS, type ColumnMapping, type NewTarget,
} from "@/lib/targets/mapping";

interface Summary { added: number; duplicates: number; blank: number }

export function ImportCsvModal({
  open,
  onClose,
  existing,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  existing: Target[];
  /** Page persists each accepted record into the store. */
  onImport: (records: NewTarget[]) => void;
}) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  const reset = () => {
    setHeaders([]); setRows([]); setMapping([]); setFileError(null); setSummary(null);
  };
  const close = () => { reset(); onClose(); };

  const onFile = async (file: File) => {
    setFileError(null);
    const { headers: h, rows: r } = parseCsv(await file.text());
    if (h.length === 0) { setFileError("Couldn't read any columns from that file."); return; }
    setHeaders(h); setRows(r); setMapping(guessMapping(h));
  };

  const setColumn = (col: number, value: string) => {
    setMapping((m) => m.map((v, i) => (i === col ? (value as ColumnMapping[number]) : v)));
  };

  const canImport = rows.length > 0 && mapping.some((m) => m !== "ignore");

  const runImport = () => {
    const { targets, blankSkipped } = rowsToTargets(rows, mapping);
    const { toAdd, duplicates } = dedupeTargets(targets, existing);
    onImport(toAdd);
    setSummary({ added: toAdd.length, duplicates, blank: blankSkipped });
  };

  const fieldOptions = ["ignore", ...TARGET_FIELDS];

  return (
    <Modal open={open} onClose={close} title="Import targets from CSV" size="lg">
      {summary ? (
        <div className="space-y-4">
          <p className="text-[0.9rem] text-[var(--color-ink)]">
            Imported <b>{summary.added}</b> · skipped <b>{summary.duplicates}</b> duplicate
            {summary.duplicates === 1 ? "" : "s"} · <b>{summary.blank}</b> blank row
            {summary.blank === 1 ? "" : "s"} ignored.
          </p>
          <div className="flex justify-end">
            <button className="btn btn-accent" onClick={close}>Done</button>
          </div>
        </div>
      ) : headers.length === 0 ? (
        <div className="space-y-3">
          <p className="text-[0.85rem] text-[var(--color-muted)] leading-relaxed">
            Choose a CSV file. We'll guess which column maps to which field, then let you
            confirm before importing.
          </p>
          <label className="btn">
            <Upload size={15} /> Choose CSV…
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
            />
          </label>
          {fileError && <p className="text-[0.8rem] text-[var(--color-accent)]">{fileError}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-[0.82rem] text-[var(--color-muted)]">
            {rows.length} row{rows.length === 1 ? "" : "s"} found. Confirm the column mapping:
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[0.78rem]">
              <thead>
                <tr>
                  {headers.map((h, col) => (
                    <th key={col} className="text-left p-1 align-top">
                      <div className="text-[var(--color-dim)] truncate mb-1" title={h}>{h || "(blank)"}</div>
                      <Select
                        options={fieldOptions}
                        value={mapping[col]}
                        onChange={(e) => setColumn(col, e.target.value)}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 5).map((r, ri) => (
                  <tr key={ri} className="border-t border-[var(--color-line)]">
                    {headers.map((_, col) => (
                      <td key={col} className="p-1 text-[var(--color-muted)] truncate max-w-[160px]">{r[col]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between gap-2">
            <button className="btn" onClick={reset}>Choose a different file</button>
            <button className="btn btn-accent" onClick={runImport} disabled={!canImport}>
              <Check size={15} /> Import {rows.length}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
```

- [ ] **Step 2: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: PASS. (Confirm `Modal` accepts `open`/`onClose`/`title`/`size` and `Select` accepts `options`/`value`/`onChange` — both verified true in the codebase. The `.hidden` and `.btn` classes exist.)

- [ ] **Step 3: Commit**

```bash
git add src/components/targets/ImportCsvModal.tsx
git commit -m "feat(targets): CSV import modal (pick, map, import)"
```

---

## Task 7: Targets page + nav

**Files:**
- Create: `src/app/targets/page.tsx`
- Modify: `src/components/layout/nav.ts`

- [ ] **Step 1: Add the nav item**

In `src/components/layout/nav.ts`, add `Target` to the lucide-react import block (alongside `Users`, etc.), then add this entry to the `NAV` array immediately **after** the Leads line (`{ href: "/leads", ... }`):

```ts
  { href: "/targets", label: "Targets", icon: Target, group: "Pipeline" },
```

- [ ] **Step 2: Implement the page**

Create `src/app/targets/page.tsx`. NOTE: import the `Target` *type* from `@/lib/types`, and for the empty-state icon use the lucide `Crosshair` icon (NOT lucide `Target`, which would clash with the type name).

```tsx
"use client";

import { useMemo, useState } from "react";
import { Upload, Crosshair, ArrowUpRight, Trash2 } from "lucide-react";
import { useStore, useTargets, useSettings } from "@/lib/store";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";
import { TextInput } from "@/components/ui/Field";
import { ConfirmDialog } from "@/components/ui/Modal";
import { ImportCsvModal } from "@/components/targets/ImportCsvModal";
import { targetToLead } from "@/lib/targets/promote";
import type { NewTarget } from "@/lib/targets/mapping";
import type { Target } from "@/lib/types";

function matches(t: Target, q: string): boolean {
  const hay = [t.company, t.contactName, t.contactRole, t.email, t.industry, t.location, t.notes]
    .join(" ").toLowerCase();
  return hay.includes(q);
}

export default function TargetsPage() {
  const store = useStore();
  const targets = useTargets();
  const settings = useSettings();

  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? targets.filter((t) => matches(t, q)) : targets;
  }, [targets, query]);

  const onImport = (records: NewTarget[]) => {
    for (const r of records) store.create("targets", r);
  };

  const promote = (t: Target) => {
    store.create("leads", targetToLead(t, settings.founderName));
    store.remove("targets", t.id);
  };

  const clearAll = () => {
    for (const t of targets) store.remove("targets", t.id);
    setConfirmClear(false);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Targets"
        subtitle="Your imported prospect list. Search it, then promote a target into a Lead when you start engaging."
        actions={
          <div className="flex items-center gap-2">
            {targets.length > 0 && (
              <button className="btn" onClick={() => setConfirmClear(true)}>
                <Trash2 size={15} /> Clear all
              </button>
            )}
            <button className="btn btn-accent" onClick={() => setImporting(true)}>
              <Upload size={15} /> Import CSV
            </button>
          </div>
        }
      />

      {targets.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Crosshair}
            title="No targets yet"
            message="Import a CSV of prospects to build your targets list, then search and promote them."
            action={<button className="btn btn-accent" onClick={() => setImporting(true)}><Upload size={15} /> Import CSV</button>}
          />
        </Panel>
      ) : (
        <Panel
          title={`${filtered.length} of ${targets.length}`}
          action={
            <TextInput
              placeholder="Search targets…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-56"
            />
          }
          noPad
        >
          <div className="overflow-x-auto">
            <table className="w-full text-[0.82rem]">
              <thead>
                <tr className="text-left text-[var(--color-dim)] border-b border-[var(--color-line)]">
                  <th className="p-2.5 font-medium">Company</th>
                  <th className="p-2.5 font-medium">Contact</th>
                  <th className="p-2.5 font-medium">Role</th>
                  <th className="p-2.5 font-medium">Email</th>
                  <th className="p-2.5 font-medium">Industry</th>
                  <th className="p-2.5 font-medium">Location</th>
                  <th className="p-2.5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id} className="border-b border-[var(--color-line)] hover:bg-[var(--color-surface-2)]">
                    <td className="p-2.5 text-[var(--color-ink)] font-medium">{t.company || "—"}</td>
                    <td className="p-2.5 text-[var(--color-muted)]">{t.contactName || "—"}</td>
                    <td className="p-2.5 text-[var(--color-muted)]">{t.contactRole || "—"}</td>
                    <td className="p-2.5 text-[var(--color-muted)] truncate max-w-[200px]">{t.email || "—"}</td>
                    <td className="p-2.5 text-[var(--color-muted)]">{t.industry || "—"}</td>
                    <td className="p-2.5 text-[var(--color-muted)]">{t.location || "—"}</td>
                    <td className="p-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button className="btn btn-sm" title="Promote to lead" onClick={() => promote(t)}>
                          <ArrowUpRight size={14} /> Promote
                        </button>
                        <button className="btn btn-ghost btn-icon" title="Delete" onClick={() => store.remove("targets", t.id)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <ImportCsvModal
        open={importing}
        onClose={() => setImporting(false)}
        existing={targets}
        onImport={onImport}
      />

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={clearAll}
        title="Clear all targets?"
        message={`This permanently removes all ${targets.length} targets. Promoted leads are not affected.`}
        confirmLabel="Clear all"
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Verify the production build**

Run: `npm run build`
Expected: build succeeds and `/targets` appears in the route list. If the build fails on an ESLint error in a file you created/modified, fix the minimal lint issue without changing behavior; if it fails for another reason, STOP and report.

- [ ] **Step 5: Commit**

```bash
git add src/app/targets/page.tsx src/components/layout/nav.ts
git commit -m "feat(targets): targets page with search, promote, clear, and CSV import"
```

---

## Task 8: Verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS, including the new `csv.test.ts`, `mapping.test.ts`, `promote.test.ts`.

- [ ] **Step 2: Type-check + build**

Run: `npx tsc --noEmit` (clean) and `npm run build` (succeeds, `/targets` listed).

- [ ] **Step 3: Manual smoke test**

Run `npm run dev`, open `http://localhost:3000/targets`. Verify:
1. Empty state shows; "Import CSV" opens the modal.
2. Import a small CSV (e.g. headers `Company Name, Full Name, Email Address, LinkedIn URL, Title, City`) → columns auto-map; you can change a mapping; Import shows a summary (added/duplicates/blank).
3. Reload → targets persisted (SQLite).
4. Search box filters the table.
5. **Promote** on a row → the target disappears and a new Lead appears on `/leads` (status new); re-import the same file → the just-promoted row is NOT auto-deduped (it left the targets list), but rows already in targets ARE skipped as duplicates.
6. **Clear all** → confirm dialog → empties the list (leads untouched).

- [ ] **Step 4: Final type-check**

Run: `npx tsc --noEmit`
Expected: PASS. (Commit any smoke-test fixes with a descriptive message.)

---

## Notes for the implementer

- **The `playbooks` collection is your template** for Tasks 1–2 — every wiring edit mirrors an existing `playbooks` line already in the file.
- **`Lead` has no `location` field** — Task 5 drops the target's `location` on promote. This is intentional (nowhere to put it).
- **Name clash:** the lucide `Target` icon and the `Target` type collide. `nav.ts` uses the icon (no type import there); the page uses the type and a different icon (`Crosshair`). Don't import the lucide `Target` into the page.
- **UI is untested by convention** (matching the advisor/prep pages); only the pure `src/lib/targets/` modules carry tests.
- Follow existing styling primitives (`btn`, `btn-sm`, `btn-ghost`, `btn-icon`, `panel`, `Panel`, `Field`, `Modal`, `ConfirmDialog`, `EmptyState`) — introduce no new design tokens.
