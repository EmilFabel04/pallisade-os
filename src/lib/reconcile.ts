import type { DataShape, Milestone, Settings } from "./types";
import { nowISO, uid } from "./utils";
import { DEFAULT_SETTINGS } from "./seed";

/**
 * One-time, idempotent data reconciliation applied at hydration so existing
 * records adapt to newer behaviours.
 *
 * Follow-up sync: a lead's `nextFollowUp` is now set whenever a follow-up task
 * is logged against it (see TaskForm). Leads created before that wiring can have
 * open follow-up tasks but an empty `nextFollowUp`. Here we backfill each such
 * lead from the EARLIEST open follow-up task's due date — the next follow-up.
 *
 * Only empty `nextFollowUp` values are filled; an already-set date (manual or
 * from a newer task) is never clobbered. Running this repeatedly is a no-op.
 */
export function reconcileFollowUps(data: DataShape): DataShape {
  // leadId -> earliest open follow-up task due date (YYYY-MM-DD)
  const earliestByLead = new Map<string, string>();
  for (const t of data.tasks) {
    if (t.linkKind !== "lead" || !t.linkId) continue;
    if (t.category !== "follow-up") continue;
    if (t.status === "done") continue;
    if (!t.dueDate) continue;
    const due = t.dueDate.slice(0, 10);
    const current = earliestByLead.get(t.linkId);
    if (!current || due < current) earliestByLead.set(t.linkId, due);
  }

  if (earliestByLead.size === 0) return data;

  let changed = false;
  const leads = data.leads.map((l) => {
    if (l.nextFollowUp) return l; // never overwrite an existing date
    const due = earliestByLead.get(l.id);
    if (!due) return l;
    changed = true;
    return { ...l, nextFollowUp: due };
  });

  return changed ? { ...data, leads } : data;
}

/**
 * Migrates the legacy `Project.currentMilestone` string onto a real Milestone
 * record. Runs on every hydrate alongside reconcileFollowUps.
 *
 * A project qualifies when it has a non-empty `currentMilestone` AND zero
 * milestone records. After migrating we blank the string — that is what makes
 * this idempotent, and it means the migration cannot re-fire after the founder
 * deliberately deletes every milestone on a project.
 */
export function reconcileProjects(data: DataShape): DataShape {
  const withMilestones = new Set(data.milestones.map((m) => m.projectId));
  const needing = data.projects.filter(
    // Defensive: this runs on restored/foreign/historical payloads, so a field
    // typed as non-optional on `Project` (`currentMilestone`) can't be trusted
    // to actually be present. `.trim()` on undefined threw here, which bricks
    // hydration (see store.tsx) — never let a malformed record escape as an
    // exception. The other fields this function reads (`id`, `startDate`,
    // `dueDate`) are only read/compared, never method-called, so a missing
    // value can't throw — but the constructor below still defaults them
    // rather than propagate `undefined` into a `string | null` field.
    (p) => (p.currentMilestone ?? "").trim() && !withMilestones.has(p.id),
  );
  if (needing.length === 0) return data;

  const ts = nowISO();
  const created: Milestone[] = needing.map((p) => ({
    id: uid("mil"),
    createdAt: ts,
    updatedAt: ts,
    projectId: p.id,
    name: (p.currentMilestone ?? "").trim(),
    startDate: p.startDate ?? null,
    endDate: p.dueDate ?? null,
    status: "in progress",
    order: 0,
    dependsOn: [],
    commitScope: "",
    notes: "",
  }));

  const migrated = new Set(needing.map((p) => p.id));
  const projects = data.projects.map((p) =>
    migrated.has(p.id) ? { ...p, currentMilestone: "" } : p,
  );

  return { ...data, projects, milestones: [...data.milestones, ...created] };
}

const CAPEX_BANDS = ["micro", "small", "mid", "enterprise"] as const;

/**
 * Backfills a `Settings` object against `DEFAULT_SETTINGS`, key by key.
 *
 * `Settings` is typed as fully populated, but a row written before a field
 * existed (e.g. before the pricing fields were added) can't be trusted to
 * actually carry it at runtime — same defensive stance as `reconcileProjects`
 * above. A missing `targetMarginPct` silently turns every retainer floor into
 * `NaN`, and a missing `capexMultipliers` throws outright, so this has to run
 * before that data reaches the pricing engine.
 *
 * Merges with `??`, never `||` or a blind object spread: `minimumSetupFee: 0`
 * and `usdToZar: 0` are deliberate "unset" sentinels the engine already
 * understands (see `Settings`), and `??` is the one operator that backfills
 * `null`/`undefined` while leaving a stored `0` alone. `capexMultipliers` is
 * merged per-band for the same reason — a row can plausibly carry a partial
 * object (e.g. only `micro` set).
 *
 * Returns the same reference when nothing was missing, matching
 * `reconcileFollowUps` / `reconcileProjects` above.
 */
export function backfillSettings(settings: Settings): Settings {
  let changed = false;
  const patch: Partial<Settings> = {};

  const scalarKeys = [
    "businessName", "founderName", "mainMarket", "services", "accentColor",
    "currency", "secondaryCurrencyEnabled",
    "targetMarginPct", "minimumSetupFee", "usdToZar",
  ] as const;
  for (const k of scalarKeys) {
    if (settings[k] === undefined || settings[k] === null) {
      (patch as Record<string, unknown>)[k] = DEFAULT_SETTINGS[k];
      changed = true;
    }
  }

  const rawCapex = settings.capexMultipliers;
  let capexChanged = false;
  const capexPatch: Partial<Settings["capexMultipliers"]> = {};
  for (const band of CAPEX_BANDS) {
    const v = rawCapex?.[band];
    if (v === undefined || v === null) {
      capexPatch[band] = DEFAULT_SETTINGS.capexMultipliers[band];
      capexChanged = true;
    }
  }
  if (capexChanged) {
    patch.capexMultipliers = { ...rawCapex, ...capexPatch };
    changed = true;
  }

  return changed ? { ...settings, ...patch } : settings;
}

/** Runs `backfillSettings` at the `DataShape` level, alongside the other
 *  hydrate-time reconciliations. */
export function reconcileSettings(data: DataShape): DataShape {
  const settings = backfillSettings(data.settings);
  return settings === data.settings ? data : { ...data, settings };
}
