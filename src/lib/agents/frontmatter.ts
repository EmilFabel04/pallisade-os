/* ============================================================
   Frontmatter parser for agent files.

   Deliberately not a YAML library. Every field in every agent file is a
   scalar or a flat string array, and the app carries no YAML dependency.
   If a file ever needs nested YAML, add the dependency then — do not grow
   this into a parser.
   ============================================================ */

export interface Frontmatter {
  meta: Record<string, string | string[]>;
  body: string;
}

const DELIM = /^---[ \t]*$/;

function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) {
    return t.slice(1, -1);
  }
  return t;
}

function parseValue(raw: string): string | string[] {
  const t = raw.trim();
  if (t.startsWith("[") && t.endsWith("]")) {
    const inner = t.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map(unquote).filter((s) => s.length > 0);
  }
  return unquote(t);
}

export function parseFrontmatter(source: string): Frontmatter {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  if (!DELIM.test(lines[0] ?? "")) {
    throw new Error("missing frontmatter: file must start with ---");
  }

  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (DELIM.test(lines[i])) { end = i; break; }
  }
  if (end === -1) throw new Error("unterminated frontmatter: no closing ---");

  const meta: Record<string, string | string[]> = {};
  for (const line of lines.slice(1, end)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    meta[line.slice(0, colon).trim()] = parseValue(line.slice(colon + 1));
  }

  return { meta, body: lines.slice(end + 1).join("\n").trim() };
}
