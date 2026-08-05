import { describe, it, expect } from "vitest";
import { AUTH_PATH_MATCHER } from "./authMatcher";

/**
 * The matcher is a negative lookahead listing the paths NextAuth must NOT
 * front. Widening it by accident leaves a route unauthenticated with no
 * visible symptom, so the exclusions are pinned explicitly here.
 */
const matcher = new RegExp(`^${AUTH_PATH_MATCHER}$`);
const fronted = (path: string) => matcher.test(path);

describe("auth path matcher", () => {
  it("excludes the cron-invoked daily route", () => {
    // Gated inside the handler by CRON_SECRET or a session; if middleware
    // fronted it, Vercel's cron would be redirected to /login instead.
    expect(fronted("/api/content/daily")).toBe(false);
  });

  it("still fronts every other content route", () => {
    expect(fronted("/api/content/posts")).toBe(true);
    expect(fronted("/api/content/posts/p1")).toBe(true);
    expect(fronted("/api/content/fingerprint")).toBe(true);
    expect(fronted("/api/content")).toBe(true);
  });

  it("keeps the pre-existing exclusions", () => {
    expect(fronted("/api/auth/callback/google")).toBe(false);
    expect(fronted("/login")).toBe(false);
    expect(fronted("/_next/static/chunk.js")).toBe(false);
    expect(fronted("/favicon.ico")).toBe(false);
    expect(fronted("/icon.svg")).toBe(false);
    expect(fronted("/logo.png")).toBe(false);
  });

  it("still fronts the app's own pages and data routes", () => {
    expect(fronted("/")).toBe(true);
    expect(fronted("/content")).toBe(true);
    expect(fronted("/leads")).toBe(true);
    expect(fronted("/api/data")).toBe(true);
  });
});
