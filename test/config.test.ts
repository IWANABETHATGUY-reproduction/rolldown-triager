import { describe, expect, it } from "vitest";

import {
  ConfigError,
  DEFAULT_MODEL,
  parseModes,
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
    expect(c.comment).toBe("when-needed");
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
