import { describe, expect, it } from "vitest";

import { reproduction } from "../src/checks/reproduction.ts";
import type { Ctx, ReproLink } from "../src/core/types.ts";
import { answers, ctx, flags, issue, parsed, scoreAnswer } from "./support.ts";

const DEFAULT_SKIP = ["OWNER", "MEMBER", "COLLABORATOR"];

const R = "reproduction";
const repl: ReproLink = {
  kind: "repl",
  url: "https://repl.rolldown.rs/#x",
  ok: true,
  detail: "3 files, rolldown latest",
};

/** The three model axes, at values that on their own produce the label. */
const flagging = { runnable: 0.05, self_evident: 0.1, explains_no_repro: 0.1 };

const empty = (): Ctx =>
  ctx({ state: { issue: { title: "t", kind: "bug", template: "none", sections: {} } } });

describe("reproduction.questions", () => {
  it("asks nothing when a runnable link exists, nothing for features, the rubric otherwise", () => {
    expect(reproduction.questions(ctx({ flags: flags({ runnableLinks: [repl] }) }))).toEqual({});
    expect(reproduction.questions(ctx({ kind: "feature" }))).toBeNull();
    expect(Object.keys(reproduction.questions(ctx()) ?? {})).toEqual([
      "runnable",
      "self_evident",
      "repro_quality",
      "explains_no_repro",
    ]);
  });
});

describe("reproduction.decide", () => {
  it("passes on a runnable link without a model answer", () => {
    expect(
      reproduction.decide(answers(R, {}), ctx({ flags: flags({ runnableLinks: [repl] }) })),
    ).toEqual({
      status: "decided",
      add: [],
      note: "REPL link (3 files, rolldown latest)",
      gate: "pass",
    });
    const two = flags({
      runnableLinks: [{ kind: "github_repo", url: "https://github.com/a/b", ok: true }, repl],
    });
    expect(reproduction.decide(answers(R, {}), ctx({ flags: two }))).toMatchObject({
      note: "GitHub repository link (+1 more)",
    });
  });

  it("labels a report with no link and almost no content, without asking the model", () => {
    expect(reproduction.decide(answers(R, {}), empty())).toMatchObject({
      status: "decided",
      add: ["needsReproduction"],
      gate: "fail",
    });
    // Even when the kind never resolved — an empty body is why kind is unknown.
    expect(reproduction.decide(answers(R, {}), ctx({ ...empty(), kind: "unknown" }))).toMatchObject(
      { add: ["needsReproduction"] },
    );
    // A link is content, so it is not an empty report.
    expect(
      reproduction.decide(
        answers(R, {}),
        ctx({ ...empty(), flags: flags({ runnableLinks: [repl] }) }),
      ),
    ).toMatchObject({ status: "decided", gate: "pass" });
  });

  it("skips features/tasks/questions and is unsure for unknown kinds", () => {
    expect(reproduction.decide(answers(R, {}), ctx({ kind: "feature" }))).toMatchObject({
      status: "skipped",
    });
    expect(reproduction.decide(answers(R, {}), ctx({ kind: "task" }))).toMatchObject({
      status: "skipped",
    });
    expect(reproduction.decide(answers(R, {}), ctx({ kind: "unknown" }))).toMatchObject({
      status: "abstained",
      gate: "unsure",
    });
  });

  it("flags an empty or truncated REPL link instead of asking for a reproduction", () => {
    expect(
      reproduction.decide(answers(R, {}), ctx({ flags: flags({ replInvalid: true }) })),
    ).toMatchObject({
      status: "abstained",
      note: "REPL link is empty or truncated",
      gate: "unsure",
    });
  });

  it("passes when the report is runnable as written, whatever the prose score", () => {
    const v = reproduction.decide(
      answers(R, { ...flagging, runnable: 0.9, repro_quality: scoreAnswer(1.2, 0.4) }),
      ctx(),
    );
    expect(v).toMatchObject({
      status: "decided",
      add: [],
      gate: "pass",
      evidence: { runnable: 0.9 },
    });
  });

  it("adds needs-reproduction when nothing is runnable and nothing is self-evident", () => {
    expect(reproduction.decide(answers(R, flagging), ctx())).toMatchObject({
      status: "decided",
      add: ["needsReproduction"],
      gate: "fail",
      evidence: { runnable: 0.05, "self-evident": 0.1 },
    });
  });

  it("does not ask for a reproduction when the report carries its own evidence", () => {
    // The 1.00-precision case: unrunnable, but it quotes the conflicting types,
    // links the published metadata, or names a failing test in this repo.
    expect(
      reproduction.decide(answers(R, { ...flagging, self_evident: 0.9 }), ctx()),
    ).toMatchObject({
      status: "abstained",
      gate: "unsure",
      note: expect.stringContaining("its own evidence"),
    });
  });

  it("leaves an explained absence to a human", () => {
    expect(
      reproduction.decide(answers(R, { ...flagging, explains_no_repro: 0.9 }), ctx()),
    ).toMatchObject({
      status: "abstained",
      gate: "unsure",
      note: expect.stringContaining("explains why"),
    });
  });

  it("is unsure in the middle of the runnable band", () => {
    expect(reproduction.decide(answers(R, { ...flagging, runnable: 0.5 }), ctx())).toMatchObject({
      status: "abstained",
      gate: "unsure",
    });
  });

  it("mentions missing template fields", () => {
    const v = reproduction.decide(
      answers(R, flagging),
      ctx({ parsed: parsed({ requiredMissing: ["system_info"] }) }),
    );
    expect(v).toMatchObject({
      note: "no reproduction found; template fields missing: system_info",
    });
  });
});

describe("reproduction — issues filed by the team", () => {
  const member = (assoc: string) =>
    ctx({
      issue: { ...issue(), authorAssociation: assoc },
      options: { skipAuthors: DEFAULT_SKIP },
    });

  it("asks nothing and skips for OWNER, MEMBER and COLLABORATOR", () => {
    for (const assoc of DEFAULT_SKIP) {
      expect(reproduction.questions(member(assoc))).toBeNull();
      expect(reproduction.decide(answers(R, {}), member(assoc))).toEqual({
        status: "skipped",
        reason: "filed by the team",
      });
    }
  });

  it("still asks an outside reporter", () => {
    for (const assoc of ["CONTRIBUTOR", "NONE", "FIRST_TIME_CONTRIBUTOR"]) {
      expect(reproduction.questions(member(assoc))).not.toBeNull();
    }
  });

  it("asks everyone when the list is empty", () => {
    const none = ctx({
      issue: { ...issue(), authorAssociation: "MEMBER" },
      options: { skipAuthors: [] },
    });
    expect(reproduction.questions(none)).not.toBeNull();
  });
});
