import { describe, it, expect } from "vitest";
import { startEdit, setDraft, commit, cancel } from "./inlineEdit";

describe("inlineEdit", () => {
  it("seeds the draft from the current value when editing starts", () => {
    const s = startEdit(12);
    expect(s.editing).toBe(true);
    expect(s.draft).toBe("12");
  });

  it("commits the drafted number", () => {
    const s = setDraft(startEdit(12), "40");
    const r = commit(s);
    expect(r.value).toBe(40);
    expect(r.state.editing).toBe(false);
  });

  it("commits exactly once — a blur after Enter is a no-op", () => {
    const s = setDraft(startEdit(12), "40");
    const first = commit(s);
    expect(first.value).toBe(40);

    const second = commit(first.state);
    expect(second.value).toBeNull();
  });

  it("commits nothing when the edit is cancelled", () => {
    const s = setDraft(startEdit(12), "40");
    const cancelled = cancel(s);
    expect(cancelled.editing).toBe(false);
    expect(commit(cancelled).value).toBeNull();
  });

  it("commits nothing on a blur that follows Escape", () => {
    const s = setDraft(startEdit(12), "999");
    const afterEscape = cancel(s);
    const afterBlur = commit(afterEscape);
    expect(afterBlur.value).toBeNull();
  });

  it("commits nothing for a non-numeric draft", () => {
    const s = setDraft(startEdit(12), "abc");
    expect(commit(s).value).toBeNull();
  });

  it("commits nothing for a blank draft", () => {
    expect(commit(setDraft(startEdit(12), "")).value).toBeNull();
    expect(commit(setDraft(startEdit(12), "   ")).value).toBeNull();
  });

  it("clamps a negative draft to 0", () => {
    expect(commit(setDraft(startEdit(12), "-5")).value).toBe(0);
  });

  it("commits a zero draft rather than treating it as absent", () => {
    expect(commit(setDraft(startEdit(12), "0")).value).toBe(0);
  });

  it("leaves the edit closed after a cancel so the input unmounts", () => {
    expect(cancel(startEdit(3)).editing).toBe(false);
  });
});
