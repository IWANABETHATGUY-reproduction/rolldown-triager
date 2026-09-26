import { BUG_EVIDENCE_LABELS, bugQuestions } from "../questions/bug.ts";
import { FEATURE_EVIDENCE_LABELS, featureQuestions } from "../questions/feature.ts";
import { PANIC_EVIDENCE_LABELS, panicQuestions } from "../questions/panic.ts";
import type {
  Answers,
  Ctx,
  Decided,
  Evidence,
  PrioritySlot,
  Thresholds,
  Verdict,
} from "../core/types.ts";
import { defineCheck } from "../core/types.ts";

export interface PriorityOptions {
  /** Priorities the check may apply on its own; anything else is suggest-only. p0 is never allowed. */
  applyLabels: PrioritySlot[];
  /**
   * What to call a crash whose `panic_reach` score is not confident enough to
   * place. `"off"` abstains. Measured over the 40 panics rolldown has
   * prioritised, these abstentions are 73% p0 or p1 — they cluster at the
   * p1/p2 boundary, where high reach means ordinary conditions means severe —
   * so the fallback errs upward. p1 is right 47% of the time and within one
   * level 93%; p2 would be right 20% and under-rate 11 of 15.
   */
  panicFallback: PrioritySlot | "off";
}

type Tri = "yes" | "no" | "unsure";

/** Reads one Noul and files it in the evidence list as it is consulted. */
function reader(
  answers: Answers,
  t: Thresholds,
  labels: Record<string, string>,
  evidence: Evidence,
) {
  return (key: string): Tri | undefined => {
    const v = answers.noul(key);
    if (v === undefined) return undefined;
    evidence[labels[key] ?? key] = Number(v.toFixed(2));
    if (v >= t.noulYes) return "yes";
    if (v <= t.noulNo) return "no";
    return "unsure";
  };
}

const unsure = (evidence: Evidence, axis: string): Verdict => ({
  status: "abstained",
  note: `unsure whether the ${axis}`,
  evidence,
});

const missing = (key: string): Verdict => ({
  status: "abstained",
  note: `no answer for ${key}`,
});

function decideBug(answers: Answers, ctx: Ctx<PriorityOptions>): Verdict {
  const evidence: Evidence = {};
  const read = reader(answers, ctx.config.thresholds, BUG_EVIDENCE_LABELS, evidence);
  const decided = (slot: PrioritySlot, note: string): Decided => ({
    status: "decided",
    add: [slot],
    note,
    evidence,
  });

  // The mapping is `.github/issue-workflow.md` adjusted to what maintainers
  // actually label (eval over triaged issues since 2026-03, see README): the
  // literal tree sends every unusable build to p1 and over-predicts p1 about
  // 2:1. What separates p1 in practice is an unusable build reached through
  // Vite, or a regression; other unusable builds land on p2. Usable builds are
  // p3 with a workaround, p2 without. Only axes on the taken path are read, so
  // an unsure answer elsewhere never blocks a decision.
  const broken = read("broken");
  if (broken === undefined) return missing("broken");
  if (broken === "unsure") return unsure(evidence, "build is unusable");

  let verdict: Decided;
  if (broken === "yes") {
    const viaVite = read("via_vite");
    const regression = read("regression");
    if (viaVite === undefined) return missing("via_vite");
    if (regression === undefined) return missing("regression");
    if (viaVite === "yes") {
      verdict = decided("p1", "build unusable through Vite");
    } else if (regression === "yes") {
      verdict = decided("p1", "build unusable, a regression");
    } else if (viaVite === "unsure" || regression === "unsure") {
      return unsure(evidence, "unusable build reaches Vite users or is a regression");
    } else {
      verdict = decided("p2", "build unusable in a specific non-Vite setup");
    }
    // The tree's p0 branches (most users, or blocking the rolldown-vite
    // upgrade) are a human call; flag them instead of deciding.
    if (read("mainstream") === "yes") {
      verdict = {
        ...verdict,
        forceSuggest: "could be p0",
        humanNote: "could be p0 if it hits most users or blocks the rolldown-vite upgrade",
      };
    }
  } else {
    const workaround = read("workaround");
    if (workaround === undefined) return missing("workaround");
    if (workaround === "unsure") return unsure(evidence, "reporter has a workaround");
    verdict =
      workaround === "yes"
        ? decided("p3", "build usable, workaround described")
        : decided("p2", "build usable, no workaround described");
  }

  return verdict;
}

/**
 * Crashes get their own branch. Every panic is `broken: yes`, so the bug tree
 * can only ever reach p1 or p2 through `via_vite`/`regression` — and those read
 * low for CLI, plugin and dev-engine crashes, which is how 21 of 31 decisions
 * collapsed onto p2 while p3 stayed structurally unreachable. What maintainers
 * actually sort on is how ordinary the conditions are that reach the crash.
 */
