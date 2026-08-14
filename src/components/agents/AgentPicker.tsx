"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentCard, AgentSurface } from "@/lib/agents/types";

const storageKey = (surface: AgentSurface) => `pallisade.agent.${surface}`;

/**
 * Roster-driven agent picker. Fetches `GET /api/agents?surface=<surface>`
 * once on mount and renders each agent as a selectable chip. The parent owns
 * the selected id (`value`/`onChange`) — this component only reconciles that
 * id against the roster once it has loaded (falling back to the first agent
 * if a stored id no longer exists) and persists the founder's choice to
 * localStorage, keyed by surface, so it survives a reload.
 *
 * Renders nothing while the roster is loading — the list is small and
 * local, so a spinner would just flash.
 */
export function AgentPicker({
  surface,
  value,
  onChange,
}: {
  surface: AgentSurface;
  value: string;
  onChange: (id: string) => void;
}) {
  const [agents, setAgents] = useState<AgentCard[] | null>(null);
  const reconciled = useRef(false);

  useEffect(() => {
    reconciled.current = false;
    setAgents(null);
    let cancelled = false;

    fetch(`/api/agents?surface=${surface}`)
      .then((res) => (res.ok ? res.json() : Promise.resolve({ agents: [] })))
      .then((data: { agents?: AgentCard[] }) => {
        if (!cancelled) setAgents(data.agents ?? []);
      })
      .catch(() => {
        if (!cancelled) setAgents([]);
      });

    return () => {
      cancelled = true;
    };
  }, [surface]);

  // Reconcile once, when the roster first arrives: prefer a valid stored
  // choice (the founder's earlier pick survives a reload), otherwise keep
  // whatever the caller defaulted to (e.g. "strategist") if that id is
  // still on the roster, and only fall back to the first agent when neither
  // is valid — a stored id that no longer exists must never reach the API.
  // Runs only once per roster load so it never clobbers a click the founder
  // makes in the same session.
  useEffect(() => {
    if (!agents || agents.length === 0 || reconciled.current) return;
    reconciled.current = true;
    const stored = window.localStorage.getItem(storageKey(surface));
    const valid = stored && agents.some((a) => a.id === stored)
      ? stored
      : agents.some((a) => a.id === value)
        ? value
        : agents[0].id;
    if (valid !== value) onChange(valid);
  }, [agents, surface, value, onChange]);

  const select = (id: string) => {
    window.localStorage.setItem(storageKey(surface), id);
    onChange(id);
  };

  if (!agents || agents.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {agents.map((a) => {
        const active = a.id === value;
        return (
          <button
            key={a.id}
            type="button"
            title={a.vibe}
            onClick={() => select(a.id)}
            className="chip transition-colors"
            style={{
              cursor: "pointer",
              fontSize: "0.8rem",
              padding: "0.4rem 0.7rem",
              color: active ? "var(--color-ink)" : "var(--color-ink-soft)",
              borderColor: active ? a.color : "var(--color-line-strong)",
              background: active ? `color-mix(in srgb, ${a.color} 14%, transparent)` : "var(--color-surface-2)",
            }}
          >
            <span aria-hidden>{a.emoji}</span>
            <span>{a.name}</span>
          </button>
        );
      })}
    </div>
  );
}
