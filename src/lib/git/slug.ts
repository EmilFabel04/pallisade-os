/* ============================================================
   GitHub slug parsing — pure, no fs, no network.

   A project can be linked two ways, and which one is usable depends on where
   the code is running (see source.ts):

     repoPath  an absolute path on this Mac — only readable in local dev
     repoSlug  "owner/repo" — readable anywhere, via api.github.com

   This turns a git remote URL into the second form, so linking a repo locally
   also records the slug and the deployed app works without being told twice.
   ============================================================ */

/**
 * What GitHub actually permits in an owner or repository name: letters,
 * digits, dot, dash, underscore. Deliberately strict — the slug is
 * interpolated into a request URL, so a segment holding "..", a slash, or a
 * query character must never survive this function.
 */
const SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Hosts whose URLs describe a repo this reader can actually fetch. */
const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

function validate(owner: string, repo: string): string | null {
  const name = repo.replace(/\.git$/i, "");
  if (!SEGMENT.test(owner) || !SEGMENT.test(name)) return null;
  // "." and ".." pass SEGMENT but are path traversal, not repo names.
  if (/^\.+$/.test(owner) || /^\.+$/.test(name)) return null;
  return `${owner}/${name}`;
}

/**
 * `owner/repo` from a git remote URL or an already-bare slug, or null.
 *
 * Returns null for a non-GitHub host rather than guessing: the reader only
 * speaks to api.github.com, so a GitLab remote coerced into a slug would
 * produce confident 404s against the wrong service.
 */
export function parseRepoSlug(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim().replace(/\/+$/, "");
  if (!raw) return null;

  // scp-style SSH: git@github.com:owner/repo.git — not a parseable URL.
  const scp = /^[^@/]+@([^:]+):(.+)$/.exec(raw);
  if (scp) {
    if (!GITHUB_HOSTS.has(scp[1].toLowerCase())) return null;
    const parts = scp[2].split("/").filter(Boolean);
    return parts.length === 2 ? validate(parts[0], parts[1]) : null;
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (!GITHUB_HOSTS.has(url.hostname.toLowerCase())) return null;
    // Reject anything carrying a query or fragment: those cannot be part of a
    // repo identity and would otherwise ride along into the API request.
    if (url.search || url.hash) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    return parts.length === 2 ? validate(parts[0], parts[1]) : null;
  }

  const parts = raw.split("/").filter(Boolean);
  if (parts.length !== 2 || raw.startsWith("/")) return null;
  return validate(parts[0], parts[1]);
}

/**
 * True when `ref` is a slug rather than a filesystem path. Used to route a
 * single stored reference to the right reader without a second field.
 */
export function isRepoSlug(ref: string | null | undefined): boolean {
  const raw = (ref ?? "").trim();
  if (!raw || raw.startsWith("/")) return false;
  return parseRepoSlug(raw) !== null;
}
