import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { extractReproLinks } from "../src/core/links.ts";
import { loadIssue } from "./helpers.ts";

const REPL = `https://repl.rolldown.rs/#${deflateSync(
  Buffer.from(JSON.stringify({ v: "latest", f: { "a.js": { c: "1" } } })),
).toString("base64")}`;

describe("extractReproLinks", () => {
  it("finds a bare REPL url and a markdown-wrapped one once each", () => {
    const body = `see ${REPL}\n\nand [REPL](${REPL}).`;
    const links = extractReproLinks(body);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ kind: "repl", ok: true, url: REPL });
  });

  it("strips trailing punctuation but keeps base64 padding", () => {
    const withPad = "https://repl.rolldown.rs/#eNpLzs8tKMlMzgcABzsCLQ==";
    const links = extractReproLinks(`(${withPad}), then ${withPad}.`);
    expect(links.map((l) => l.url)).toEqual([withPad]);
  });

  it("flags an empty or broken REPL link as not ok", () => {
    const empty = `https://repl.rolldown.rs/#${deflateSync(
      Buffer.from(JSON.stringify({ v: "latest", f: {} })),
    ).toString("base64")}`;
    expect(extractReproLinks(empty)[0]).toMatchObject({ kind: "repl", ok: false, detail: "empty" });
    expect(extractReproLinks("https://repl.rolldown.rs/#eNpLzs8")[0]).toMatchObject({
      kind: "repl",
      ok: false,
    });
  });

  it("accepts stackblitz projects but not the starter template", () => {
    const body = [
      "https://stackblitz.com/edit/stackblitz-starters-xcbf5ppd?file=README.md",
      "https://stackblitz.com/fork/github/rolldown/rolldown-starter-stackblitz",
      "https://stackblitz.com/pricing",
    ].join("\n");
    const links = extractReproLinks(body);
    expect(links).toEqual([
      { kind: "stackblitz", ok: true, url: expect.stringContaining("/edit/") },
      {
        kind: "stackblitz",
        ok: false,
        url: expect.stringContaining("starter"),
        detail: "starter template, not a reproduction",
      },
    ]);
  });

  it("treats github repos and files as reproductions but issue/pr links as references", () => {
    const body = [
      "https://github.com/Dragonite24/rolldown-umd-amd-repro",
      "https://github.com/medz/rolldown-nitro-dev-tla-cycle-repro/tree/main/src",
      "https://github.com/rolldown/rolldown/issues/9287",
      "https://github.com/someone/thing/issues/12",
      "https://github.com/someone/thing/blob/main/README.md",
      "https://github.com/someone/thing/pull/3",
      "https://github.com/vitejs/vite",
      "https://github.com/someone/thing/releases/download/v1/repro.zip",
      "https://github.com/",
    ].join("\n");
    const links = extractReproLinks(body);
    expect(links.map((l) => l.url)).toEqual([
      "https://github.com/Dragonite24/rolldown-umd-amd-repro",
      "https://github.com/medz/rolldown-nitro-dev-tla-cycle-repro/tree/main/src",
      // A file in a third-party repo names a clonable project; only rolldown's
      // own source is filtered, and that happens by owner.
      "https://github.com/someone/thing/blob/main/README.md",
      "https://github.com/someone/thing/releases/download/v1/repro.zip",
    ]);
    expect(links.every((l) => l.kind === "github_repo" && l.ok)).toBe(true);
  });

  it("recognises webcontainer, codesandbox and gist hosts", () => {
    const links = extractReproLinks(
      "https://vite.new https://vitest.new/ https://codesandbox.io/p/sandbox/x https://gist.github.com/u/abc123 https://gist.github.com/",
    );
    expect(links.map((l) => `${l.kind}:${l.ok}`)).toEqual([
      "webcontainer:true",
      "webcontainer:true",
      "codesandbox:true",
      "gist:true",
    ]);
  });

  it("ignores unrelated urls", () => {
    expect(extractReproLinks("https://rolldown.rs/guide https://example.com/x")).toEqual([]);
  });

  it("matches the real fixtures", () => {
    expect(extractReproLinks(loadIssue(10938).body).map((l) => l.kind)).toEqual([
      "webcontainer",
      "webcontainer",
    ]);
    expect(extractReproLinks(loadIssue(10829).body)).toEqual([
      expect.objectContaining({ kind: "github_repo", ok: true }),
    ]);
    expect(extractReproLinks(loadIssue(10798).body)).toEqual([]);
    expect(extractReproLinks(loadIssue(10812).body)).toEqual([]);
  });
});

describe("a file in someone else's repo is a reproduction", () => {
  // rolldown#10970-shaped: the reporter linked the workflow that fails rather
  // than a repo root or a REPL. It is the same effort and the same clonable
  // project, so rejecting it sent an issue with a reproduction to the model.
  it("accepts a blob link outside the reference owners", () => {
    const [link] = extractReproLinks(
      "https://github.com/mikicvi/pihole-switcher/blob/master/.github/workflows/docker-publish.yaml",
    );
    expect(link).toMatchObject({ kind: "github_repo", ok: true });
  });

  it("still rejects rolldown's own source, and links that are only evidence", () => {
    for (const u of [
      "https://github.com/rolldown/rolldown/blob/main/crates/rolldown/src/lib.rs",
      "https://github.com/someone/app/issues/12",
      "https://github.com/someone/app/pull/12",
      "https://github.com/someone/app/commit/abc1234",
      "https://github.com/someone/app/actions/runs/123",
    ]) {
      expect(extractReproLinks(u)).toEqual([]);
    }
  });
});
