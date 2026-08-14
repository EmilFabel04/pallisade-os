"use client";

import { useEffect, useState } from "react";
import { Check, RotateCcw, Trash2, Save, Database, Building2, Sparkles, Loader2, Lock, AlertCircle } from "lucide-react";
import { useStore } from "@/lib/store";
import { aiStatus, type AIStatus } from "@/lib/aiClient";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Field, NumberInput, TextArea, TextInput } from "@/components/ui/Field";
import { ConfirmDialog } from "@/components/ui/Modal";
import { AGENT_SURFACES, type AgentCard, type AgentSpec, type AgentSurface } from "@/lib/agents/types";
import type { Settings } from "@/lib/types";

const SURFACE_LABEL: Record<AgentSurface, string> = {
  brain: "Brain",
  advisor: "Advisor",
  project: "Project",
};

type AgentDetail = AgentSpec & { overridden: boolean };

const ACCENT_PRESETS = [
  { name: "Crimson", value: "#e5484d" },
  { name: "Scarlet", value: "#dc2626" },
  { name: "Ember", value: "#f0613a" },
  { name: "Rose", value: "#e93d82" },
  { name: "Amber", value: "#e3a341" },
  { name: "Emerald", value: "#3dd68c" },
];

export default function SettingsPage() {
  const { settings, updateSettings, resetDemo, clearAll } = useStore();
  const [draft, setDraft] = useState<Settings>(settings);
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [ai, setAi] = useState<AIStatus | null>(null);
  const [aiLoading, setAiLoading] = useState(true);

  useEffect(() => {
    aiStatus()
      .then(setAi)
      .finally(() => setAiLoading(false));
  }, []);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setDraft((p) => ({ ...p, [k]: v }));
    if (k === "accentColor") applyAccent(v as string);
  };

  const save = () => {
    updateSettings(draft);
    applyAccent(draft.accentColor);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <PageHeader
        title="Settings"
        subtitle="Configure your business profile, branding and data."
        actions={
          <button className="btn btn-accent" onClick={save}>
            {saved ? <Check size={15} /> : <Save size={15} />} {saved ? "Saved" : "Save changes"}
          </button>
        }
      />

      <Panel title="Business profile">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Business name">
              <TextInput value={draft.businessName} onChange={(e) => set("businessName", e.target.value)} />
            </Field>
            <Field label="Founder name">
              <TextInput value={draft.founderName} onChange={(e) => set("founderName", e.target.value)} />
            </Field>
          </div>
          <Field label="Main market">
            <TextArea value={draft.mainMarket} onChange={(e) => set("mainMarket", e.target.value)} rows={2} />
          </Field>
          <Field label="Services">
            <TextArea value={draft.services} onChange={(e) => set("services", e.target.value)} rows={2} />
          </Field>
        </div>
      </Panel>

      <Panel title="Branding">
        <Field label="Brand accent colour">
          <div className="flex flex-wrap items-center gap-2.5 mt-1">
            {ACCENT_PRESETS.map((a) => (
              <button
                key={a.value}
                onClick={() => set("accentColor", a.value)}
                title={a.name}
                className="relative flex items-center justify-center transition-transform hover:scale-105"
                style={{
                  width: 34, height: 34, borderRadius: 9, background: a.value,
                  outline: draft.accentColor === a.value ? "2px solid var(--color-ink)" : "1px solid var(--color-line-strong)",
                  outlineOffset: 2,
                }}
              >
                {draft.accentColor === a.value && <Check size={16} className="text-white" />}
              </button>
            ))}
            <label className="inline-flex items-center gap-2 ml-1">
              <input
                type="color"
                value={draft.accentColor}
                onChange={(e) => set("accentColor", e.target.value)}
                style={{ width: 34, height: 34, borderRadius: 9, background: "transparent", border: "1px solid var(--color-line-strong)", cursor: "pointer" }}
              />
              <span className="tnum text-[0.78rem] text-[var(--color-muted)]">{draft.accentColor}</span>
            </label>
          </div>
        </Field>
      </Panel>

      <Panel title="Currency">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Default currency">
            <div className="flex gap-2">
              {(["ZAR", "USD"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => set("currency", c)}
                  className="btn flex-1"
                  style={draft.currency === c ? { borderColor: "var(--color-accent)", color: "var(--color-ink)" } : {}}
                >
                  {c === "ZAR" ? "R  ZAR" : "$  USD"}
                  {draft.currency === c && <Check size={14} className="text-[var(--color-accent)]" />}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Secondary currency">
            <label className="flex items-center gap-2.5 h-9 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={draft.secondaryCurrencyEnabled}
                onChange={(e) => set("secondaryCurrencyEnabled", e.target.checked)}
                style={{ accentColor: "var(--color-accent)", width: 16, height: 16 }}
              />
              <span className="text-[0.84rem] text-[var(--color-ink-soft)]">
                Enable {draft.currency === "ZAR" ? "USD" : "ZAR"} as an optional secondary currency
              </span>
            </label>
          </Field>
        </div>
      </Panel>

      <Panel title="Pricing">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5">
          <Field
            label="Target margin on monthly (%)"
            hint="The retainer floor is running cost plus this. Nothing can be quoted below it."
          >
            <NumberInput
              value={Math.round((draft.targetMarginPct ?? 0) * 100)}
              min={0}
              max={500}
              onChange={(e) => set("targetMarginPct", Number(e.target.value) / 100)}
            />
          </Field>

          <Field
            label="Minimum setup fee"
            hint="Your absolute walk-away. Leave at 0 to let comparables set the floor alone."
          >
            <NumberInput
              value={draft.minimumSetupFee ?? 0}
              min={0}
              onChange={(e) => set("minimumSetupFee", Number(e.target.value))}
            />
          </Field>

          <Field
            label="USD → ZAR rate"
            hint="Market comparables are usually quoted in USD. Until this is set, they are excluded from matching."
          >
            <NumberInput
              value={draft.usdToZar ?? 0}
              min={0}
              step={0.01}
              onChange={(e) => set("usdToZar", Number(e.target.value))}
            />
          </Field>
        </div>

        <p className="eyebrow mt-6 mb-3">Capex ceiling multipliers</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3.5">
          {(["micro", "small", "mid", "enterprise"] as const).map((band) => (
            <Field key={band} label={band}>
              <NumberInput
                value={draft.capexMultipliers?.[band] ?? 1}
                min={0}
                step={0.1}
                onChange={(e) =>
                  set("capexMultipliers", {
                    ...draft.capexMultipliers,
                    [band]: Number(e.target.value),
                  })
                }
              />
            </Field>
          ))}
        </div>
        <p className="text-[0.75rem] text-[var(--color-dim)] mt-3 leading-relaxed">
          Applied to the comparable-derived ceiling, not to the target. A bigger client
          does not make the work worth more — it widens how far above the anchor you can
          reasonably push.
        </p>
      </Panel>

      <Panel title="AI">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <Sparkles size={16} className="text-[var(--color-accent)] mt-0.5" />
            <div>
              <p className="text-[0.86rem] text-[var(--color-ink)]">
                AI summaries &amp; business review
              </p>
              <p className="text-[0.8rem] text-[var(--color-muted)] leading-relaxed mt-0.5">
                {aiLoading
                  ? "Checking…"
                  : ai?.configured
                    ? `Live — using ${ai.model} at ${ai.effort} effort.`
                    : "No API key found — using built-in mock summaries. Add a key to enable real AI."}
              </p>
            </div>
          </div>
          {aiLoading ? (
            <Loader2 size={16} className="animate-spin text-[var(--color-muted)]" />
          ) : (
            <span
              className="chip shrink-0"
              style={
                ai?.configured
                  ? { color: "var(--color-positive)", borderColor: "#1e6b46", background: "rgba(61,214,140,0.08)" }
                  : { color: "var(--color-muted)" }
              }
            >
              {ai?.configured ? "Connected" : "Mock mode"}
            </span>
          )}
        </div>
        {!aiLoading && !ai?.configured && (
          <div className="mt-3 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3 text-[0.8rem] text-[var(--color-muted)] leading-relaxed">
            Add your Anthropic API key to{" "}
            <code className="tnum text-[var(--color-ink-soft)]">.env.local</code> in the project folder,
            then restart the app. Get a key at{" "}
            <span className="text-[var(--color-ink-soft)]">console.anthropic.com</span>.
          </div>
        )}
      </Panel>

      <AgentsPanel />

      <Panel title="Data">
        <div className="flex items-start gap-3 mb-4">
          <Database size={16} className="text-[var(--color-muted)] mt-0.5" />
          <p className="text-[0.82rem] text-[var(--color-muted)] leading-relaxed">
            All data is stored locally in your browser. The storage layer is abstracted behind a single adapter, so it can be pointed at Supabase or Firebase later without changing the app.
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button className="btn" onClick={() => setConfirmReset(true)}>
            <RotateCcw size={15} /> Load demo data
          </button>
          <button className="btn" onClick={() => setConfirmClear(true)} style={{ color: "var(--color-accent-soft)" }}>
            <Trash2 size={15} /> Clear all data
          </button>
        </div>
      </Panel>

      <div className="flex items-center gap-2 text-[0.74rem] text-[var(--color-dim)] px-1">
        <Building2 size={13} /> Pallisade OS · v0.1 · local build
      </div>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={resetDemo}
        title="Load demo data?"
        message="This replaces everything with a sample demo dataset so you can see the app populated. Any data you've added will be lost."
        confirmLabel="Load demo"
      />
      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={clearAll}
        title="Clear all data?"
        message="This permanently removes every lead, interaction, project, task, scorecard and pain point. Your settings are kept."
        confirmLabel="Clear everything"
      />
    </div>
  );
}

/**
 * Lists every agent, grouped by surface, with a per-agent persona editor.
 * Fetches the roster for each surface via GET /api/agents?surface=<s> — the
 * six-key AgentCard projection Task 14's picker also uses — then each
 * AgentEditorRow fetches its own full spec (including body and the
 * read-only tool grant) from GET /api/agents/:id. That second route is the
 * only place a system prompt crosses into the browser; the roster call
 * above never carries one.
 */
function AgentsPanel() {
  const [groups, setGroups] = useState<Record<AgentSurface, AgentCard[]> | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      AGENT_SURFACES.map((s) =>
        fetch(`/api/agents?surface=${s}`)
          .then((res) => (res.ok ? res.json() : { agents: [] }))
          .catch(() => ({ agents: [] })),
      ),
    ).then((results: { agents?: AgentCard[] }[]) => {
      if (cancelled) return;
      const next = {} as Record<AgentSurface, AgentCard[]>;
      AGENT_SURFACES.forEach((s, i) => {
        next[s] = results[i].agents ?? [];
      });
      setGroups(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Panel title="Agent personas">
      <div className="flex items-start gap-3 mb-4">
        <Lock size={16} className="text-[var(--color-muted)] mt-0.5 shrink-0" />
        <p className="text-[0.82rem] text-[var(--color-muted)] leading-relaxed">
          Editing a persona here changes only its system prompt. Tool access is fixed in the
          agent&apos;s file and shown read-only below — it can&apos;t be widened from this screen.
        </p>
      </div>

      {!groups && <p className="text-[0.82rem] text-[var(--color-muted)]">Loading agents…</p>}

      {groups &&
        AGENT_SURFACES.filter((s) => groups[s].length > 0).map((surface) => (
          <div key={surface} className="mb-5 last:mb-0">
            <p className="eyebrow mb-2.5">{SURFACE_LABEL[surface]}</p>
            <div className="space-y-3">
              {groups[surface].map((card) => (
                <AgentEditorRow key={card.id} card={card} />
              ))}
            </div>
          </div>
        ))}
    </Panel>
  );
}

function AgentEditorRow({ card }: { card: AgentCard }) {
  const [spec, setSpec] = useState<AgentDetail | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"saving" | "resetting" | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    fetch(`/api/agents/${card.id}`).then((res) => (res.ok ? (res.json() as Promise<AgentDetail>) : null));

  useEffect(() => {
    let cancelled = false;
    load().then((data) => {
      if (cancelled || !data) return;
      setSpec(data);
      setDraft(data.body);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);

  const save = async () => {
    if (!draft.trim()) {
      setError("A persona can't be saved empty — write something or use Reset to default instead.");
      return;
    }
    setError(null);
    setBusy("saving");
    try {
      const res = await fetch(`/api/agents/${card.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      if (!res.ok) throw new Error();
      const fresh = await load();
      if (fresh) setSpec(fresh);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch {
      setError("Couldn't save — try again.");
    } finally {
      setBusy(null);
    }
  };

  const reset = async () => {
    setError(null);
    setBusy("resetting");
    try {
      const res = await fetch(`/api/agents/${card.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      const fresh = await load();
      if (fresh) {
        setSpec(fresh);
        setDraft(fresh.body);
      }
    } catch {
      setError("Couldn't reset — try again.");
    } finally {
      setBusy(null);
    }
  };

  const dirty = spec ? draft !== spec.body : false;

  return (
    <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3.5">
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="flex items-start gap-2.5 min-w-0">
          <span aria-hidden className="text-[1.1rem] leading-none mt-0.5">{card.emoji}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[0.88rem] text-[var(--color-ink)] font-medium">{card.name}</p>
              {spec?.overridden && (
                <span className="chip" style={{ fontSize: "0.68rem", padding: "0.15rem 0.5rem", color: "var(--color-accent)" }}>
                  Customized
                </span>
              )}
            </div>
            <p className="text-[0.78rem] text-[var(--color-muted)] mt-0.5">{card.description}</p>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-2 mb-2.5">
        <Lock size={12} className="text-[var(--color-dim)] mt-1 shrink-0" />
        <div className="flex flex-wrap gap-1.5">
          {spec ? (
            spec.tools.length > 0 ? (
              spec.tools.map((t) => (
                <span
                  key={t}
                  className="chip"
                  style={{ fontSize: "0.68rem", padding: "0.18rem 0.5rem", color: "var(--color-dim)", cursor: "default" }}
                  title="Tool grants are set in the agent's file and are not editable here."
                >
                  {t}
                </span>
              ))
            ) : (
              <span className="text-[0.72rem] text-[var(--color-dim)]">No tools granted</span>
            )
          ) : (
            <span className="text-[0.72rem] text-[var(--color-dim)]">…</span>
          )}
        </div>
      </div>

      {spec ? (
        <>
          <TextArea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            spellCheck={false}
          />
          {error && (
            <p className="flex items-center gap-1.5 text-[0.76rem] mt-1.5" style={{ color: "var(--color-accent-soft)" }}>
              <AlertCircle size={13} /> {error}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2.5">
            <button className="btn btn-accent" disabled={!dirty || busy !== null} onClick={save}>
              {busy === "saving" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : saved ? (
                <Check size={14} />
              ) : (
                <Save size={14} />
              )}
              {saved ? "Saved" : "Save"}
            </button>
            <button className="btn" disabled={!spec.overridden || busy !== null} onClick={reset}>
              {busy === "resetting" ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
              Reset to default
            </button>
          </div>
        </>
      ) : (
        <p className="text-[0.78rem] text-[var(--color-muted)]">Loading…</p>
      )}
    </div>
  );
}

function applyAccent(color: string) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--color-accent", color);
  document.documentElement.style.setProperty("--color-accent-soft", color);
}
