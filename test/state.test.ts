import { describe, expect, it } from "vitest";

import { buildState } from "../src/core/state.ts";
import type { ParsedIssue } from "../src/core/types.ts";
import { loadIssue, parseIssue } from "./helpers.ts";

const base = (over: Partial<ParsedIssue> = {}): ParsedIssue => ({
  template: "bug",
  sections: { reproduction: "steps", expected: "x", actual: "y", system_info: "Node: 22" },
  requiredMissing: [],
  links: [],
  ...over,
});

describe("buildState", () => {
  it("only includes title, kind, template and sanitized sections", () => {
    const { state } = buildState({ title: "  [Bug]: t  ", body: "" }, base(), "bug");
    expect(state).toEqual({
      issue: {
        title: "[Bug]: t",
        kind: "bug",
        template: "bug",
        sections: { reproduction: "steps", expected: "x", actual: "y", system_info: "Node: 22" },
      },
    });
  });

  it("drops `_No response_` sections", () => {
    const { state } = buildState(
      { title: "t", body: "" },
      base({ sections: { reproduction: "r", additional: "_No response_" } }),
      "bug",
    );
    expect(state.issue.sections).toEqual({ reproduction: "r" });
  });

  it("flags priority words in prose but not in code", () => {
    const words = (body: string): boolean =>
      buildState({ title: "t", body }, base({ sections: { body } }), "unknown").flags.priorityWords;
    expect(words("This is a P0 blocker for us")).toBe(true);
    expect(words("please prioritise this")).toBe(true);
    expect(words("```\nP0 in a log line\n```")).toBe(false);
    expect(words("the build fails with an error")).toBe(false);
    expect(words("blocking the main thread is critical")).toBe(false);
  });

  it("derives templateFollowed, runnableLinks and replInvalid", () => {
    const repl = { kind: "repl" as const, url: "u", ok: false, detail: "empty" };
    const repo = { kind: "github_repo" as const, url: "g", ok: true };
    expect(
      buildState({ title: "t", body: "" }, base({ links: [repl] }), "bug").flags,
    ).toMatchObject({
      templateFollowed: true,
      runnableLinks: [],
      replInvalid: true,
    });
    expect(
      buildState({ title: "t", body: "" }, base({ links: [repl, repo] }), "bug").flags,
    ).toMatchObject({
      runnableLinks: [repo],
      replInvalid: false,
    });
    expect(
      buildState({ title: "t", body: "" }, base({ template: "none", requiredMissing: [] }), "bug")
        .flags.templateFollowed,
    ).toBe(false);
    expect(
      buildState({ title: "t", body: "" }, base({ requiredMissing: ["system_info"] }), "bug").flags
        .templateFollowed,
    ).toBe(false);
  });

  it("shrinks the largest sections until the state fits the budget", () => {
    const huge = Array.from({ length: 3000 }, (_, i) => `line ${i} ${"z".repeat(20)}`).join("\n");
    const { state, flags } = buildState(
      { title: "t", body: "" },
      base({ sections: { reproduction: huge, actual: huge, body: huge } }),
      "bug",
    );
    expect(JSON.stringify(state).length).toBeLessThanOrEqual(40_000);
    expect(flags.truncated.sort()).toEqual(["actual", "body", "reproduction"]);
  });

  it("builds a compact state for a real issue", () => {
    const issue = loadIssue(10792);
    const { state, flags } = buildState(issue, parseIssue(issue), "bug");
    expect(JSON.stringify(state)).not.toContain("repl.rolldown.rs/#");
    expect(state.issue.sections.reproduction).toContain("<repl-link: 6 files");
    expect(flags.runnableLinks).toHaveLength(1);
    expect(JSON.stringify(state).length).toBeLessThan(5000);
  });
});
