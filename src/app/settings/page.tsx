"use client";

import { useEffect, useState } from "react";
import { Check, RotateCcw, Trash2, Save, Database, Building2, Sparkles, Loader2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { aiStatus, type AIStatus } from "@/lib/aiClient";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Field, TextArea, TextInput } from "@/components/ui/Field";
import { ConfirmDialog } from "@/components/ui/Modal";
import type { Settings } from "@/lib/types";

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

function applyAccent(color: string) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--color-accent", color);
  document.documentElement.style.setProperty("--color-accent-soft", color);
}
