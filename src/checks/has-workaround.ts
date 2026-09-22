import { bugQuestions } from "../questions/bug.ts";
import { defineCheck } from "../core/types.ts";

/**
 * The smallest possible check: one reused question, one label. Exists to show
 * what adding a check takes — this file plus one entry in `checks/index.ts`.
 */
export const hasWorkaround = defineCheck({
  id: "has-workaround",
  defaultMode: "suggest",

  questions(ctx) {
    return ctx.kind === "bug" || ctx.kind === "unknown"
      ? { workaround: bugQuestions.workaround }
      : null;
  },

  decide(answers, ctx) {
    if (ctx.kind !== "bug") return { status: "skipped", reason: "not a bug" };
    const v = answers.noul("workaround");
    if (v === undefined) return { status: "abstained", note: "no answer for workaround" };
    const evidence = { workaround: Number(v.toFixed(2)) };
    return v >= ctx.config.thresholds.workaroundLabel
      ? {
          status: "decided",
          add: ["hasWorkaround"],
          note: "reporter describes a workaround",
          evidence,
        }
      : { status: "decided", add: [], note: "no workaround described", evidence };
  },
});
