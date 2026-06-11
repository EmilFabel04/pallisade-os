"use client";

import { useLayoutEffect, useRef, useState } from "react";

export interface TrendPoint {
  label: string;
  value: number;
}

export function TrendChart({
  data,
  type = "line",
  color = "#e5484d",
  height = 160,
  formatValue = (v: number) => String(v),
}: {
  data: TrendPoint[];
  type?: "line" | "bar";
  color?: string;
  height?: number;
  formatValue?: (v: number) => string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setW(entries[0].contentRect.width);
    });
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const padX = 6;
  const padTop = 12;
  const padBottom = 18;
  const innerW = Math.max(0, w - padX * 2);
  const innerH = height - padTop - padBottom;

  const max = Math.max(1, ...data.map((d) => d.value));
  const min = 0;
  const range = max - min || 1;

  const x = (i: number) =>
    data.length <= 1 ? padX + innerW / 2 : padX + (i / (data.length - 1)) * innerW;
  const y = (v: number) => padTop + innerH - ((v - min) / range) * innerH;

  const linePath = data
    .map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`)
    .join(" ");
  const areaPath =
    data.length > 0
      ? `${linePath} L${x(data.length - 1).toFixed(1)},${(padTop + innerH).toFixed(1)} L${x(0).toFixed(1)},${(padTop + innerH).toFixed(1)} Z`
      : "";

  const gid = `grad-${color.replace("#", "")}`;
  const barW = data.length ? Math.min(22, (innerW / data.length) * 0.62) : 0;

  const hovered = hover != null ? data[hover] : null;

  return (
    <div ref={wrapRef} className="relative w-full select-none" style={{ height }}>
      {w > 0 && (
        <svg
          width={w}
          height={height}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const mx = e.clientX - rect.left;
            let nearest = 0;
            let best = Infinity;
            for (let i = 0; i < data.length; i++) {
              const d = Math.abs(x(i) - mx);
              if (d < best) {
                best = d;
                nearest = i;
              }
            }
            setHover(nearest);
          }}
        >
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>

          {/* gridlines */}
          {[0.25, 0.5, 0.75, 1].map((g) => (
            <line
              key={g}
              x1={padX}
              x2={w - padX}
              y1={padTop + innerH * g}
              y2={padTop + innerH * g}
              stroke="var(--color-line)"
              strokeWidth={1}
            />
          ))}

          {type === "line" ? (
            <>
              <path d={areaPath} fill={`url(#${gid})`} />
              <path
                d={linePath}
                fill="none"
                stroke={color}
                strokeWidth={1.75}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {data.map((d, i) => (
                <circle
                  key={i}
                  cx={x(i)}
                  cy={y(d.value)}
                  r={hover === i ? 3.5 : 0}
                  fill={color}
                  stroke="var(--color-surface)"
                  strokeWidth={1.5}
                />
              ))}
            </>
          ) : (
            data.map((d, i) => {
              const bh = ((d.value - min) / range) * innerH;
              return (
                <rect
                  key={i}
                  x={x(i) - barW / 2}
                  y={padTop + innerH - bh}
                  width={barW}
                  height={Math.max(0, bh)}
                  rx={2}
                  fill={color}
                  opacity={hover == null || hover === i ? 0.85 : 0.4}
                />
              );
            })
          )}

          {/* hover guide */}
          {hover != null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={padTop}
              y2={padTop + innerH}
              stroke="var(--color-line-strong)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}

          {/* end labels */}
          {data.length > 0 && (
            <>
              <text x={padX} y={height - 4} fontSize={9.5} fill="var(--color-dim)" fontFamily="var(--font-mono)">
                {data[0].label}
              </text>
              <text
                x={w - padX}
                y={height - 4}
                fontSize={9.5}
                fill="var(--color-dim)"
                textAnchor="end"
                fontFamily="var(--font-mono)"
              >
                {data[data.length - 1].label}
              </text>
            </>
          )}
        </svg>
      )}

      {hovered && hover != null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border px-2 py-1 text-center"
          style={{
            left: Math.min(Math.max(x(hover), 40), w - 40),
            top: 0,
            background: "var(--color-surface-3)",
            borderColor: "var(--color-line-strong)",
          }}
        >
          <div className="text-[0.6rem] uppercase tracking-wider text-[var(--color-dim)]">
            {hovered.label}
          </div>
          <div className="tnum text-[0.82rem] font-semibold text-[var(--color-ink)]">
            {formatValue(hovered.value)}
          </div>
        </div>
      )}
    </div>
  );
}
