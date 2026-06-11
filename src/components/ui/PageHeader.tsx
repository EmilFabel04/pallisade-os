export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
      <div>
        <h1 className="text-[1.45rem] font-semibold tracking-[-0.01em] text-[var(--color-ink)]">
          {title}
        </h1>
        {subtitle && (
          <p className="text-[0.86rem] text-[var(--color-muted)] mt-1 max-w-2xl leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow mb-3">{children}</p>;
}
