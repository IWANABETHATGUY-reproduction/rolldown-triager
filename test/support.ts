import { answersFor } from "../src/core/answers.ts";
import { resolveConfig, type RawConfig } from "../src/core/config.ts";
import type {
  Answers,
  AnyAnswer,
  Ctx,
  Flags,
  Issue,
  Kind,
  ParsedIssue,
  ResolvedConfig,
} from "../src/core/types.ts";

/** Raw batch answers from a flat `{ key: value }` map: numbers become Nouls, objects pass through. */
export function batch(
  prefix: string,
  values: Record<string, number | AnyAnswer>,
): Record<string, AnyAnswer> {
  const out: Record<string, AnyAnswer> = {};
  for (const [k, v] of Object.entries(values)) {
    out[`${prefix}:${k}`] = typeof v === "number" ? { type: "noul", noul: v } : v;
  }
  return out;
}

export function answers(prefix: string, values: Record<string, number | AnyAnswer>): Answers {
  return answersFor(batch(prefix, values), prefix);
}

export function scoreAnswer(score: number, confidence: number, levels = 4): AnyAnswer {
  const probabilities: Record<string, number> = {};
  for (let i = 0; i < levels; i++) probabilities[String(i)] = i === Math.round(score) ? 1 : 0;
  const legend: Record<string, string> = {};
  for (let i = 0; i < levels; i++) legend[String(i)] = `level ${i}`;
  return { type: "score", score, confidence, legend, probabilities } as AnyAnswer;
}

export function choiceAnswer(choice: string, confidence: number): AnyAnswer {
  return {
    type: "choice",
    choice,
    confidence,
    probabilities: { [choice]: confidence },
  } as AnyAnswer;
}

export const issue = (over: Partial<Issue> = {}): Issue => ({
  number: 1,
  title: "[Bug]: something",
  body: "### Reproduction link or steps\n\nsteps\n\n### What is expected?\n\nx\n\n### What is actually happening?\n\ny\n\n### System Info\n\nNode 22",
  typeName: "Bug",
  labels: ["needs-triage"],
  htmlUrl: "https://github.com/o/r/issues/1",
  authorAssociation: "NONE",
  ...over,
});

export const parsed = (over: Partial<ParsedIssue> = {}): ParsedIssue => ({
  template: "bug",
  sections: { reproduction: "steps", expected: "x", actual: "y", system_info: "Node 22" },
  requiredMissing: [],
  links: [],
  ...over,
});

export const flags = (over: Partial<Flags> = {}): Flags => ({
  priorityWords: false,
  templateFollowed: true,
  runnableLinks: [],
  replInvalid: false,
  isPanic: false,
  truncated: [],
  ...over,
});

export function ctx<O>(
  over: Partial<Ctx<O>> & { kind?: Kind; raw?: RawConfig; options?: O } = {},
): Ctx<O> {
  const config: ResolvedConfig = over.config ?? resolveConfig(over.raw);
  const { raw: _raw, ...rest } = over;
  return {
    issue: issue(),
    parsed: parsed(),
    // Enough prose that the default ctx is not treated as an empty report; the
    // empty case is exercised explicitly in reproduction.test.ts.
    state: {
      issue: {
        title: "t",
        kind: over.kind ?? "bug",
        template: "bug",
        sections: { reproduction: "a".repeat(200) },
      },
    },
    flags: flags(),
    kind: over.kind ?? "bug",
    kindSource: "type",
    kindConfidence: null,
    config,
    options: (over.options ?? {}) as O,
    ...rest,
  };
}
