"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderKanban, Plus, AlertOctagon, ArrowRight, ListChecks } from "lucide-react";
import { useStore } from "@/lib/store";
import { useFocusParam } from "@/components/useFocus";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { FilterSelect } from "@/components/ui/Detail";
import { ProjectForm } from "@/components/forms/ProjectForm";
import { PROJECT_STAGES, PROJECT_TYPES } from "@/lib/types";
import { priorityTone, projectStageTone } from "@/lib/badges";
import { relativeDay, isOverdue, cn } from "@/lib/utils";

function ProjectsView() {
  const { projects, tasks } = useStore();
  const focusId = useFocusParam();
  const router = useRouter();

  const [fStage, setFStage] = useState("all");
  const [fType, setFType] = useState("all");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (focusId) router.replace(`/projects/${focusId}`);
  }, [focusId, router]);

  const filtered = useMemo(
    () =>
      projects.filter((p) => {
        if (fStage !== "all" && p.stage !== fStage) return false;
        if (fType !== "all" && p.type !== fType) return false;
        return true;
      }),
    [projects, fStage, fType],
  );

  const tasksFor = (id: string) => tasks.filter((t) => t.linkKind === "project" && t.linkId === id);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Projects"
        subtitle="Active client and demo work — stage, blockers, next actions and the tasks behind each one."
        actions={
          <button className="btn btn-accent" onClick={() => setCreating(true)}>
            <Plus size={15} /> Add Project
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-2.5">
        <FilterSelect label="Stage" value={fStage} onChange={setFStage} options={[{ value: "all", label: "All stages" }, ...PROJECT_STAGES.map((s) => ({ value: s, label: s }))]} />
        <FilterSelect label="Type" value={fType} onChange={setFType} options={[{ value: "all", label: "All types" }, ...PROJECT_TYPES.map((s) => ({ value: s, label: s }))]} />
      </div>

      {filtered.length === 0 ? (
        <Panel noPad>
          <EmptyState
            icon={FolderKanban}
            title={projects.length === 0 ? "No projects yet" : "No projects match"}
            message={projects.length === 0 ? "Add a project to track demo or paid work from idea to closed." : "Try clearing a filter."}
            action={projects.length === 0 ? <button className="btn btn-accent" onClick={() => setCreating(true)}><Plus size={15} /> Add Project</button> : undefined}
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((p) => {
            const pt = tasksFor(p.id);
            const done = pt.filter((t) => t.status === "done").length;
            return (
              <Link key={p.id} href={`/projects/${p.id}`} className="panel p-4 text-left hover:border-[var(--color-line-strong)] transition-colors flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-[0.95rem] font-semibold text-[var(--color-ink)] truncate">{p.name}</h3>
                    <p className="text-[0.76rem] text-[var(--color-dim)] truncate">{p.company}</p>
                  </div>
                  <Badge tone={priorityTone(p.priority)} dot={false}>{p.priority}</Badge>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <Badge tone={projectStageTone(p.stage)}>{p.stage}</Badge>
                  <span className="chip">{p.type}</span>
                </div>

                {p.nextAction && (
                  <p className="text-[0.79rem] text-[var(--color-ink-soft)] leading-snug flex items-start gap-1.5">
                    <ArrowRight size={13} className="text-[var(--color-accent)] mt-0.5 shrink-0" />
                    <span className="line-clamp-2">{p.nextAction}</span>
                  </p>
                )}
                {p.currentBlocker && (
                  <p className="text-[0.76rem] text-[var(--color-accent-soft)] leading-snug flex items-start gap-1.5">
                    <AlertOctagon size={12} className="mt-0.5 shrink-0" />
                    <span className="line-clamp-1">{p.currentBlocker}</span>
                  </p>
                )}

                <div className="mt-auto pt-2 flex items-center justify-between text-[0.74rem] text-[var(--color-dim)] border-t border-[var(--color-line)]">
                  <span className="inline-flex items-center gap-1.5"><ListChecks size={13} /> {done}/{pt.length} tasks</span>
                  {p.dueDate && (
                    <span className={cn("tnum", isOverdue(p.dueDate) && p.stage !== "closed" ? "text-[var(--color-accent-soft)]" : "")}>
                      Due {relativeDay(p.dueDate)}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="Add Project" subtitle="Track a new piece of work">
        <ProjectForm onClose={() => setCreating(false)} />
      </Modal>
    </div>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={null}>
      <ProjectsView />
    </Suspense>
  );
}
