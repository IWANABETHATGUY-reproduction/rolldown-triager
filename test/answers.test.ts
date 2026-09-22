import { describe, expect, it } from "vitest";

import { answersFor } from "../src/core/answers.ts";
import { batch, choiceAnswer, scoreAnswer } from "./support.ts";

describe("answersFor", () => {
  it("strips the prefix and ignores other checks' keys", () => {
    const all = {
      ...batch("a", { x: 0.2 }),
      ...batch("b", { x: 0.9, s: scoreAnswer(1.5, 0.7, 3), c: choiceAnswer("bug", 0.8) }),
    };
    const a = answersFor(all, "a");
    const b = answersFor(all, "b");
    expect(a.noul("x")).toBe(0.2);
    expect(b.noul("x")).toBe(0.9);
    expect(a.has("s")).toBe(false);
    expect(b.score("s")).toMatchObject({ score: 1.5, confidence: 0.7, top: 2 });
    expect(b.choice("c")).toMatchObject({ choice: "bug", confidence: 0.8 });
    expect(b.noul("s")).toBeUndefined();
    expect(b.score("x")).toBeUndefined();
    expect(Object.keys(b.raw)).toEqual(["x", "s", "c"]);
  });
});
