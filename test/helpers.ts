import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { extractReproLinks } from "../src/core/links.ts";
import { detectKind, detectTemplate, parseSections, requiredMissing } from "../src/core/parse.ts";
import type { Issue, Kind, KindSource, ParsedIssue } from "../src/core/types.ts";

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

export function loadIssue(number: number): Issue {
  return JSON.parse(readFileSync(join(FIXTURES, "issues", `${number}.json`), "utf8")) as Issue;
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
