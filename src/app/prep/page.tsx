"use client";

import { useEffect, useMemo, useState } from "react";
import { GraduationCap, BookOpen, Dumbbell } from "lucide-react";
import { useStore, usePlaybook } from "@/lib/store";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";
import { Select } from "@/components/ui/Field";
import { SessionRunner } from "@/components/prep/SessionRunner";
import { PlaybookEditor } from "@/components/prep/PlaybookEditor";
import { buildSession, mergePlaybook, nextConfidence, type PlaybookSections, type StageId } from "@/lib/prep/session";
import { draftSection, getPrepStatus, meetingPrep, type PrepContext } from "@/lib/prep/prepClient";
import type { Confidence, GlossaryCard, OfferingCard, Playbook, PronunciationCard } from "@/lib/types";

type Surface = "train" | "playbook";
type Section = keyof PlaybookSections;
type AnyCard = PronunciationCard | GlossaryCard | OfferingCard;

export default function PrepPage() {
  const store = useStore();
  const playbook = usePlaybook();
  const { leads, settings } = store;

  const context: PrepContext = useMemo(
    () => ({ businessName: settings.businessName, mainMarket: settings.mainMarket, services: settings.services }),
    [settings.businessName, settings.mainMarket, settings.services],
  );

  const [surface, setSurface] = useState<Surface>("train");
  const [leadId, setLeadId] = useState<string>(""); // "" = General mode
  const [merged, setMerged] = useState<PlaybookSections | null>(null); // meeting additions overlay
  const [sessionKey, setSessionKey] = useState(0); // bump to restart the runner
  const [drafting, setDrafting] = useState<Section | null>(null);
  const [meetingLoading, setMeetingLoading] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { getPrepStatus().then((s) => setConfigured(s.configured)); }, []);

  // Ensure exactly one Playbook record exists.
  useEffect(() => {
    if (store.ready && store.playbooks.length === 0) {
      store.create("playbooks", { pronunciations: [], glossary: [], offerings: [] } as Omit<Playbook, "id" | "createdAt" | "updatedAt">);
    }
  }, [store.ready, store.playbooks.length, store]);

  // The playbook used for the session: saved playbook, plus meeting overlay if in Meeting mode.
  const effective: Playbook | null = useMemo(() => {
    if (!playbook) return null;
    return leadId && merged ? mergePlaybook(playbook, merged) : playbook;
  }, [playbook, leadId, merged]);

  const stages = useMemo(() => (effective ? buildSession(effective) : []), [effective]);

  const updateSection = (section: Section, cards: AnyCard[]) => {
    if (!playbook) return;
    store.update("playbooks", playbook.id, { [section]: cards } as Partial<Playbook>);
  };

  const onDraft = async (stage: StageId): Promise<AnyCard[]> => {
    const sectionKey: Section = stage === "pronunciation" ? "pronunciations" : stage;
    setDrafting(sectionKey);
    setError(null);
    try {
      const draft = await draftSection(stage, context);
      return draft[sectionKey] as AnyCard[];
    } catch (e) {
      setError((e as Error).message);
      return [];
    } finally {
      setDrafting(null);
    }
  };

  const onGrade = (stage: StageId, cardId: string, gotIt: boolean) => {
    if (!playbook) return;
    const sectionKey: Section = stage === "pronunciation" ? "pronunciations" : stage;
    // Only persist for cards that live in the saved playbook (meeting-overlay cards are session-only).
    const list = playbook[sectionKey] as AnyCard[];
    if (!list.some((c) => c.id === cardId)) return;
    const confidence: Confidence = nextConfidence(gotIt);
    updateSection(sectionKey, list.map((c) => (c.id === cardId ? { ...c, confidence } : c)));
  };

  const selectLead = async (id: string) => {
    setLeadId(id);
    setMerged(null);
    setError(null);
    if (!id) return;
    const lead = leads.find((l) => l.id === id);
    if (!lead) return;
    setMeetingLoading(true);
    try {
      const add = await meetingPrep(
        {
          company: lead.company, contactName: lead.contactName, contactRole: lead.contactRole,
          industry: lead.industry, painPoint: lead.painPoint, objection: lead.objection,
        },
        context,
      );
      setMerged(add);
      setSessionKey((k) => k + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMeetingLoading(false);
    }
  };

  const subtitle =
    "Warm up before a meeting: rehearse tricky pronunciations, drill the buyer's industry language, and sharpen how you pitch your own tools and value. Pick a meeting to tailor it, or train on your general playbook.";

  return (
    <div className="space-y-5">
      <PageHeader title="Meeting Prep" subtitle={subtitle} />

      {configured === false && (
        <Panel>
          <p className="text-[0.84rem] text-[var(--color-muted)] leading-relaxed p-1">
            AI drafting needs a Claude API key — add <code>ANTHROPIC_API_KEY=sk-ant-…</code> to <code>.env.local</code> and restart.
            You can still build and run your playbook manually without it.
          </p>
        </Panel>
      )}

      {/* mode + surface bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button className={surface === "train" ? "btn btn-accent" : "btn"} onClick={() => setSurface("train")}>
            <Dumbbell size={15} /> Train
          </button>
          <button className={surface === "playbook" ? "btn btn-accent" : "btn"} onClick={() => setSurface("playbook")}>
            <BookOpen size={15} /> Playbook
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[0.76rem] text-[var(--color-muted)]">Prep for</span>
          <Select
            options={["General", ...leads.map((l) => l.company)]}
            value={leadId ? (leads.find((l) => l.id === leadId)?.company ?? "General") : "General"}
            onChange={(e) => {
              const company = e.target.value;
              const lead = leads.find((l) => l.company === company);
              void selectLead(lead ? lead.id : "");
            }}
          />
        </div>
      </div>

      {error && <p className="text-[0.78rem] text-[var(--color-accent)]">{error}</p>}

      {surface === "playbook" ? (
        playbook ? (
          <PlaybookEditor
            sections={{ pronunciations: playbook.pronunciations, glossary: playbook.glossary, offerings: playbook.offerings }}
            onChange={updateSection}
            onDraft={onDraft}
            drafting={drafting}
          />
        ) : null
      ) : (
        <Panel>
          {meetingLoading ? (
            <EmptyState icon={GraduationCap} title="Tailoring your prep…" message="Building cards for this meeting from the lead's details." />
          ) : stages.length === 0 ? (
            <EmptyState
              icon={GraduationCap}
              title="Your playbook is empty"
              message="Switch to the Playbook tab to add cards or draft them with AI, then come back to train."
              action={<button className="btn btn-accent" onClick={() => setSurface("playbook")}><BookOpen size={15} /> Open Playbook</button>}
            />
          ) : (
            <SessionRunner
              key={sessionKey}
              stages={stages}
              onGrade={onGrade}
              onRestart={() => setSessionKey((k) => k + 1)}
            />
          )}
        </Panel>
      )}
    </div>
  );
}
