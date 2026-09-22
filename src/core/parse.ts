import type { Issue, Kind, KindSource, SectionKey, Sections, Template } from "./types.ts";

// GitHub renders each issue-form field as `### <label>` followed by the value.
// Empty optional fields render as `_No response_`.

const HEADING_RE = /^#{2,3}\s+(.+?)\s*#*\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;

interface Alias {
  re: RegExp;
  key: SectionKey;
}

const ALIASES: Alias[] = [
  { re: /^(minimal )?reproduction( link)?( or steps| repo(sitory)?)?:?$/i, key: "reproduction" },
  { re: /^(steps to|how to|to) reproduce:?$/i, key: "reproduction" },
  { re: /^(what is )?expected( behaviou?r| result)?\??:?$/i, key: "expected" },
  { re: /^what is actually happening\??:?$/i, key: "actual" },
  { re: /^(actual|current|observed) (behaviou?r|result):?$/i, key: "actual" },
  { re: /^describe the bug:?$/i, key: "actual" },
  { re: /^panic message:?$/i, key: "panic_message" },
  { re: /^(system info(rmation)?|environment|versions?):?$/i, key: "system_info" },
  { re: /^(any )?additional (comments?|context|information|notes?)\??:?$/i, key: "additional" },
  { re: /^what problem does this feature solve\??:?$/i, key: "problem" },
  { re: /^(problem|motivation|use case):?$/i, key: "problem" },
  { re: /^what does the proposed api look like\??:?$/i, key: "proposed_api" },
  { re: /^proposed (api|solution|change):?$/i, key: "proposed_api" },
];

/** Exact form labels per template; two or more matches identify the template. */
const TEMPLATE_HEADINGS: Record<Exclude<Template, "none">, string[]> = {
  bug: [
    "reproduction link or steps",
    "what is expected?",
    "what is actually happening?",
    "system info",
    "any additional comments?",
  ],
  panic: ["panic message", "reproduction", "system info", "additional context"],
  feature: ["what problem does this feature solve?", "what does the proposed api look like?"],
};

const REQUIRED: Record<Template, SectionKey[]> = {
  bug: ["reproduction", "expected", "actual", "system_info"],
  panic: ["panic_message", "reproduction", "system_info"],
  feature: ["problem", "proposed_api"],
  none: [],
};

export interface ParsedSections {
  sections: Sections;
  /** Headings seen, in order, lowercased. */
  headings: string[];
}

export function isEmptyResponse(text: string | undefined): boolean {
  const t = text?.trim() ?? "";
  return t === "" || /^_no response_$/i.test(t);
}

function aliasFor(heading: string): SectionKey | null {
  for (const { re, key } of ALIASES) if (re.test(heading)) return key;
  return null;
}

export function parseSections(body: string): ParsedSections {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const headings: string[] = [];
  const known: Partial<Record<SectionKey, string[]>> = {};
  const other: string[][] = [];

  let target: string[] = [];
  other.push(target); // preamble
  let inFence = false;

  for (const line of lines) {
    if (FENCE_RE.test(line)) inFence = !inFence;
    const m = inFence ? null : HEADING_RE.exec(line);
    if (m?.[1]) {
      const heading = m[1].trim();
      headings.push(heading.toLowerCase());
      const key = aliasFor(heading);
      if (key) {
        target = known[key] ?? (known[key] = []);
        if (target.length > 0) target.push("");
      } else {
        target = [`${heading}:`];
        other.push(target);
      }
      continue;
    }
    target.push(line);
  }

  const sections: Sections = {};
  for (const [key, value] of Object.entries(known) as [SectionKey, string[]][]) {
    const text = value.join("\n").trim();
    if (text) sections[key] = text;
  }
  const leftovers = other.map((chunk) => chunk.join("\n").trim()).filter(Boolean);

  if (Object.keys(sections).length === 0) {
    const text = leftovers.join("\n\n").trim();
    return { sections: text ? { body: text } : {}, headings };
  }
  if (leftovers.length > 0) {
    sections.additional = [...leftovers, sections.additional].filter(Boolean).join("\n\n");
  }
  return { sections, headings };
}

export function detectTemplate(headings: string[], title: string): Template {
  const seen = new Set(headings);
  let best: Template = "none";
  let bestCount = 1; // need at least two exact form headings
  for (const [template, labels] of Object.entries(TEMPLATE_HEADINGS) as [
    Exclude<Template, "none">,
    string[],
  ][]) {
    const count = labels.filter((l) => seen.has(l)).length;
    if (count > bestCount) {
      best = template;
      bestCount = count;
    } else if (count === bestCount && count > 1 && titlePrefix(title) === template) {
      best = template;
    }
  }
  return best;
}

function titlePrefix(title: string): Template | null {
  const t = title.trimStart();
  if (/^\[panic\]/i.test(t)) return "panic";
  if (/^\[bug\]/i.test(t)) return "bug";
  if (/^\[feature( request)?\]/i.test(t)) return "feature";
  return null;
}

export function requiredMissing(template: Template, sections: Sections): string[] {
  return REQUIRED[template].filter((key) => isEmptyResponse(sections[key]));
}

export function detectKind(
  issue: Pick<Issue, "typeName" | "title">,
  template: Template,
): { kind: Kind; source: KindSource } {
  switch (issue.typeName?.toLowerCase()) {
    case "bug":
      return { kind: "bug", source: "type" };
    case "feature":
      return { kind: "feature", source: "type" };
    case "task":
      return { kind: "task", source: "type" };
    default:
      break;
  }
  if (template === "bug" || template === "panic") return { kind: "bug", source: "template" };
  if (template === "feature") return { kind: "feature", source: "template" };
  const prefix = titlePrefix(issue.title);
  if (prefix === "bug" || prefix === "panic") return { kind: "bug", source: "title" };
  if (prefix === "feature") return { kind: "feature", source: "title" };
  return { kind: "unknown", source: "none" };
}
