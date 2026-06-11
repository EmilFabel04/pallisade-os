"use client";

import { DataProvider } from "@/lib/store";
import { QuickAddProvider } from "@/components/forms/QuickAdd";
import { AppShell } from "@/components/layout/AppShell";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <DataProvider>
      <QuickAddProvider>
        <AppShell>{children}</AppShell>
      </QuickAddProvider>
    </DataProvider>
  );
}
