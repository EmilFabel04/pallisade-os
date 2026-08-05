"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, SendHorizontal, PenLine, Plus, Trash2, Pencil } from "lucide-react";
import { useStore } from "@/lib/store";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { ThreadList } from "@/components/advisor/ThreadList";
import { MessageBubble } from "@/components/advisor/MessageBubble";
import { MicButton } from "@/components/ui/MicButton";
import VoicePanel from "@/components/content/VoicePanel";
import TodayPanel from "@/components/content/TodayPanel";
import { contentTypeMeta } from "@/lib/content/prompt";
import { buildSnapshot, getContentStatus, sendContentTurn } from "@/lib/contentClient";
import type {
  ChatMessage,
  ContentThread,
  ContentType,
  PositioningProfile,
} from "@/lib/types";
import { uid, nowISO } from "@/lib/utils";

const CONTENT_TYPES: ContentType[] = ["social", "script", "longform"];

export default function ContentPage() {
  const store = useStore();
  const { contentThreads, positioningProfiles, settings } = store;

  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Profile editor state.
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileBody, setProfileBody] = useState("");

  useEffect(() => { getContentStatus().then((s) => setConfigured(s.configured)); }, []);

  const active = useMemo<ContentThread | null>(
    () => contentThreads.find((t) => t.id === activeId) ?? null,
    [contentThreads, activeId],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [active?.messages.length, loading]);

  const setMessages = (thread: ContentThread, messages: ChatMessage[]) =>
    store.update("contentThreads", thread.id, { messages });

  // Effective profile / content type for the composer: from the active thread, else defaults.
  const activeProfileId = active?.profileId ?? positioningProfiles[0]?.id ?? null;
  const activeContentType: ContentType = active?.contentType ?? "social";

  const newThread = () => { setActiveId(null); setInput(""); setError(null); };

  // Setting profile/type before a thread exists is held until the first send;
  // for an existing thread, persist immediately.
  const [pendingProfileId, setPendingProfileId] = useState<string | null>(null);
  const [pendingType, setPendingType] = useState<ContentType | null>(null);
  const candidateProfileId = active ? activeProfileId : (pendingProfileId ?? activeProfileId);
  const selProfileId = positioningProfiles.some((p) => p.id === candidateProfileId)
    ? candidateProfileId
    : (positioningProfiles[0]?.id ?? null);
  const selType = active ? activeContentType : (pendingType ?? "social");
  const selProfile = positioningProfiles.find((p) => p.id === selProfileId) ?? null;

  const onSelectProfile = (id: string) => {
    if (active) store.update("contentThreads", active.id, { profileId: id });
    else setPendingProfileId(id);
  };
  const onSelectType = (t: ContentType) => {
    if (active) store.update("contentThreads", active.id, { contentType: t });
    else setPendingType(t);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    if (!selProfile) { setError("Add and select a positioning profile first."); return; }
    setError(null);

    let thread = active;
    if (!thread) {
      thread = store.create("contentThreads", {
        title: text.slice(0, 48),
        messages: [],
        profileId: selProfileId,
        contentType: selType,
      } as Omit<ContentThread, "id" | "createdAt" | "updatedAt">) as ContentThread;
      setActiveId(thread.id);
      setPendingProfileId(null);
      setPendingType(null);
    }

    const userMsg: ChatMessage = { id: uid("msg"), role: "user", content: text, createdAt: nowISO() };
    const withUser = [...thread.messages, userMsg];
    setMessages(thread, withUser);
    setInput("");
    setLoading(true);

    try {
      const reply = await sendContentTurn({
        messages: withUser.map((m) => ({ role: m.role, content: m.content })),
        snapshot: buildSnapshot(store),
        profile: { name: selProfile.name, body: selProfile.body },
        contentType: selType,
        context: {
          businessName: settings.businessName,
          founderName: settings.founderName,
          services: settings.services,
        },
      });
      const assistantMsg: ChatMessage = {
        id: uid("msg"), role: "assistant", content: reply.content, createdAt: nowISO(),
      };
      setMessages(thread, [...withUser, assistantMsg]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  // ---- profiles manager ----
  const startNewProfile = () => { setEditingProfileId("new"); setProfileName(""); setProfileBody(""); };
  const startEditProfile = (p: PositioningProfile) => {
    setEditingProfileId(p.id); setProfileName(p.name); setProfileBody(p.body);
  };
  const saveProfile = () => {
    const name = profileName.trim();
    const bodyText = profileBody.trim();
    if (!name || !bodyText) return;
    if (editingProfileId === "new") {
      const created = store.create("positioningProfiles", { name, body: bodyText } as Omit<
        PositioningProfile, "id" | "createdAt" | "updatedAt"
      >) as PositioningProfile;
      if (!active) setPendingProfileId(created.id);
    } else if (editingProfileId) {
      store.update("positioningProfiles", editingProfileId, { name, body: bodyText });
    }
    setEditingProfileId(null);
  };
  const deleteProfile = (id: string) => store.remove("positioningProfiles", id);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Content Studio"
        subtitle="Pick a positioning profile and a content type, then get ideas first — and the full script or post on request. Grounded in your real pain points, leads and calls."
      />

      {configured === false && (
        <Panel>
          <div className="flex items-start gap-3 p-1">
            <PenLine size={18} className="text-[var(--color-accent)] mt-0.5" />
            <p className="text-[0.84rem] text-[var(--color-muted)] leading-relaxed">
              Content Studio needs a Claude API key. Add <code>ANTHROPIC_API_KEY=sk-ant-…</code> to{" "}
              <code>.env.local</code> and restart the app.
            </p>
          </div>
        </Panel>
      )}

      <TodayPanel />

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-5 items-start">
        <div className="flex flex-col gap-5">
          <Panel title="Threads">
            <ThreadList
              conversations={contentThreads}
              activeId={activeId}
              onSelect={(id) => { setActiveId(id); setError(null); }}
              onNew={newThread}
            />
          </Panel>

          <Panel title="Positioning profiles">
            <div className="flex flex-col gap-1.5">
              {positioningProfiles.map((p) => (
                <div key={p.id} className="flex items-center gap-1.5 text-[0.8rem]">
                  <span className="truncate flex-1 text-[var(--color-muted)]">{p.name}</span>
                  <button className="btn btn-sm" title="Edit" onClick={() => startEditProfile(p)}>
                    <Pencil size={12} />
                  </button>
                  <button className="btn btn-sm" title="Delete" onClick={() => deleteProfile(p.id)}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              {positioningProfiles.length === 0 && (
                <p className="text-[0.75rem] text-[var(--color-dim)]">No profiles yet.</p>
              )}
              <button className="btn btn-sm w-full justify-start mt-1" onClick={startNewProfile}>
                <Plus size={13} /> New profile
              </button>
            </div>

            {editingProfileId && (
              <div className="flex flex-col gap-2 mt-3 pt-3 border-t border-[var(--color-line)]">
                <input
                  className="input"
                  placeholder="Profile name"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                />
                <textarea
                  className="textarea"
                  rows={6}
                  placeholder="Paste your positioning document…"
                  value={profileBody}
                  onChange={(e) => setProfileBody(e.target.value)}
                />
                <div className="flex gap-2">
                  <button className="btn btn-accent btn-sm" onClick={saveProfile}
                    disabled={!profileName.trim() || !profileBody.trim()}>
                    Save
                  </button>
                  <button className="btn btn-sm" onClick={() => setEditingProfileId(null)}>Cancel</button>
                </div>
              </div>
            )}
          </Panel>

          <VoicePanel />
        </div>

        <Panel>
          {/* composer controls */}
          <div className="flex flex-wrap items-center gap-2 mb-4 pb-4 border-b border-[var(--color-line)]">
            <select
              className="input max-w-[200px]"
              value={selProfileId ?? ""}
              onChange={(e) => onSelectProfile(e.target.value)}
            >
              {positioningProfiles.length === 0 && <option value="">No profiles — add one</option>}
              {positioningProfiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select
              className="input max-w-[220px]"
              value={selType}
              onChange={(e) => onSelectType(e.target.value as ContentType)}
            >
              {CONTENT_TYPES.map((t) => (
                <option key={t} value={t}>{contentTypeMeta(t).label}</option>
              ))}
            </select>
          </div>

          <div ref={scrollRef} className="flex flex-col gap-4 overflow-y-auto pr-1" style={{ minHeight: 360, maxHeight: "55vh" }}>
            {!active || active.messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center py-16 px-6">
                <div className="flex items-center justify-center mb-4" style={{ width: 52, height: 52, borderRadius: 12, border: "1px solid var(--color-line-strong)", background: "var(--color-surface-2)" }}>
                  <PenLine size={22} className="text-[var(--color-accent)]" strokeWidth={1.5} />
                </div>
                <h3 className="text-[0.95rem] font-semibold text-[var(--color-ink)]">What should we make?</h3>
                <p className="text-[0.83rem] text-[var(--color-muted)] mt-1.5 max-w-sm leading-relaxed">
                  Try "give me 5 LinkedIn hooks about manual reconciliation", or "draft a 45-second reel from idea 2".
                </p>
              </div>
            ) : (
              active.messages.map((m) => (
                <MessageBubble key={m.id} message={m} onConfirm={() => {}} onDismiss={() => {}} />
              ))
            )}
            {loading && (
              <div className="flex items-center gap-2 text-[0.8rem] text-[var(--color-dim)]">
                <Loader2 size={14} className="animate-spin" /> Thinking…
              </div>
            )}
          </div>

          {error && <p className="text-[0.78rem] text-[var(--color-accent)] mt-3">{error}</p>}

          <div className="flex items-end gap-2 mt-4 pt-4 border-t border-[var(--color-line)]">
            <textarea
              className="textarea flex-1"
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder="Ask for ideas or a script…  (Enter to send · Shift+Enter for a new line · 🎙 to talk)"
              disabled={loading}
            />
            <MicButton
              size={16}
              title="Talk to Content Studio"
              onTranscript={(t) => setInput((prev) => (prev && !/\s$/.test(prev) ? `${prev} ${t}` : `${prev}${t}`))}
            />
            <button className="btn btn-accent" onClick={() => void send()} disabled={loading || !input.trim()}>
              {loading ? <Loader2 size={15} className="animate-spin" /> : <SendHorizontal size={15} />}
              Send
            </button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
