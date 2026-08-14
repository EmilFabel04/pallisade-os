/* Server-only. Reads src/agents/*.md, validates, applies body overrides. */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSpec, toCard } from "./spec";
import { loadOverrides } from "./overrides";
import type { AgentCard, AgentSpec, AgentSurface } from "./types";

const AGENTS_DIR = join(process.cwd(), "src", "agents");

export class AgentNotFound extends Error {
  constructor(id: string) { super(`unknown agent: ${id}`); }
}

let cache: Promise<Map<string, AgentSpec>> | null = null;

export async function loadRegistry(dir: string = AGENTS_DIR): Promise<Map<string, AgentSpec>> {
  const names = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  const overrides = await loadOverrides();

  const specs = await Promise.all(
    names.map(async (f) => {
      const id = f.slice(0, -3);
      const spec = buildSpec(id, await readFile(join(dir, f), "utf8"));
      const body = overrides.get(id);
      return body ? { ...spec, body } : spec;
    }),
  );

  return new Map(specs.map((s) => [s.id, s]));
}

function registry(): Promise<Map<string, AgentSpec>> {
  if (!cache) {
    // A rejected load must not stick around forever — a transient DB or
    // filesystem hiccup would otherwise disable the whole registry until the
    // process restarts. Clear the cache on failure so the next call retries
    // from scratch. (This bug exists in content/daily/store.ts's schemaReady
    // and was inherited by overrides.ts's schemaReady; do not inherit it here.)
    //
    // Clearing must check that `cache` still refers to THIS attempt before
    // nulling it. resetRegistryCache() plus a newer, successful load can
    // land while this attempt is still in flight (Task 16's Settings editor
    // calls resetRegistryCache() after writing an override); an unconditional
    // clear would then discard that newer, valid cache out from under it once
    // this stale attempt finally rejects.
    const attempt: Promise<Map<string, AgentSpec>> = loadRegistry().catch((err: unknown) => {
      if (cache === attempt) cache = null;
      throw err;
    });
    cache = attempt;
  }
  return cache;
}

/** Tests and the Settings editor call this after writing an override. */
export function resetRegistryCache(): void { cache = null; }

export async function getAgent(id: string): Promise<AgentSpec> {
  const spec = (await registry()).get(id);
  if (!spec) throw new AgentNotFound(id);
  return spec;
}

export async function listAgents(surface: AgentSurface): Promise<AgentCard[]> {
  return [...(await registry()).values()]
    .filter((s) => s.surface === surface)
    .map(toCard)
    .sort((a, b) => a.name.localeCompare(b.name));
}
