import { parseFrontmatter } from "./frontmatter";
import {
  AGENT_SURFACES, CAPABILITY_GROUPS,
  type AgentCard, type AgentSpec, type AgentSurface, type CapabilityGroup,
} from "./types";

const REQUIRED = ["name", "description", "color", "emoji", "vibe", "surface"] as const;

function str(meta: Record<string, string | string[]>, key: string, id: string): string {
  const v = meta[key];
  if (typeof v !== "string" || !v.trim()) {
    throw new Error(`agent "${id}": field "${key}" is required and must be a non-empty string`);
  }
  return v;
}

export function buildSpec(id: string, source: string): AgentSpec {
  // parseFrontmatter throws structural errors ("missing frontmatter",
  // "unterminated frontmatter") that know nothing about agents. Re-throw with
  // the id attached — otherwise a boot failure across the whole roster reports
  // only that *a* file is malformed, and names none of them.
  let parsed;
  try {
    parsed = parseFrontmatter(source);
  } catch (err) {
    throw new Error(`agent "${id}": ${(err as Error).message}`);
  }
  const { meta, body } = parsed;

  for (const key of REQUIRED) str(meta, key, id);

  const surface = meta.surface as string;
  if (!(AGENT_SURFACES as readonly string[]).includes(surface)) {
    throw new Error(
      `agent "${id}": field "surface" has unknown value "${surface}" ` +
      `(expected one of ${AGENT_SURFACES.join(", ")})`,
    );
  }

  const rawTools = meta.tools ?? [];
  const tools = Array.isArray(rawTools) ? rawTools : [rawTools];
  for (const t of tools) {
    if (!(CAPABILITY_GROUPS as readonly string[]).includes(t)) {
      throw new Error(
        `agent "${id}": field "tools" has unknown capability group "${t}" ` +
        `(expected one of ${CAPABILITY_GROUPS.join(", ")})`,
      );
    }
  }

  if (!body.trim()) throw new Error(`agent "${id}": body (system prompt) is empty`);

  const model = typeof meta.model === "string" && meta.model.trim() ? meta.model : undefined;

  return {
    id,
    name: str(meta, "name", id),
    description: str(meta, "description", id),
    color: str(meta, "color", id),
    emoji: str(meta, "emoji", id),
    vibe: str(meta, "vibe", id),
    surface: surface as AgentSurface,
    tools: tools as CapabilityGroup[],
    ...(model ? { model } : {}),
    body,
  };
}

export function toCard(spec: AgentSpec): AgentCard {
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    color: spec.color,
    emoji: spec.emoji,
    vibe: spec.vibe,
  };
}
