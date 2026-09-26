import { describe, expect, it } from "vitest";

import { priority, type PriorityOptions } from "../src/checks/priority.ts";
import { answers, ctx, flags, scoreAnswer } from "./support.ts";

const P = "priority";
const opts: PriorityOptions = { applyLabels: ["p1", "p2", "p3"] };
const bug = (over: Parameters<typeof ctx<PriorityOptions>>[0] = {}) =>
  ctx<PriorityOptions>({ kind: "bug", options: opts, ...over });

describe("priority.questions", () => {
  it("asks the bug branch, the feature branch, both when unsure, nothing for tasks", () => {
    expect(Object.keys(priority.questions(bug()) ?? {})).toEqual([
      "broken",
      "mainstream",
      "via_vite",
      "workaround",
      "regression",
      "argues_priority",
    ]);
    expect(Object.keys(priority.questions(ctx({ kind: "feature" })) ?? {})).toEqual([
      "framework_need",
      "usefulness",
    ]);
    expect(Object.keys(priority.questions(ctx({ kind: "unknown" })) ?? {})).toHaveLength(8);
    expect(priority.questions(ctx({ kind: "task" }))).toBeNull();
    expect(priority.questions(ctx({ kind: "question" }))).toBeNull();
  });

  it("adds the panic pair when the report is a crash", () => {
    const keys = Object.keys(priority.questions(panic()) ?? {});
    expect(keys).toContain("panic_invalid_input");
    expect(keys).toContain("panic_reach");
    // the bug axes still ride along in the same request
    expect(keys).toContain("broken");
    expect(keys).toContain("argues_priority");
  });
});

const panic = (over: Parameters<typeof ctx<PriorityOptions>>[0] = {}) =>
  ctx<PriorityOptions>({
    kind: "bug",
    options: opts,
    flags: flags({ isPanic: true }),
    ...over,
  });

// Every panic is `broken: yes`, so the general tree could only ever reach p1 or
// p2 through `via_vite`/`regression` — both read low for CLI, plugin and
// dev-engine crashes. Measured over the 40 panics rolldown has prioritised,
// 21 of 31 decisions collapsed onto p2 and p3 was unreachable. This branch
// sorts on how ordinary the conditions are that reach the crash instead.
describe("priority.decide — panic branch", () => {
  const reach = (score: number, confidence = 0.9) =>
    answers(P, {
      panic_invalid_input: 0.05,
      panic_reach: scoreAnswer(score, confidence, 3),
      argues_priority: 0.05,
    });

  it("calls a crash in an ordinary build p1", () => {
    expect(priority.decide(reach(2.4), panic())).toMatchObject({
      status: "decided",
      add: ["p1"],
      note: "crash in an ordinary build",
    });
  });

  it("calls a crash behind a package, syntax or sequence p2", () => {
    expect(priority.decide(reach(1.0), panic())).toMatchObject({
      status: "decided",
      add: ["p2"],
    });
  });

  it("calls a crash behind a platform, host or experimental flag p3", () => {
    // Unreachable through the general tree: a panic is never `broken: no`.
    expect(priority.decide(reach(0.2), panic())).toMatchObject({
      status: "decided",
      add: ["p3"],
    });
  });

  it("calls a crash on invalid input p3 whatever the reach score", () => {
    const v = priority.decide(
      answers(P, {
        panic_invalid_input: 0.92,
        panic_reach: scoreAnswer(2.8, 0.9, 3),
        argues_priority: 0.05,
      }),
      panic(),
    );
    expect(v).toMatchObject({
      status: "decided",
      add: ["p3"],
      note: "crash while rejecting invalid input; an error message is the fix",
    });
  });

  it("abstains when the reach score is not confident", () => {
    expect(priority.decide(reach(2.4, 0.2), panic())).toMatchObject({ status: "abstained" });
  });

  it("still lets a report that argues its own priority only suggest", () => {
    const v = priority.decide(
      answers(P, {
        panic_invalid_input: 0.05,
        panic_reach: scoreAnswer(2.4, 0.9, 3),
        argues_priority: 0.9,
      }),
      panic(),
    );
    expect(v).toMatchObject({ add: ["p1"], forceSuggest: "the report argues its own priority" });
  });

  it("leaves a non-panic bug on the general tree", () => {
    // Same answers, isPanic false: the panic axes are ignored entirely.
    const v = priority.decide(
      answers(P, {
        broken: 0.9,
        via_vite: 0.9,
        regression: 0.1,
        mainstream: 0.1,
        argues_priority: 0.05,
        panic_reach: scoreAnswer(0.2, 0.9, 3),
      }),
      bug(),
    );
    expect(v).toMatchObject({ add: ["p1"], note: "build unusable through Vite" });
  });
});

