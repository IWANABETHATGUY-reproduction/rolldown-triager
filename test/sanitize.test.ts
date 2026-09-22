import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { proseOnly, replaceReplUrls, sanitizeSection } from "../src/core/sanitize.ts";

const REPL = `https://repl.rolldown.rs/#${deflateSync(
  Buffer.from(JSON.stringify({ v: "1.0.0", f: { "a.js": { c: "1" } } })),
).toString("base64")}`;

describe("sanitizeSection", () => {
  it("replaces REPL urls with a summary so the base64 hash never reaches the model", () => {
    const { text } = sanitizeSection(`Repro: ${REPL}`, { cap: 1000 });
    expect(text).toBe("Repro: <repl-link: 1 file, rolldown 1.0.0>");
    expect(replaceReplUrls("x https://repl.rolldown.rs/# y")).toBe("x <repl-link: no payload> y");
  });

  it("strips html comments, images and wrapper tags", () => {
    const { text } = sanitizeSection(
      '<!-- template note -->\n<details><summary>log</summary>\n\n![shot](https://x/y.png)\n<img src="a">\n</details>',
      { cap: 1000 },
    );
    expect(text).toBe("log\n\n[image]\n[image]");
  });

  it("trims long fenced blocks to head and tail", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    const { text } = sanitizeSection(["```", ...lines, "```"].join("\n"), {
      cap: 10_000,
      fenceMax: 40,
      fenceHead: 5,
      fenceTail: 2,
    });
    expect(text.split("\n")).toEqual([
      "```",
      "line 0",
      "line 1",
      "line 2",
      "line 3",
      "line 4",
      "[... 93 lines omitted ...]",
      "line 98",
      "line 99",
      "```",
    ]);
  });

  it("leaves short fences alone and copes with an unterminated one", () => {
    expect(sanitizeSection("```\na\n```", { cap: 100 }).text).toBe("```\na\n```");
    expect(sanitizeSection("```\na\nb", { cap: 100 }).text).toBe("```\na\nb");
  });

  it("cuts very long lines and long urls", () => {
    const { text } = sanitizeSection(`${"x".repeat(600)}\nhttps://example.com/${"y".repeat(300)}`, {
      cap: 10_000,
    });
    const [first, second] = text.split("\n");
    expect(first).toHaveLength(503);
    expect(first?.endsWith("...")).toBe(true);
    expect(second).toBe("example.com/...");
  });

  it("anonymises mentions but not emails or code", () => {
    const { text } = sanitizeSection("cc @someone and me@example.com `@decorator`", { cap: 100 });
    expect(text).toBe("cc @user and me@example.com `@decorator`");
  });

  it("keeps head and tail lines of a panic message", () => {
    const body = Array.from({ length: 50 }, (_, i) => `frame ${i}`).join("\n");
    const { text } = sanitizeSection(body, { cap: 10_000, headLines: 3, tailLines: 2 });
    expect(text).toBe("frame 0\nframe 1\nframe 2\n[... 45 lines omitted ...]\nframe 48\nframe 49");
  });

  it("filters system info to relevant lines, falling back to the first lines", () => {
    const re = /\b(OS|Node|rolldown)\b/;
    expect(
      sanitizeSection(
        "System:\n  OS: macOS\n  CPU: m1\nBinaries:\n  Node: 22\nnpmPackages:\n  rolldown: 1",
        {
          cap: 1000,
          keepLines: re,
        },
      ).text,
    ).toBe("OS: macOS\nNode: 22\nrolldown: 1");
    expect(sanitizeSection("nothing\nrelevant", { cap: 1000, keepLines: re }).text).toBe(
      "nothing\nrelevant",
    );
  });

  it("caps on a line boundary and reports truncation", () => {
    const body = Array.from({ length: 20 }, (_, i) => `row ${i}`).join("\n");
    const out = sanitizeSection(body, { cap: 40 });
    expect(out.truncated).toBe(true);
    expect(out.text.endsWith("\n[... truncated ...]")).toBe(true);
    expect(out.text.length).toBeLessThan(40 + 20);
    expect(sanitizeSection("short", { cap: 40 })).toEqual({ text: "short", truncated: false });
  });

  it("collapses runs of blank lines", () => {
    expect(sanitizeSection("a\n\n\n\n\nb", { cap: 100 }).text).toBe("a\n\nb");
  });
});

describe("proseOnly", () => {
  it("removes fenced and inline code", () => {
    expect(proseOnly("keep `P0` this\n```\nurgent\n```\nend").replace(/\s+/g, " ").trim()).toBe(
      "keep this end",
    );
  });
});
