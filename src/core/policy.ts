import type {
  Check,
  CheckResult,
  Ctx,
  Effective,
  LabelPlan,
  LabelSlot,
  Mode,
  PrioritySlot,
  Verdict,
} from "./types.ts";
import { PRIORITY_SLOTS } from "./types.ts";

// Every label invariant lives here, so a new check inherits them all:
//   - p0 is never applied automatically
//   - applying any p* removes needs-triage; nothing else is ever removed
//   - an issue that already carries a p* label was decided by a human
//   - a failed/unsure gate (reproduction) blocks every other label
//   - a kind guessed by the model with low confidence blocks labels
//   - per-check mode: apply | suggest | off

export interface PolicyInput {
  check: Check;
  verdict: Verdict;
}

const isPriority = (slot: LabelSlot): slot is PrioritySlot =>
  PRIORITY_SLOTS.includes(slot as PrioritySlot);

export function modeFor(check: Check, modes: Record<string, Mode>): Mode {
  return modes[check.id] ?? check.defaultMode ?? "suggest";
}

export function applyPolicy(
  inputs: PolicyInput[],
  ctx: Ctx,
): { results: CheckResult[]; plan: LabelPlan } {
  const { labels, modes, thresholds } = ctx.config;
  const priorityNames = new Set(PRIORITY_SLOTS.map((s) => labels[s]));
  const hasPriorityAlready = ctx.issue.labels.some((l) => priorityNames.has(l));
  const kindWeak =
    ctx.kindSource === "model" && (ctx.kindConfidence ?? 0) < thresholds.kindConfidence;

  const plan: LabelPlan = { add: [], remove: [] };
  const results: CheckResult[] = [];

  for (const { check, verdict } of inputs) {
    const mode = modeFor(check, modes);
    const downgradedBecause: string[] = [];
    let effective: Effective;
    let slots: LabelSlot[] = [];

    if (mode === "off") {
      effective = "skipped";
    } else if (verdict.status === "skipped") {
      effective = "skipped";
    } else if (verdict.status === "abstained") {
      effective = "abstained";
    } else {
      slots = verdict.add.filter((s) => {
        if (s === "p0") {
          downgradedBecause.push("p0 is never applied automatically");
          return false;
        }
        return true;
      });
      if (verdict.forceSuggest) downgradedBecause.push(verdict.forceSuggest);
      if (slots.length > 0) {
        if (slots.some(isPriority) && hasPriorityAlready) {
          downgradedBecause.push("issue already has a priority label");
        }
        if (kindWeak) downgradedBecause.push("issue kind came from the model with low confidence");
      }
      effective = mode === "apply" && downgradedBecause.length === 0 ? "applied" : "suggested";
      if (effective === "applied") {
        for (const slot of slots) {
          const name = labels[slot];
          if (!plan.add.includes(name)) plan.add.push(name);
          if (isPriority(slot) && !plan.remove.includes(labels.needsTriage)) {
            plan.remove.push(labels.needsTriage);
          }
        }
      }
    }

    results.push({
      id: check.id,
      verdict,
      mode,
      effective,
      labels: slots.map((s) => labels[s]),
      downgradedBecause,
    });
  }

  return { results, plan };
}
