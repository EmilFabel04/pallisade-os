"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, SendHorizontal, Bot } from "lucide-react";
import type {
  ChatMessage,
  CollectionKey,
  Milestone,
  Project,
  ProjectThread,
  ProposedAction,
  Task,
} from "@/lib/types";
import { useStore } from "@/lib/store";
import { projectChatConfigured, sendProjectMessage } from "@/lib/projects/projectClient";
import { applyAction, type AdvisorStore } from "@/lib/advisor/applyAction";
import { MessageBubble } from "@/components/advisor/MessageBubble";
import { nowISO, uid } from "@/lib/utils";

/**
 * Per-project chat, mirroring the Sales Advisor's thread handling
 * (`src/app/advisor/page.tsx`) but scoped to one project and persisted
 * to the `projectThreads` collection instead of `conversations`.
 */
export function ProjectChat({
  project,
  milestones,
  tasks,
}: {
  project: Project;
  milestones: Milestone[];
  tasks: Task[];
}) {
  const store = useStore();
  const { projectThreads, settings } = store;

  // The store's CRUD is generic over CollectionKey; wrap it once in the loose
  // shape applyAction expects (avoids strictFunctionTypes assignability errors —
  // same pattern as the Advisor page).
  const crud: AdvisorStore = useMemo(
    () => ({
      create: (key, value) => store.create(key as CollectionKey, value as never),
      update: (key, id, patch) => store.update(key as CollectionKey, id, patch as never),
    }),
    [store],
  );

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);

  // Same "not configured" posture as the other agents.
  useEffect(() => {
    let cancelled = false;
    void projectChatConfigured().then((ok) => {
      if (!cancelled) setConfigured(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const thread: ProjectThread | null = useMemo(() => {
    const mine = projectThreads
      .filter((t) => t.projectId === project.id)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return (threadId ? mine.find((t) => t.id === threadId) : mine[0]) ?? null;
  }, [projectThreads, project.id, threadId]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;

    setInput("");
    setError(null);
    setBusy(true);

    const userMsg: ChatMessage = { id: uid("msg"), role: "user", content: text, createdAt: nowISO() };
    const history = [...(thread?.messages ?? []), userMsg];

    // Create the thread on the first message so the transcript survives a
    // reload even if the network call below fails.
    let id = thread?.id ?? null;
    if (id) {
      store.update("projectThreads", id, { messages: history });
    } else {
      const created = store.create("projectThreads", {
        projectId: project.id,
        title: text.slice(0, 60),
        messages: history,
      });
      id = created.id;
      setThreadId(id);
    }

    try {
      const reply = await sendProjectMessage({
        messages: history.map((m) => ({ role: m.role, content: m.content })),
        snapshot: { project, milestones, tasks },
        context: {
          businessName: settings.businessName,
          founderName: settings.founderName,
        },
      });
      store.update("projectThreads", id, {
        messages: [
          ...history,
          {
            id: uid("msg"),
            role: "assistant",
            content: reply.content,
            actions: reply.actions,
            createdAt: nowISO(),
          },
        ],
      });
    } catch (err) {
      setError(
        (err as Error).message === "no_key"
          ? "No ANTHROPIC_API_KEY set — add one to .env.local and restart."
          : "That didn't go through. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const updateAction = (msgId: string, actionId: string, patch: Partial<ProposedAction>) => {
    if (!thread) return;
    store.update("projectThreads", thread.id, {
      messages: thread.messages.map((m) =>
        m.id !== msgId
          ? m
          : { ...m, actions: m.actions?.map((a) => (a.id === actionId ? { ...a, ...patch } : a)) },
      ),
    });
  };

  // Writes stay confirm-gated: `applyAction` only runs on an explicit confirm.
  // Dismiss just marks the card resolved — it never touches the store.
  const confirmAction = (msg: ChatMessage) => (a: ProposedAction) => {
    const result = applyAction(crud, a);
    updateAction(msg.id, a.id, { status: "confirmed", ...(result ? { result } : {}) });
  };
  const dismissAction = (msg: ChatMessage) => (a: ProposedAction) => {
    updateAction(msg.id, a.id, { status: "dismissed" });
  };

  if (configured === false)
    return (
      <div className="flex items-start gap-3 p-1">
        <Bot size={18} className="text-[var(--color-accent)] mt-0.5" />
        <p className="text-[0.84rem] text-[var(--color-muted)] leading-relaxed">
          Project chat needs a Claude API key. Add <code>ANTHROPIC_API_KEY=sk-ant-…</code> to{" "}
          <code>.env.local</code> and restart the app.
        </p>
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-3 min-h-[12rem]">
        {!thread?.messages.length && (
          <p className="text-[0.8rem] text-[var(--color-muted)]">
            Ask about this project — milestones, what shipped, what&apos;s blocking, what to do next.
          </p>
        )}
        {thread?.messages.map((m) => (
          <MessageBubble key={m.id} message={m} onConfirm={confirmAction(m)} onDismiss={dismissAction(m)} />
        ))}
        {busy && (
          <p className="flex items-center gap-2 text-[0.78rem] text-[var(--color-dim)]">
            <Loader2 size={13} className="animate-spin" /> Thinking…
          </p>
        )}
        {error && <p className="text-[0.78rem] text-[var(--color-accent-soft)]">{error}</p>}
      </div>

      <div className="flex gap-2">
        <input
          className="input flex-1"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Ask about this project…"
          disabled={busy}
        />
        <button className="btn btn-accent" onClick={() => void send()} disabled={busy || !input.trim()}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <SendHorizontal size={15} />}
        </button>
      </div>
    </div>
  );
}
