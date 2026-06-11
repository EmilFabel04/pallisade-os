"use client";

import { Bot, User } from "lucide-react";
import type { ChatMessage, ProposedAction } from "@/lib/types";
import { ActionCard } from "./ActionCard";

export function MessageBubble({
  message, onConfirm, onDismiss,
}: {
  message: ChatMessage;
  onConfirm: (a: ProposedAction) => void;
  onDismiss: (a: ProposedAction) => void;
}) {
  const isUser = message.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className="flex items-center justify-center shrink-0"
        style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid var(--color-line-strong)", background: "var(--color-surface-2)" }}
      >
        {isUser ? <User size={14} className="text-[var(--color-muted)]" /> : <Bot size={14} className="text-[var(--color-accent)]" />}
      </div>
      <div className={`max-w-[80%] ${isUser ? "text-right" : ""}`}>
        <div
          className="rounded-lg px-3.5 py-2.5 text-[0.86rem] leading-relaxed whitespace-pre-wrap"
          style={{
            background: isUser ? "var(--color-surface-2)" : "var(--color-surface)",
            border: "1px solid var(--color-line)",
            color: "var(--color-ink-soft)",
            textAlign: "left",
          }}
        >
          {message.content}
        </div>
        {message.actions?.map((a) => (
          <ActionCard key={a.id} action={a} onConfirm={onConfirm} onDismiss={onDismiss} />
        ))}
      </div>
    </div>
  );
}
