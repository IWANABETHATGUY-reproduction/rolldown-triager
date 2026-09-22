import type { Answers, AnyAnswer, ChoiceAnswer, ScoreAnswer } from "./types.ts";

/** Builds a check's view of the batch answers: keys under `${prefix}:` with the prefix removed. */
export function answersFor(all: Readonly<Record<string, AnyAnswer>>, prefix: string): Answers {
  const raw: Record<string, AnyAnswer> = {};
  const marker = `${prefix}:`;
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(marker)) raw[key.slice(marker.length)] = value;
  }
  return {
    raw,
    has: (key) => key in raw,
    noul(key) {
      const a = raw[key];
      return a?.type === "noul" ? a.noul : undefined;
    },
    score(key): ScoreAnswer | undefined {
      const a = raw[key];
      if (a?.type !== "score") return undefined;
      const probabilities: Record<string, number> = {};
      let top = 0;
      for (const [level, p] of Object.entries(a.probabilities as Record<string, number>)) {
        probabilities[level] = p;
        top = Math.max(top, Number(level));
      }
      return { score: a.score, confidence: a.confidence, top, probabilities };
    },
    choice(key): ChoiceAnswer | undefined {
      const a = raw[key];
      if (a?.type !== "choice") return undefined;
      return {
        choice: a.choice,
        confidence: a.confidence,
        probabilities: { ...(a.probabilities as Record<string, number>) },
      };
    },
  };
}
