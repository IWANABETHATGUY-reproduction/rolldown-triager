import { answersFor } from "./answers.ts";
import { MARKER, renderComment, type CommentMeta } from "./comment.ts";
import type { IssueClient } from "./github.ts";
import type { JevClient } from "./jev.ts";
import { extractReproLinks } from "./links.ts";
import { detectKind, detectTemplate, parseSections, requiredMissing } from "./parse.ts";
import { applyPolicy, modeFor, type PolicyInput } from "./policy.ts";
import { buildState } from "./state.ts";
import type {
  AnyAnswer,
  Check,
  CommentMode,
  Ctx,
  Issue,
  Kind,
  KindSource,
  ParsedIssue,
  Report,
  ResolvedConfig,
} from "./types.ts";
import { kindQuestion } from "../questions/kind.ts";

import type { Questions } from "@typesafe-ai/sdk";

export interface RunInput {
  issue: Issue;
  config: ResolvedConfig;
  jev: JevClient;
  /** All registered checks; `config.checks` picks and orders the enabled ones. */
  checks: Check[];
  /** Run even when `needs-triage` is absent (local dry-runs, evals). */
  force?: boolean;
}

const KIND_KEY = "core:kind";

export function selectChecks(all: Check[], config: ResolvedConfig): Check[] {
  const byId = new Map(all.map((c) => [c.id, c]));
  return config.checks.map((id) => {
    const check = byId.get(id);
    if (!check)
      throw new Error(
        `unknown check ${JSON.stringify(id)}; available: ${[...byId.keys()].join(", ")}`,
      );
    return check;
  });
}

export function parseIssue(issue: Issue): ParsedIssue & { kind: Kind; kindSource: KindSource } {
  const { sections, headings } = parseSections(issue.body);
  const template = detectTemplate(headings, issue.title);
  const { kind, source } = detectKind(issue, template);
  return {
    template,
    sections,
    requiredMissing: requiredMissing(template, sections),
    links: extractReproLinks(issue.body),
    kind,
    kindSource: source,
  };
}

export async function runTriage(input: RunInput): Promise<Report> {
  const { issue, config, jev } = input;
  const base: Omit<
    Report,
    "kind" | "kindSource" | "kindConfidence" | "flags" | "results" | "plan" | "questionsAsked"
  > = {
    issue: { number: issue.number, title: issue.title, htmlUrl: issue.htmlUrl },
    model: null,
    usage: null,
  };

  const { kind: kind0, kindSource: kindSource0, ...parsed } = parseIssue(issue);
  const { state, flags } = buildState(issue, parsed, kind0);

  if (!input.force && !issue.labels.includes(config.labels.needsTriage)) {
    return {
      ...base,
      kind: kind0,
      kindSource: kindSource0,
      kindConfidence: null,
      flags,
      results: [],
      plan: { add: [], remove: [] },
      questionsAsked: 0,
      shortCircuit: "already-triaged",
    };
  }

  const enabled = selectChecks(input.checks, config).filter(
    (c) => modeFor(c, config.modes) !== "off",
  );
  const ctxFor = (
    check: Check,
    kind: Kind,
    kindSource: KindSource,
    kindConfidence: number | null,
  ): Ctx => ({
    issue,
    parsed,
    state,
    flags,
    kind,
    kindSource,
    kindConfidence,
    config,
    options: {
      ...(check.defaultOptions as object | undefined),
      ...(config.options[check.id] as object | undefined),
    },
  });

  // Collect every check's questions into one request.
  const merged: Questions = {};
  const asked = new Map<string, boolean>();
  for (const check of enabled) {
    const q = check.questions(ctxFor(check, kind0, kindSource0, null));
    asked.set(check.id, q !== null);
    if (!q) continue;
    for (const [key, question] of Object.entries(q)) {
      if (key.includes(":"))
        throw new Error(
          `check ${check.id}: question key ${JSON.stringify(key)} must not contain ':'`,
        );
      merged[`${check.id}:${key}`] = question;
    }
  }
  if (kind0 === "unknown" && [...asked.values()].some(Boolean)) merged[KIND_KEY] = kindQuestion;

  let answers: Record<string, AnyAnswer> = {};
  let model: string | null = null;
  let usage: Report["usage"] = null;
  const questionsAsked = Object.keys(merged).length;
  if (questionsAsked > 0) {
    const result = await jev.ask(state, merged, config.model);
    answers = result.answers;
    model = result.model;
    usage = result.usage;
  }

  let kind = kind0;
  let kindSource = kindSource0;
  let kindConfidence: number | null = null;
  const kindAnswer = answers[KIND_KEY];
  if (kind === "unknown" && kindAnswer?.type === "choice") {
    const map: Record<string, Kind> = {
      bug: "bug",
      feature: "feature",
      question: "question",
      other: "unknown",
    };
    kind = map[kindAnswer.choice] ?? "unknown";
    kindSource = "model";
    kindConfidence = kindAnswer.confidence;
  }

  const inputs: PolicyInput[] = enabled.map((check) => ({
    check,
    verdict: check.decide(
      answersFor(answers, check.id),
      ctxFor(check, kind, kindSource, kindConfidence),
    ),
  }));
  const anyCheck = enabled[0];
  const { results, plan } = anyCheck
    ? applyPolicy(inputs, ctxFor(anyCheck, kind, kindSource, kindConfidence))
    : { results: [], plan: { add: [], remove: [] } };

  return {
    ...base,
    kind,
    kindSource,
    kindConfidence,
    flags,
    results,
    plan,
    model,
    usage,
    questionsAsked,
    ...(questionsAsked === 0 && results.every((r) => r.effective === "skipped")
      ? { shortCircuit: "no-questions" as const }
      : {}),
  };
}

