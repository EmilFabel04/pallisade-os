"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, SendHorizontal, BrainCircuit } from "lucide-react";
import { useStore } from "@/lib/store";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { ThreadList } from "@/components/advisor/ThreadList";
import { MessageBubble } from "@/components/advisor/MessageBubble";
import { MicButton } from "@/components/ui/MicButton";
import { getBrainStatus, sendBrainTurn } from "@/lib/brainClient";
import type { BrainThread, ChatMessage } from "@/lib/types";
import { uid, nowISO } from "@/lib/utils";

export default function BrainPage() {
  const store = useStore();
  const { brainThreads, settings } = store;

  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { getBrainStatus().then((s) => setConfigured(s.configured)); }, []);

  const active = useMemo<BrainThread | null>(
    () => brainThreads.find((t) => t.id === activeId) ?? null,
    [brainThreads, activeId],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [active?.messages.length, loading]);

  const setMessages = (thread: BrainThread, messages: ChatMessage[]) =>
    store.update("brainThreads", thread.id, { messages });

  const newThread = () => { setActiveId(null); setInput(""); setError(null); };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setError(null);

    let thread = active;
    if (!thread) {
      thread = store.create("brainThreads", {
        title: text.slice(0, 48),
        mode: "strategist",
        messages: [],
      } as Omit<BrainThread, "id" | "createdAt" | "updatedAt">) as BrainThread;
      setActiveId(thread.id);
    }

    const userMsg: ChatMessage = { id: uid("msg"), role: "user", content: text, createdAt: nowISO() };
    const withUser = [...thread.messages, userMsg];
    setMessages(thread, withUser);
    setInput("");
    setLoading(true);

    try {
      const reply = await sendBrainTurn({
        messages: withUser.map((m) => ({ role: m.role, content: m.content })),
        context: {
          businessName: settings.businessName,
          founderName: settings.founderName,
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

  return (
    <div className="space-y-5">
      <PageHeader
        title="Brain"
        subtitle="Your strategic sparring partner for positioning and the big calls — thinking like a founder who has scaled and taken companies public."
      />

      {configured === false && (
        <Panel>
          <div className="flex items-start gap-3 p-1">
            <BrainCircuit size={18} className="text-[var(--color-accent)] mt-0.5" />
            <p className="text-[0.84rem] text-[var(--color-muted)] leading-relaxed">
              The Brain needs a Claude API key. Add <code>ANTHROPIC_API_KEY=sk-ant-…</code> to{" "}
              <code>.env.local</code> and restart the app.
            </p>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-5 items-start">
        <Panel title="Threads">
          <ThreadList
            conversations={brainThreads}
            activeId={activeId}
            onSelect={(id) => { setActiveId(id); setError(null); }}
            onNew={newThread}
          />
        </Panel>

        <Panel>
          <div ref={scrollRef} className="flex flex-col gap-4 overflow-y-auto pr-1" style={{ minHeight: 360, maxHeight: "60vh" }}>
            {!active || active.messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center py-16 px-6">
                <div className="flex items-center justify-center mb-4" style={{ width: 52, height: 52, borderRadius: 12, border: "1px solid var(--color-line-strong)", background: "var(--color-surface-2)" }}>
                  <BrainCircuit size={22} className="text-[var(--color-accent)]" strokeWidth={1.5} />
                </div>
                <h3 className="text-[0.95rem] font-semibold text-[var(--color-ink)]">What are we deciding?</h3>
                <p className="text-[0.83rem] text-[var(--color-muted)] mt-1.5 max-w-sm leading-relaxed">
                  Try "should I niche down to asset managers or stay broad?", or "how should I price the reconciliation product?".
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
              placeholder="Put a decision on the table…  (Enter to send · Shift+Enter for a new line · 🎙 to talk)"
              disabled={loading}
            />
            <MicButton
              size={16}
              title="Talk to the Brain"
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
