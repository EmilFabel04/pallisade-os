"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Newspaper, RefreshCw, Settings2, Loader2, Bookmark } from "lucide-react";
import { useStore, useNewsFeed, useNewsInterests, useNewsBookmarks } from "@/lib/store";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";
import { Markdown } from "@/components/advisor/Markdown";
import { NewsCard } from "@/components/news/NewsCard";
import { NewsInterestsModal } from "@/components/news/NewsInterestsModal";
import { getNewsStatus, refreshNews } from "@/lib/newsClient";
import { DEFAULT_NEWS_INTERESTS, CATEGORY_ORDER, CATEGORY_LABELS } from "@/lib/news/defaults";
import type { NewsInterests, NewsItem } from "@/lib/types";
import { timeAgo, uid, nowISO } from "@/lib/utils";

const STALE_MS = 6 * 60 * 60 * 1000;

export default function NewsPage() {
  const store = useStore();
  const feed = useNewsFeed();
  const interests = useNewsInterests();
  const bookmarks = useNewsBookmarks();
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [showInterests, setShowInterests] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [autoTried, setAutoTried] = useState(false);

  useEffect(() => { getNewsStatus().then((s) => setConfigured(s.configured)); }, []);

  const seededRef = useRef<NewsInterests | null>(null);

  // Returns the existing interests record, or creates one exactly once.
  // Safe under Strict Mode double-invoke because the ref persists across
  // invocations and across renders until the useNewsInterests() selector catches up.
  const ensureInterests = (): NewsInterests => {
    if (interests) return interests;
    if (seededRef.current) return seededRef.current;
    const created = store.create("newsInterests", { ...DEFAULT_NEWS_INTERESTS }) as NewsInterests;
    seededRef.current = created;
    return created;
  };

  // Seed the interests record once the store is ready so the modal always has a record to edit.
  useEffect(() => {
    if (!store.ready) return;
    ensureInterests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.ready]);

  // Upsert the singleton feed record.
  const saveFeed = (data: { items: NewsItem[]; summary: string; fetchedAt: string; degraded: string[] }) => {
    if (feed) store.update("newsFeed", feed.id, data);
    else store.create("newsFeed", data);
  };

  const refresh = async () => {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const data = await refreshNews(ensureInterests());
      saveFeed(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Auto-refresh once on mount when the cache is missing or older than 6h. Runs even without an API key — the structured feed loads regardless; the AI summary is just skipped.
  useEffect(() => {
    if (!store.ready || autoTried || configured === null) return;
    const stale = !feed || Date.now() - Date.parse(feed.fetchedAt) > STALE_MS;
    if (stale) { setAutoTried(true); void refresh(); }
    else setAutoTried(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.ready, configured, autoTried]);

  const bookmarkedIds = useMemo(() => new Set(bookmarks.map((b) => b.item.id)), [bookmarks]);

  const toggleBookmark = (item: NewsItem) => {
    const existing = bookmarks.find((b) => b.item.id === item.id);
    if (existing) store.remove("newsBookmarks", existing.id);
    else store.create("newsBookmarks", { item });
  };

  const discussInBrain = (item: NewsItem) => {
    const seed = `Let's dig into this and brainstorm what it means for me / what I could build:\n\n**${item.title}**\n${item.url}\n${item.snippet ?? ""}`;
    const thread = store.create("brainThreads", {
      title: item.title.slice(0, 48),
      // Both, for the same reason brain/page.tsx writes both: agentId is what
      // the Brain reopens on, mode keeps the row readable after a rollback.
      mode: "brainstorm",
      agentId: "product-brainstorm",
      messages: [{ id: uid("msg"), role: "user", content: seed, createdAt: nowISO() }],
      attachments: [],
    });
    router.push(`/brain?thread=${thread.id}`);
  };

  const visibleItems = showSaved ? bookmarks.map((b) => b.item) : feed?.items ?? [];
  const byCategory = useMemo(() => {
    const items = showSaved ? bookmarks.map((b) => b.item) : feed?.items ?? [];
    const map = new Map<string, NewsItem[]>();
    for (const it of items) {
      const arr = map.get(it.category) ?? [];
      arr.push(it);
      map.set(it.category, arr);
    }
    // Sort each bucket by score desc, then recency.
    for (const arr of map.values()) {
      arr.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
    }
    return map;
  }, [showSaved, bookmarks, feed]);

  const hasAnything = visibleItems.length > 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="News"
        subtitle={feed ? `Updated ${timeAgo(feed.fetchedAt)}` : "Your personalized feed — GitHub, AI, SA finance, products, Reddit & X."}
        actions={
          <>
            <button
              className={`btn ${showSaved ? "btn-accent" : ""}`}
              onClick={() => setShowSaved((s) => !s)}
              title="Saved items"
            >
              <Bookmark size={15} /> Saved{bookmarks.length ? ` (${bookmarks.length})` : ""}
            </button>
            <button className="btn btn-ghost btn-icon" onClick={() => setShowInterests(true)} title="News interests">
              <Settings2 size={16} />
            </button>
            <button className="btn btn-accent" onClick={() => void refresh()} disabled={loading}>
              {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              Refresh
            </button>
          </>
        }
      />

      {configured === false && (
        <Panel>
          <p className="text-[0.84rem] text-[var(--color-muted)] leading-relaxed p-1">
            No <code>ANTHROPIC_API_KEY</code> — showing the raw feed without the AI summary. Add the key to{" "}
            <code>.env.local</code> and restart for top picks and relevance blurbs.
          </p>
        </Panel>
      )}

      {error && <p className="text-[0.8rem] text-[var(--color-accent)]">{error}</p>}

      {feed?.degraded?.length ? (
        <p className="text-[0.76rem] text-[var(--color-dim)]">Couldn't load: {feed.degraded.join(", ")}.</p>
      ) : null}

      {!showSaved && feed?.summary && (
        <Panel title="Top Picks">
          <Markdown>{feed.summary}</Markdown>
        </Panel>
      )}

      {!hasAnything ? (
        <Panel>
          <EmptyState
            icon={showSaved ? Bookmark : Newspaper}
            title={showSaved ? "No saved items yet" : "No news yet"}
            message={showSaved ? "Bookmark items from the feed and they'll show up here." : "Hit Refresh to pull the latest relevant news."}
            action={
              !showSaved ? (
                <button className="btn btn-accent" onClick={() => void refresh()} disabled={loading}>
                  {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Refresh
                </button>
              ) : undefined
            }
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          {CATEGORY_ORDER.filter((c) => (byCategory.get(c)?.length ?? 0) > 0).map((c) => (
            <Panel key={c} title={CATEGORY_LABELS[c]}>
              <div className="flex flex-col gap-2.5">
                {byCategory.get(c)!.map((item) => (
                  <NewsCard
                    key={item.id}
                    item={item}
                    bookmarked={bookmarkedIds.has(item.id)}
                    onBookmark={toggleBookmark}
                    onDiscuss={discussInBrain}
                  />
                ))}
              </div>
            </Panel>
          ))}
        </div>
      )}

      {interests && (
        <NewsInterestsModal
          open={showInterests}
          interests={interests}
          onClose={() => setShowInterests(false)}
          onSave={(patch) => store.update("newsInterests", interests.id, patch)}
        />
      )}
    </div>
  );
}
