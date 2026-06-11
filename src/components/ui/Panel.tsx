import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Panel({
  title,
  action,
  href,
  children,
  className,
  bodyClassName,
  noPad,
}: {
  title?: string;
  action?: React.ReactNode;
  href?: string;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  noPad?: boolean;
}) {
  return (
    <section className={cn("panel flex flex-col", className)}>
      {title && (
        <div className="panel-head">
          <span className="panel-title">{title}</span>
          {action ??
            (href && (
              <Link
                href={href}
                className="inline-flex items-center gap-1 text-[0.74rem] text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors"
              >
                View all <ArrowUpRight size={13} />
              </Link>
            ))}
        </div>
      )}
      <div className={cn(noPad ? "" : "p-[1.1rem]", "flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}
