import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  message,
  action,
}: {
  icon: LucideIcon;
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      <div
        className="flex items-center justify-center mb-4"
        style={{
          width: 52,
          height: 52,
          borderRadius: 12,
          border: "1px solid var(--color-line-strong)",
          background: "var(--color-surface-2)",
          color: "var(--color-muted)",
        }}
      >
        <Icon size={22} strokeWidth={1.5} />
      </div>
      <h3 className="text-[0.95rem] font-semibold text-[var(--color-ink)]">{title}</h3>
      <p className="text-[0.83rem] text-[var(--color-muted)] mt-1.5 max-w-sm leading-relaxed">
        {message}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
