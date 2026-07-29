"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Milestone } from "@/lib/types";
import {
  ganttRange, rangeDays, barGeometry, dependencyEdges, type GanttRange,
} from "@/lib/projects/schedule";
import { milestoneStatusTone, TONE_STYLE } from "@/lib/badges";
import { addDaysISO, daysBetween, fmtDate, todayISO } from "@/lib/utils";

const ROW_H = 34;
const LABEL_W = 168;

export interface GanttGroup {
  key: string;
  label?: string;
  milestones: Milestone[];
}

export function GanttChart({
  groups,
  onSelect,
}: {
  groups: GanttGroup[];
  onSelect?: (m: Milestone) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);

  // Width comes from a ResizeObserver, matching TrendChart.tsx.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setW(entries[0].contentRect.width));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const all = useMemo(() => groups.flatMap((g) => g.milestones), [groups]);
  const range = useMemo(() => ganttRange(all), [all]);

  if (!range)
    return (
      <p className="text-[0.8rem] text-[var(--color-muted)]">
        No dated milestones yet — add start and end dates to see the timeline.
      </p>
    );

  const barsW = Math.max(0, w - LABEL_W);
  const ticks = weekTicks(range);
  const total = rangeDays(range);
  const today = todayISO();
  const todayX =
    today >= range.start && today <= range.end
      ? (daysBetween(range.start, today) / total) * barsW
      : null;

  return (
    <div ref={wrapRef} className="w-full overflow-x-auto">
      {/* week ruler */}
      <div className="flex" style={{ paddingLeft: LABEL_W }}>
        <div className="relative h-5 flex-1">
          {ticks.map((t) => (
            <span
              key={t.iso}
              className="absolute top-0 text-[0.66rem] text-[var(--color-dim)] tnum -translate-x-1/2"
              style={{ left: (daysBetween(range.start, t.iso) / total) * barsW }}
            >
              {t.label}
            </span>
          ))}
        </div>
      </div>

      {groups.map((g) => {
        const rows = [...g.milestones].sort((a, b) => a.order - b.order);
        const edges = dependencyEdges(rows, range, barsW, ROW_H);

        return (
          <div key={g.key} className="mb-3 last:mb-0">
            {g.label && <p className="eyebrow mb-1.5">{g.label}</p>}

            <div className="relative">
              {/* dependency connectors — an overlay, so bars stay plain DOM */}
              <svg
                className="pointer-events-none absolute inset-0"
                style={{ left: LABEL_W, width: barsW, height: rows.length * ROW_H }}
              >
                {edges.map((e, i) => (
                  <polyline
                    key={i}
                    points={`${e.x1},${e.y1} ${e.x1 + 8},${e.y1} ${e.x1 + 8},${e.y2} ${e.x2},${e.y2}`}
                    fill="none"
                    stroke="var(--color-line-strong)"
                    strokeWidth={1}
                  />
                ))}
              </svg>

              {/* today marker */}
              {todayX !== null && (
                <div
                  className="pointer-events-none absolute top-0 w-px bg-[var(--color-accent)] opacity-40"
                  style={{ left: LABEL_W + todayX, height: rows.length * ROW_H }}
                />
              )}

              {rows.map((m) => {
                const geo = barGeometry(m, range, barsW);
                const tone = TONE_STYLE[milestoneStatusTone(m.status)];
                return (
                  <div key={m.id} className="flex items-center" style={{ height: ROW_H }}>
                    <span
                      className="shrink-0 truncate pr-3 text-[0.78rem] text-[var(--color-ink-soft)]"
                      style={{ width: LABEL_W }}
                      title={m.name}
                    >
                      {m.name}
                    </span>
                    <div className="relative flex-1 overflow-hidden" style={{ height: ROW_H }}>
                      {geo ? (
                        <button
                          onClick={() => onSelect?.(m)}
                          title={`${m.name} · ${m.status} · ${fmtDate(m.startDate)} → ${fmtDate(m.endDate)}`}
                          className="absolute top-1/2 -translate-y-1/2 rounded-sm border transition-opacity hover:opacity-80"
                          style={{
                            left: geo.x,
                            width: geo.w,
                            height: 16,
                            background: tone.bg,
                            borderColor: tone.border,
                          }}
                        />
                      ) : (
                        <span className="absolute top-1/2 -translate-y-1/2 text-[0.7rem] text-[var(--color-muted)]">
                          no dates
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A label every Monday, thinned so they never collide on a long domain. */
function weekTicks(range: GanttRange): { iso: string; label: string }[] {
  const out: { iso: string; label: string }[] = [];
  const weeks = Math.ceil((daysBetween(range.start, range.end) + 1) / 7);
  const every = weeks > 12 ? 4 : weeks > 6 ? 2 : 1;

  for (let i = 0; i < weeks; i += every) {
    const iso = addDaysISO(range.start, i * 7);
    out.push({
      iso,
      label: new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
      }),
    });
  }
  return out;
}
