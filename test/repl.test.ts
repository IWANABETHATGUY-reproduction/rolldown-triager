import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { decodeReplUrl, replHasContent, summarizeRepl } from "../src/core/repl.ts";
import { loadIssue } from "./helpers.ts";

function encode(payload: unknown, level = 9): string {
  const b64 = deflateSync(Buffer.from(JSON.stringify(payload)), { level }).toString("base64");
  return `https://repl.rolldown.rs/#${b64}`;
}

const PAYLOAD = {
  v: "1.2.9",
  f: {
    "index.js": { n: "index.js", c: "import './a.js'\n", e: true },
    "a.js": { n: "a.js", c: "export const a = 1\n" },
  },
};

describe("decodeReplUrl", () => {
  it("decodes a zlib payload (best compression, as the REPL emits)", () => {
    const d = decodeReplUrl(encode(PAYLOAD));
    expect(d).toMatchObject({ ok: true, version: "1.2.9" });
    if (!d.ok) throw new Error("unreachable");
    expect(d.files.map((f) => f.name)).toEqual(["index.js", "a.js"]);
    expect(d.files[0]?.entry).toBe(true);
    expect(summarizeRepl(d)).toBe("2 files, rolldown 1.2.9");
  });

  it("decodes a zlib payload at default compression too", () => {
    expect(decodeReplUrl(encode(PAYLOAD, 6))).toMatchObject({ ok: true });
  });

  it("decodes the legacy escape() format", () => {
    const legacy = Buffer.from(
      unescape(encodeURIComponent(JSON.stringify({ v: "0.1", f: { "a.js": { code: "x" } } }))),
      "latin1",
    ).toString("base64");
    const d = decodeReplUrl(`https://repl.rolldown.rs/#${legacy}`);
    expect(d).toMatchObject({ ok: true, version: "0.1" });
    if (d.ok) expect(d.files[0]?.content).toBe("x");
  });

  it("reports an empty payload as not having content", () => {
    const d = decodeReplUrl(encode({ v: "latest", f: { "index.js": { c: "  \n" } } }));
    expect(d.ok).toBe(true);
    expect(replHasContent(d)).toBe(false);
    expect(summarizeRepl(d)).toBe("empty");
  });

  it("fails cleanly on a truncated hash", () => {
    const url = encode(PAYLOAD);
    const d = decodeReplUrl(url.slice(0, url.length - 20));
    expect(d).toEqual({ ok: false, error: "undecodable" });
    expect(summarizeRepl(d)).toBe("undecodable (truncated link?)");
  });

  it("fails cleanly with no hash", () => {
    expect(decodeReplUrl("https://repl.rolldown.rs/")).toEqual({ ok: false, error: "no-payload" });
    expect(decodeReplUrl("https://repl.rolldown.rs/#")).toEqual({ ok: false, error: "no-payload" });
  });

  it("rejects JSON that is not a REPL state", () => {
    expect(decodeReplUrl(encode([1, 2]))).toEqual({ ok: false, error: "malformed" });
    expect(decodeReplUrl(encode({ v: "1" }))).toEqual({ ok: false, error: "malformed" });
  });

  it("decodes the real link from issue #10792", () => {
    const url = /https:\/\/repl\.rolldown\.rs\/#\S+/.exec(loadIssue(10792).body)?.[0] ?? "";
    const d = decodeReplUrl(url.replace(/[)>.,]+$/, ""));
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.files.length).toBeGreaterThan(0);
  });
});
