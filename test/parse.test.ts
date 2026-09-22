import { describe, expect, it } from "vitest";

import {
  detectKind,
  detectTemplate,
  isEmptyResponse,
  parseSections,
  requiredMissing,
} from "../src/core/parse.ts";
import { loadIssue, parseIssue } from "./helpers.ts";

const BUG_BODY = `### Reproduction link or steps

https://repl.rolldown.rs/#abc

### What is expected?

works

### What is actually happening?

\`\`\`
### not a heading, inside a fence
error
\`\`\`

### System Info

_No response_

### Any additional comments?

_No response_`;

describe("parseSections", () => {
  it("maps form headings to canonical sections and ignores headings inside fences", () => {
    const { sections, headings } = parseSections(BUG_BODY);
    expect(headings).toEqual([
      "reproduction link or steps",
      "what is expected?",
      "what is actually happening?",
      "system info",
      "any additional comments?",
    ]);
    expect(sections.reproduction).toBe("https://repl.rolldown.rs/#abc");
    expect(sections.expected).toBe("works");
    expect(sections.actual).toContain("### not a heading, inside a fence");
    expect(sections.system_info).toBe("_No response_");
  });

  it("puts a body with no recognised headings into `body`", () => {
    expect(parseSections("just text\n\nmore").sections).toEqual({ body: "just text\n\nmore" });
    expect(parseSections("   ").sections).toEqual({});
  });

  it("folds preamble and unknown headings into `additional`, keeping the heading text", () => {
    const { sections } = parseSections(
      "intro line\n\n## Steps to reproduce\n\n1. run\n\n## Root cause\n\nsomewhere\n\n### Any additional comments?\n\nthanks",
    );
    expect(sections.reproduction).toBe("1. run");
    expect(sections.additional).toBe("intro line\n\nRoot cause:\n\nsomewhere\n\nthanks");
  });

  it("handles CRLF bodies", () => {
    expect(parseSections("### Panic message\r\n\r\nboom\r\n").sections.panic_message).toBe("boom");
  });
});

describe("detectTemplate / requiredMissing", () => {
  it("needs at least two exact form headings", () => {
    expect(detectTemplate(["reproduction link or steps"], "[Bug]: x")).toBe("none");
    expect(detectTemplate(["reproduction link or steps", "system info"], "x")).toBe("bug");
    expect(detectTemplate(["panic message", "reproduction"], "x")).toBe("panic");
    expect(
      detectTemplate(
        ["what problem does this feature solve?", "what does the proposed api look like?"],
        "x",
      ),
    ).toBe("feature");
  });

  it("breaks ties with the title prefix", () => {
    // "system info" + "reproduction" is one hit for bug (system info) and two for panic.
    expect(detectTemplate(["system info", "reproduction"], "[Bug]: x")).toBe("panic");
  });

  it("treats `_No response_` as missing", () => {
    const { sections } = parseSections(BUG_BODY);
    expect(requiredMissing("bug", sections)).toEqual(["system_info"]);
    expect(isEmptyResponse("_No response_")).toBe(true);
    expect(isEmptyResponse(" x ")).toBe(false);
  });
});

describe("detectKind", () => {
  it("prefers the native type, then the template, then the title", () => {
    expect(detectKind({ typeName: "Feature", title: "[Bug]: x" }, "bug")).toEqual({
      kind: "feature",
      source: "type",
    });
    expect(detectKind({ typeName: "Task", title: "x" }, "none")).toEqual({
      kind: "task",
      source: "type",
    });
    expect(detectKind({ typeName: null, title: "x" }, "panic")).toEqual({
      kind: "bug",
      source: "template",
    });
    expect(detectKind({ typeName: null, title: "[Feature Request]: x" }, "none")).toEqual({
      kind: "feature",
      source: "title",
    });
    expect(detectKind({ typeName: null, title: "WASI throws" }, "none")).toEqual({
      kind: "unknown",
      source: "none",
    });
  });
});

describe("real fixtures", () => {
  it.each([
    [10938, "bug", "bug", "type"],
    [10792, "bug", "bug", "type"],
    [10829, "panic", "bug", "type"],
    [10119, "feature", "feature", "type"],
    [10853, "bug", "feature", "type"], // "[Bug]:" title, retyped Feature by a maintainer
    [10909, "bug", "bug", "template"], // blank issue with hand-written form headings, type null
    [10697, "none", "unknown", "none"],
    [10384, "panic", "bug", "type"],
  ] as const)("#%i → template %s, kind %s from %s", (number, template, kind, source) => {
    const parsed = parseIssue(loadIssue(number));
    expect(parsed.template).toBe(template);
    expect(parsed.kind).toBe(kind);
    expect(parsed.kindSource).toBe(source);
    expect(parsed.requiredMissing).toEqual([]);
  });

  it("keeps recognised sections for a non-template issue", () => {
    const parsed = parseIssue(loadIssue(10697));
    expect(Object.keys(parsed.sections).sort()).toEqual(["additional", "system_info"]);
  });
});
