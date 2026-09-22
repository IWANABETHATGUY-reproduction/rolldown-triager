import { decodeReplUrl, REPL_HOSTS, summarizeRepl } from "./repl.ts";

// Jev's accuracy drops as the state fills with content unrelated to the
// decision, and the 32k-token budget covers state plus the longest question.
// Everything here removes tokens that carry no triage signal.

export interface SanitizeOptions {
  /** Character cap, applied last on a line boundary. */
  cap: number;
  /** Fenced blocks longer than this keep `fenceHead` + `fenceTail` lines. */
  fenceMax?: number;
  fenceHead?: number;
  fenceTail?: number;
  lineMax?: number;
  /** Keep only the first/last N lines of the whole section (panic messages). */
  headLines?: number;
  tailLines?: number;
  /** Keep only lines matching this (system info); falls back to the first lines when nothing matches. */
  keepLines?: RegExp;
}

export interface Sanitized {
  text: string;
  truncated: boolean;
}

const REPL_URL_RE = new RegExp(
  `https?://(?:${REPL_HOSTS.map((h) => h.replaceAll(".", "\\.")).join("|")})/?#[^\\s<>()[\\]"'\`]*`,
  "g",
);
const LONG_URL_RE = /https?:\/\/([^\s<>()[\]"'`/]+)[^\s<>()[\]"'`]{200,}/g;
const FENCE_RE = /^\s*(```|~~~)/;

const OMITTED = (n: number): string => `[... ${n} lines omitted ...]`;

export function replaceReplUrls(text: string): string {
  return text.replace(REPL_URL_RE, (url) => `<repl-link: ${summarizeRepl(decodeReplUrl(url))}>`);
}

function stripHtml(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "[image]")
    .replace(/<img\b[^>]*>/gi, "[image]")
    .replace(/<video\b[\s\S]*?<\/video>/gi, "[video]")
    .replace(/<\/?(details|summary|p|div|br|b|i|em|strong|kbd|sup|sub)\b[^>]*>/gi, "");
}

function trimFences(text: string, max: number, head: number, tail: number): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let fence: string[] | null = null;
  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      if (fence === null) {
        fence = [line];
      } else {
        fence.push(line);
        const inner = fence.length - 2;
        if (inner > max) {
          const open = fence[0] ?? "";
          const close = fence.at(-1) ?? "";
          const body = fence.slice(1, -1);
          out.push(
            open,
            ...body.slice(0, head),
            OMITTED(inner - head - tail),
            ...body.slice(-tail),
            close,
          );
        } else {
          out.push(...fence);
        }
        fence = null;
      }
      continue;
    }
    if (fence) fence.push(line);
    else out.push(line);
  }
  if (fence) out.push(...fence); // unterminated fence
  return out.join("\n");
}

function headTail(text: string, head: number, tail: number): string {
  const lines = text.split("\n");
  if (lines.length <= head + tail) return text;
  return [...lines.slice(0, head), OMITTED(lines.length - head - tail), ...lines.slice(-tail)].join(
    "\n",
  );
}

function keepMatching(text: string, re: RegExp): string {
  const lines = text.split("\n");
  const kept = lines.filter((l) => re.test(l));
  return (kept.length > 0 ? kept : lines.slice(0, 10)).map((l) => l.trim()).join("\n");
}

function capOnLine(text: string, cap: number): Sanitized {
  if (text.length <= cap) return { text, truncated: false };
  const cut = text.lastIndexOf("\n", cap);
  const kept = text.slice(0, cut > cap / 2 ? cut : cap);
  return { text: `${kept.trimEnd()}\n[... truncated ...]`, truncated: true };
}

export function sanitizeSection(raw: string, opts: SanitizeOptions): Sanitized {
  let text = raw.replace(/\r\n?/g, "\n");
  text = stripHtml(text);
  text = replaceReplUrls(text);
  text = text.replace(LONG_URL_RE, (_m, host: string) => `${host}/...`);
  text = trimFences(text, opts.fenceMax ?? 40, opts.fenceHead ?? 25, opts.fenceTail ?? 10);
  const lineMax = opts.lineMax ?? 500;
  text = text
    .split("\n")
    .map((l) => (l.length > lineMax ? `${l.slice(0, lineMax)}...` : l))
    .join("\n");
  text = text.replace(/(^|[^\w`])@[\w-]+/g, "$1@user");
  if (opts.keepLines) text = keepMatching(text, opts.keepLines);
  if (opts.headLines !== undefined && opts.tailLines !== undefined) {
    text = headTail(text, opts.headLines, opts.tailLines);
  }
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return capOnLine(text, opts.cap);
}

/** Body text with fenced blocks and inline code removed, for prose-only heuristics. */
export function proseOnly(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/`[^`\n]*`/g, " ");
}
