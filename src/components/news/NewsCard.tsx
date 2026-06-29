"use client";

import { Bookmark, BookmarkCheck, MessageSquarePlus, ArrowUpRight } from "lucide-react";
import type { NewsItem } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { categoryTone } from "@/lib/news/defaults";
import { timeAgo } from "@/lib/utils";

export function NewsCard({
  item,
  bookmarked,
  onBookmark,
  onDiscuss,
}: {
  item: NewsItem;
  bookmarked: boolean;
  onBookmark: (item: NewsItem) => void;
  onDiscuss: (item: NewsItem) => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Badge tone={categoryTone(item.category)} dot={false}>{item.source}</Badge>
        {item.publishedAt && (
          <span className="text-[0.7rem] text-[var(--color-dim)]">{timeAgo(item.publishedAt)}</span>
        )}
        {typeof item.score === "number" && item.score > 0 && (
          <span className="text-[0.7rem] text-[var(--color-dim)]">★ {item.score}</span>
        )}
      </div>

      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="text-[0.88rem] font-medium text-[var(--color-ink)] hover:text-[var(--color-accent)] inline-flex items-start gap-1 leading-snug"
      >
        {item.title}
        <ArrowUpRight size={13} className="mt-0.5 shrink-0 text-[var(--color-dim)]" />
      </a>

      {item.snippet && (
        <p className="text-[0.78rem] text-[var(--color-muted)] leading-relaxed line-clamp-2">{item.snippet}</p>
      )}
      {item.whyItMatters && (
        <p className="text-[0.76rem] text-[var(--color-accent)] leading-snug">→ {item.whyItMatters}</p>
      )}

      <div className="flex items-center gap-3 mt-1">
        <button
          onClick={() => onBookmark(item)}
          className="inline-flex items-center gap-1 text-[0.72rem] text-[var(--color-dim)] hover:text-[var(--color-ink)]"
          title={bookmarked ? "Remove bookmark" : "Bookmark"}
        >
          {bookmarked ? <BookmarkCheck size={13} className="text-[var(--color-accent)]" /> : <Bookmark size={13} />}
          {bookmarked ? "Saved" : "Save"}
        </button>
        <button
          onClick={() => onDiscuss(item)}
          className="inline-flex items-center gap-1 text-[0.72rem] text-[var(--color-dim)] hover:text-[var(--color-ink)]"
          title="Discuss in Brain"
        >
          <MessageSquarePlus size={13} /> Discuss in Brain
        </button>
      </div>
    </div>
  );
}
