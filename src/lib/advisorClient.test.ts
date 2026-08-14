/* buildSnapshot is the single narrowing between a stored DataShape and what an
   agent's read tools see. Both the Advisor (client-side, per turn) and the
   Brain route (server-side, from loadAll()) go through it, so the shape the
   tool bus receives is identical on both surfaces — this pins that. */

import { describe, it, expect } from "vitest";
import { buildSnapshot } from "@/lib/advisorClient";
import { DEFAULT_SETTINGS } from "@/lib/seed";
import type { DataShape } from "@/lib/types";

const shape = (): DataShape => ({
  leads: [], interactions: [], projects: [], tasks: [], scorecards: [],
  painPoints: [], conversations: [], playbooks: [], targets: [], dialLists: [],
  positioningProfiles: [], voiceSamples: [], voiceProfile: [], contentThreads: [],
  brainThreads: [], newsFeed: [], newsInterests: [], newsBookmarks: [], notes: [],
  metricEntries: [], milestones: [], projectThreads: [],
  quotes: [], comparables: [],
  settings: DEFAULT_SETTINGS,
});

describe("buildSnapshot", () => {
  it("carries every collection the read tools resolve against", () => {
    const snap = buildSnapshot(shape());
    for (const k of ["leads", "interactions", "projects", "tasks", "scorecards",
                     "painPoints", "dialLists", "milestones", "quotes", "comparables"]) {
      expect(snap, `missing ${k}`).toHaveProperty(k);
    }
    expect(snap.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("drops chat history and content-studio material", () => {
    // Not privacy theatre: the Brain route feeds this straight from loadAll(),
    // which returns every collection in the DB. Chat threads and the founder's
    // raw writing samples are not sales context and must not ride along.
    const snap = buildSnapshot(shape()) as Record<string, unknown>;
    for (const k of ["conversations", "brainThreads", "contentThreads", "projectThreads",
                     "notes", "voiceSamples", "voiceProfile", "positioningProfiles",
                     "newsFeed", "newsInterests", "newsBookmarks", "metricEntries",
                     "playbooks", "targets"]) {
      expect(snap, `${k} must not reach an agent`).not.toHaveProperty(k);
    }
  });
});
