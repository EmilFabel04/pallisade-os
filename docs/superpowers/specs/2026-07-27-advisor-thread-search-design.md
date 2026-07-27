# Sales Advisor — Thread Keyword Search — Design

**Date:** 2026-07-27
**Status:** Approved

## Goal

Let the founder find an old conversation by keyword instead of scrolling the thread
list. Typing in a search box above the Conversations list filters it to threads whose
title or message text contains the keywords, with a count of matching messages per
thread.

## Decisions (locked)

1. **Result shape:** a filtered thread list, not a snippet/results view. Rows stay
   clickable exactly as today; only the set of visible rows changes.
2. **Scope:** all three pages that render `ThreadList` — Sales Advisor, Brain, and
   Content Studio. It is one shared component; gating it to the advisor would mean an
   extra prop and three inconsistent panels.
3. **Matching:** all-words-anywhere. Case-insensitive substring, terms split on
   whitespace, terms need not co-occur in a single message.
4. **Time range:** all threads, no age cutoff. The list is already sorted newest-first
   so recent threads surface at the top naturally.
5. **No backend work.** Conversations are already fully loaded in the client store, so
   search is a pure client-side filter. No API route, no store change, no type change.

## Module — `src/lib/advisor/searchThreads.ts`

Pure and generic over the minimal thread shape, so it does not import
`Conversation` / `ContentThread` / `BrainThread`:

```ts
export interface SearchableThread {
  title: string;
  messages: { content: string }[];
}

export interface ThreadSearchResult<T> {
  thread: T;
  matchCount: number;
}

export function searchThreads<T extends SearchableThread>(
  threads: T[],
  query: string,
): ThreadSearchResult<T>[];
```

Semantics:

- **Terms:** `query.toLowerCase().trim().split(/\s+/)`, empty strings dropped.
- **Empty query** (empty or whitespace-only): return every thread in input order with
  `matchCount: 0`. Callers render this identically to today's unfiltered list.
- **Qualifies:** a thread is included when *every* term appears as a substring of its
  title or of at least one message's content. Different terms may be satisfied by
  different messages.
- **`matchCount`:** the number of **messages** containing at least one term. It counts
  messages, not occurrences — a message containing a term three times counts once.
  Title hits do not contribute.
- **Order:** input order is preserved; search does not re-rank. The caller already
  sorts newest-first.

A thread can therefore qualify with `matchCount: 0` when it matched on title alone.
The UI renders that case as "title match" rather than "0 matches".

## UI — `src/components/advisor/ThreadList.tsx`

- Local `query` state inside the component. No prop or callback added to the public
  signature, so `advisor`, `brain`, and `content` pages are untouched.
- A search input above the "New conversation" button, using the existing
  icon-inside-input pattern from `src/app/leads/page.tsx:103` (a `Search` icon absolutely
  positioned left, `className="input"` with left padding).
- The input is hidden entirely when there are no threads at all — nothing to search.
- Each row gains a small sub-line: `"3 matches"` / `"1 match"` / `"title match"`. The
  sub-line is rendered only while a query is active.
- Escape clears the query.
- When a query matches nothing: "No threads match “…”." replaces the rows. The existing
  "No conversations yet." empty state is kept for the genuinely-empty case.
- Search never touches `activeId`. Filtering the list while a thread is open leaves that
  thread open in the reading pane, so searching does not lose your place.

## Testing — `src/lib/advisor/searchThreads.test.ts`

Vitest, colocated, matching existing `src/lib/advisor/*.test.ts` convention:

- empty and whitespace-only query return all threads with `matchCount: 0`
- single term matching a title only → included, `matchCount: 0`
- single term matching message content → included with the right count
- multi-term AND satisfied across two *different* messages → included
- multi-term where one term is absent → excluded
- case-insensitivity in both directions (upper-case query, upper-case content)
- `matchCount` counts messages, not occurrences
- input order preserved

## Files

| Action | Path |
|---|---|
| new | `src/lib/advisor/searchThreads.ts` |
| new | `src/lib/advisor/searchThreads.test.ts` |
| edit | `src/components/advisor/ThreadList.tsx` |

No changes to `src/lib/types.ts`, the store, or any API route.

## Out of scope

- Snippet/preview results with highlighted keywords.
- Searching across record types (leads, tasks, interactions) from one box.
- Fuzzy matching, stemming, or relevance ranking.
- Persisting the query across navigation.
