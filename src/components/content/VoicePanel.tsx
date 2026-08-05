"use client";

import { useState } from "react";
import { Plus, Trash2, RefreshCw, Loader2 } from "lucide-react";
import { useStore, useVoiceSamples, useVoiceProfile } from "@/lib/store";
import { Panel } from "@/components/ui/Panel";
import { profileFromSamples } from "@/lib/content/voice";
import { nowISO } from "@/lib/utils";
import type { VoiceProfile, VoiceSample, VoiceSource } from "@/lib/types";

const SOURCES: { value: VoiceSource; label: string }[] = [
  { value: "linkedin", label: "LinkedIn post" },
  { value: "email", label: "Email" },
  { value: "voice-note", label: "Voice note" },
  { value: "other", label: "Other" },
];

/** The daily run refuses to start below this, so the panel says so up front. */
export const MIN_SAMPLES = 3;

export default function VoicePanel() {
  const store = useStore();
  const samples = useVoiceSamples();
  const profile = useVoiceProfile();
  const [text, setText] = useState("");
  const [source, setSource] = useState<VoiceSource>("linkedin");
  const [rebuilding, setRebuilding] = useState(false);

  const add = () => {
    const body = text.trim();
    if (!body) return;
    store.create("voiceSamples", { text: body, source } as Omit<
      VoiceSample, "id" | "createdAt" | "updatedAt"
    >);
    setText("");
  };

  const rebuild = async () => {
    setRebuilding(true);
    const texts = samples.map((s) => s.text);
    // Measured locally and saved whatever happens to the network. The numeric
    // half of the profile is the part the gate depends on, so it must never be
    // hostage to an API call.
    const stats = profileFromSamples(texts);

    let fingerprint = profile?.fingerprint ?? "";
    let neverSay = profile?.neverSay ?? [];
    try {
      const res = await fetch("/api/content/fingerprint", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ samples: texts }),
      });
      if (res.ok) {
        const data = (await res.json()) as { fingerprint: string; neverSay: string[] };
        fingerprint = data.fingerprint;
        // Union, not replace — keeps anything the founder added by killing a post.
        neverSay = [...new Set([...neverSay, ...data.neverSay])].slice(-60);
      }
    } catch {
      /* the measured stats below still save */
    }

    const patch = {
      stats,
      sampleCount: samples.length,
      computedAt: nowISO(),
      fingerprint,
      neverSay,
    };
    if (profile) store.update("voiceProfile", profile.id, patch);
    else store.create("voiceProfile", patch as Omit<VoiceProfile, "id" | "createdAt" | "updatedAt">);
    setRebuilding(false);
  };

  const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
  const preview = (s: string) => (s.length > 40 ? `${s.slice(0, 40)}…` : s);

  const shortBy = MIN_SAMPLES - samples.length;

  return (
    <Panel title="Voice">
      <div className="flex flex-col gap-1.5">
        {samples.map((s) => (
          <div key={s.id} className="flex items-center gap-1.5 text-[0.8rem]">
            <span className="truncate flex-1 text-[var(--color-muted)]" title={s.text}>
              {preview(s.text)}
            </span>
            <span className="text-[0.7rem] text-[var(--color-dim)]">{wordCount(s.text)}w</span>
            <button
              className="btn btn-sm"
              title="Delete sample"
              onClick={() => store.remove("voiceSamples", s.id)}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}

        {shortBy > 0 && (
          <p className="text-[0.75rem] text-[var(--color-dim)]">
            {shortBy} more sample{shortBy === 1 ? "" : "s"} needed before the daily
            engine will run. Paste anything you wrote — posts, emails, rough notes.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 mt-3 pt-3 border-t border-[var(--color-line)]">
        <textarea
          className="textarea"
          rows={4}
          placeholder="Paste something you wrote…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex gap-2">
          <select
            className="input flex-1"
            value={source}
            onChange={(e) => setSource(e.target.value as VoiceSource)}
          >
            {SOURCES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <button className="btn btn-accent btn-sm" onClick={add} disabled={!text.trim()}>
            <Plus size={13} /> Add
          </button>
        </div>
      </div>

      {profile && (
        <div className="mt-3 pt-3 border-t border-[var(--color-line)] text-[0.75rem] text-[var(--color-muted)] space-y-0.5">
          <div>Rhythm (burstiness): {profile.stats.burstiness.toFixed(2)}</div>
          <div>Avg sentence: {profile.stats.avgSentenceLength.toFixed(1)} words</div>
          <div>Short sentences: {(profile.stats.shortSentenceRatio * 100).toFixed(0)}%</div>
          <div className="text-[var(--color-dim)]">
            From {profile.sampleCount} sample{profile.sampleCount === 1 ? "" : "s"}
          </div>
        </div>
      )}

      <button
        className="btn btn-sm w-full justify-start mt-3"
        onClick={() => void rebuild()}
        disabled={samples.length === 0 || rebuilding}
      >
        {rebuilding ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}{" "}
        Rebuild fingerprint
      </button>
    </Panel>
  );
}
