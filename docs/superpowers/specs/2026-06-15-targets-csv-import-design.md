# Targets CSV Import — Design

**Date:** 2026-06-15
**Status:** Approved for planning

## Purpose

Let the founder import a CSV of targeted clients/prospects into Pallisade OS as a
lightweight, searchable **Targets** list — kept out of the active Leads pipeline —
and **promote** a target into a Lead when they start engaging it.

## Background / why this shape

The founder first explored connecting LinkedIn (create leads from the inbox, chat
in-app, save conversations as interactions). LinkedIn offers **no sanctioned API for
personal messaging**, and every in-app-inbox path requires ToS-violating third-party
automation with account-ban risk. Rather than take that on, the founder chose a fully
owned, sanctioned alternative: import a CSV of targets and search it. This spec covers
only that CSV-import feature; the LinkedIn paths are explicitly out of scope.

## Decisions (locked)

- **Separate `Targets` list**, not imported into Leads — a big cold list stays out of
  the active pipeline.
- **Target fields:** core sales fields only (`company, contactName, contactRole,
  email, phone, linkedinUrl, industry, location, notes`). Unmapped CSV columns are
  dropped.
- **Column mapping:** auto-guess from headers, then a confirm step where the user can
  correct each column (or set it to "ignore").
- **Promote = move:** creates a Lead from the target, then removes the target. No
  duplication.
- **Search is page-local** (a filter box on the Targets page), not added to the
  global top-bar search — avoids drowning the real pipeline in cold prospects.
- **Targets are excluded from the advisor snapshot** — a large list sent every advisor
  turn would balloon token cost. Mirrors how `playbooks` is handled. Revisitable.

## Architecture overview

Reuses existing patterns end to end:

- **Persistence:** a new `targets` collection on the SQLite-backed `/api/data` store
  and the generic store CRUD — same wiring as the earlier `playbooks` collection.
- **CSV handling:** entirely client-side (parse in the browser, save through the
  existing store). No new API route. Pure parse/map/dedupe/promote logic lives in
  tested modules under `src/lib/targets/`.
- **UI:** a new `/targets` page (Pipeline nav group) with an Import CSV modal and a
  searchable table.

## 1. Data model

Added to `src/lib/types.ts`:

