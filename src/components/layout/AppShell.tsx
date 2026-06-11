"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { useStore } from "@/lib/store";
import { BrandMark } from "./Brand";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { ready, settings } = useStore();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Apply the saved brand accent globally (persists across reloads).
  useEffect(() => {
    const c = settings.accentColor;
    if (!c) return;
    document.documentElement.style.setProperty("--color-accent", c);
    document.documentElement.style.setProperty("--color-accent-soft", c);
  }, [settings.accentColor]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 animate-fade">
          <div className="animate-pulse">
            <BrandMark size={32} />
          </div>
          <p className="text-[0.72rem] tracking-[0.14em] uppercase text-[var(--color-dim)]">
            Loading Pallisade OS
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative" style={{ zIndex: 1 }}>
      {/* Desktop sidebar */}
      <aside className="hidden md:block fixed inset-y-0 left-0 w-[236px] z-20">
        <Sidebar />
      </aside>

      {/* Mobile slide-over */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-[rgba(5,5,6,0.7)] animate-fade"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-[260px] animate-rise">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
            <button
              className="btn btn-ghost btn-icon absolute top-3 right-3"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      <div className="md:pl-[236px] min-h-screen flex flex-col">
        <Topbar onMenu={() => setMobileOpen(true)} />
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 sm:py-8 max-w-[1400px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
