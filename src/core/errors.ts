// A failing upstream can answer with a whole HTML page rather than an API
// error: a WAF block, a proxy 5xx, a captcha interstitial. The SDK puts that
// page in `error.message`, so printing it verbatim buries the real log under
// markup. Collapse it to the line a reader actually needs.

const MAX_LENGTH = 400;

// The SDK puts the whole API key in the message when the key is not a valid
// header value — a trailing newline is enough, and `gh secret set` from a file
// produces one (typesafe-ai/typesafe-sdk-js#14). Actions masks secrets it
// registered, but the CLI has no masking at all, so redact before printing
// rather than relying on the runner.
const BEARER_RE = /\bBearer\s+\S+/gi;
const LONG_TOKEN_RE = /\b[A-Za-z0-9_-]{32,}\b/g;

function redact(message: string): string {
  return message.replace(BEARER_RE, "Bearer [redacted]").replace(LONG_TOKEN_RE, "[redacted]");
}

const HTML_RE = /<(?:!doctype|html)\b/i;
const STATUS_RE = /^\s*(\d{3})\b/;
const TITLE_RE = /<title[^>]*>([^<]*)<\/title>/i;
const RAY_RE = /Ray ID:\s*<strong[^>]*>([0-9a-f]+)</i;

function truncate(message: string): string {
  const safe = redact(message);
  return safe.length > MAX_LENGTH ? `${safe.slice(0, MAX_LENGTH)}…` : safe;
}

/**
 * One line for any error, with HTML error pages summarized rather than dumped.
 * The status, the page title and Cloudflare's Ray ID are the parts worth
 * keeping: together they say who rejected the request and identify it in their
 * logs. A blocked request never reached the model, so the issue stays
 * `needs-triage` for a human — the point of the line is to make that visible.
 */
export function formatError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (!HTML_RE.test(raw)) return truncate(raw);

  const status = STATUS_RE.exec(raw)?.[1];
  const title = TITLE_RE.exec(raw)?.[1]?.trim();
  const ray = RAY_RE.exec(raw)?.[1];

  const parts: string[] = [];
  if (status) parts.push(status);
  parts.push(title ? JSON.stringify(title) : "HTML error page");
  if (ray) parts.push(`Ray ID ${ray}`);
  parts.push(`${raw.length} bytes of HTML, not an API response`);
  return parts.join(" · ");
}
