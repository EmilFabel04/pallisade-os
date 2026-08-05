export const PILLARS = [
  "client-pain", "build-log", "contrarian", "proof", "teardown", "lesson",
] as const;
export type ContentPillar = (typeof PILLARS)[number];

export const FORMATS = [
  "scene", "one-idea", "before-after", "claim-defence", "numbers", "short-punch",
] as const;
export type PostFormat = (typeof FORMATS)[number];

export const KILL_REASONS = [
  "boring", "not_my_voice", "not_true", "wrong_angle", "already_said",
] as const;
export type KillReason = (typeof KILL_REASONS)[number];

export interface SourceRef {
  collection: string;
  id: string;
  /** The concrete detail lifted from this record. */
  anchor: string;
}

export interface EditorialCheck {
  rule: string;
  passed: boolean;
  /** Human-readable, specific, actionable. Never "make it better". */
  detail: string;
}

export interface MaterialItem {
  collection: string;
  id: string;
  date: string;
  text: string;
  anchors: string[];
  pillarHints: ContentPillar[];
  score: number;
}

export interface PostBrief {
  slot: 1 | 2;
  sourceRefs: SourceRef[];
  pillar: ContentPillar;
  format: PostFormat;
  /** The single thing this post asserts. Committed before any prose exists. */
  claim: string;
  anchor: string;
  why: string;
}

export type PostStatus = "draft" | "needs_work" | "kept" | "killed" | "posted";

export interface ContentPost {
  id: string;
  date: string;
  slot: 1 | 2;
  pillar: ContentPillar;
  format: PostFormat;
  sourceRefs: SourceRef[];
  claim: string;
  body: string;
  openingLine: string;
  checks: EditorialCheck[];
  revisions: number;
  status: PostStatus;
  killReason: KillReason | null;
  editedBody: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContentRun {
  id: string;
  date: string;
  status: "ok" | "thin" | "failed";
  ledgerSize: number;
  reachback: boolean;
  usedNews: boolean;
  degraded: string[];
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}
