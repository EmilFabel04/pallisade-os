"use client";

import { useLayoutEffect, useRef, useState } from "react";

/** A minimal, dependency-free SVG sparkline: one polyline, no axes/tooltip. */
export function Sparkline({
  data,
  color = "var(--color-accent)",
  height = 34,
}: {
  data: number[];
  color?: string;
  height?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setW(entries[0].contentRect.width));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const pad = 2;
  const innerW = Math.max(0, w - pad * 2);
  const innerH = height - pad * 2;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const x = (i: number) =>
    data.length <= 1 ? pad + innerW / 2 : pad + (i / (data.length - 1)) * innerW;
  const y = (v: number) => pad + innerH - ((v - min) / range) * innerH;
  const path = data
    .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");

  return (
    <div ref={wrapRef} className="w-full" style={{ height }}>
      {w > 0 && data.length > 0 && (
        <svg width={w} height={height} className="block">
          {data.length === 1 ? (
            <line
              x1={pad}
              x2={w - pad}
              y1={y(data[0])}
              y2={y(data[0])}
              stroke={color}
              strokeWidth={1.5}
              strokeLinecap="round"
              opacity={0.7}
            />
          ) : (
            <path
              d={path}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
        </svg>
      )}
    </div>
  );
}
