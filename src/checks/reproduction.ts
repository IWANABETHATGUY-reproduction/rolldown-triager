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

/** Characters of real prose across every section the model would be shown. */
function contentLength(ctx: { state: { issue: { sections: Record<string, string> } } }): number {
  return Object.values(ctx.state.issue.sections).join(" ").replace(/\s+/g, " ").trim().length;
}

/** No runnable link, nothing in the template, and less than a sentence of prose. */
function isEmptyReport(
  ctx: Parameters<typeof contentLength>[0] & { flags: { runnableLinks: unknown[] } },
): boolean {
  return ctx.flags.runnableLinks.length === 0 && contentLength(ctx) < 80;
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
    // An issue with no substance needs a reproduction whatever it turns out to
    // be about, and the model never gets a useful read on it. Deciding this in
    // code also rescues the case where kind is unknown *because* the body is
    // empty, which used to abstain before the rubric was even asked.
    if (isEmptyReport(ctx)) {
      return {
        status: "decided",
        add: ["needsReproduction"],
        note: "the report has no reproduction and almost no content",
        gate: "fail",
      };
    }

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
    const canRun = answers.noul("runnable");
    const selfEvident = answers.noul("self_evident");
    const quality = answers.score("repro_quality");
    const explains = answers.noul("explains_no_repro");
    if (canRun === undefined)
      return { status: "abstained", note: "no answer for runnable", gate: "unsure" };

    const evidence: Evidence = { runnable: Number(canRun.toFixed(2)) };
    if (selfEvident !== undefined) evidence["self-evident"] = Number(selfEvident.toFixed(2));
    if (quality) evidence.steps = `${quality.score.toFixed(1)}/${quality.top}`;
    if (explains !== undefined) evidence["explains no link"] = Number(explains.toFixed(2));
    const missingFields =
      ctx.parsed.requiredMissing.length > 0
        ? `; template fields missing: ${ctx.parsed.requiredMissing.join(", ")}`
        : "";

    // Runnable settles it on its own: there is something to run, so there is
    // nothing to ask the reporter for.
    if (canRun >= t.reproRunnableYes) {
      return {
        status: "decided",
        add: [],
        note: "no link, but the report is runnable as written",
        evidence,
        gate: "pass",
      };
    }
    // The escape hatch outranks the label: a reporter who explains why a live
    // repro is impossible should get a human, not a form letter.
    if ((explains ?? 0) >= t.noulYes) {
      return {
        status: "abstained",
        note: "no link; the report explains why, needs a human",
        evidence,
        gate: "unsure",
      };
    }
    // A report can be unrunnable and still need nothing from its author: it
    // quotes the conflicting declarations, names a failing test in this repo,
    // links the published metadata. Asking those reporters for a reproduction
    // is the main way this check wastes a maintainer's credibility.
    if ((selfEvident ?? 0) >= t.reproSelfEvident) {
      return {
        status: "abstained",
        note: "nothing to run, but the report carries its own evidence",
        evidence,
        gate: "unsure",
      };
    }
    // Not runnable, and the detail that is there does not reach the bar either.
    if (canRun <= t.reproRunnableNo && (quality?.score ?? 0) <= t.reproLow) {
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
      note: `no link and the report is hard to judge${missingFields}`,
      evidence,
      gate: "unsure",
    };
  },
});
