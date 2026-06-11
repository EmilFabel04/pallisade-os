import type { Settings } from "./types";

/** Tailwind-friendly className joiner */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function uid(prefix = "rec"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export function nowISO(): string {
  return new Date().toISOString();
}

/** ISO date (no time) for "today" in local tz */
export function todayISO(): string {
  return toDateISO(new Date());
}

export function toDateISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return toDateISO(d);
}

export function daysBetween(fromISO: string, toISO_: string): number {
  const a = new Date(fromISO + "T00:00:00").getTime();
  const b = new Date(toISO_ + "T00:00:00").getTime();
  return Math.round((b - a) / 86400000);
}

export function isToday(iso: string | null): boolean {
  return !!iso && iso.slice(0, 10) === todayISO();
}

export function isPast(iso: string | null): boolean {
  return !!iso && iso.slice(0, 10) < todayISO();
}

export function isOverdue(iso: string | null): boolean {
  return isPast(iso);
}

/** Human date e.g. "10 Jun 2026" */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? iso + "T00:00:00" : iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? iso + "T00:00:00" : iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

/** Relative phrasing for follow-up urgency */
export function relativeDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = daysBetween(todayISO(), iso.slice(0, 10));
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  return `In ${diff}d`;
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return fmtDateShort(iso);
}

const CURRENCY_SYMBOL: Record<Settings["currency"], string> = {
  ZAR: "R",
  USD: "$",
};

export function fmtCurrency(
  value: number,
  currency: Settings["currency"] = "ZAR",
): string {
  const sym = CURRENCY_SYMBOL[currency] ?? "";
  const n = Math.abs(value) >= 1000
    ? value.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return `${sym}${n}`;
}

export function fmtCompact(value: number): string {
  if (Math.abs(value) >= 1_000_000)
    return (value / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (Math.abs(value) >= 1000)
    return (value / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(value);
}

export function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
