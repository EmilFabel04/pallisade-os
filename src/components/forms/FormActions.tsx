export function FormActions({
  onCancel,
  saveLabel = "Save",
  saveDisabled,
}: {
  onCancel: () => void;
  saveLabel?: string;
  saveDisabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-[var(--color-line)]">
      <button type="button" className="btn" onClick={onCancel}>
        Cancel
      </button>
      <button type="submit" className="btn btn-accent" disabled={saveDisabled}>
        {saveLabel}
      </button>
    </div>
  );
}