export interface ApplyOptions {
  dryRun: boolean;
  commentMode: CommentMode;
  force?: boolean;
  meta?: CommentMeta;
}

export interface ApplyOutcome {
  labelsChanged: boolean;
  finalLabels?: string[];
  comment?: string;
  commentUrl?: string;
  skipped?: "already-triaged" | "no-questions" | "dry-run";
}

export async function applyReport(
  report: Report,
  config: ResolvedConfig,
  gh: IssueClient,
  options: ApplyOptions,
): Promise<ApplyOutcome> {
  if (report.shortCircuit === "already-triaged")
    return { labelsChanged: false, skipped: "already-triaged" };

  const acted =
    report.plan.add.length > 0 ||
    report.results.some((r) => r.effective === "suggested" && r.labels.length > 0);
  const shouldComment =
    options.commentMode === "always" || (options.commentMode === "when-acting" && acted);
  const comment = shouldComment ? renderComment(report, config.labels, options.meta) : undefined;

  if (options.dryRun)
    return { labelsChanged: false, ...(comment ? { comment } : {}), skipped: "dry-run" };

  // Re-read: a human may have triaged while the model was thinking.
  const fresh = await gh.getIssue(report.issue.number);
  if (!options.force && !fresh.labels.includes(config.labels.needsTriage)) {
    return { labelsChanged: false, skipped: "already-triaged" };
  }

  let labelsChanged = false;
  let finalLabels = fresh.labels;
  if (report.plan.add.length > 0 || report.plan.remove.length > 0) {
    finalLabels = fresh.labels.filter((l) => !report.plan.remove.includes(l));
    for (const l of report.plan.add) if (!finalLabels.includes(l)) finalLabels.push(l);
    if (
      finalLabels.length !== fresh.labels.length ||
      finalLabels.some((l) => !fresh.labels.includes(l))
    ) {
      await gh.setLabels(report.issue.number, finalLabels);
      labelsChanged = true;
    }
  }

  let commentUrl: string | undefined;
  if (comment) {
    const existing = (await gh.listComments(report.issue.number)).find((c) =>
      c.body.includes(MARKER),
    );
    const saved = existing
      ? await gh.updateComment(existing.id, comment)
      : await gh.createComment(report.issue.number, comment);
    commentUrl = saved.htmlUrl;
  }

  return {
    labelsChanged,
    finalLabels,
    ...(comment ? { comment } : {}),
    ...(commentUrl ? { commentUrl } : {}),
  };
}
