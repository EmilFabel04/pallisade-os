"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, SendHorizontal, BrainCircuit, Paperclip, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { ThreadList } from "@/components/advisor/ThreadList";
import { MessageBubble } from "@/components/advisor/MessageBubble";
import { MicButton } from "@/components/ui/MicButton";
import { getBrainStatus, sendBrainTurn, getDriveStatus } from "@/lib/brainClient";
import { stopNotice } from "@/lib/agents/stopNotice";
import type { BrainThread, BrainAttachment, ChatMessage } from "@/lib/types";
import { AgentPicker } from "@/components/agents/AgentPicker";
import { threadAgentId } from "@/lib/brain/mode";
import { uid, nowISO } from "@/lib/utils";

export default function BrainPage() {
  const store = useStore();
  const { brainThreads, settings } = store;

  const [agentId, setAgentId] = useState("strategist");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the last turn ended for a reason other than the agent finishing.
  // Without it a truncated answer reads exactly like a complete one.
  const [notice, setNotice] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  // Connection state only — the account id is resolved server-side now, so
  // the page has no reason to know it. This drives the "Connect Drive" panel.
  const [driveConnected, setDriveConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const deepLinked = useRef(false);
  const searchParams = useSearchParams();

  // strategist/brainstorm used to be a mode toggle; they are now five agents.
  // isBrainstorm still decides attachments/Drive and the page's copy — those
  // are genuinely brainstorm-only affordances, not a bucketing scheme.
  const isBrainstorm = agentId === "product-brainstorm";

  useEffect(() => { getBrainStatus().then((s) => setConfigured(s.configured)); }, []);
  useEffect(() => {
    if (isBrainstorm) getDriveStatus().then((s) => setDriveConnected(s.connected));
  }, [isBrainstorm]);

  // One bucket per agent, resolved the same way the thread is reopened, so a
  // thread never shows in a list that would then restore a different agent.
  const threads = useMemo(
    () => brainThreads.filter((t) => threadAgentId(t) === agentId),
    [brainThreads, agentId],
  );

  const active = useMemo<BrainThread | null>(
    () => brainThreads.find((t) => t.id === activeId) ?? null,
    [brainThreads, activeId],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [active?.messages.length, loading]);

  const setMessages = (thread: BrainThread, messages: ChatMessage[]) =>
    store.update("brainThreads", thread.id, { messages });

  const newThread = () => { setActiveId(null); setInput(""); setError(null); setNotice(null); };

  const selectAgent = (id: string) => {
    setAgentId(id); setActiveId(null); setInput(""); setError(null); setNotice(null);
  };

  const selectThread = (id: string) => {
    const t = brainThreads.find((x) => x.id === id);
    if (t) setAgentId(threadAgentId(t));
    setActiveId(id);
    setError(null);
    setNotice(null);
  };

  // Create-on-demand so a thread exists before the first message or attachment.
  const ensureThread = (seedTitle: string): BrainThread => {
    if (active) return active;
    const thread = store.create("brainThreads", {
      title: seedTitle.slice(0, 48) || (isBrainstorm ? "New brainstorm" : "New thread"),
      // agentId is the truth; mode is written alongside it so a rollback to the
      // two-mode Brain still reads the thread instead of dropping it.
      mode: isBrainstorm ? "brainstorm" : "strategist",
      agentId,
      messages: [],
      attachments: [],
    } as Omit<BrainThread, "id" | "createdAt" | "updatedAt">) as BrainThread;
    setActiveId(thread.id);
    return thread;
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const thread = ensureThread("New brainstorm");
    const read: BrainAttachment[] = [];
    for (const f of Array.from(files)) {
      if (!/\.(md|txt|markdown)$/i.test(f.name)) continue;
      const content = await f.text();
      read.push({ id: uid("att"), name: f.name, content, createdAt: nowISO() });
    }
    if (read.length) {
      store.update("brainThreads", thread.id, { attachments: [...(thread.attachments ?? []), ...read] });
    }
  };

  const removeAttachment = (attId: string) => {
    if (!active) return;
    store.update("brainThreads", active.id, {
      attachments: (active.attachments ?? []).filter((a) => a.id !== attId),
    });
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setError(null);
    setNotice(null);

    const thread = ensureThread(text);
    const userMsg: ChatMessage = { id: uid("msg"), role: "user", content: text, createdAt: nowISO() };
    const withUser = [...thread.messages, userMsg];
    setMessages(thread, withUser);
    setInput("");
    setLoading(true);

    try {
      const reply = await sendBrainTurn({
        messages: withUser.map((m) => ({ role: m.role, content: m.content })),
        agentId,
        attachments: isBrainstorm
          ? (thread.attachments ?? []).map((a) => ({ name: a.name, content: a.content }))
          : undefined,
        context: {
          businessName: settings.businessName,
          founderName: settings.founderName,
          // deal-strategist, discovery-coach and pipeline-analyst all
          // interpolate {{services}}. Without this the route fell through to
          // its hardcoded default and the founder's Settings edit was silently
          // ignored on this surface while the Advisor honoured it.
          services: settings.services,
        },
      });
      const assistantMsg: ChatMessage = {
        id: uid("msg"), role: "assistant", content: reply.content, createdAt: nowISO(),
      };
      setMessages(thread, [...withUser, assistantMsg]);
      setNotice(stopNotice(reply.stoppedBy));
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

  // Deep link from the News section: /brain?thread=<id> opens that thread.
  useEffect(() => {
    if (deepLinked.current) return;
    const id = searchParams.get("thread");
    if (id && store.ready && brainThreads.some((t) => t.id === id)) {
      deepLinked.current = true;
      selectThread(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, store.ready, brainThreads.length]);

  const attachments = active?.attachments ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Brain"
        subtitle={isBrainstorm
          ? "Product brainstorm — reads your Drive docs + dropped notes, researches the market, and writes a build scope for Claude Code."
          : "Your strategic sparring partner for positioning and the big calls — thinking like a founder who has scaled and taken companies public."}
      />

      <AgentPicker surface="brain" value={agentId} onChange={selectAgent} />

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

      {isBrainstorm && configured !== false && !driveConnected && (
        <Panel>
          <div className="flex items-start gap-3 p-1">
            <Paperclip size={16} className="text-[var(--color-accent)] mt-0.5" />
            <p className="text-[0.84rem] text-[var(--color-muted)] leading-relaxed">
              Connect Google Drive to let the Brain read your docs and transcripts.{" "}
              <a href="/api/gmail/connect" className="text-[var(--color-accent)] underline">Connect Drive</a>.
              You can still drop <code>.md</code> files below and use web research without it.
            </p>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-5 items-start">
        <Panel title="Threads">
          <ThreadList
            conversations={threads}
            activeId={activeId}
            onSelect={selectThread}
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
                <h3 className="text-[0.95rem] font-semibold text-[var(--color-ink)]">
                  {isBrainstorm ? "What are we building?" : "What are we deciding?"}
                </h3>
                <p className="text-[0.83rem] text-[var(--color-muted)] mt-1.5 max-w-sm leading-relaxed">
                  {isBrainstorm
                    ? "Drop your notes/transcripts (.md) or just describe the idea — I'll pull from Drive, research how it's solved today, and scope the build."
                    : "Try \"should I niche down to asset managers or stay broad?\", or \"how should I price the reconciliation product?\"."}
                </p>
              </div>
            ) : (
              active.messages.map((m) => (
                <MessageBubble key={m.id} message={m} onConfirm={() => {}} onDismiss={() => {}} copyRaw={isBrainstorm} />
              ))
            )}
            {loading && (
              <div className="flex items-center gap-2 text-[0.8rem] text-[var(--color-dim)]">
                <Loader2 size={14} className="animate-spin" /> {isBrainstorm ? "Researching…" : "Thinking…"}
              </div>
            )}
          </div>

          {error && <p className="text-[0.78rem] text-[var(--color-accent)] mt-3">{error}</p>}

          {notice && <p className="text-[0.78rem] text-[var(--color-muted)] mt-3">{notice}</p>}

          {isBrainstorm && attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {attachments.map((a) => (
                <span key={a.id} className="inline-flex items-center gap-1.5 text-[0.74rem] px-2 py-1 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-muted)]">
                  <Paperclip size={11} /> {a.name}
                  <button onClick={() => removeAttachment(a.id)} className="hover:text-[var(--color-accent)]"><X size={11} /></button>
                </span>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2 mt-4 pt-4 border-t border-[var(--color-line)]">
            {isBrainstorm && (
              <label className="btn btn-ghost cursor-pointer" title="Attach .md / .txt notes">
                <Paperclip size={15} />
                <input type="file" accept=".md,.markdown,.txt" multiple className="hidden"
                  onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
              </label>
            )}
            <textarea
              className="textarea flex-1"
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder={isBrainstorm
                ? "Describe the product idea…  (📎 to attach notes · Enter to send · 🎙 to talk)"
                : "Put a decision on the table…  (Enter to send · Shift+Enter for a new line · 🎙 to talk)"}
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
