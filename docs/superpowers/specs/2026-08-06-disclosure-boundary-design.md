# The disclosure boundary

**Date:** 2026-08-06
**Status:** approved

## Problem

The daily content engine has exactly one safety axis: *is this true and traceable*.
`checkSpecificity` in `gate.ts` fails a post that invents a client detail. Nothing
anywhere asks the other question — *may this be published at all*.

Every stage is tuned to maximise specificity about real, logged material, and that
material is the founder's private CRM. So the better the engine works, the more it
exposes him. Three concrete leaks:

1. `harvest.ts` feeds `interactions.rawNotes` and `whatTheySaid` — raw private call
   notes and verbatim client quotes — into the ledger, on records that also carry
   `company` and `contact`.
2. `scoreItem`'s `CHARGED` regex adds +12 to material matching
   `broke|failed|wasted|lost|stuck|embarrass|missed|late`, ranking his worst days
   highest.
3. `metricEntries` emits lines like `MRR moved to 0 against a recent average of 0`,
   publishing his commercial stage directly.

A *real* company name is the sharpest case: it traces perfectly against the source
record, so `checkSpecificity` passes it. The existing `isCompanyAnchor` high-risk
rule only fires on *untraced* names, because it was built to catch fabrication.

## Decisions

- **Client material:** usable, never attributable. No verbatim quotes, company
  names or contact names. Pain generalised to industry/role level.
- **Numbers:** nothing that measures *his* business — the whole `metricEntries`
  collection, revenue, pipeline, dials, emails, leads, meetings, and stage language
  ("pre-revenue", "first client"). A client's own operational figure ("14 hours a
  month") stays publishable, because the gate requires a traceable anchor and
  banning every digit would push most posts to `needs_work`.
- **Vulnerability:** struggle material is publishable only from the far side of it —
  problem plus fix, told as expertise. Never open or unresolved.

## Design

Enforced at two points. Harvest-only cannot catch what the model infers or
rephrases; gate-only would still ship private notes to the API inside every prompt.

### 1. Harvest (`harvest.ts`)

The ledger is the single funnel feeding the brief prompt, the source texts and the
draft, so one filter here protects every downstream stage.

| Collection | Change |
|---|---|
| `interactions` | drop `rawNotes`, `whatTheySaid`; keep `painPoints`, `objections`, `buyingSignals` |
| `scorecards` | drop `problems`, `avoidTomorrow`; keep `wins`, `lessons` |
| `projects` | drop `currentBlocker` |
| `metricEntries` | removed from `collectCandidates` entirely |
| `milestones` | kept — completed work is resolved authority |

`scoreItem` loses the `CHARGED` term.

### 2. Redaction (`redact.ts`, new, pure)

`buildVocabulary(data)` collects every company and person name from the founder's
own records (`leads.company`, `leads.contactName`, `interactions.company`,
`interactions.contact`, `projects.company`). `redactText` scrubs those exact strings
from each `MaterialItem.text`.

Applied inside `collectCandidates`, **before** `extractAnchors` runs — otherwise the
anchor list carries the name the text no longer does.

### 3. Disclosure gate (`disclosure.ts`, 7th check in `runGate`)

Fails a finished post carrying:

- **identity** — any company or contact name from his records (closes the
  traced-name hole above)
- **business metrics / stage** — revenue, MRR, pipeline, dials, meetings,
  "pre-revenue", "first client", "still building"
- **unresolved struggle** — "I'm stuck", "I don't know", "struggling"

Returns the standard `EditorialCheck`, so it flows into the existing revise loop and
marks a still-disclosing post `needs_work` with no new machinery. `GateInput` gains
an `identities: string[]` field, supplied by `run.ts` from the same vocabulary.

### 4. Prompt-side (`craft.ts`, `draft.ts`, `brief.ts`)

State the boundary up front rather than only correcting after: a disclosure clause
in the constitution, `lesson` and `build-log` in `PILLAR_META` reworded to demand
resolution, and the same rule in the brief prompt so Stage 1 never *chooses* an
exposing angle.

## Testing

Harvest exclusions; redaction (a name in the data never survives into ledger text
or anchors); each disclosure category, plus a legitimate client-pain post still
passing; and an end-to-end `run.ts` test that a post naming a company comes back
`needs_work`.

## Accepted consequence

Dropping six fields and a collection thins the ledger. Light days will hit
`reachback` mode more often. Accepted as the right trade.
