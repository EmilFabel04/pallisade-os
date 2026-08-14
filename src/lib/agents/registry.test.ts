import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadRegistry,
  getAgent,
  listAgents,
  resetRegistryCache,
  AgentNotFound,
} from "@/lib/agents/registry";

function fixtureDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "agents-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

const file = (name: string, surface: string) =>
  `---\nname: ${name}\ndescription: D\ncolor: "#fff"\nemoji: A\nvibe: V\nsurface: ${surface}\ntools: [crm]\n---\nBODY ${name}`;

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

// loadOverrides is DB-backed (src/lib/agents/overrides.ts). Stub it at the
// module boundary so nothing in this file ever calls getClient() — the
// default client points at the founder's real production database. See the
// task brief's "Database hazard" section.
const overridesState = vi.hoisted(() => ({ map: new Map<string, string>() }));
vi.mock("@/lib/agents/overrides", () => ({
  loadOverrides: () => Promise.resolve(overridesState.map),
}));

// getAgent/listAgents read a hardcoded AGENTS_DIR (src/agents under cwd) with
// no way to inject a directory — that's the point, it's the production
// entrypoint. src/agents itself is empty until Task 7 (only .gitkeep), so to
// exercise the cache/filtering behavior we redirect just that one path to a
// fixture directory and leave every other readdir/readFile call (the
// explicit-dir calls the first describe block makes) untouched.
const AGENTS_DIR = join(process.cwd(), "src", "agents");
const fsRedirect = vi.hoisted(() => ({ from: "", to: "" }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readdir: (path: unknown, ...rest: unknown[]) =>
      (actual.readdir as (...a: unknown[]) => unknown)(
        path === fsRedirect.from ? fsRedirect.to : path,
        ...rest,
      ),
    readFile: (path: unknown, ...rest: unknown[]) => {
      const p = path as string;
      const redirected =
        fsRedirect.from && p.startsWith(fsRedirect.from + "/")
          ? join(fsRedirect.to, p.slice(fsRedirect.from.length + 1))
          : p;
      return (actual.readFile as (...a: unknown[]) => unknown)(redirected, ...rest);
    },
  };
});

describe("loadRegistry", () => {
  it("loads every .md file, keyed by filename without extension", async () => {
    const dir = fixtureDir({ "a.md": file("A", "brain"), "b.md": file("B", "advisor") });
    dirs.push(dir);
    const reg = await loadRegistry(dir);
    expect([...reg.keys()].sort()).toEqual(["a", "b"]);
    expect(reg.get("a")!.name).toBe("A");
  });

  it("ignores non-markdown files", async () => {
    const dir = fixtureDir({ "a.md": file("A", "brain"), "notes.txt": "ignore me" });
    dirs.push(dir);
    expect((await loadRegistry(dir)).size).toBe(1);
  });

  it("throws with the filename when one agent file is invalid", async () => {
    const dir = fixtureDir({ "broken.md": file("A", "nowhere") });
    dirs.push(dir);
    await expect(loadRegistry(dir)).rejects.toThrow(/broken.*surface/s);
  });
});

describe("registry: override precedence", () => {
  beforeEach(() => {
    overridesState.map = new Map();
  });

  it("replaces body with the DB override but leaves every other field file-owned", async () => {
    const dir = fixtureDir({ "a.md": file("A", "brain") });
    dirs.push(dir);
    overridesState.map = new Map([["a", "OVERRIDDEN"]]);

    const reg = await loadRegistry(dir);
    const spec = reg.get("a")!;

    expect(spec.body).toBe("OVERRIDDEN");
    expect(spec.name).toBe("A");
    expect(spec.description).toBe("D");
    expect(spec.color).toBe("#fff");
    expect(spec.emoji).toBe("A");
    expect(spec.vibe).toBe("V");
    expect(spec.surface).toBe("brain");
    expect(spec.tools).toEqual(["crm"]);
  });

  it("leaves body as the file's body when there is no override for that id", async () => {
    const dir = fixtureDir({ "b.md": file("B", "brain") });
    dirs.push(dir);
    overridesState.map = new Map([["a", "OVERRIDDEN"]]); // override for a different id

    const reg = await loadRegistry(dir);
    expect(reg.get("b")!.body).toBe("BODY B");
  });
});

describe("registry cache: getAgent, listAgents, resetRegistryCache", () => {
  beforeEach(() => {
    resetRegistryCache();
    overridesState.map = new Map();
    fsRedirect.from = AGENTS_DIR;
    fsRedirect.to = "";
  });

  it("listAgents returns cards for one surface only, sorted by name", async () => {
    const dir = fixtureDir({
      "z.md": file("Zed", "brain"),
      "a.md": file("Amy", "brain"),
      "c.md": file("Cee", "advisor"),
    });
    dirs.push(dir);
    fsRedirect.to = dir;

    const brainCards = await listAgents("brain");
    expect(brainCards.map((c) => c.name)).toEqual(["Amy", "Zed"]);

    const advisorCards = await listAgents("advisor");
    expect(advisorCards.map((c) => c.name)).toEqual(["Cee"]);

    const projectCards = await listAgents("project");
    expect(projectCards).toEqual([]);
  });

  it("listAgents cards carry no body and no tools — exact key set only", async () => {
    const dir = fixtureDir({ "a.md": file("A", "brain") });
    dirs.push(dir);
    fsRedirect.to = dir;

    const [card] = await listAgents("brain");
    expect(Object.keys(card).sort()).toEqual([
      "color",
      "description",
      "emoji",
      "id",
      "name",
      "vibe",
    ]);
  });

  it("getAgent returns the full spec, including body and tools", async () => {
    const dir = fixtureDir({ "a.md": file("A", "brain") });
    dirs.push(dir);
    fsRedirect.to = dir;

    const spec = await getAgent("a");
    expect(spec.body).toBe("BODY A");
    expect(spec.tools).toEqual(["crm"]);
  });

  it("getAgent throws AgentNotFound for an unknown id", async () => {
    const dir = fixtureDir({ "a.md": file("A", "brain") });
    dirs.push(dir);
    fsRedirect.to = dir;

    await expect(getAgent("nope")).rejects.toThrow(AgentNotFound);
  });

  it("memoises the registry: a directory change is invisible until resetRegistryCache", async () => {
    const dir1 = fixtureDir({ "a.md": file("A", "brain") });
    dirs.push(dir1);
    fsRedirect.to = dir1;
    expect((await getAgent("a")).name).toBe("A");

    const dir2 = fixtureDir({ "a.md": file("CHANGED", "brain") });
    dirs.push(dir2);
    fsRedirect.to = dir2;
    expect((await getAgent("a")).name).toBe("A"); // still cached

    resetRegistryCache();
    expect((await getAgent("a")).name).toBe("CHANGED");
  });

  it("does not permanently cache a rejected load — a transient failure is retried, not fatal until restart", async () => {
    fsRedirect.to = join(tmpdir(), `agents-missing-${Math.random().toString(36).slice(2)}`);
    await expect(getAgent("a")).rejects.toThrow();

    const dir = fixtureDir({ "a.md": file("A", "brain") });
    dirs.push(dir);
    fsRedirect.to = dir;
    // No resetRegistryCache() call here — the rejected load must not have stuck.
    expect((await getAgent("a")).name).toBe("A");
  });
});
