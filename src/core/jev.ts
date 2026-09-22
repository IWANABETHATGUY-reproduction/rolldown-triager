import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { TypeSafeClient, type Questions, type Usage } from "@typesafe-ai/sdk";

import type { AnyAnswer, TriageState } from "./types.ts";

export interface JevResult {
  model: string;
  answers: Record<string, AnyAnswer>;
  usage: Usage;
}

/** The one thing the runner needs from a model: answers to a batch of questions about a state. */
export interface JevClient {
  ask(state: TriageState, questions: Questions, model: string): Promise<JevResult>;
}

export interface TypeSafeJevOptions {
  /** Per attempt, ms. Triage is not latency-sensitive, so allow for a slow cold call. */
  timeout?: number;
  baseURL?: string;
  fetch?: typeof fetch;
}

export function createTypeSafeJev(apiKey: string, options: TypeSafeJevOptions = {}): JevClient {
  const client = new TypeSafeClient({
    apiKey,
    timeout: options.timeout ?? 30_000,
    logLevel: "off",
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return {
    async ask(state, questions, model) {
      const result = await client.systemOne({ state, questions, model });
      return {
        model: result.model,
        answers: { ...(result.answers as Record<string, AnyAnswer>) },
        usage: result.usage,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Recorded answers for offline tests and cached evals
// ---------------------------------------------------------------------------

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** Stable hash of exactly what would be sent, so any change to state or question text invalidates a recording. */
export function requestHash(state: TriageState, questions: Questions, model: string): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical({ model, state, questions })))
    .digest("hex")
    .slice(0, 24);
}

export interface Recording {
  /** Free-form tag for humans, e.g. the issue number. */
  label: string;
  hash: string;
  model: string;
  questionKeys: string[];
  usage: Usage;
  answers: Record<string, AnyAnswer>;
}

export class FixtureStale extends Error {
  override name = "FixtureStale";
}

export interface RecordedJevOptions {
  /** Live client used to fill a missing recording; without it a miss throws `FixtureStale`. */
  recordThrough?: JevClient;
  /** Name for new recordings; defaults to the request hash. */
  label?: string;
}

export function createRecordedJev(dir: string, options: RecordedJevOptions = {}): JevClient {
  const index = new Map<string, Recording>();
  if (existsSync(dir)) {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const rec = JSON.parse(readFileSync(join(dir, file), "utf8")) as Recording;
      index.set(rec.hash, rec);
    }
  }
  return {
    async ask(state, questions, model) {
      const hash = requestHash(state, questions, model);
      const hit = index.get(hash);
      if (hit) return { model: hit.model, answers: hit.answers, usage: hit.usage };
      if (!options.recordThrough) {
        throw new FixtureStale(
          `no recorded answers for ${options.label ?? hash} (hash ${hash}); re-record with \`pnpm cli record\``,
        );
      }
      const result = await options.recordThrough.ask(state, questions, model);
      const rec: Recording = {
        label: options.label ?? hash,
        hash,
        model: result.model,
        questionKeys: Object.keys(questions),
        usage: result.usage,
        answers: result.answers,
      };
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${rec.label}.json`), `${JSON.stringify(rec, null, 2)}\n`);
      index.set(hash, rec);
      return { model: rec.model, answers: rec.answers, usage: rec.usage };
    },
  };
}
