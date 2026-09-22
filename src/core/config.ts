import type {
  CommentMode,
  LabelNames,
  LabelSlot,
  Mode,
  ResolvedConfig,
  Thresholds,
} from "./types.ts";
import { LABEL_SLOTS } from "./types.ts";

/** Exact label names on rolldown/rolldown. */
export const ROLLDOWN_LABELS: LabelNames = {
  p0: "p0: urgent",
  p1: "p1: important",
  p2: "p2: significant / minor bug",
  p3: "p3: nice to have / edge case",
  needsTriage: "needs-triage",
  needsReproduction: "needs-reproduction",
  hasWorkaround: "has workaround",
};

export const DEFAULT_THRESHOLDS: Thresholds = {
  noulYes: 0.75,
  noulNo: 0.25,
  scoreConfidence: 0.6,
  reproLow: 1,
  reproOk: 2.25,
  reproConfidence: 0.7,
  usefulnessP2: 1,
  workaroundLabel: 0.85,
  arguesPriority: 0.6,
  kindConfidence: 0.7,
};

/** Pinned: the `jev-latest` alias moves silently and thresholds are tuned per version. */
export const DEFAULT_MODEL = "jev-1.13.0";
export const DEFAULT_CHECKS = ["reproduction", "priority"];
/**
 * Measured on rolldown issues triaged since 2026-03 (`pnpm cli eval`):
 * priority agrees with maintainers on ~57% of decided bugs and p1 precision is
 * ~57%, so it only suggests until the questions improve. Reproduction at the
 * default thresholds was 3/3 correct with 19% recall, so it applies.
 */
export const DEFAULT_MODES: Record<string, Mode> = {
  reproduction: "apply",
  priority: "suggest",
};

const MODES = new Set<string>(["apply", "suggest", "off"]);
const COMMENT_MODES = new Set<string>(["always", "when-acting", "never"]);

export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Raw string inputs as they arrive from `action.yml` / the CLI. */
export interface RawConfig {
  checks?: string;
  modes?: string;
  options?: string;
  labels?: string;
  thresholds?: string;
  comment?: string;
  model?: string;
}

function parseJsonObject(name: string, text: string | undefined): Record<string, unknown> {
  const trimmed = text?.trim();
  if (!trimmed) return {};
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch (error) {
    throw new ConfigError(`\`${name}\` is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigError(`\`${name}\` must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function parseList(text: string | undefined): string[] {
  return (text ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseModes(text: string | undefined): Record<string, Mode> {
  const modes: Record<string, Mode> = {};
  for (const entry of parseList(text)) {
    const [id, mode, ...rest] = entry.split("=").map((s) => s.trim());
    if (!id || !mode || rest.length > 0 || !MODES.has(mode)) {
      throw new ConfigError(
        `\`modes\` entry ${JSON.stringify(entry)} must look like \`check=apply|suggest|off\``,
      );
    }
    modes[id] = mode as Mode;
  }
  return modes;
}

export function resolveConfig(raw: RawConfig = {}): ResolvedConfig {
  const checks = raw.checks?.trim() ? parseList(raw.checks) : [...DEFAULT_CHECKS];

  const labels: LabelNames = { ...ROLLDOWN_LABELS };
  for (const [key, value] of Object.entries(parseJsonObject("labels", raw.labels))) {
    if (!LABEL_SLOTS.includes(key as LabelSlot)) {
      throw new ConfigError(`\`labels\` has unknown slot ${JSON.stringify(key)}`);
    }
    if (typeof value !== "string" || !value.trim()) {
      throw new ConfigError(`\`labels.${key}\` must be a non-empty string`);
    }
    labels[key as LabelSlot] = value;
  }

  const thresholds: Thresholds = { ...DEFAULT_THRESHOLDS };
  for (const [key, value] of Object.entries(parseJsonObject("thresholds", raw.thresholds))) {
    if (!(key in DEFAULT_THRESHOLDS)) {
      throw new ConfigError(`\`thresholds\` has unknown key ${JSON.stringify(key)}`);
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new ConfigError(`\`thresholds.${key}\` must be a number`);
    }
    thresholds[key as keyof Thresholds] = value;
  }
  if (thresholds.noulNo >= thresholds.noulYes) {
    throw new ConfigError("`thresholds.noulNo` must be below `thresholds.noulYes`");
  }

  const comment = raw.comment?.trim() || "always";
  if (!COMMENT_MODES.has(comment)) {
    throw new ConfigError(`\`comment\` must be one of always, when-acting, never`);
  }

  return {
    labels,
    checks,
    modes: { ...DEFAULT_MODES, ...parseModes(raw.modes) },
    options: parseJsonObject("options", raw.options),
    comment: comment as CommentMode,
    model: raw.model?.trim() || DEFAULT_MODEL,
    thresholds,
  };
}
