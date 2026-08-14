import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("the mock AI layer stays deleted", () => {
  it("src/lib/ai.ts does not exist", () => {
    expect(existsSync(join(process.cwd(), "src", "lib", "ai.ts"))).toBe(false);
  });

  it("nothing imports @/lib/ai", () => {
    const offenders = walk(join(process.cwd(), "src")).filter((f) => {
      const s = readFileSync(f, "utf8");
      return /from\s+["']@\/lib\/ai["']|from\s+["']\.\/ai["']|from\s+["']\.\.\/ai["']/.test(s);
    });
    expect(offenders).toEqual([]);
  });

  it("aiClient has no silent fallback", () => {
    const s = readFileSync(join(process.cwd(), "src", "lib", "aiClient.ts"), "utf8");
    expect(s).not.toMatch(/fall through to mock/i);
    expect(s).not.toMatch(/generateCallSummary|generateBusinessReview/);
  });
});
