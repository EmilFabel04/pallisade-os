/**
 * Keyword search over chat threads (Sales Advisor, Brain, Content Studio).
 *
 * Generic over the minimal shape so it never imports the page-specific thread
 * types — `Conversation`, `ContentThread` and `BrainThread` all satisfy it.
 */

export interface SearchableThread {
  title: string;
  messages: { content: string }[];
}

export interface ThreadSearchResult<T> {
  thread: T;
  /** How many messages contain at least one term. Title-only hits count 0. */
  matchCount: number;
}

/** Lowercased, whitespace-split query terms. Empty for a blank query. */
function terms(query: string): string[] {
  const q = query.trim().toLowerCase();
  return q ? q.split(/\s+/) : [];
}

/**
 * Filter `threads` to those where *every* term appears in the title or in some
 * message. Terms may be satisfied by different messages. Input order is kept —
 * callers already sort newest-first.
 */
export function searchThreads<T extends SearchableThread>(
  threads: T[],
  query: string,
): ThreadSearchResult<T>[] {
  const words = terms(query);
  if (words.length === 0) return threads.map((thread) => ({ thread, matchCount: 0 }));

  const results: ThreadSearchResult<T>[] = [];
  for (const thread of threads) {
    const title = thread.title.toLowerCase();
    const contents = thread.messages.map((m) => m.content.toLowerCase());

    const qualifies = words.every(
      (w) => title.includes(w) || contents.some((c) => c.includes(w)),
    );
    if (!qualifies) continue;

    const matchCount = contents.filter((c) => words.some((w) => c.includes(w))).length;
    results.push({ thread, matchCount });
  }
  return results;
}
