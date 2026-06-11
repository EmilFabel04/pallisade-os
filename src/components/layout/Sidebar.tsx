"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV, NAV_GROUPS } from "./nav";
import { BrandWordmark } from "./Brand";
import { useSettings } from "@/lib/store";
import { cn } from "@/lib/utils";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const settings = useSettings();

  return (
    <div className="flex h-full flex-col bg-[var(--color-surface)] border-r border-[var(--color-line)]">
      <div className="px-5 h-16 flex items-center border-b border-[var(--color-line)] shrink-0">
        <Link href="/" onClick={onNavigate}>
          <BrandWordmark />
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {NAV_GROUPS.map((group) => {
          const items = NAV.filter((n) => n.group === group);
          if (!items.length) return null;
          return (
            <div key={group}>
              <p className="px-3 mb-1.5 text-[0.6rem] font-semibold tracking-[0.14em] uppercase text-[var(--color-dim)]">
                {group}
              </p>
              <div className="space-y-0.5">
                {items.map((item) => {
                  const active =
                    item.href === "/"
                      ? pathname === "/"
                      : pathname.startsWith(item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onNavigate}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-md px-3 py-2 text-[0.84rem] transition-colors",
                        active
                          ? "text-[var(--color-ink)] bg-[var(--color-surface-2)]"
                          : "text-[var(--color-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]",
                      )}
                    >
                      {active && (
                        <span
                          className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[2.5px] rounded-full"
                          style={{ background: "var(--color-accent)" }}
                        />
                      )}
                      <Icon
                        size={17}
                        strokeWidth={active ? 2.1 : 1.8}
                        className={active ? "text-[var(--color-accent)]" : ""}
                      />
                      <span className={active ? "font-medium" : ""}>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="px-5 py-4 border-t border-[var(--color-line)] shrink-0">
        <div className="flex items-center gap-2.5">
          <div
            className="flex items-center justify-center text-[0.7rem] font-semibold text-white shrink-0"
            style={{ width: 30, height: 30, borderRadius: 8, background: "var(--color-accent)" }}
          >
            {(settings.founderName || "E").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-[0.8rem] font-medium text-[var(--color-ink)] truncate">
              {settings.founderName || "Emil"}
            </div>
            <div className="text-[0.68rem] text-[var(--color-dim)] truncate">
              {settings.businessName || "Pallisade Data"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
