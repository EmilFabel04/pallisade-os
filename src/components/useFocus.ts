"use client";

import { useSearchParams } from "next/navigation";

/** Reads ?focus=<id> so search / dashboard links can deep-open a record.
 *  Pages that use this must render inside a <Suspense> boundary. */
export function useFocusParam(): string | null {
  return useSearchParams().get("focus");
}
