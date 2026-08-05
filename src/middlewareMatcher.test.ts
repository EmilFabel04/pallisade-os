import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The matcher is a negative lookahead listing the paths NextAuth must NOT
 * front. Widening it by accident leaves a route unauthenticated with no
 * visible symptom, so the exclusions are pinned explicitly here.
 *
 * The pattern is read out of middleware.ts as text rather than imported.
 * Two reasons, both load-bearing:
 *   1. Importing middleware.ts pulls in next-auth, which cannot resolve
 *      `next/server` under vitest.
 *   2. Next.js statically analyses the `config` export at build time and
 *      REJECTS an imported constant ("Unknown identifier ... at
 *      config.matcher[0]"), failing the build outright — so the literal
 *      cannot be extracted into a shared module to make it importable.
 * Reading the file tests the exact string Next.js will use, with no parallel
 * copy that could drift.
 */
const source = readFileSync(join(process.cwd(), "src/middleware.ts"), "utf8");
const literal = source.match(/"(\/\(\(\?!.*?)"/s)?.[1];
// The file holds JS source, so `\\.` in it is an escaped backslash followed by
// a dot. Collapse the doubling to get the regex the runtime actually compiles.
const matcher = new RegExp(`^${literal?.replace(/\\\\/g, "\\")}$`);
const fronted = (path: string) => matcher.test(path);

describe("middleware matcher", () => {
  it("is an inline literal Next.js can statically analyse", () => {
    // Guards the build itself: an imported identifier here fails `next build`.
    expect(literal).toBeTruthy();
    expect(source).not.toMatch(/matcher:\s*\[\s*[A-Z_]+\s*\]/);
  });

  it("excludes the cron-invoked daily route", () => {
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
