import { reproQuestions } from "../questions/repro.ts";
import type { Evidence, ReproLink } from "../core/types.ts";
import { defineCheck } from "../core/types.ts";

function describe(link: ReproLink): string {
  switch (link.kind) {
    case "repl":
      return `REPL link (${link.detail ?? "ok"})`;
    case "stackblitz":
      return "StackBlitz link";
    case "codesandbox":
      return "CodeSandbox link";
    case "webcontainer":
      return `${new URL(link.url).hostname} link`;
    case "gist":
      return "gist link";
    case "github_repo":
      return "GitHub repository link";
    default:
      return link.kind;
  }
}

/**
 * Gating: when this fails or is unsure, no other check may apply labels, because
 * the workflow's first question is "does it have a proper reproduction?".
 */
export const reproduction = defineCheck({
  id: "reproduction",
  gating: true,
  defaultMode: "apply",

  questions(ctx) {
    if (ctx.kind === "feature" || ctx.kind === "task" || ctx.kind === "question") return null;
    // A runnable link settles it in code; nothing to ask.
    if (ctx.flags.runnableLinks.length > 0) return {};
    return reproQuestions;
  },

  decide(answers, ctx) {
    switch (ctx.kind) {
      case "feature":
        return { status: "skipped", reason: "feature request" };
      case "task":
        return { status: "skipped", reason: "task" };
      case "question":
        return { status: "skipped", reason: "question" };
      case "unknown":
        return {
          status: "abstained",
          note: "could not tell whether this is a bug",
          gate: "unsure",
        };
      default:
        break;
    }

    const runnable = ctx.flags.runnableLinks;
    if (runnable.length > 0) {
      const first = runnable[0] as ReproLink;
      const more = runnable.length > 1 ? ` (+${runnable.length - 1} more)` : "";
      return { status: "decided", add: [], note: `${describe(first)}${more}`, gate: "pass" };
    }
    if (ctx.flags.replInvalid) {
      return { status: "abstained", note: "REPL link is empty or truncated", gate: "unsure" };
    }

    const t = ctx.config.thresholds;
    const quality = answers.score("repro_quality");
    const explains = answers.noul("explains_no_repro");
    if (!quality)
      return { status: "abstained", note: "no answer for repro_quality", gate: "unsure" };

    const evidence: Evidence = { steps: `${quality.score.toFixed(1)}/${quality.top}` };
    if (explains !== undefined) evidence["explains no link"] = Number(explains.toFixed(2));
    const missingFields =
      ctx.parsed.requiredMissing.length > 0
        ? `; template fields missing: ${ctx.parsed.requiredMissing.join(", ")}`
        : "";

    if (quality.score >= t.reproOk && quality.confidence >= t.reproConfidence) {
      return {
        status: "decided",
        add: [],
        note: "no link, but the steps look complete",
        evidence,
        gate: "pass",
      };
    }
    if ((explains ?? 0) >= t.noulYes) {
      return {
        status: "abstained",
        note: "no link; the report explains why, needs a human",
        evidence,
        gate: "unsure",
      };
    }
    if (quality.score <= t.reproLow && quality.confidence >= t.reproConfidence) {
      return {
        status: "decided",
        add: ["needsReproduction"],
        note: `no reproduction found${missingFields}`,
        evidence,
        gate: "fail",
      };
    }
    return {
      status: "abstained",
      note: `no link and the steps are hard to judge${missingFields}`,
      evidence,
      gate: "unsure",
    };
  },
});
