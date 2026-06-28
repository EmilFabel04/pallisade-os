"use client";

import { useRef, useState } from "react";
import { Bot, User, Copy, Check } from "lucide-react";
import type { ChatMessage, ProposedAction } from "@/lib/types";
import { ActionCard } from "./ActionCard";
import { Markdown } from "./Markdown";

export function MessageBubble({
  message, onConfirm, onDismiss, copyRaw = false,
}: {
  message: ChatMessage;
  onConfirm: (a: ProposedAction) => void;
  onDismiss: (a: ProposedAction) => void;
  copyRaw?: boolean;
}) {
  const isUser = message.role === "user";
  const bodyRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  /* Force plain text onto the clipboard. Without this the browser copies the
     bubble's dark background + light text as HTML, which pastes into Gmail (and
     other rich editors) as black-highlighted text. */
  const onCopy = (e: React.ClipboardEvent) => {
    const text = window.getSelection()?.toString();
    if (!text) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", text);
  };

  /* Copy button: grabs the clean rendered text (no markdown syntax, no styling),
     ideal for pasting an advisor-drafted email straight into Gmail. */
  const copyAll = async () => {
    const text = copyRaw ? message.content : (bodyRef.current?.innerText ?? message.content);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  };

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className="flex items-center justify-center shrink-0"
        style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid var(--color-line-strong)", background: "var(--color-surface-2)" }}
      >
        {isUser ? <User size={14} className="text-[var(--color-muted)]" /> : <Bot size={14} className="text-[var(--color-accent)]" />}
      </div>
      <div className={`group max-w-[80%] ${isUser ? "text-right" : ""}`}>
        <div
          ref={bodyRef}
          onCopy={onCopy}
          className={`rounded-lg px-3.5 py-2.5 text-[0.86rem] leading-relaxed ${isUser ? "whitespace-pre-wrap" : ""}`}
          style={{
            background: isUser ? "var(--color-surface-2)" : "var(--color-surface)",
            border: "1px solid var(--color-line)",
            color: "var(--color-ink-soft)",
            textAlign: "left",
          }}
        >
          {isUser ? message.content : <Markdown>{message.content}</Markdown>}
        </div>
        {!isUser && (
          <button
            onClick={copyAll}
            className="mt-1 inline-flex items-center gap-1 text-[0.7rem] text-[var(--color-dim)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--color-ink-soft)]"
            title="Copy as plain text"
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
        {message.actions?.map((a) => (
          <ActionCard key={a.id} action={a} onConfirm={onConfirm} onDismiss={onDismiss} />
        ))}
      </div>
    </div>
  );
}
