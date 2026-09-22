import { Buffer } from "node:buffer";
import { inflateSync } from "node:zlib";

// The rolldown REPL keeps its whole state in the URL hash as
// base64(zlib(JSON({ f: files, v: version }))). Mirrors rolldown/repl
// `app/utils/url.ts` and the decoder in rolldown's `rolldown-repl` skill.

export const REPL_HOSTS: readonly string[] = ["repl.rolldown.rs", "rolldown-repl.netlify.app"];

export interface ReplFile {
  name: string;
  content: string;
  entry: boolean;
}

export type ReplDecode =
  | { ok: true; version: string; files: ReplFile[] }
  | { ok: false; error: "no-payload" | "undecodable" | "malformed" };

/** zlib header: CMF 0x78 (deflate, 32k window) and (CMF << 8 | FLG) divisible by 31. */
function isZlib(bin: Buffer): boolean {
  const cmf = bin[0];
  const flg = bin[1];
  return cmf === 0x78 && flg !== undefined && ((cmf << 8) | flg) % 31 === 0;
}

export function decodeReplUrl(url: string): ReplDecode {
  const hashAt = url.indexOf("#");
  if (hashAt < 0 || hashAt === url.length - 1) return { ok: false, error: "no-payload" };
  let raw = url.slice(hashAt + 1);
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // Not percent-encoded; use as is.
  }
  raw += "=".repeat(-raw.length & 3);
  const bin = Buffer.from(raw, "base64");
  if (bin.length === 0) return { ok: false, error: "undecodable" };

  let text: string;
  try {
    text = isZlib(bin)
      ? inflateSync(bin).toString("utf8")
      : // Legacy share links: decodeURIComponent(escape(binary)).
        decodeURIComponent(bin.toString("latin1"));
  } catch {
    return { ok: false, error: "undecodable" };
  }

  let state: unknown;
  try {
    state = JSON.parse(text);
  } catch {
    return { ok: false, error: "undecodable" };
  }
  if (typeof state !== "object" || state === null) return { ok: false, error: "malformed" };
  const { f, v } = state as { f?: unknown; v?: unknown };
  if (typeof f !== "object" || f === null || Array.isArray(f)) {
    return { ok: false, error: "malformed" };
  }

  const files: ReplFile[] = [];
  for (const [name, meta] of Object.entries(f as Record<string, unknown>)) {
    const m = (meta ?? {}) as { n?: unknown; c?: unknown; code?: unknown; e?: unknown };
    const content = typeof m.c === "string" ? m.c : typeof m.code === "string" ? m.code : "";
    files.push({ name: typeof m.n === "string" ? m.n : name, content, entry: m.e === true });
  }
  return { ok: true, version: typeof v === "string" && v ? v : "unknown", files };
}

export function replHasContent(decoded: ReplDecode): boolean {
  return decoded.ok && decoded.files.some((f) => f.content.trim().length > 0);
}

export function summarizeRepl(decoded: ReplDecode): string {
  if (!decoded.ok) {
    return decoded.error === "no-payload" ? "no payload" : "undecodable (truncated link?)";
  }
  if (!replHasContent(decoded)) return "empty";
  const n = decoded.files.length;
  return `${n} file${n === 1 ? "" : "s"}, rolldown ${decoded.version}`;
}
