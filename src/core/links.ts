import { decodeReplUrl, REPL_HOSTS, replHasContent, summarizeRepl } from "./repl.ts";
import type { ReproLink } from "./types.ts";

// Deterministic reproduction-link detection. Runs on the raw body before any
// sanitizing, so the REPL hash is still intact.

const URL_RE = /https?:\/\/[^\s<>()[\]"'`]+/g;

/** Repos whose links are references (docs, source, other issues), not reproductions. */
const REFERENCE_OWNERS = new Set([
  "rolldown",
  "vitejs",
  "rollup",
  "oxc-project",
  "evanw",
  "nodejs",
  "microsoft",
  "webpack",
  "web-infra-dev",
]);

const STARTER_RE = /rolldown-starter-stackblitz/i;

export function extractReproLinks(body: string): ReproLink[] {
  const seen = new Set<string>();
  const links: ReproLink[] = [];
  for (const match of body.matchAll(URL_RE)) {
    const url = match[0].replace(/[.,;:!?]+$/, "");
    if (seen.has(url)) continue;
    seen.add(url);
    const link = classify(url);
    if (link) links.push(link);
  }
  return links;
}

function classify(url: string): ReproLink | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const path = parsed.pathname;
  const segments = path.split("/").filter(Boolean);

  if (REPL_HOSTS.includes(host)) {
    const decoded = decodeReplUrl(url);
    return {
      kind: "repl",
      url,
      ok: replHasContent(decoded),
      detail: summarizeRepl(decoded),
    };
  }

  if (host === "stackblitz.com") {
    if (STARTER_RE.test(path)) {
      return { kind: "stackblitz", url, ok: false, detail: "starter template, not a reproduction" };
    }
    if (/^\/(edit|github|fork|~)\//.test(path)) return { kind: "stackblitz", url, ok: true };
    return null;
  }

  if (host === "codesandbox.io") {
    // Same rule StackBlitz already had: a sandbox lives under a project path.
    // Without it `codesandbox.io/pricing` counted as a reproduction and
    // short-circuited the check in code.
    if (/^\/(s|p|embed|devbox|sandbox)\//.test(path)) {
      return { kind: "codesandbox", url, ok: true };
    }
    return null;
  }
  if (host.endsWith(".csb.app")) {
    return { kind: "codesandbox", url, ok: true };
  }

  if (host === "vite.new" || host === "vitest.new" || host === "stackblitz.new") {
    return { kind: "webcontainer", url, ok: true };
  }

  if (host === "gist.github.com") {
    return segments.length >= 2 ? { kind: "gist", url, ok: true } : null;
  }

  if (host === "github.com") {
    const [owner, repo, section] = segments;
    if (!owner || !repo) return null;
    if (REFERENCE_OWNERS.has(owner.toLowerCase()) || STARTER_RE.test(repo)) return null;
    if (section === undefined || section === "tree" || section === "archive") {
      return { kind: "github_repo", url, ok: true };
    }
    if (section === "releases" && path.includes("/download/")) {
      return { kind: "github_repo", url, ok: true };
    }
    // issues, pull, blob, discussions, commit, compare, actions, ... are references.
    return null;
  }

  return null;
}
