"use client";

import { useEffect, useState } from "react";
import type { NewsInterests } from "@/lib/types";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput, TextArea } from "@/components/ui/Field";

type Editable = Pick<
  NewsInterests,
  "topics" | "githubLanguages" | "githubTopics" | "subreddits" | "rssFeeds" | "aboutMe"
>;

export function NewsInterestsModal({
  open,
  interests,
  onClose,
  onSave,
}: {
  open: boolean;
  interests: NewsInterests;
  onClose: () => void;
  onSave: (patch: Editable) => void;
}) {
  const [form, setForm] = useState<Editable>(interests);

  useEffect(() => { setForm(interests); }, [interests, open]);

  const set = (k: keyof Editable) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="News interests"
      subtitle="Tune what the feed pulls and how it judges relevance."
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-accent" onClick={() => { onSave(form); onClose(); }}>Save</button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label="Topics & keywords" hint="Comma-separated; used to rank and judge relevance.">
          <TextInput value={form.topics} onChange={set("topics")} placeholder="AI agents, RAG, automation" />
        </Field>
        <Field label="GitHub languages" hint="Comma-separated, e.g. TypeScript, Python">
          <TextInput value={form.githubLanguages} onChange={set("githubLanguages")} />
        </Field>
        <Field label="GitHub topics" hint="Comma-separated, e.g. llm, agents, rag">
          <TextInput value={form.githubTopics} onChange={set("githubTopics")} />
        </Field>
        <Field label="Subreddits" hint="Comma-separated, no r/ prefix">
          <TextInput value={form.subreddits} onChange={set("subreddits")} />
        </Field>
        <Field label="RSS feeds" hint="One per line. Prefix with a category: ai|url, finance|url, products|url (bare url ⇒ ai).">
          <TextArea rows={4} value={form.rssFeeds} onChange={set("rssFeeds")} />
        </Field>
        <Field label="About me" hint="Helps Claude judge what's relevant to you.">
          <TextArea rows={3} value={form.aboutMe} onChange={set("aboutMe")} />
        </Field>
      </div>
    </Modal>
  );
}
