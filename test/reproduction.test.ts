import { describe, expect, it } from "vitest";

import { reproduction } from "../src/checks/reproduction.ts";
import type { ReproLink } from "../src/core/types.ts";
import { answers, ctx, flags, parsed, scoreAnswer } from "./support.ts";

const R = "reproduction";
const repl: ReproLink = {
  kind: "repl",
  url: "https://repl.rolldown.rs/#x",
  ok: true,
  detail: "3 files, rolldown latest",
};

describe("reproduction.questions", () => {
  it("asks nothing when a runnable link exists, nothing for features, the rubric otherwise", () => {
    expect(reproduction.questions(ctx({ flags: flags({ runnableLinks: [repl] }) }))).toEqual({});
    expect(reproduction.questions(ctx({ kind: "feature" }))).toBeNull();
    expect(Object.keys(reproduction.questions(ctx()) ?? {})).toEqual([
      "repro_quality",
      "explains_no_repro",
    ]);
    expect(Object.keys(reproduction.questions(ctx({ kind: "unknown" })) ?? {})).toHaveLength(2);
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

  it("passes when the steps look complete with confidence", () => {
    const v = reproduction.decide(
      answers(R, { repro_quality: scoreAnswer(2.8, 0.9), explains_no_repro: 0.1 }),
      ctx(),
    );
    expect(v).toMatchObject({
      status: "decided",
      add: [],
      gate: "pass",
      evidence: { steps: "2.8/3", "explains no link": 0.1 },
    });
  });

  it("adds needs-reproduction only when clearly inadequate, confident, and unexplained", () => {
    expect(
      reproduction.decide(
        answers(R, { repro_quality: scoreAnswer(0.4, 0.9), explains_no_repro: 0.1 }),
        ctx(),
      ),
    ).toMatchObject({
      status: "decided",
      add: ["needsReproduction"],
      gate: "fail",
    });
    // explained → human
    expect(
      reproduction.decide(
        answers(R, { repro_quality: scoreAnswer(0.4, 0.9), explains_no_repro: 0.9 }),
        ctx(),
      ),
    ).toMatchObject({
      status: "abstained",
      gate: "unsure",
      note: expect.stringContaining("explains why"),
    });
    // not confident → unsure
    expect(
      reproduction.decide(
        answers(R, { repro_quality: scoreAnswer(0.4, 0.5), explains_no_repro: 0.1 }),
        ctx(),
      ),
    ).toMatchObject({
      status: "abstained",
      gate: "unsure",
    });
    // middle of the scale → unsure
    expect(
      reproduction.decide(
        answers(R, { repro_quality: scoreAnswer(1.6, 0.9), explains_no_repro: 0.1 }),
        ctx(),
      ),
    ).toMatchObject({
      status: "abstained",
      gate: "unsure",
    });
  });

  it("mentions missing template fields", () => {
    const v = reproduction.decide(
      answers(R, { repro_quality: scoreAnswer(0.2, 0.9), explains_no_repro: 0 }),
      ctx({ parsed: parsed({ requiredMissing: ["system_info"] }) }),
    );
    expect(v).toMatchObject({
      note: "no reproduction found; template fields missing: system_info",
    });
  });
});
