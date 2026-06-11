export function DetailGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-5 gap-y-3.5">{children}</div>;
}

export function DetailRow({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <dt className="text-[0.66rem] font-semibold tracking-[0.08em] uppercase text-[var(--color-dim)] mb-1">
        {label}
      </dt>
      <dd className="text-[0.86rem] text-[var(--color-ink-soft)] leading-relaxed">
        {children || <span className="text-[var(--color-dim)]">—</span>}
      </dd>
    </div>
  );
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="inline-flex items-center gap-2">
      <span className="text-[0.7rem] uppercase tracking-wider text-[var(--color-dim)] hidden lg:inline">
        {label}
      </span>
      <select
        className="select"
        style={{ height: 34, fontSize: "0.8rem", minWidth: 120 }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
