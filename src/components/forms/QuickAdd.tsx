"use client";

import { createContext, useContext, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { LeadForm } from "./LeadForm";
import { InteractionForm } from "./InteractionForm";
import { ProjectForm } from "./ProjectForm";
import { TaskForm } from "./TaskForm";
import { ScorecardForm } from "./ScorecardForm";

export type QuickAddKind =
  | "lead"
  | "interaction"
  | "project"
  | "task"
  | "scorecard"
  | null;

interface QuickAddCtx {
  open: (kind: QuickAddKind) => void;
}

const Ctx = createContext<QuickAddCtx | null>(null);

const TITLES: Record<NonNullable<QuickAddKind>, { title: string; subtitle: string }> = {
  lead: { title: "Add Lead", subtitle: "Create a new CRM record" },
  interaction: { title: "Log Interaction", subtitle: "Record a call, reply or meeting" },
  project: { title: "Add Project", subtitle: "Track a new piece of work" },
  task: { title: "Add Task", subtitle: "Capture something to do" },
  scorecard: { title: "Daily Scorecard", subtitle: "Log today's activity" },
};

export function QuickAddProvider({ children }: { children: React.ReactNode }) {
  const [kind, setKind] = useState<QuickAddKind>(null);
  const close = () => setKind(null);

  return (
    <Ctx.Provider value={{ open: setKind }}>
      {children}
      <Modal
        open={kind !== null}
        onClose={close}
        title={kind ? TITLES[kind].title : ""}
        subtitle={kind ? TITLES[kind].subtitle : ""}
        size={kind === "scorecard" || kind === "lead" ? "lg" : "md"}
      >
        {kind === "lead" && <LeadForm onClose={close} />}
        {kind === "interaction" && <InteractionForm onClose={close} />}
        {kind === "project" && <ProjectForm onClose={close} />}
        {kind === "task" && <TaskForm onClose={close} />}
        {kind === "scorecard" && <ScorecardForm onClose={close} />}
      </Modal>
    </Ctx.Provider>
  );
}

export function useQuickAdd() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useQuickAdd must be used within QuickAddProvider");
  return ctx;
}
