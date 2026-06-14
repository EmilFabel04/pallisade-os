"use client";

import { useMemo, useState } from "react";
import { Volume2, Check, RotateCcw, ArrowRight, Trophy } from "lucide-react";
import type { BuiltStage, StageId } from "@/lib/prep/session";
import type { GlossaryCard, OfferingCard, PlaybookCard, PronunciationCard } from "@/lib/types";
import { useSpeak } from "@/lib/voice/useSpeak";

interface QueueItem {
  stageIndex: number;
  card: PlaybookCard;
}

export function SessionRunner({
  stages,
  onGrade,
  onRestart,
}: {
  stages: BuiltStage[];
  /** Called when a recall card is graded; the page persists confidence on the saved playbook. */
  onGrade: (stage: StageId, cardId: string, gotIt: boolean) => void;
  onRestart: () => void;
}) {
  const { supported, speak } = useSpeak();

  // Flatten stages into an ordered queue; missed recall cards get re-appended within their stage.
  const initialQueue = useMemo<QueueItem[]>(
    () => stages.flatMap((s, stageIndex) => s.cards.map((card) => ({ stageIndex, card }))),
    [stages],
  );

  const [queue, setQueue] = useState<QueueItem[]>(initialQueue);
  const [pos, setPos] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const total = initialQueue.length;
  const done = pos >= queue.length;
  const current = queue[pos];
  const stage = current ? stages[current.stageIndex] : null;

  const advance = () => {
    setRevealed(false);
    setPos((p) => p + 1);
  };

  const grade = (gotIt: boolean) => {
    if (!current || !stage) return;
    onGrade(stage.id, current.card.id, gotIt);
    if (!gotIt) {
      // requeue the missed card at the END OF ITS STAGE (before the next stage starts)
      setQueue((q) => {
        const next = [...q];
        let insertAt = next.length;
        for (let i = pos + 1; i < next.length; i++) {
          if (next[i].stageIndex > current.stageIndex) { insertAt = i; break; }
        }
        next.splice(insertAt, 0, { stageIndex: current.stageIndex, card: current.card });
        return next;
      });
    }
    advance();
  };

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-16 px-6">
        <div className="flex items-center justify-center mb-4" style={{ width: 52, height: 52, borderRadius: 12, border: "1px solid var(--color-line-strong)", background: "var(--color-surface-2)" }}>
          <Trophy size={22} className="text-[var(--color-accent)]" strokeWidth={1.5} />
        </div>
        <h3 className="text-[0.95rem] font-semibold text-[var(--color-ink)]">Session complete</h3>
        <p className="text-[0.83rem] text-[var(--color-muted)] mt-1.5 max-w-sm leading-relaxed">
          You worked through {total} card{total === 1 ? "" : "s"}. Missed cards are marked to resurface next time.
        </p>
        <button className="btn btn-accent mt-5" onClick={onRestart}>
          <RotateCcw size={15} /> Run again
        </button>
      </div>
    );
  }

  const stageNumber = (current?.stageIndex ?? 0) + 1;
  // Denominator is the LIVE queue length so requeued misses extend the bar honestly.
  const progress = queue.length ? Math.round((pos / queue.length) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* progress */}
      <div>
        <div className="flex items-center justify-between text-[0.74rem] text-[var(--color-muted)] mb-2">
          <span className="eyebrow">Stage {stageNumber}/{stages.length} · {stage?.title}</span>
          <span className="tnum">{pos + 1} / {queue.length}</span>
        </div>
        <div style={{ height: 6, borderRadius: 99, background: "var(--color-surface-2)", border: "1px solid var(--color-line)" }}>
          <div style={{ height: "100%", width: `${progress}%`, borderRadius: 99, background: "var(--color-accent)", transition: "width .25s ease" }} />
        </div>
      </div>

      {stage?.kind === "pronunciation"
        ? <PronunciationView card={current!.card as PronunciationCard} supported={supported} speak={speak} onNext={advance} />
        : <RecallView card={current!.card} stage={stage!.id} revealed={revealed} onReveal={() => setRevealed(true)} onGrade={grade} />}
    </div>
  );
}

function PronunciationView({
  card, supported, speak, onNext,
}: {
  card: PronunciationCard;
  supported: boolean;
  speak: (t: string) => void;
  onNext: () => void;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] p-6 text-center">
      <div className="text-[1.6rem] font-semibold text-[var(--color-ink)]">{card.term}</div>
      {card.phonetic && <div className="text-[1rem] text-[var(--color-accent)] mt-1">/ {card.phonetic} /</div>}
      {card.tip && <p className="text-[0.84rem] text-[var(--color-muted)] mt-3 max-w-md mx-auto leading-relaxed">{card.tip}</p>}
      <div className="flex items-center justify-center gap-2 mt-5">
        {supported && (
          <button className="btn" onClick={() => speak(card.term)} title="Hear a model pronunciation">
            <Volume2 size={15} /> Hear it
          </button>
        )}
        <button className="btn btn-accent" onClick={onNext}>
          I practiced <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

function RecallView({
  card, stage, revealed, onReveal, onGrade,
}: {
  card: PlaybookCard;
  stage: StageId;
  revealed: boolean;
  onReveal: () => void;
  onGrade: (gotIt: boolean) => void;
}) {
  const isGlossary = stage === "glossary";
  const g = card as GlossaryCard;
  const o = card as OfferingCard;
  const prompt = isGlossary ? g.term : `Pitch the value of "${o.name}" — and handle the objection.`;

  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] p-6">
      <p className="eyebrow mb-2">{isGlossary ? "Define this term" : "Sell this"}</p>
      <div className="text-[1.15rem] font-semibold text-[var(--color-ink)]">{prompt}</div>

      {!revealed ? (
        <button className="btn btn-accent mt-5" onClick={onReveal}>Reveal answer</button>
      ) : (
        <>
          <div className="mt-4 space-y-2 text-[0.86rem] leading-relaxed">
            {isGlossary ? (
              <>
                <p className="text-[var(--color-ink)]">{g.definition || "—"}</p>
                {g.example && <p className="text-[var(--color-muted)] italic">e.g. {g.example}</p>}
              </>
            ) : (
              <>
                {o.summary && <p className="text-[var(--color-ink)]">{o.summary}</p>}
                {o.valueProp && <p className="text-[var(--color-muted)]"><b className="text-[var(--color-ink)]">Value:</b> {o.valueProp}</p>}
                {o.priceAnchor && <p className="text-[var(--color-muted)]"><b className="text-[var(--color-ink)]">Price:</b> {o.priceAnchor}</p>}
                {o.objection && <p className="text-[var(--color-muted)]"><b className="text-[var(--color-ink)]">Objection:</b> {o.objection}</p>}
                {o.response && <p className="text-[var(--color-muted)]"><b className="text-[var(--color-ink)]">Response:</b> {o.response}</p>}
              </>
            )}
          </div>
          <div className="flex items-center gap-2 mt-5 pt-4 border-t border-[var(--color-line)]">
            <button className="btn" onClick={() => onGrade(false)}>
              <RotateCcw size={15} /> Missed it
            </button>
            <button className="btn btn-accent" onClick={() => onGrade(true)}>
              <Check size={15} /> Got it
            </button>
          </div>
        </>
      )}
    </div>
  );
}
