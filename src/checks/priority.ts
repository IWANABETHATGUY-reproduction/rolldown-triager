import { BUG_EVIDENCE_LABELS, bugQuestions } from "../questions/bug.ts";
import { FEATURE_EVIDENCE_LABELS, featureQuestions } from "../questions/feature.ts";
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

  const argues = answers.noul("argues_priority");
  if (argues !== undefined)
    evidence[BUG_EVIDENCE_LABELS.argues_priority] = Number(argues.toFixed(2));
  if (ctx.flags.priorityWords || (argues ?? 0) >= ctx.config.thresholds.arguesPriority) {
    verdict = { ...verdict, forceSuggest: "the report argues its own priority" };
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
  defaultOptions: { applyLabels: ["p1", "p2", "p3"] },

  questions(ctx) {
    switch (ctx.kind) {
      case "bug":
        return bugQuestions;
      case "feature":
        return featureQuestions;
      case "unknown":
        // Ask both branches now; `decide` uses whichever kind the model settles on.
        return { ...bugQuestions, ...featureQuestions };
      default:
        return null;
    }
  },

  decide(answers, ctx) {
    let verdict: Verdict;
    switch (ctx.kind) {
      case "bug":
        verdict = decideBug(answers, ctx);
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
    if (verdict.status === "decided" && !verdict.forceSuggest) {
      const slot = verdict.add.find((s): s is PrioritySlot => s.startsWith("p"));
      if (slot && !ctx.options.applyLabels.includes(slot)) {
        verdict = { ...verdict, forceSuggest: `${slot} is suggest-only by configuration` };
      }
    }
    return verdict;
  },
});
