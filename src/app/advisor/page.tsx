"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, SendHorizontal, Bot } from "lucide-react";
import { useStore } from "@/lib/store";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { ThreadList } from "@/components/advisor/ThreadList";
import { MessageBubble } from "@/components/advisor/MessageBubble";
import { MicButton } from "@/components/ui/MicButton";
import { createCalendarEvent } from "@/lib/calendar/calendarClient";
import { applyAction, type AdvisorStore } from "@/lib/advisor/applyAction";
import { buildSnapshot, getAdvisorStatus, sendAdvisorTurn } from "@/lib/advisorClient";
import type { ChatMessage, CollectionKey, Conversation, ProposedAction } from "@/lib/types";
import { uid, nowISO } from "@/lib/utils";

export default function AdvisorPage() {
  const store = useStore();
  const { conversations, settings } = store;

  // The store's CRUD is generic over CollectionKey; wrap it once in the loose
  // shape applyAction expects (avoids strictFunctionTypes assignability errors).
  const crud: AdvisorStore = useMemo(() => ({
    create: (key, value) => store.create(key as CollectionKey, value as never),
    update: (key, id, patch) => store.update(key as CollectionKey, id, patch as never),
  }), [store]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { getAdvisorStatus().then((s) => setConfigured(s.configured)); }, []);

  const active = useMemo<Conversation | null>(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [active?.messages.length, loading]);

  /** Persist a new messages array onto a conversation. */
  const setMessages = (conv: Conversation, messages: ChatMessage[]) =>
    store.update("conversations", conv.id, { messages });

  const newConversation = () => { setActiveId(null); setInput(""); setError(null); };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setError(null);

    // Ensure there is an active conversation.
    let conv = active;
    if (!conv) {
      conv = store.create("conversations", {
        title: text.slice(0, 48),
        messages: [],
      } as Omit<Conversation, "id" | "createdAt" | "updatedAt">) as Conversation;
      setActiveId(conv.id);
    }

    const userMsg: ChatMessage = { id: uid("msg"), role: "user", content: text, createdAt: nowISO() };
    const withUser = [...conv.messages, userMsg];
    setMessages(conv, withUser);
    setInput("");
    setLoading(true);

    try {
      const reply = await sendAdvisorTurn({
        messages: withUser.map((m) => ({ role: m.role, content: m.content })),
        snapshot: buildSnapshot(store),
        context: {
          businessName: settings.businessName,
          founderName: settings.founderName,
          services: settings.services,
        },
      });
      const assistantMsg: ChatMessage = {
        id: uid("msg"), role: "assistant", content: reply.content,
        actions: reply.actions, createdAt: nowISO(),
      };
      setMessages(conv, [...withUser, assistantMsg]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const updateAction = (
    msgId: string,
    actionId: string,
    patch: Partial<ProposedAction>,
  ) => {
    if (!active) return;
    const messages = active.messages.map((m) =>
      m.id === msgId
        ? { ...m, actions: m.actions?.map((a) => (a.id === actionId ? { ...a, ...patch } : a)) }
        : m,
    );
    setMessages(active, messages);
  };

  const confirmAction = (msg: ChatMessage) => async (a: ProposedAction) => {
    // Calendar events are created via the Google API, not the local store.
    if (a.tool === "create_calendar_event") {
      try {
        const ev = await createCalendarEvent({
          summary: String(a.args.summary ?? ""),
          start: String(a.args.start ?? ""),
          durationMinutes: a.args.durationMinutes ? Number(a.args.durationMinutes) : undefined,
          description: a.args.description ? String(a.args.description) : undefined,
          location: a.args.location ? String(a.args.location) : undefined,
          attendees: Array.isArray(a.args.attendees) ? (a.args.attendees as string[]) : undefined,
        });
        updateAction(msg.id, a.id, { status: "confirmed", externalUrl: ev.htmlLink });
      } catch (e) {
        setError(`Couldn't add to calendar: ${(e as Error).message}`);
      }
      return;
    }
    const result = applyAction(crud, a);
    updateAction(msg.id, a.id, { status: "confirmed", ...(result ? { result } : {}) });
  };
  const dismissAction = (msg: ChatMessage) => (a: ProposedAction) => {
    updateAction(msg.id, a.id, { status: "dismissed" });
  };

  // Enter sends; Shift+Enter inserts a newline. `isComposing` guards IME input.
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sales Advisor"
        subtitle="Ask about your pipeline, get strategy, and let the advisor draft tasks, leads and follow-ups — every change waits for your confirmation."
      />

      {configured === false && (
        <Panel>
          <div className="flex items-start gap-3 p-1">
            <Bot size={18} className="text-[var(--color-accent)] mt-0.5" />
            <p className="text-[0.84rem] text-[var(--color-muted)] leading-relaxed">
              The Sales Advisor needs a Claude API key. Add <code>ANTHROPIC_API_KEY=sk-ant-…</code> to{" "}
              <code>.env.local</code> and restart the app. Settings → AI shows the connection status.
            </p>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-5 items-start">
        <Panel title="Conversations">
          <ThreadList
            conversations={conversations}
            activeId={activeId}
            onSelect={(id) => { setActiveId(id); setError(null); }}
            onNew={newConversation}
          />
        </Panel>

        <Panel>
          <div ref={scrollRef} className="flex flex-col gap-4 overflow-y-auto pr-1" style={{ minHeight: 360, maxHeight: "60vh" }}>
            {!active || active.messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center py-16 px-6">
                <div className="flex items-center justify-center mb-4" style={{ width: 52, height: 52, borderRadius: 12, border: "1px solid var(--color-line-strong)", background: "var(--color-surface-2)" }}>
                  <Bot size={22} className="text-[var(--color-accent)]" strokeWidth={1.5} />
                </div>
                <h3 className="text-[0.95rem] font-semibold text-[var(--color-ink)]">How can I help you sell?</h3>
                <p className="text-[0.83rem] text-[var(--color-muted)] mt-1.5 max-w-sm leading-relaxed">
                  Try "which leads are going cold?", "draft a follow-up task for Quillmere Capital", or "what are my top 3 priorities tomorrow?"
                </p>
              </div>
            ) : (
              active.messages.map((m) => (
                <MessageBubble key={m.id} message={m} onConfirm={confirmAction(m)} onDismiss={dismissAction(m)} />
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
              placeholder="Ask the advisor…  (Enter to send · Shift+Enter for a new line · 🎙 to talk)"
              disabled={loading}
            />
            <MicButton
              size={16}
              title="Talk to the advisor"
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
