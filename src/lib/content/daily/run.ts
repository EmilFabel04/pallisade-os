/* The orchestrator. Dependency-injected so it is testable without a network. */

import type Anthropic from "@anthropic-ai/sdk";
import type { DataShape } from "@/lib/types";
import { uid, nowISO } from "@/lib/utils";
import { profileFromSamples } from "@/lib/content/voice";
import { buildLedger } from "./harvest";
import { buildMemory, SOURCE_WINDOW_DAYS } from "./rotation";
// firstLine, NOT splitSentences — see the producer/consumer note on openingLine.
import { runGate, firstLine } from "./gate";
import type { chooseBriefs as ChooseBriefs } from "./brief";
import type { draftPost as DraftPost, DraftInput } from "./draft";
import type { revisePost as RevisePost } from "./revise";
import type { ContentPost, ContentRun, EditorialCheck, MaterialItem, PostBrief } from "./types";

export const MAX_REVISIONS = 2;
export const MIN_VOICE_SAMPLES = 3;
/** Spec cap. Applied on read here rather than pruned at write time. */
export const NEVER_SAY_CAP = 60;

/**
 * Failures that mean "the founder has not finished setting this up", as
 * opposed to a model or database failure. They are worth telling apart: the
 * fix is a two-minute action in the Voice panel, and reporting them as a
 * generic upstream failure leaves the founder with nothing to act on.
 * Every message under these codes is authored here, never an upstream
 * error string, so it is safe to hand back to the client verbatim.
 */
export const PRECONDITION_CODES = ["voice_samples", "positioning"] as const;
export type PreconditionCode = (typeof PRECONDITION_CODES)[number];

/** The precondition code an error carries, or null if it is a real failure. */
export function preconditionCode(message: string): PreconditionCode | null {
  return PRECONDITION_CODES.find((c) => message.startsWith(`${c}:`)) ?? null;
}

export interface RunDeps {
  data: DataShape;
  today: string;
  client: Anthropic;
  chooseBriefs: typeof ChooseBriefs;
  draftPost: typeof DraftPost;
  revisePost: typeof RevisePost;
  loadRecentPosts: (days: number, today: string) => Promise<ContentPost[]>;
  persist: (posts: ContentPost[], run: ContentRun) => Promise<void>;
}

function sourceTextsFor(brief: PostBrief, ledger: MaterialItem[]): string[] {
  return brief.sourceRefs
    .map((ref) => ledger.find((i) => i.collection === ref.collection && i.id === ref.id)?.text)
    .filter((t): t is string => Boolean(t));
}

/** Killed bodies and edit pairs, harvested from history for the draft prompt. */
function feedbackFrom(posts: ContentPost[], pillar: string) {
  const killedExamples = posts
    .filter((p) => p.status === "killed" && p.pillar === pillar && p.body)
    .slice(0, 3)
    .map((p) => ({ body: p.body, reason: p.killReason ?? "killed" }));

  const editPairs = posts
    .filter((p) => p.editedBody && p.editedBody !== p.body)
    .slice(0, 3)
    .map((p) => ({ before: p.body, after: p.editedBody as string }));

  return { killedExamples, editPairs };
}

export async function runDaily(
  deps: RunDeps,
): Promise<{ run: ContentRun; posts: ContentPost[] }> {
  const { data, today, client } = deps;

  const run: ContentRun = {
    id: uid("run"),
    date: today,
    status: "ok",
    ledgerSize: 0,
    reachback: false,
    usedNews: false,
    degraded: [],
    error: null,
    startedAt: nowISO(),
    finishedAt: null,
  };

  try {
    const samples = (data.voiceSamples ?? []).map((s) => s.text).filter(Boolean);
    if (samples.length < MIN_VOICE_SAMPLES) {
      throw new Error(
        `voice_samples: need ${MIN_VOICE_SAMPLES} writing samples, have ${samples.length}`,
      );
    }

    const positioning = data.positioningProfiles?.[0]?.body;
    if (!positioning) throw new Error("positioning: no positioning profile saved");

    const stored = data.voiceProfile?.[0] ?? null;
    const stats = stored?.stats ?? profileFromSamples(samples);
    const fingerprint = stored?.fingerprint ?? "";
    const neverSay = (stored?.neverSay ?? []).slice(0, NEVER_SAY_CAP);

    const history = await deps.loadRecentPosts(SOURCE_WINDOW_DAYS, today);
    const { items: ledger, mode } = buildLedger(data, history, today);

    run.ledgerSize = ledger.length;
    run.reachback = mode === "reachback";
    run.usedNews = mode === "news";
    if (mode !== "fresh") {
      run.status = "thin";
      run.degraded.push(
        mode === "reachback"
          ? "no fresh material — reached back to older logged records"
          : "no logged material at all — built from the news feed",
      );
    }

    const memory = buildMemory(history, today);
    const briefs = await deps.chooseBriefs(
      client,
      { ledger, memory, positioning, fingerprint, today },
      memory,
    );

    const posts: ContentPost[] = [];

    for (const brief of briefs) {
      const sourceTexts = sourceTextsFor(brief, ledger);
      const { killedExamples, editPairs } = feedbackFrom(history, brief.pillar);

      const draftInput: DraftInput = {
        brief, sourceTexts, positioning, fingerprint, stats,
        samples: samples.slice(0, 3), killedExamples, editPairs, neverSay,
      };

      let body = await deps.draftPost(client, draftInput);
      let checks: EditorialCheck[] = [];
      let revisions = 0;

      for (;;) {
        checks = runGate({
          body, sourceRefs: brief.sourceRefs, sourceTexts,
          profile: stats, neverSay, recentOpeners: memory.recentOpeners,
        });
        const failures = checks.filter((c) => !c.passed);
        if (failures.length === 0 || revisions >= MAX_REVISIONS) break;

        revisions += 1;
        body = await deps.revisePost(client, { ...draftInput, body, failures });
      }

      const stillFailing = checks.some((c) => !c.passed);
      posts.push({
        id: uid("post"),
        date: today,
        slot: brief.slot,
        pillar: brief.pillar,
        format: brief.format,
        sourceRefs: brief.sourceRefs,
        claim: brief.claim,
        body,
        // MUST be firstLine(body), never splitSentences(body)[0]. This is the
        // only producer of openingLine; gate.ts's checkOpener and rotation.ts's
        // buildMemory are the consumers and both reason about the whole first
        // LINE. Writing only the first sentence means a post whose opening line
        // holds two sentences never collides with its own stored opener, and
        // the repetition guard passes while comparing nothing.
        openingLine: firstLine(body),
        checks,
        revisions,
        status: stillFailing ? "needs_work" : "draft",
        killReason: null,
        editedBody: null,
        createdAt: nowISO(),
        updatedAt: nowISO(),
      });
    }

    run.finishedAt = nowISO();
    await deps.persist(posts, run);
    return { run, posts };
  } catch (err) {
    run.status = "failed";
    run.error = (err as Error).message;
    run.finishedAt = nowISO();
    await deps.persist([], run);
    throw err;
  }
}