function decidePanic(answers: Answers, ctx: Ctx<PriorityOptions>): Verdict {
  const t = ctx.config.thresholds;
  const evidence: Evidence = {};
  const read = reader(answers, t, PANIC_EVIDENCE_LABELS, evidence);

  // Rolldown crashing instead of printing an error is a presentation bug: the
  // build was going to fail anyway, and nothing correct is broken.
  const invalid = read("panic_invalid_input");
  if (invalid === undefined) return missing("panic_invalid_input");
  if (invalid === "yes") {
    return {
      status: "decided",
      add: ["p3"],
      note: "crash while rejecting invalid input; an error message is the fix",
      evidence,
    };
  }

  const reach = answers.score("panic_reach");
  if (!reach) return missing("panic_reach");
  evidence[PANIC_EVIDENCE_LABELS.panic_reach] = `${reach.score.toFixed(1)}/${reach.top}`;
  if (reach.confidence < t.panicConfidence) {
    const fallback = ctx.options.panicFallback;
    if (!fallback || fallback === "off" || fallback === "p0") {
      return {
        status: "abstained",
        note: "unsure how ordinary the crash conditions are",
        evidence,
      };
    }
    return {
      status: "decided",
      add: [fallback],
      note: `crash, too unclear to place; defaulting to ${fallback}`,
      evidence,
      humanNote: "the model could not place this crash; these skew more severe, not less",
    };
  }

  let verdict: Decided;
  if (reach.score >= t.panicReachP1) {
    verdict = {
      status: "decided",
      add: ["p1"],
      note: "crash in an ordinary build",
      evidence,
    };
  } else if (reach.score >= t.panicReachP2) {
    verdict = {
      status: "decided",
      add: ["p2"],
      note: "crash behind a particular package, syntax or sequence",
      evidence,
    };
  } else {
    verdict = {
      status: "decided",
      add: ["p3"],
      note: "crash behind a specific platform, host or experimental flag",
      evidence,
    };
  }

  return verdict;
}

function decideFeature(answers: Answers, ctx: Ctx<PriorityOptions>): Verdict {
  const t = ctx.config.thresholds;
  const evidence: Evidence = {};
  const read = reader(answers, t, FEATURE_EVIDENCE_LABELS, evidence);

  const framework = read("framework_need");
  if (framework === undefined) return missing("framework_need");
  if (framework === "unsure") return unsure(evidence, "request blocks a named framework");
  if (framework === "yes") {
    return {
      status: "decided",
      add: ["p1"],
      note: "a named framework needs this to run on rolldown-vite",
      evidence,
      forceSuggest: "p1 for a feature request needs a human",
    };
  }

  const usefulness = answers.score("usefulness");
  if (!usefulness) return missing("usefulness");
  evidence[FEATURE_EVIDENCE_LABELS.usefulness] = `${usefulness.score.toFixed(1)}/${usefulness.top}`;
  if (usefulness.confidence < t.scoreConfidence) {
    return { status: "abstained", note: "unsure how widely the feature would be used", evidence };
  }
  return usefulness.score >= t.usefulnessP2
    ? { status: "decided", add: ["p2"], note: "useful to a recognizable group of users", evidence }
    : { status: "decided", add: ["p3"], note: "serves a particular setup", evidence };
}

export const priority = defineCheck<PriorityOptions>({
  id: "priority",
  defaultMode: "apply",
  defaultOptions: { applyLabels: ["p1", "p2", "p3"], panicFallback: "p1" },

  questions(ctx) {
    // Extra questions cost almost nothing, so a crash report carries the panic
    // pair as well; `decide` picks the branch.
    const panic = ctx.flags.isPanic ? panicQuestions : {};
    switch (ctx.kind) {
      case "bug":
        return { ...bugQuestions, ...panic };
      case "feature":
        return featureQuestions;
      case "unknown":
        // Ask both branches now; `decide` uses whichever kind the model settles on.
        return { ...bugQuestions, ...featureQuestions, ...panic };
      default:
        return null;
    }
  },

  decide(answers, ctx) {
    let verdict: Verdict;
    switch (ctx.kind) {
      case "bug":
        verdict = ctx.flags.isPanic ? decidePanic(answers, ctx) : decideBug(answers, ctx);
        break;
      case "feature":
        verdict = decideFeature(answers, ctx);
        break;
      case "task":
        return { status: "skipped", reason: "task" };
      case "question":
        return { status: "skipped", reason: "looks like a question, not a bug or feature" };
      default:
        return { status: "abstained", note: "could not tell whether this is a bug or a feature" };
    }
    // The self-prioritisation guard belongs here, not in a branch: a report
    // arguing "P0 urgent blocker" must not label itself whichever path decided
    // it. Three branches used to return before reaching it — the panic
    // invalid-input and fallback paths, and the feature branch, which never had
    // it at all — so the defence failed exactly where the model was least sure.
    if (verdict.status === "decided") {
      const argues = answers.noul("argues_priority");
      if (argues !== undefined && verdict.evidence) {
        verdict.evidence[BUG_EVIDENCE_LABELS.argues_priority] = Number(argues.toFixed(2));
      }
      if (
        !verdict.forceSuggest &&
        (ctx.flags.priorityWords || (argues ?? 0) >= ctx.config.thresholds.arguesPriority)
      ) {
        verdict = { ...verdict, forceSuggest: "the report argues its own priority" };
      }
    }
    if (verdict.status === "decided" && !verdict.forceSuggest) {
      const slot = verdict.add.find((s): s is PrioritySlot => s.startsWith("p"));
      if (slot && !ctx.options.applyLabels.includes(slot)) {
        verdict = { ...verdict, forceSuggest: `${slot} is suggest-only by configuration` };
      }
    }
    return verdict;
  },
});
