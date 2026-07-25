/**
 * Click-to-edit state machine for a numeric field, kept pure so it can be
 * unit-tested in this repo's node-env vitest (no DOM).
 *
 * The `handled` latch is the important part: an inline number input commits on
 * blur *and* on Enter, and Escape must commit nothing — so Enter (or Escape)
 * has to disarm the blur that inevitably follows when the input unmounts.
 * Getting this wrong is what commit eefdf22 fixed in the old MetricWidget.
 */
export interface EditState {
  editing: boolean;
  draft: string;
  /** True once this edit has been resolved — blocks any later commit. */
  handled: boolean;
}

export function startEdit(value: number): EditState {
  return { editing: true, draft: String(value), handled: false };
}

export function setDraft(state: EditState, draft: string): EditState {
  return { ...state, draft };
}

/**
 * Resolve the edit. Returns the value to persist, or `null` when nothing
 * should be written (already handled, blank, or non-numeric).
 */
export function commit(state: EditState): { state: EditState; value: number | null } {
  const closed: EditState = { ...state, editing: false, handled: true };
  if (state.handled) return { state: closed, value: null };

  const trimmed = state.draft.trim();
  if (trimmed === "") return { state: closed, value: null };

  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { state: closed, value: null };

  return { state: closed, value: Math.max(0, n) };
}

export function cancel(state: EditState): EditState {
  return { ...state, editing: false, handled: true };
}