```ts
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

Registry wiring (identical pattern to the `playbooks` collection already in the app):

- `DataShape` gains `targets: Target[]`.
- `store.tsx` `EMPTY` gains `targets: []`; add a `useTargets()` selector.
- `db/sqlite.ts` `COLLECTIONS` gains `"targets"`.
- `seed.ts` `seedData()` return literal and `db/apiAdapter.ts` empty literal gain
  `targets: []`.
- `components/layout/Topbar.tsx`: the two `Record<SearchHit["kind"], string>` maps
  (`HIT_ROUTE`, `HIT_LABEL`) gain `targets: "/targets"` and `targets: "Target"`.
  (Required by the exhaustive `Record` type; `store.search()` does not emit target
  hits — global search intentionally excludes targets.)
- `types.ts` `AdvisorSnapshot` becomes
  `Omit<DataShape, "conversations" | "playbooks" | "targets">`.

`CollectionKey` picks up `"targets"` automatically; `create/update/remove` work
unchanged.

## 2. CSV import (pure logic + modal flow)

Pure modules under `src/lib/targets/`:

- **`csv.ts` — `parseCsv(text: string): { headers: string[]; rows: string[][] }`.**
  RFC-4180-ish: handles quoted fields, commas/newlines inside quotes, escaped `""`,
  CRLF or LF line endings. First non-empty line is the header row. Ragged rows are
  padded/truncated to the header length.

- **`mapping.ts`:**
  - `TARGET_FIELDS` — the 9 field keys.
  - `guessMapping(headers: string[]): (TargetField | "ignore")[]` — one entry per
    column, matched by normalising the header (lowercase, strip non-alphanumerics)
    against a synonym table (e.g. `companyname`→`company`, `fullname`/`name`/`contact`
    →`contactName`, `emailaddress`/`email`→`email`, `linkedin`/`profileurl`/`profile`
    →`linkedinUrl`, `title`/`role`/`jobtitle`→`contactRole`, `city`/`location`→
    `location`, `industry`→`industry`, `phone`/`mobile`→`phone`, `notes`/`comment`→
    `notes`). No match → `"ignore"`. If two columns map to the same field, the first
    wins and later ones become `"ignore"`.
  - `rowsToTargets(rows, mapping): { targets: NewTarget[]; blankSkipped: number }` —
    applies the mapping, trims values, fills unmapped fields with `""`. Rows with
    neither `company` nor `contactName` after trimming are skipped (counted in
    `blankSkipped`).
  - `dedupeTargets(incoming, existing): { toAdd: NewTarget[]; duplicates: number }` —
    drops an incoming record if its non-empty `email` (case-insensitive) or
    `linkedinUrl` matches an existing target OR an already-accepted incoming record
    (intra-file dedupe).

- **`promote.ts` — `targetToLead(target, founderName): NewLead`.** Carries every
  target field across; defaults the rest: `status: "new"`, `quality: "medium"`,
  `source: linkedinUrl ? "LinkedIn" : "website"`, `owner: founderName`,
  `estimatedValue: 0`, and the remaining Lead string fields (`companyType`,
  `painPoint`, `objection`, `buyingSignal`, `solutionIdea`) `""`, date fields `null`.

`NewTarget`/`NewLead` are the `Omit<…, "id" | "createdAt" | "updatedAt">` shapes the
store's `create` expects.

### Import modal — four steps (`ImportCsvModal`)

1. **Pick file** → read as text → `parseCsv`.
2. **Auto-guess** → `guessMapping(headers)`.
3. **Confirm mapping** → preview table: first ~5 rows, each column headed by a `Select`
   of the 9 fields + "Ignore", pre-set to the guess and editable. Shows total row count.
4. **Import** → `rowsToTargets` (→ `targets`, `blankSkipped`) →
   `dedupeTargets(targets, current store targets)` (→ `toAdd`, `duplicates`) →
   `store.create("targets", …)` for each record in `toAdd`. Closes with a summary:
   *"Imported {toAdd.length} · skipped {duplicates} duplicates · {blankSkipped} blank
   rows ignored."*

## 3. Targets page & promote

New file `src/app/targets/page.tsx`; new nav item **Targets** (icon `Target`,
**Pipeline** group, placed near Leads in `nav.ts`).

- **Header:** title + **Import CSV** button (opens the modal) + a search/filter input.
- **Filter:** `searchTargets(targets, query)` — case-insensitive substring match across
  company, contactName, contactRole, email, industry, location, notes.
- **Table:** company · contact · role · email · industry · location, with per-row
  **Promote** and **Delete** (trash icon). A **Clear all** action in the header,
  confirm-gated via the existing `ConfirmDialog`.
- **Promote** (per row): `store.create("leads", targetToLead(target, settings.founderName))`
  then `store.remove("targets", target.id)`.
- **EmptyState** when there are no targets → CTA opens Import CSV.

## 4. Error handling & edge cases

- **Non-CSV / unparseable file:** `parseCsv` on a file with no parseable header row
  yields empty headers → the modal shows "Couldn't read any columns from that file"
  and stays on step 1.
- **Empty file / zero data rows:** import is disabled; message "No rows to import."
- **All columns ignored:** import disabled until at least one column maps to a field.
- **Duplicate columns mapped to one field:** first wins (see `guessMapping`); user can
  override in the confirm step.
- **Large files:** parsing and insert are synchronous client-side; acceptable for the
  expected scale (hundreds–low thousands). No streaming.
- **Promote with sparse target:** missing fields just default/blank on the Lead.

## 5. Testing (vitest)

Pure logic tested; UI (page, modal) untested per the app's convention:

- `parseCsv`: simple rows; quoted fields with embedded commas and newlines; escaped
  `""`; CRLF vs LF; ragged rows padded/truncated.
- `guessMapping`: common header variants map correctly; unknown headers → "ignore";
  duplicate target mappings collapse to first-wins.
- `rowsToTargets`: mapping applied and trimmed; unmapped fields blank; blank rows
  (no company and no contactName) skipped with an accurate count.
- `dedupeTargets`: drops email/linkedinUrl matches against existing and intra-file;
  empty email/linkedinUrl never triggers a false dedupe.
- `targetToLead`: every target field carries over; defaults correct; source derives
  from presence of linkedinUrl.

## Out of scope (YAGNI)

- LinkedIn integration of any kind (API, third-party automation, browser extension).
- Adding targets to global search or the advisor snapshot.
- Re-export, bulk-edit, column persistence/saved mappings, dedupe by fuzzy name.
- Editing a target in place beyond delete/promote (edit it after promoting to a Lead).
