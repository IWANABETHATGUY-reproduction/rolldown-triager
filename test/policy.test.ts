import { describe, expect, it } from "vitest";

import { applyPolicy } from "../src/core/policy.ts";
import type { Check, LabelSlot, Verdict } from "../src/core/types.ts";
import { defineCheck } from "../src/core/types.ts";
import { ctx as baseCtx, issue } from "./support.ts";

/** Policy tests exercise apply mode; the shipped default for priority is suggest. */
const ctx = (over: Parameters<typeof baseCtx>[0] = {}) =>
  baseCtx({
    ...over,
    raw: { ...over.raw, modes: ["priority=apply", over.raw?.modes].filter(Boolean).join(",") },
  });

const check = (id: string, over: Partial<Check> = {}): Check =>
  defineCheck({
    id,
    defaultMode: "apply",
    questions: () => ({}),
    decide: () => ({ status: "skipped", reason: "x" }),
    ...over,
  });

const gate = check("reproduction");
const prio = check("priority");
const extra = check("has-workaround", { defaultMode: "suggest" });

const decided = (add: LabelSlot[], over: Partial<Verdict> = {}): Verdict =>
  ({ status: "decided", add, note: "n", ...over }) as Verdict;

describe("applyPolicy", () => {
  it("applies labels and removes needs-triage when a priority is set", () => {
    const { results, plan } = applyPolicy([{ check: prio, verdict: decided(["p2"]) }], ctx());
    expect(results[0]).toMatchObject({
      effective: "applied",
      labels: ["p2: significant / minor bug"],
      downgradedBecause: [],
    });
    expect(plan).toEqual({ add: ["p2: significant / minor bug"], remove: ["needs-triage"] });
  });

  it("never applies p0", () => {
    const { results, plan } = applyPolicy([{ check: prio, verdict: decided(["p0"]) }], ctx());
    expect(results[0]).toMatchObject({
      effective: "suggested",
      labels: [],
      downgradedBecause: ["p0 is never applied automatically"],
    });
    expect(plan).toEqual({ add: [], remove: [] });
  });

  it("only ever removes needs-triage", () => {
    const { plan } = applyPolicy(
      [{ check: gate, verdict: decided(["needsReproduction"], { gate: "fail" }) }],
      ctx(),
    );
    expect(plan).toEqual({ add: ["needs-reproduction"], remove: [] });
  });

  it("downgrades a priority when the issue already has one", () => {
    const c = ctx({ issue: issue({ labels: ["needs-triage", "p1: important"] }) });
    const { results, plan } = applyPolicy([{ check: prio, verdict: decided(["p3"]) }], c);
    expect(results[0]).toMatchObject({
      effective: "suggested",
      downgradedBecause: ["issue already has a priority label"],
    });
    expect(plan.add).toEqual([]);
  });

  it("a failed or unsure reproduction does not hold back another check's label", () => {
    // Verifiability and severity are separate questions. A maintainer retitles a
    // wrong priority in one click; a priority that was never applied is invisible.
    for (const gateVerdict of [
      decided(["needsReproduction"], { gate: "fail" }),
      { status: "abstained", note: "unsure", gate: "unsure" } as Verdict,
    ]) {
      const { results, plan } = applyPolicy(
        [
          { check: gate, verdict: gateVerdict },
          { check: prio, verdict: decided(["p2"]) },
        ],
        ctx(),
      );
      expect(results[1]).toMatchObject({ effective: "applied", downgradedBecause: [] });
      expect(plan.add).toContain("p2: significant / minor bug");
      expect(plan.remove).toEqual(["needs-triage"]);
      if (gateVerdict.status === "decided") expect(plan.add).toContain("needs-reproduction");
    }
  });

  it("a passed gate lets others apply", () => {
    const { plan } = applyPolicy(
      [
        { check: gate, verdict: decided([], { gate: "pass" }) },
        { check: prio, verdict: decided(["p3"]) },
      ],
      ctx(),
    );
    expect(plan).toEqual({ add: ["p3: nice to have / edge case"], remove: ["needs-triage"] });
  });

  it("honours forceSuggest, suggest mode, and off mode", () => {
    const c = ctx({ raw: { modes: "has-workaround=off" } });
    const { results, plan } = applyPolicy(
      [
        { check: prio, verdict: decided(["p2"], { forceSuggest: "could be p0" }) },
        { check: extra, verdict: decided(["hasWorkaround"]) },
      ],
      c,
    );
    expect(results[0]).toMatchObject({
      effective: "suggested",
      downgradedBecause: ["could be p0"],
    });
    expect(results[1]).toMatchObject({ effective: "skipped", mode: "off" });
    expect(plan).toEqual({ add: [], remove: [] });

    const suggest = applyPolicy([{ check: extra, verdict: decided(["hasWorkaround"]) }], ctx());
    expect(suggest.results[0]).toMatchObject({
      effective: "suggested",
      mode: "suggest",
      downgradedBecause: [],
    });
  });

  it("blocks labels when the kind came from the model with low confidence", () => {
    const c = ctx({ kindSource: "model", kindConfidence: 0.4 });
    const { results } = applyPolicy([{ check: prio, verdict: decided(["p2"]) }], c);
    expect(results[0]?.downgradedBecause).toEqual([
      "issue kind came from the model with low confidence",
    ]);
    const ok = applyPolicy(
      [{ check: prio, verdict: decided(["p2"]) }],
      ctx({ kindSource: "model", kindConfidence: 0.9 }),
    );
    expect(ok.results[0]?.effective).toBe("applied");
  });

  it("a decision with no labels is applied trivially", () => {
    const { results, plan } = applyPolicy(
      [{ check: gate, verdict: decided([], { gate: "pass" }) }],
      ctx(),
    );
    expect(results[0]).toMatchObject({ effective: "applied", labels: [] });
    expect(plan).toEqual({ add: [], remove: [] });
  });
});
