import { describe, expect, it } from "vitest";

import { formatError } from "../src/core/errors.ts";

// Shape of the real block seen on 2026-09-23: an issue quoting
// `require('fs').writeFileSync` in a shell snippet tripped Cloudflare's managed
// rules in front of the model API, and the SDK surfaced the whole page.
const cloudflare403 = `403 <!DOCTYPE html>
<html class="no-js" lang="en-US">
<head>
<title>Attention Required! | Cloudflare</title>
<meta charset="UTF-8" />
</head>
<body>
<h2 data-translate="blocked_why_headline">Why have I been blocked?</h2>
<p>This website is using a security service to protect itself from online attacks.</p>
<span class="cf-footer-item sm:block sm:mb-1">Cloudflare Ray ID: <strong class="font-semibold">a3f809ea7f189a5a</strong></span>
${"<div>padding</div>\n".repeat(60)}
</body>
</html>`;

describe("formatError", () => {
  it("collapses an HTML error page to one line", () => {
    const line = formatError(new Error(cloudflare403));
    expect(line).not.toContain("<");
    expect(line.split("\n")).toHaveLength(1);
  });

  it("keeps the parts that identify who rejected the request", () => {
    const line = formatError(new Error(cloudflare403));
    expect(line).toContain("403");
    expect(line).toContain("Attention Required! | Cloudflare");
    expect(line).toContain("a3f809ea7f189a5a");
  });

  it("leaves an ordinary error message alone", () => {
    expect(formatError(new Error("`typesafe-api-key` is required"))).toBe(
      "`typesafe-api-key` is required",
    );
  });

  it("truncates a long non-HTML message", () => {
    // Words, not one long run: a single 900-character token is a credential
    // shape and is redacted before truncation ever applies.
    const line = formatError(new Error("failed to reach the model. ".repeat(60)));
    expect(line).toHaveLength(401);
    expect(line.endsWith("…")).toBe(true);
  });

  it("handles a thrown non-Error", () => {
    expect(formatError("plain string")).toBe("plain string");
  });

  it("still reports an HTML page with no title or ray id", () => {
    const line = formatError(new Error("502 <html><body>bad gateway</body></html>"));
    expect(line).toContain("502");
    expect(line).toContain("HTML error page");
  });
});

describe("formatError redaction", () => {
  // typesafe-ai/typesafe-sdk-js#14: a key with a trailing newline is rejected
  // by Headers.append, and the SDK wraps that with the key in the message.
  const key = `api_${"k".repeat(103)}`;

  it("redacts a key echoed by the SDK", () => {
    const line = formatError(
      new Error(`Headers.append: "Bearer ${key}" is an invalid header value.`),
    );
    expect(line).not.toContain(key);
    expect(line).toContain("[redacted]");
  });

  it("redacts a bare long token anywhere in the message", () => {
    expect(formatError(new Error(`connect failed for ${key}`))).not.toContain(key);
  });

  it("leaves ordinary messages readable", () => {
    expect(formatError(new Error("`typesafe-api-key` is required"))).toBe(
      "`typesafe-api-key` is required",
    );
  });
});
