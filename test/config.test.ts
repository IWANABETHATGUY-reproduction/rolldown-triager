import { describe, expect, it } from "vitest";

import {
  ConfigError,
  DEFAULT_MODEL,
  parseModes,
  resolveApiKey,
  resolveConfig,
  ROLLDOWN_LABELS,
} from "../src/core/config.ts";

describe("resolveConfig", () => {
  it("has rolldown defaults", () => {
    const c = resolveConfig();
    expect(c.labels).toEqual(ROLLDOWN_LABELS);
    expect(c.checks).toEqual(["reproduction", "priority"]);
    expect(c.modes).toEqual({ reproduction: "apply", priority: "suggest" });
    expect(c.model).toBe(DEFAULT_MODEL);
    expect(c.comment).toBe("never");
  });

  it("parses lists, modes and JSON overrides", () => {
    const c = resolveConfig({
      checks: " priority, has-workaround ",
      modes: "priority=suggest, has-workaround=off",
      labels: '{"needsTriage":"triage"}',
      thresholds: '{"noulYes":0.8}',
      options: '{"priority":{"applyLabels":["p2"]}}',
      comment: "when-acting",
      model: "jev-latest",
    });
    expect(c.checks).toEqual(["priority", "has-workaround"]);
    expect(c.modes).toEqual({
      reproduction: "apply",
      priority: "suggest",
      "has-workaround": "off",
    });
    expect(c.labels.needsTriage).toBe("triage");
    expect(c.thresholds.noulYes).toBe(0.8);
    expect(c.options).toEqual({ priority: { applyLabels: ["p2"] } });
    expect(c.comment).toBe("when-acting");
    expect(c.model).toBe("jev-latest");
  });

  it("rejects bad input with a clear message", () => {
    expect(() => resolveConfig({ labels: "{" })).toThrow(ConfigError);
    expect(() => resolveConfig({ labels: '["x"]' })).toThrow("must be a JSON object");
    expect(() => resolveConfig({ labels: '{"nope":"x"}' })).toThrow("unknown slot");
    expect(() => resolveConfig({ labels: '{"p1":""}' })).toThrow("non-empty");
    expect(() => resolveConfig({ thresholds: '{"noulYes":"a"}' })).toThrow("must be a number");
    expect(() => resolveConfig({ thresholds: '{"bogus":1}' })).toThrow("unknown key");
    expect(() => resolveConfig({ thresholds: '{"noulYes":0.2,"noulNo":0.3}' })).toThrow("below");
    expect(() => resolveConfig({ comment: "sometimes" })).toThrow("comment");
    expect(() => parseModes("priority=maybe")).toThrow("check=apply|suggest|off");
    expect(() => parseModes("priority")).toThrow(ConfigError);
  });
});

describe("resolveApiKey", () => {
  const src = "`typesafe-api-key`";

  it("accepts a key and strips surrounding whitespace", () => {
    // The trailing newline `gh secret set` adds when reading from a file.
    expect(resolveApiKey("api_abc123\n", src)).toBe("api_abc123");
    expect(resolveApiKey("  api_abc123  ", src)).toBe("api_abc123");
  });

  it("refuses a missing or blank key", () => {
    for (const raw of [undefined, "", "   ", "\n"]) {
      expect(() => resolveApiKey(raw, src)).toThrow(ConfigError);
      expect(() => resolveApiKey(raw, src)).toThrow("is required");
    }
  });

  it("refuses a key with interior whitespace, naming the likely cause", () => {
    // Not sendable as a header. The SDK reacts by putting the whole key in an
    // error message and retrying it, so this has to fail before the SDK sees it.
    expect(() => resolveApiKey("api_abc\n123", src)).toThrow(/trailing newline/);
    expect(() => resolveApiKey("api abc", src)).toThrow(/whitespace/);
  });

  it("never puts the key in the error it throws", () => {
    const key = `api_${"k".repeat(103)}\nx`;
    try {
      resolveApiKey(key, src);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).not.toContain("kkk");
    }
  });
});
