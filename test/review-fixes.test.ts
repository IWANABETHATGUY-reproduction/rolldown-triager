import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";

import { priority } from "../src/checks/priority.ts";
import { reproduction } from "../src/checks/reproduction.ts";
import { renderComment } from "../src/core/comment.ts";
import { resolveConfig } from "../src/core/config.ts";
import { extractReproLinks } from "../src/core/links.ts";
import { decodeReplUrl, summarizeRepl } from "../src/core/repl.ts";
import type { Report } from "../src/core/types.ts";
import { answers, ctx, flags, issue, scoreAnswer } from "./support.ts";

// Fixes for the twelve findings of the 2026-09-26 review. Each test names the
// behaviour that was wrong, so a regression says what it broke.

describe("kind is decided before emptiness (finding 4)", () => {
  const short = (kind: string) =>
    ctx({
      kind: kind as never,
      state: {
        issue: {
          title: "t",
          kind: kind as never,
          template: "none" as const,
          sections: { body: "Add support." },
        },
      },
      options: { skipAuthors: [] },
    });

  it("never asks a feature, task or question for a reproduction", () => {
    for (const kind of ["feature", "task", "question"]) {
      expect(reproduction.decide(answers("reproduction", {}), short(kind))).toMatchObject({
        status: "skipped",
      });
    }
  });

  it("still labels a short bug report", () => {
    expect(reproduction.decide(answers("reproduction", {}), short("bug"))).toMatchObject({
      add: ["needsReproduction"],
    });
  });
});

describe("a decision made in code asks nothing (finding 12)", () => {
  it("asks no questions for an empty report", () => {
    const empty = ctx({
      kind: "bug",
      state: { issue: { title: "t", kind: "bug", template: "none", sections: {} } },
      options: { skipAuthors: [] },
    });
    expect(reproduction.questions(empty)).toEqual({});
    expect(reproduction.decide(answers("reproduction", {}), empty)).toMatchObject({
      add: ["needsReproduction"],
    });
  });
});

describe("self-prioritisation guard covers every branch (finding 5)", () => {
  const opts = { applyLabels: ["p1", "p2", "p3"], panicFallback: "p1" };
  const mk = (kind: string, isPanic: boolean) =>
    ctx({ kind: kind as never, options: opts, flags: flags({ isPanic, priorityWords: true }) });
  const sc = (s: number, c: number) => scoreAnswer(s, c, 3);

  it("forces suggest on the panic invalid-input branch", () => {
    const v = priority.decide(
      answers("priority", { panic_invalid_input: 0.95, panic_reach: sc(2.4, 0.9) }),
      mk("bug", true),
    );
    expect(v).toMatchObject({ forceSuggest: "the report argues its own priority" });
  });

  it("forces suggest on the panic fallback", () => {
    const v = priority.decide(
      answers("priority", { panic_invalid_input: 0.05, panic_reach: sc(2.4, 0.1) }),
      mk("bug", true),
    );
    expect(v).toMatchObject({ add: ["p1"], forceSuggest: "the report argues its own priority" });
  });

  it("forces suggest on the feature branch", () => {
    const v = priority.decide(
      answers("priority", { framework_need: 0.1, usefulness: sc(2, 0.9) }),
      mk("feature", false),
    );
    expect(v).toMatchObject({ forceSuggest: "the report argues its own priority" });
  });
});

describe("REPL payloads are bounded and flattened (findings 6, 7)", () => {
  const link = (state: unknown) =>
    `https://repl.rolldown.rs/#${deflateSync(Buffer.from(JSON.stringify(state))).toString("base64")}`;

  it("flattens an injected version to one short token", () => {
    const url = link({
      v: "1.0\n\n### Heading\n\n@someone see https://evil.test",
      f: { "a.js": { c: "x" } },
    });
    const summary = summarizeRepl(decodeReplUrl(url));
    expect(summary).not.toContain("\n");
    expect(summary).not.toContain("@someone");
    expect(summary).not.toContain("#");
    expect(extractReproLinks(`see ${url}`)[0]?.detail).toBe(summary);
  });

  it("refuses a payload that inflates past the cap instead of expanding it", () => {
    const url = link({ v: "1", f: { "big.js": { c: "A".repeat(8 * 1024 * 1024) } } });
    expect(decodeReplUrl(url)).toMatchObject({ ok: false });
  });

  it("still decodes an ordinary payload", () => {
    const url = link({ v: "1.2.9", f: { "a.js": { c: "export const a = 1" } } });
    expect(decodeReplUrl(url)).toMatchObject({ ok: true, version: "1.2.9" });
  });
});

describe("marketing pages are not reproductions (finding 8)", () => {
  it("rejects CodeSandbox pages that are not sandboxes", () => {
    for (const u of ["https://codesandbox.io/pricing", "https://codesandbox.io/docs/learn"]) {
      expect(extractReproLinks(`see ${u}`)).toEqual([]);
    }
  });

  it("keeps real sandboxes, and the hosts whose bare URL is the environment", () => {
    for (const u of [
      "https://codesandbox.io/s/abc123",
      "https://codesandbox.io/p/sandbox/xyz",
      "https://vite.new",
    ]) {
      expect(extractReproLinks(`see ${u}`)[0]?.ok).toBe(true);
    }
  });
});

describe("priorities are found by configured name (finding 10)", () => {
  it("renders the needs-triage removal under renamed labels", () => {
    const config = resolveConfig({ labels: JSON.stringify({ p2: "severity: medium" }) });
    const report = {
      issue: { number: 7, title: "t", htmlUrl: "u" },
      kind: "bug",
      kindSource: "type",
      kindConfidence: null,
      flags: flags(),
      model: "jev-1.13.0",
      usage: null,
      questionsAsked: 6,
      results: [
        {
          id: "priority",
          verdict: { status: "decided" as const, add: ["p2" as const], note: "n" },
          mode: "apply" as const,
          effective: "applied" as const,
          labels: ["severity: medium"],
          downgradedBecause: [],
        },
      ],
      plan: { add: ["severity: medium"], remove: ["needs-triage"] },
    } as unknown as Report;
    expect(renderComment(report, config.labels)).toContain("removed `needs-triage`");
  });
});

describe("the bot only edits its own comment (finding 1)", () => {
  it("prefers a bot comment that starts with the marker over a quoted one", () => {
    // A reporter quoting the bot prefixes every line with "> ", so the marker
    // is no longer at position 0 — and the author is not a bot.
    const quoted = {
      id: 1,
      body: "> <!-- rolldown-triager -->\n> quoting you",
      authorLogin: "reporter",
      authorIsBot: false,
    };
    const ours = {
      id: 2,
      body: "<!-- rolldown-triager -->\nreal",
      authorLogin: "github-actions[bot]",
      authorIsBot: true,
    };
    const pick = (cs: (typeof quoted)[]) =>
      cs.filter((c) => c.body.startsWith("<!-- rolldown-triager -->")).find((c) => c.authorIsBot) ??
      cs.filter((c) => c.body.startsWith("<!-- rolldown-triager -->"))[0];
    expect(pick([quoted, ours])?.id).toBe(2);
    expect(pick([quoted])).toBeUndefined();
  });
});