describe("priority.decide — bug branch (measured mapping over issue-workflow.md)", () => {
  it("unusable through Vite → p1; unusable regression → p1", () => {
    const vite = priority.decide(
      answers(P, {
        broken: 0.9,
        via_vite: 0.9,
        regression: 0.1,
        mainstream: 0.1,
        argues_priority: 0.05,
      }),
      bug(),
    );
    expect(vite).toMatchObject({
      status: "decided",
      add: ["p1"],
      note: "build unusable through Vite",
    });
    expect(vite).not.toHaveProperty("forceSuggest");
    expect(vite.status === "decided" && vite.evidence).toEqual({
      unusable: 0.9,
      "via vite": 0.9,
      regression: 0.1,
      "common setup": 0.1,
      "argues priority": 0.05,
    });
    const regression = priority.decide(
      answers(P, { broken: 0.9, via_vite: 0.1, regression: 0.9, mainstream: 0.1 }),
      bug(),
    );
    expect(regression).toMatchObject({ add: ["p1"], note: "build unusable, a regression" });
  });

  it("unusable in a specific non-Vite setup, not a regression → p2", () => {
    const v = priority.decide(
      answers(P, { broken: 0.9, via_vite: 0.1, regression: 0.1, mainstream: 0.1 }),
      bug(),
    );
    expect(v).toMatchObject({ status: "decided", add: ["p2"] });
  });

  it("unusable in a common setup is flagged as a possible p0 and never applied", () => {
    const v = priority.decide(
      answers(P, { broken: 0.9, via_vite: 0.9, regression: 0.1, mainstream: 0.9 }),
      bug(),
    );
    expect(v).toMatchObject({ add: ["p1"], forceSuggest: "could be p0" });
    expect(v.status === "decided" && v.humanNote).toContain("p0");
  });

  it("abstains when an axis on the taken path is in the unsure band", () => {
    expect(priority.decide(answers(P, { broken: 0.5 }), bug())).toMatchObject({
      status: "abstained",
    });
    expect(
      priority.decide(
        answers(P, { broken: 0.9, via_vite: 0.5, regression: 0.1, mainstream: 0.1 }),
        bug(),
      ),
    ).toMatchObject({
      status: "abstained",
    });
    expect(
      priority.decide(
        answers(P, { broken: 0.9, via_vite: 0.1, regression: 0.5, mainstream: 0.1 }),
        bug(),
      ),
    ).toMatchObject({
      status: "abstained",
    });
    expect(priority.decide(answers(P, { broken: 0.1, workaround: 0.5 }), bug())).toMatchObject({
      status: "abstained",
    });
  });

  it("does not abstain on an unsure axis that is off the path", () => {
    // mainstream only adds the p0 note; unsure mainstream changes nothing.
    expect(
      priority.decide(
        answers(P, { broken: 0.9, via_vite: 0.9, regression: 0.1, mainstream: 0.5 }),
        bug(),
      ),
    ).toMatchObject({
      status: "decided",
      add: ["p1"],
    });
    // regression is not consulted for usable builds.
    expect(
      priority.decide(answers(P, { broken: 0.1, workaround: 0.9, regression: 0.5 }), bug()),
    ).toMatchObject({
      status: "decided",
      add: ["p3"],
    });
  });

  it("usable build: workaround → p3, none → p2, without consulting Vite/regression", () => {
    const yes = priority.decide(
      answers(P, { broken: 0.1, workaround: 0.9, via_vite: 0.9, regression: 0.9 }),
      bug(),
    );
    expect(yes).toMatchObject({ add: ["p3"] });
    expect(Object.keys((yes.status === "decided" && yes.evidence) || {})).toEqual([
      "unusable",
      "workaround",
    ]);
    expect(priority.decide(answers(P, { broken: 0.1, workaround: 0.1 }), bug())).toMatchObject({
      add: ["p2"],
    });
  });

  it("forces suggest when the report argues its own priority (model or regex)", () => {
    const base = { broken: 0.1, workaround: 0.1 };
    expect(priority.decide(answers(P, { ...base, argues_priority: 0.8 }), bug())).toMatchObject({
      add: ["p2"],
      forceSuggest: "the report argues its own priority",
    });
    expect(
      priority.decide(
        answers(P, { ...base, argues_priority: 0.1 }),
        bug({ flags: flags({ priorityWords: true }) }),
      ),
    ).toMatchObject({ forceSuggest: "the report argues its own priority" });
  });

  it("honours applyLabels", () => {
    const v = priority.decide(
      answers(P, { broken: 0.9, via_vite: 0.9, regression: 0.1, mainstream: 0.1 }),
      bug({ options: { applyLabels: ["p2", "p3"] } }),
    );
    expect(v).toMatchObject({ add: ["p1"], forceSuggest: "p1 is suggest-only by configuration" });
  });

  it("abstains when an answer is missing", () => {
    expect(priority.decide(answers(P, {}), bug())).toMatchObject({
      status: "abstained",
      note: "no answer for broken",
    });
    expect(priority.decide(answers(P, { broken: 0.9 }), bug())).toMatchObject({
      status: "abstained",
      note: "no answer for via_vite",
    });
  });
});

describe("priority.decide — feature branch", () => {
  const feature = ctx<PriorityOptions>({ kind: "feature", options: opts });

  it("a named framework blocked → p1, suggest-only", () => {
    expect(priority.decide(answers(P, { framework_need: 0.9 }), feature)).toMatchObject({
      status: "decided",
      add: ["p1"],
      forceSuggest: expect.stringContaining("human"),
    });
  });

  it("usefulness decides p2 vs p3 when confident", () => {
    expect(
      priority.decide(
        answers(P, { framework_need: 0.1, usefulness: scoreAnswer(1.6, 0.9, 3) }),
        feature,
      ),
    ).toMatchObject({
      add: ["p2"],
      evidence: { usefulness: "1.6/2" },
    });
    expect(
      priority.decide(
        answers(P, { framework_need: 0.1, usefulness: scoreAnswer(0.3, 0.9, 3) }),
        feature,
      ),
    ).toMatchObject({
      add: ["p3"],
    });
    expect(
      priority.decide(
        answers(P, { framework_need: 0.1, usefulness: scoreAnswer(1.2, 0.3, 3) }),
        feature,
      ),
    ).toMatchObject({
      status: "abstained",
    });
  });
});

describe("priority.decide — other kinds", () => {
  it("skips tasks and questions, abstains when the kind is unknown", () => {
    expect(priority.decide(answers(P, {}), ctx({ kind: "task" }))).toMatchObject({
      status: "skipped",
    });
    expect(priority.decide(answers(P, {}), ctx({ kind: "question" }))).toMatchObject({
      status: "skipped",
    });
    expect(priority.decide(answers(P, {}), ctx({ kind: "unknown" }))).toMatchObject({
      status: "abstained",
    });
  });
});
