import { appendFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { inflateSync } from "node:zlib";
//#region node_modules/.pnpm/@typesafe-ai+sdk@0.6.0/node_modules/@typesafe-ai/sdk/dist/index.mjs
const requestIdFrom = (headers) => headers.get("x-typesafe-request-id") ?? void 0;
/**
* A promise for the parsed result with access to the HTTP response.
*
* Non-2xx responses reject with an `APIError`, including through `asResponse()`.
*/
var APIPromise = class APIPromise extends Promise {
	#responsePromise;
	#parseResponse;
	#parsed;
	constructor(responsePromise, parseResponse) {
		super((resolve) => resolve(void 0));
		this.#responsePromise = responsePromise;
		this.#parseResponse = parseResponse;
	}
	/**
	* Resolves to the raw `Response` without parsing the body. SDK requests buffer the full
	* body under the request timeout before handoff; reading it afterwards is caller-owned.
	* The caller owns the body; don't also `await` the parsed result on the same promise.
	*/
	asResponse() {
		return this.#responsePromise;
	}
	/** Return the parsed result, HTTP response, and request ID. */
	async withResponse() {
		const [data, response] = await Promise.all([this.#parse(), this.#responsePromise]);
		return {
			data,
			response,
			requestId: requestIdFrom(response.headers)
		};
	}
	/** Transform the parsed result, sharing the HTTP response and a single body parse. */
	map(fn) {
		return new APIPromise(this.#responsePromise, () => this.#parse().then(fn));
	}
	#parse() {
		this.#parsed ??= this.#responsePromise.then(this.#parseResponse);
		return this.#parsed;
	}
	then(onfulfilled, onrejected) {
		return this.#parse().then(onfulfilled, onrejected);
	}
	catch(onrejected) {
		return this.#parse().catch(onrejected);
	}
	finally(onfinally) {
		return this.#parse().finally(onfinally);
	}
};
/** Environment variable names for client configuration. Explicit options take precedence. */
const ENV = {
	/** Required API key; used when `apiKey` is omitted. */
	apiKey: "TYPESAFE_API_KEY",
	/** API root; defaults to `https://api.typesafe.ai`. */
	baseURL: "TYPESAFE_BASE_URL",
	/** Default model name; defaults to `jev-latest`. */
	defaultModel: "TYPESAFE_DEFAULT_MODEL",
	/** Log level; defaults to `warn`. */
	logLevel: "TYPESAFE_LOG_LEVEL"
};
/** Read a trimmed environment value, returning `undefined` for missing or blank values. */
const readEnv = (name) => {
	if (typeof process === "undefined" || !process.env) return void 0;
	return process.env[name]?.trim() || void 0;
};
/** Return the explicit value, falling back to the environment. */
const fromCodeOrEnv = (fromCode, envVar) => fromCode ?? readEnv(envVar);
const range = (from, to) => Array.from({ length: to - from }, (_, i) => from + i);
/** Default SDK retry policy. */
const DEFAULT_RETRY_POLICY = {
	maxRetries: 2,
	backoffInitialMs: 500,
	backoffMaxMs: 5e3,
	backoffJitter: .25,
	/** HTTP 408, 429, and 5xx responses. */
	httpStatuses: /* @__PURE__ */ new Set([
		408,
		429,
		...range(500, 600)
	]),
	respectRetryAfter: true,
	/** Maximum server retry delay before falling back to backoff. */
	maxRetryAfterMs: 6e4,
	apiConnectionError: true,
	apiTimeoutError: true
};
DEFAULT_RETRY_POLICY.maxRetries;
/** Whether the policy retries an HTTP status code. */
const isRetryableStatus = (status, policy = DEFAULT_RETRY_POLICY) => policy.httpStatuses.has(status);
/**
* Parse `retry-after-ms` or `Retry-After` into milliseconds, preferring `retry-after-ms`.
*
* Return `undefined` when neither header contains a valid delay.
*/
const parseRetryAfter = (headers, now = Date.now()) => {
	const ms = Number(headers.get("retry-after-ms"));
	if (headers.has("retry-after-ms") && Number.isFinite(ms) && ms >= 0) return ms;
	const raw = headers.get("retry-after");
	if (raw === null) return void 0;
	const seconds = Number(raw);
	if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1e3 : void 0;
	const date = Date.parse(raw);
	if (!Number.isNaN(date)) return Math.max(0, date - now);
};
/**
* Calculate the delay in milliseconds for a zero-based retry attempt.
*
* Use an allowed server delay; otherwise use capped exponential backoff with jitter.
*/
const retryDelayMs = (attempt, headers, policy = DEFAULT_RETRY_POLICY, random = Math.random) => {
	if (policy.respectRetryAfter && headers !== void 0) {
		const retryAfter = parseRetryAfter(headers);
		if (retryAfter !== void 0 && retryAfter <= policy.maxRetryAfterMs) return retryAfter;
	}
	const exponential = Math.min(policy.backoffInitialMs * 2 ** attempt, policy.backoffMaxMs);
	return Math.round(exponential * (1 - random() * policy.backoffJitter));
};
/** Wait `ms` milliseconds, rejecting with `signal.reason` on cancellation. */
const sleep = (ms, signal) => new Promise((resolve, reject) => {
	if (signal?.aborted) return reject(signal.reason);
	const onAbort = () => {
		clearTimeout(timer);
		reject(signal?.reason);
	};
	const timer = setTimeout(() => {
		signal?.removeEventListener("abort", onAbort);
		resolve();
	}, ms);
	signal?.addEventListener("abort", onAbort, { once: true });
});
/** Base class for SDK errors. */
var TypeSafeError = class extends Error {
	constructor(message, options) {
		super(message, options);
		this.name = new.target.name;
	}
};
const isRecord = (value) => typeof value === "object" && value !== null;
/** Extract a message from a text, error, or validation response body. */
const extractMessage = (body) => {
	if (typeof body === "string") return body || void 0;
	if (!isRecord(body)) return void 0;
	const { error, message, detail } = body;
	if (typeof error === "string") return error;
	if (isRecord(error) && typeof error.message === "string") return error.message;
	if (typeof message === "string") return message;
	if (typeof detail === "string") return detail;
	if (isRecord(detail) && typeof detail.message === "string") return detail.message;
	if (Array.isArray(detail)) return describeValidationErrors(detail);
};
/** Format validation errors as semicolon-separated `path: message` entries. */
const describeValidationErrors = (errors) => {
	const parts = errors.flatMap((e) => {
		if (!isRecord(e) || typeof e.msg !== "string") return [];
		const loc = Array.isArray(e.loc) ? e.loc.filter((x) => x !== "body").join(".") : "";
		return [loc ? `${loc}: ${e.msg}` : e.msg];
	});
	return parts.length > 0 ? parts.join("; ") : void 0;
};
const MAX_RAW_BODY_IN_MESSAGE = 200;
/** An unsuccessful HTTP response from the API. */
var APIError = class APIError extends TypeSafeError {
	/** HTTP response status code. */
	status;
	/** HTTP response headers. */
	headers;
	/** Parsed JSON, response text, or `undefined` for an empty body. */
	body;
	/** Request ID from `x-typesafe-request-id`, or `undefined` when absent. */
	requestId;
	constructor(status, body, headers, message) {
		super(message ?? APIError.describe(status, body));
		this.status = status;
		this.body = body;
		this.headers = headers;
		this.requestId = requestIdFrom(headers);
	}
	static describe(status, body) {
		const detail = extractMessage(body);
		if (detail) return `${status} ${detail}`;
		if (body === void 0) return `${status} status code (no body)`;
		const raw = typeof body === "string" ? body : JSON.stringify(body);
		return `${status} ${raw.length > MAX_RAW_BODY_IN_MESSAGE ? `${raw.slice(0, MAX_RAW_BODY_IN_MESSAGE)}…` : raw}`;
	}
	/** Create the error subclass for an HTTP status code. */
	static fromResponse(status, body, headers) {
		if (status === 400) return new BadRequestError(status, body, headers);
		if (status === 401) return new AuthenticationError(status, body, headers);
		if (status === 403) return new PermissionDeniedError(status, body, headers);
		if (status === 404) return new NotFoundError(status, body, headers);
		if (status === 422) return new UnprocessableEntityError(status, body, headers);
		if (status === 429) return new RateLimitError(status, body, headers);
		if (status >= 500) return new InternalServerError(status, body, headers);
		return new APIError(status, body, headers);
	}
};
/** HTTP 400: the request is invalid. */
var BadRequestError = class extends APIError {};
/** HTTP 401: authentication failed. */
var AuthenticationError = class extends APIError {};
/** HTTP 403: access is denied. */
var PermissionDeniedError = class extends APIError {};
/** HTTP 404: the resource was not found. */
var NotFoundError = class extends APIError {};
/** HTTP 422: request validation failed. */
var UnprocessableEntityError = class extends APIError {};
/** HTTP 429: the rate limit was exceeded. */
var RateLimitError = class extends APIError {
	/** Server retry delay in milliseconds, or `undefined` when absent or invalid. */
	retryAfterMs = parseRetryAfter(this.headers);
};
/** HTTP 5xx: the server failed to handle the request. */
var InternalServerError = class extends APIError {};
/** The request or response-body delivery failed (DNS, TLS, connection closed, etc.). */
var APIConnectionError = class extends TypeSafeError {
	constructor(message = "Connection error.", options) {
		super(message, options);
	}
};
/** The full response did not arrive within the timeout. A kind of `APIConnectionError`. */
var APITimeoutError = class extends APIConnectionError {
	/** Configured timeout in milliseconds. */
	timeoutMs;
	constructor(timeoutMs, options) {
		super(`Request timed out after ${timeoutMs}ms.`, options);
		this.timeoutMs = timeoutMs;
	}
};
/** The caller cancelled the request through an `AbortSignal`. */
var APIUserAbortError = class extends TypeSafeError {
	constructor(message = "Request was aborted.", options) {
		super(message, options);
	}
};
/** Supported log levels, from most to least verbose. */
const LOG_LEVELS = [
	"debug",
	"info",
	"warn",
	"error",
	"off"
];
const DEFAULT_LOG_LEVEL = "warn";
const isLogLevel = (value) => LOG_LEVELS.includes(value);
/** Validate a configured log level, throwing `TypeSafeError` for unknown values. */
const parseLogLevel = (value, source) => {
	if (isLogLevel(value)) return value;
	throw new TypeSafeError(`Invalid log level "${value}" from ${source}. Expected one of: ${LOG_LEVELS.join(", ")}.`);
};
const PREFIX = "[typesafe-sdk]";
/** Default console logger with the `[typesafe-sdk]` prefix. */
const consoleLogger = {
	debug: (message, ...args) => console.debug(`${PREFIX} ${message}`, ...args),
	info: (message, ...args) => console.info(`${PREFIX} ${message}`, ...args),
	warn: (message, ...args) => console.warn(`${PREFIX} ${message}`, ...args),
	error: (message, ...args) => console.error(`${PREFIX} ${message}`, ...args)
};
const RANK = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
	off: 4
};
const drop = () => {};
/** Filter logger calls to the configured level and above. */
const withLevel = (sink, level) => {
	const enabled = (at) => RANK[at] >= RANK[level];
	return {
		debug: enabled("debug") ? (message, ...args) => sink.debug(message, ...args) : drop,
		info: enabled("info") ? (message, ...args) => sink.info(message, ...args) : drop,
		warn: enabled("warn") ? (message, ...args) => sink.warn(message, ...args) : drop,
		error: enabled("error") ? (message, ...args) => sink.error(message, ...args) : drop
	};
};
/** Credential headers that retain a key suffix for identification. */
const KEY_HEADERS = /* @__PURE__ */ new Set([
	"authorization",
	"proxy-authorization",
	"x-api-key"
]);
/** Headers whose values are redacted in full. */
const OPAQUE_HEADERS = /* @__PURE__ */ new Set(["cookie", "set-cookie"]);
/** Mask a key, preserving its scheme and the last four characters of secrets longer than eight. */
const redactKey = (value) => {
	const [scheme, secret] = value.includes(" ") ? value.split(/\s+/, 2) : [void 0, value];
	const tail = secret && secret.length > 8 ? secret.slice(-4) : "";
	return `${scheme ? `${scheme} ` : ""}***${tail}`;
};
const redact = (name, value) => {
	const lower = name.toLowerCase();
	if (KEY_HEADERS.has(lower)) return redactKey(value);
	if (OPAQUE_HEADERS.has(lower)) return "***";
	return value;
};
/** Copy headers with known credential values redacted. */
const redactHeaders = (headers) => Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, redact(name, value)]));
/**
* Create a yes/no question with optional descriptions for either outcome.
*
* @param instructions - The question as text, a JSON object or array; defaults to `null`.
* @param criteria - Optional descriptions of the yes and no outcomes.
*/
const noul = (instructions = null, criteria) => ({
	type: "noul",
	instructions,
	criteria
});
/**
* Create a score question using an ordered rubric.
*
* @param instructions - The question as text, a JSON object or array, or `null`.
* @param criteria - At least two descriptions indexed by score from zero; entries may be `null`.
*/
const score = (instructions, criteria) => {
	if (!Array.isArray(criteria)) throw new TypeSafeError("Score criteria must be a list of descriptions indexed by score from zero, not a map.");
	return {
		type: "score",
		instructions,
		criteria
	};
};
/**
* Create a question that selects between named alternatives.
*
* @param instructions - The question as text, a JSON object or array, or `null`.
* @param criteria - Labels mapped to descriptions, or `null` for undescribed labels.
*/
const choice = (instructions, criteria) => {
	if (Array.isArray(criteria)) throw new TypeSafeError("Choice criteria must be a map of labels to descriptions, not a list.");
	return {
		type: "choice",
		instructions,
		criteria
	};
};
/** Reject empty question sets and score questions without a list of at least two criteria. */
const validateQuestions = (questions) => {
	if (Object.keys(questions).length === 0) throw new TypeSafeError("At least one question is required.");
	for (const [name, question] of Object.entries(questions)) {
		if (question.type !== "score") continue;
		if (!Array.isArray(question.criteria)) throw new TypeSafeError(`Score question "${name}" has criteria that are not a list; score criteria must be a list of descriptions indexed by score from zero.`);
		if (question.criteria.length < 2) throw new TypeSafeError(`Score question "${name}" has ${question.criteria.length} criteria; at least two scores are required.`);
	}
};
/** Access to the Models API resource. */
var Models = class {
	#transport;
	constructor(transport) {
		this.#transport = transport;
	}
	/** List the models available to the account. */
	list(options = {}) {
		return this.#transport.request("GET", "/v1/models", options).map(unwrapModels);
	}
};
const unwrapModels = (wire) => {
	if (Array.isArray(wire?.models)) return wire.models;
	throw new TypeSafeError("Unexpected response shape from GET /v1/models; expected { models: [...] }.");
};
const g = globalThis;
/** Whether browser page globals are present. */
const isBrowser = () => typeof g.window !== "undefined" && typeof g.window.document !== "undefined" && typeof g.navigator !== "undefined";
/** Runtime name, version, and platform for the `X-TypeSafe-Runtime` header. */
const describeRuntime = () => {
	const platform = g.process?.platform && g.process?.arch ? ` (${g.process.platform}; ${g.process.arch})` : "";
	if (g.Bun?.version) return `bun/${g.Bun.version}${platform}`;
	if (g.Deno?.version?.deno) return `deno/${g.Deno.version.deno}${platform}`;
	if (g.EdgeRuntime !== void 0) return "vercel-edge";
	if (g.navigator?.userAgent === "Cloudflare-Workers") return "cloudflare-workers";
	if (g.process?.versions?.node) return `node/${g.process.versions.node}${platform}`;
	if (isBrowser()) return "browser";
	return "unknown";
};
const VERSION = "0.6.0";
const missingApiKey = () => {
	throw new TypeSafeError(`No API key was provided. Pass \`apiKey\` to the TypeSafeClient constructor or set the ${ENV.apiKey} environment variable.`);
};
const missingFetch = () => {
	throw new TypeSafeError("No global `fetch` is available in this runtime. Pass a `fetch` implementation to the TypeSafeClient constructor.");
};
const refuseBrowser = () => {
	throw new TypeSafeError("TypeSafeClient is running in a browser, which would expose your API key to anyone using the page. Call the API from a server instead, or pass `dangerouslyAllowBrowser: true` if you understand the risk.");
};
/** Call global `fetch` with its required receiver in browsers. */
const defaultFetch = (input, init) => globalThis.fetch(input, init);
const assertNonNegativeInteger = (name, value) => {
	if (!Number.isInteger(value) || value < 0) throw new TypeSafeError(`\`${name}\` must be a non-negative integer, got ${String(value)}.`);
	return value;
};
const assertPositiveMs = (name, value) => {
	if (!Number.isFinite(value) || value <= 0) throw new TypeSafeError(`\`${name}\` must be a positive number of milliseconds, got ${String(value)}.`);
	return value;
};
const assertNonNegativeMs = (name, value) => {
	if (!Number.isFinite(value) || value < 0) throw new TypeSafeError(`\`${name}\` must be a non-negative number of milliseconds, got ${String(value)}.`);
	return value;
};
const assertFraction = (name, value) => {
	if (!Number.isFinite(value) || value < 0 || value > 1) throw new TypeSafeError(`\`${name}\` must be between 0 and 1, got ${String(value)}.`);
	return value;
};
const assertStatusSet = (name, statuses) => {
	for (const status of statuses) if (!Number.isInteger(status) || status < 100 || status > 999) throw new TypeSafeError(`\`${name}\` must contain HTTP status codes, got ${String(status)}.`);
	return statuses;
};
/** Merge and validate retry overrides, copying the status set to isolate later mutations. */
const resolveRetryPolicy = (base, overrides) => {
	const o = overrides ?? {};
	return {
		maxRetries: o.maxRetries === void 0 ? base.maxRetries : assertNonNegativeInteger("retry.maxRetries", o.maxRetries),
		backoffInitialMs: o.backoffInitialMs === void 0 ? base.backoffInitialMs : assertNonNegativeMs("retry.backoffInitialMs", o.backoffInitialMs),
		backoffMaxMs: o.backoffMaxMs === void 0 ? base.backoffMaxMs : assertNonNegativeMs("retry.backoffMaxMs", o.backoffMaxMs),
		backoffJitter: o.backoffJitter === void 0 ? base.backoffJitter : assertFraction("retry.backoffJitter", o.backoffJitter),
		httpStatuses: new Set(o.httpStatuses === void 0 ? base.httpStatuses : assertStatusSet("retry.httpStatuses", o.httpStatuses)),
		respectRetryAfter: o.respectRetryAfter ?? base.respectRetryAfter,
		maxRetryAfterMs: o.maxRetryAfterMs === void 0 ? base.maxRetryAfterMs : assertNonNegativeMs("retry.maxRetryAfterMs", o.maxRetryAfterMs),
		apiConnectionError: o.apiConnectionError ?? base.apiConnectionError,
		apiTimeoutError: o.apiTimeoutError ?? base.apiTimeoutError
	};
};
/** Whether the policy retries a connection error or timeout. */
const isRetryableError = (err, policy) => {
	if (err instanceof APITimeoutError) return policy.apiTimeoutError;
	if (err instanceof APIConnectionError) return policy.apiConnectionError;
	return false;
};
/** Resolve and validate the log level from configuration or the environment. */
const resolveLogLevel = (fromCode) => {
	if (fromCode !== void 0) return parseLogLevel(fromCode, "the `logLevel` option");
	const fromEnv = readEnv(ENV.logLevel);
	if (fromEnv !== void 0) return parseLogLevel(fromEnv, ENV.logLevel);
	return DEFAULT_LOG_LEVEL;
};
const stripTrailingSlashes = (url) => url.replace(/\/+$/, "");
/** Last value wins regardless of casing; undefined removes a protected header. */
const mergeHeaders = (...sources) => {
	const entries = /* @__PURE__ */ new Map();
	for (const source of sources) for (const [name, value] of Object.entries(source)) if (value === void 0) entries.delete(name.toLowerCase());
	else entries.set(name.toLowerCase(), [name, value]);
	return Object.fromEntries(entries.values());
};
/** Drain a clone so the original response retains its metadata and a readable, buffered body. */
const bufferResponse = async (response, signal) => {
	const reader = response.clone().body?.getReader();
	if (!reader) return;
	const cancel = () => {
		reader.cancel(signal.reason).catch(() => {});
		response.body?.cancel(signal.reason).catch(() => {});
	};
	signal.addEventListener("abort", cancel, { once: true });
	try {
		if (signal.aborted) cancel();
		signal.throwIfAborted();
		while (!(await reader.read()).done) signal.throwIfAborted();
		signal.throwIfAborted();
	} finally {
		signal.removeEventListener("abort", cancel);
		reader.releaseLock();
	}
};
/** Runtime description cached for the process lifetime. */
const RUNTIME = describeRuntime();
/** Client for the TypeSafe AI API. */
var TypeSafeClient = class {
	/** API key excluded from serialization and public properties. */
	#apiKey;
	/** API root with trailing slashes removed. */
	baseURL;
	/** Model used when a request omits `model`. */
	defaultModel;
	/** Configured log verbosity. */
	logLevel;
	/** The configured logger, filtered to `logLevel`. */
	logger;
	/** Retry settings with constructor overrides applied. */
	retry;
	/** Timeout per attempt in milliseconds. */
	timeout;
	/** Additional headers sent with each request. */
	defaultHeaders;
	/** HTTP fetch implementation. */
	fetch;
	/** The models available to the account. */
	models;
	#requestCount = 0;
	/**
	* Create a client for the TypeSafe AI API.
	*
	* Explicit options take precedence over environment variables, then SDK defaults.
	* Empty or whitespace-only environment values are ignored.
	*
	* @throws {TypeSafeError} The API key is missing, configuration is invalid, or the runtime is unsupported.
	*/
	constructor(config = {}) {
		if (isBrowser() && !config.dangerouslyAllowBrowser) refuseBrowser();
		this.#apiKey = fromCodeOrEnv(config.apiKey, ENV.apiKey) ?? missingApiKey();
		this.baseURL = stripTrailingSlashes(fromCodeOrEnv(config.baseURL, ENV.baseURL) ?? "https://api.typesafe.ai");
		this.defaultModel = fromCodeOrEnv(config.defaultModel, ENV.defaultModel) ?? "jev-latest";
		this.logLevel = resolveLogLevel(config.logLevel);
		this.logger = withLevel(config.logger ?? consoleLogger, this.logLevel);
		this.retry = resolveRetryPolicy(DEFAULT_RETRY_POLICY, config.retry);
		this.timeout = assertPositiveMs("timeout", config.timeout ?? 1e4);
		this.defaultHeaders = { ...config.defaultHeaders };
		if (config.fetch === void 0 && typeof globalThis.fetch !== "function") missingFetch();
		this.fetch = config.fetch ?? defaultFetch;
		const transport = {
			request: (method, path, options) => this.#request(method, path, options),
			defaultModel: this.defaultModel
		};
		this.models = new Models(transport);
	}
	/**
	* Answer named questions about text or structured state.
	*
	* @param request - State, questions, and an optional model override.
	* @param options - Per-call timeout, retry, headers, and cancellation settings.
	* @returns Answers typed by question name and criteria, with model and token usage.
	* @throws {TypeSafeError} Questions are empty, or score criteria are not a list of at least two entries.
	* @throws {APIError} The server returns a non-2xx response after retries.
	* @throws {APIConnectionError} The request cannot connect or times out after retries.
	* @throws {APIUserAbortError} The caller aborts the request.
	*
	* @example
	* ```ts
	* const { answers } = await client.systemOne({
	*   state: "I was charged twice. Please help.",
	*   questions: { billing: noul("Is this about billing?") },
	* });
	* console.log(answers.billing.noul);
	* ```
	*/
	systemOne(request, options = {}) {
		validateQuestions(request.questions);
		const body = {
			...request,
			model: request.model ?? this.defaultModel
		};
		return this.#request("POST", "/v1/systemone", {
			...options,
			body
		});
	}
	/** Send a request and parse its response body. */
	#request(method, path, options = {}) {
		const resolved = {
			method,
			path,
			body: options.body,
			headers: mergeHeaders(this.defaultHeaders, options.headers ?? {}),
			signal: options.signal,
			timeout: options.timeout === void 0 ? this.timeout : assertPositiveMs("timeout", options.timeout),
			retry: resolveRetryPolicy(this.retry, options.retry)
		};
		const tag = `#${++this.#requestCount} ${method} ${path}`;
		return new APIPromise(this.fetchWithRetries(tag, resolved), async (res) => {
			const parsed = await parseBody(res);
			this.logger.debug(`${tag} <- body`, parsed);
			return parsed;
		});
	}
	/** Retry eligible failures, logging attempt summaries at `info` and headers and bodies at `debug`. */
	async fetchWithRetries(tag, req) {
		const url = `${this.baseURL}${req.path}`;
		const headers = mergeHeaders(req.headers, {
			Authorization: `Bearer ${this.#apiKey}`,
			Accept: "application/json",
			"User-Agent": `typesafe-sdk/${VERSION}`,
			"X-TypeSafe-SDK": `typesafe-sdk/${VERSION}`,
			"X-TypeSafe-Runtime": RUNTIME,
			"Content-Type": req.body === void 0 ? void 0 : "application/json",
			"X-TypeSafe-Retry-Count": void 0
		});
		const body = req.body === void 0 ? void 0 : JSON.stringify(req.body);
		for (let attempt = 0;; attempt++) {
			const retriesLeft = req.retry.maxRetries - attempt;
			const attemptHeaders = attempt === 0 ? headers : {
				...headers,
				"X-TypeSafe-Retry-Count": String(attempt)
			};
			this.logger.debug(`${tag} -> ${url}`, {
				headers: redactHeaders(attemptHeaders),
				body: req.body
			});
			const started = Date.now();
			let res;
			try {
				res = await this.attempt(tag, url, {
					method: req.method,
					headers: attemptHeaders,
					body
				}, req);
			} catch (err) {
				if (err instanceof APIUserAbortError || retriesLeft <= 0) throw err;
				if (!isRetryableError(err, req.retry)) throw err;
				await this.backOff(tag, attempt, retriesLeft, err.message, void 0, req);
				continue;
			}
			const requestId = requestIdFrom(res.headers);
			this.logger.info(`${tag} <- ${res.status} in ${Date.now() - started}ms${requestId ? ` (request ${requestId})` : ""}`);
			if (res.ok) return res;
			const errorBody = await parseBody(res);
			this.logger.debug(`${tag} <- error body`, errorBody);
			const error = APIError.fromResponse(res.status, errorBody, res.headers);
			if (retriesLeft <= 0 || !isRetryableStatus(res.status, req.retry)) throw error;
			await this.backOff(tag, attempt, retriesLeft, `${res.status}`, res.headers, req);
		}
	}
	/**
	* One HTTP round trip, including body delivery, with a timeout. The caller's signal and our
	* timer both abort the same controller; we check which fired to choose the error class.
	*/
	async attempt(tag, url, init, { signal, timeout }) {
		const controller = new AbortController();
		const abortFromCaller = () => controller.abort(signal?.reason);
		if (signal?.aborted) abortFromCaller();
		signal?.addEventListener("abort", abortFromCaller, { once: true });
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, timeout);
		const started = Date.now();
		const elapsed = () => `${Date.now() - started}ms`;
		try {
			const response = await this.fetch(url, {
				...init,
				signal: controller.signal
			});
			await bufferResponse(response, controller.signal);
			return response;
		} catch (err) {
			if (signal?.aborted) {
				this.logger.info(`${tag} aborted by caller after ${elapsed()}`);
				throw new APIUserAbortError(void 0, { cause: err });
			}
			if (timedOut) {
				this.logger.info(`${tag} timed out after ${elapsed()}`);
				throw new APITimeoutError(timeout, { cause: err });
			}
			this.logger.info(`${tag} connection error after ${elapsed()}`, err);
			throw new APIConnectionError(err instanceof Error ? `Connection error: ${err.message}` : void 0, { cause: err });
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener("abort", abortFromCaller);
		}
	}
	/** Wait before retrying; caller cancellation throws `APIUserAbortError`. */
	async backOff(tag, attempt, retriesLeft, reason, headers, { retry, signal }) {
		const delay = retryDelayMs(attempt, headers, retry);
		const nth = attempt + 1;
		const total = attempt + retriesLeft;
		this.logger.info(`${tag} retrying in ${delay}ms (retry ${nth}/${total}) after ${reason}`);
		try {
			await sleep(delay, signal);
		} catch (err) {
			this.logger.info(`${tag} aborted by caller while waiting to retry`);
			throw new APIUserAbortError(void 0, { cause: err });
		}
	}
};
const parseBody = async (res) => {
	const text = await res.text();
	if (text.length === 0) return void 0;
	if ((res.headers.get("content-type") ?? "").includes("application/json")) try {
		return JSON.parse(text);
	} catch {
		return text;
	}
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
};
//#endregion
//#region src/questions/bug.ts
const bugQuestions = {
	broken: noul({
		question: "Does the report describe a build or dev server that cannot be used: the process crashes or panics, the build exits with an error, it never finishes, or the emitted output throws, hangs, fails to load, or differs between identical builds?",
		focus: "Judge only the observed outcome described in `issue.sections` (usually `actual`, `panic_message` and `reproduction`)."
	}, {
		true: {
			what: "The build does not complete, or the produced bundle does not run correctly: a runtime error, a hang, a blank page, wrong execution order, a missing export at runtime, or output that changes between identical builds.",
			examples: [
				"vite build exits with UNRESOLVED_ENTRY",
				"Rolldown panicked",
				"the app never mounts and the console shows init_x is not a function",
				"the same input produces different chunk names on every build"
			]
		},
		false: {
			what: "The build completes and the output runs; what is wrong is secondary: bundle size, speed, sourcemaps, warnings, type declarations, formatting, or a missed optimization.",
			not_for: "The reporter calling it critical, urgent, blocking or P0 does not make the answer yes.",
			examples: [
				"minify sourcemap has an empty names array",
				"no tree-shaking after a guaranteed throw",
				"RenderedChunk is not assignable to PreRenderedChunk"
			]
		}
	}),
	mainstream: noul({
		question: "Would this happen in a typical project using default options, a common framework, and ordinary code, rather than needing a specific option, plugin, platform, environment, or unusual code pattern?",
		focus: "Look at what the reporter had to configure or write to hit it: options and code in `issue.sections.reproduction`, the environment in `issue.sections.system_info`."
	}, {
		true: {
			what: "Default or very common configuration, a mainstream OS and Node version, and ordinary import/export code. Anyone running a normal build could hit it.",
			examples: [
				"every build on the WASI binding",
				"any project with code splitting enabled",
				"plain ESM imports of a popular package"
			]
		},
		false: {
			what: "Needs a particular option (advancedChunks groups, strictExecutionOrder, preserveModules), a specific plugin, a rare platform or container setup, a Windows-only path form, or an unusual code pattern (direct eval, webpack-style module registries, top-level-await cycles).",
			not_for: "A small reproduction is still ordinary code; do not answer no because the example is minimal."
		}
	}),
	via_vite: noul({
		question: "Is the reporter running Rolldown through Vite (vite build, vite dev, vite.config, a Vite plugin, Vitest, rolldown-vite, or a Vite-based framework) rather than the rolldown CLI, the rolldown API, or tsdown?",
		focus: "Commands, config file names and package names anywhere in `issue.sections`."
	}, {
		true: { what: "Mentions vite build, vite dev, vite.config, a Vite plugin, Vitest, Nuxt, SvelteKit, Astro, or another Vite-based framework as the way Rolldown is invoked." },
		false: {
			what: "Uses rolldown.config, the rolldown CLI or JS API, tsdown, or does not say.",
			not_for: "Comparing output against Rollup or esbuild is not using Vite."
		}
	}),
	workaround: noul({
		question: "Does the reporter state a way to avoid the problem, such as changing an option, restructuring code, pinning a version, or using a different setting?",
		focus: "Only what is written in `issue.sections`. Do not invent workarounds."
	}, {
		true: {
			what: "A concrete workaround is described, even if the reporter finds it inconvenient.",
			examples: [
				"setting output.codeSplitting: false avoids it",
				"works if I disable the plugin",
				"downgrading to 1.2.0 fixes it"
			]
		},
		false: {
			what: "No way around it is given, or the reporter says they tried things and nothing helped.",
			not_for: "A different bundler working is not a workaround for Rolldown."
		}
	}),
	regression: noul({
		question: "Does the reporter say this worked in an earlier version of Rolldown or Vite and stopped working in a newer one?",
		focus: "Explicit version comparisons anywhere in `issue.sections`."
	}, {
		true: {
			what: "Names or clearly implies a version that worked and a version that fails.",
			examples: ["1.2.8 was fine, 1.2.9 errors", "regression since the last release"]
		},
		false: {
			what: "No earlier working version is mentioned, or the reporter says it never worked, or only compares against Rollup.",
			not_for: "Rollup or esbuild behaving differently is not a regression."
		}
	}),
	argues_priority: noul({
		question: "Does the reporter argue for how the issue should be prioritized or labeled, rather than only describing what happens?",
		focus: "Statements about urgency, importance, blocking status, or which label or priority the issue deserves."
	}, {
		true: {
			what: "Text such as: this is a P0, urgent, critical, blocker, must fix before release, please prioritize, affects everyone.",
			not_for: "Plainly stating consequences, like the build fails, is not arguing."
		},
		false: { what: "Describes behavior and impact without asking for a priority." }
	})
};
/** Short labels for the comment, in the order the decision tree consults them. */
const BUG_EVIDENCE_LABELS = {
	broken: "unusable",
	via_vite: "via vite",
	regression: "regression",
	mainstream: "common setup",
	workaround: "workaround",
	argues_priority: "argues priority"
};
//#endregion
//#region src/core/types.ts
const LABEL_SLOTS = [
	"p0",
	"p1",
	"p2",
	"p3",
	"needsTriage",
	"needsReproduction",
	"hasWorkaround"
];
const PRIORITY_SLOTS = [
	"p0",
	"p1",
	"p2",
	"p3"
];
function defineCheck(check) {
	if (!/^[a-z][a-z0-9-]*$/.test(check.id)) throw new Error(`invalid check id ${JSON.stringify(check.id)}`);
	return check;
}
//#endregion
//#region src/checks/has-workaround.ts
/**
* The smallest possible check: one reused question, one label. Exists to show
* what adding a check takes — this file plus one entry in `checks/index.ts`.
*/
const hasWorkaround = defineCheck({
	id: "has-workaround",
	defaultMode: "suggest",
	questions(ctx) {
		return ctx.kind === "bug" || ctx.kind === "unknown" ? { workaround: bugQuestions.workaround } : null;
	},
	decide(answers, ctx) {
		if (ctx.kind !== "bug") return {
			status: "skipped",
			reason: "not a bug"
		};
		const v = answers.noul("workaround");
		if (v === void 0) return {
			status: "abstained",
			note: "no answer for workaround"
		};
		const evidence = { workaround: Number(v.toFixed(2)) };
		return v >= ctx.config.thresholds.workaroundLabel ? {
			status: "decided",
			add: ["hasWorkaround"],
			note: "reporter describes a workaround",
			evidence
		} : {
			status: "decided",
			add: [],
			note: "no workaround described",
			evidence
		};
	}
});
//#endregion
//#region src/questions/feature.ts
const featureQuestions = {
	framework_need: noul({
		question: "Does the reporter say a specific framework, meta-framework, or Vite plugin needs this in order to run on Vite with Rolldown?",
		focus: "Whether a blocked project is named in `issue.sections` (usually `problem`)."
	}, {
		true: {
			what: "The reporter maintains or names a framework or plugin (Nuxt, SvelteKit, Astro, Angular, Remix, a vite-plugin-*) and says it cannot adopt rolldown-vite without this.",
			examples: ["vite-plugin-x needs this hook to support rolldown-vite", "SvelteKit relies on this Rollup option"]
		},
		false: {
			what: "A request from an application project, a general nice-to-have, or Rollup parity with no blocked project named.",
			not_for: "Mentioning that Vite exists is not enough; a blocked project must be named."
		}
	}),
	usefulness: score({
		question: "Who would use this feature?",
		focus: "The situation in `issue.sections.problem` and how general the API in `issue.sections.proposed_api` is."
	}, [
		"Serves one project's particular setup or an uncommon workflow; most users would never touch it.",
		"Serves a recognizable group: users of a particular framework, platform, output format, or plugin ecosystem, or people migrating from Rollup or another bundler.",
		"Would be used in most builds: defaults, the CLI or config surface most projects use, the plugin hooks most plugins use, or something users rely on today in Rollup or Vite."
	])
};
const FEATURE_EVIDENCE_LABELS = {
	framework_need: "named framework blocked",
	usefulness: "usefulness"
};
//#endregion
//#region src/questions/panic.ts
const panicQuestions = {
	panic_invalid_input: noul({
		question: "Did Rolldown crash while rejecting something the reporter supplied — a malformed pattern, an unsupported option value, a path it cannot accept — where printing a clear error instead of crashing would be the whole fix?",
		focus: "`issue.sections.panic_message` together with `reproduction` and `actual`."
	}, {
		true: {
			what: "The crash message names the offending input and says what would have been valid; the build was going to fail either way, and only the presentation is wrong.",
			examples: ["Invalid glob pattern: *.js, it must start with '/' or './'", "In virtual modules, all globs must start with '/'"]
		},
		false: {
			what: "The input was valid and Rolldown failed on its own: an internal invariant, an index out of bounds, an unreachable branch, a symbol or entry it could not resolve, a segfault.",
			not_for: "An internal assertion that happens to mention a user file is not the reporter supplying something invalid."
		}
	}),
	panic_reach: score({
		question: "How ordinary are the conditions needed to reach this crash?",
		focus: "Judge the setup described in `issue.sections`: the options, platform, host, packages and steps required before it happens. Ignore how severe the crash itself is."
	}, [
		"Needs a specific operating system feature, CI provider, package manager, hosting sandbox, or a flag the docs mark experimental or opt-in.",
		"Needs a named third-party package, an unusual character or syntax, or a precise sequence of actions such as interrupting a watch build at the right moment.",
		"Needs a documented option or a recognisable code pattern, in an otherwise ordinary build.",
		"Happens in an ordinary build with common options and ordinary code, with nothing unusual required to reach it."
	])
};
const PANIC_EVIDENCE_LABELS = {
	panic_invalid_input: "invalid input",
	panic_reach: "reach"
};
//#endregion
//#region src/checks/priority.ts
/** Reads one Noul and files it in the evidence list as it is consulted. */
function reader(answers, t, labels, evidence) {
	return (key) => {
		const v = answers.noul(key);
		if (v === void 0) return void 0;
		evidence[labels[key] ?? key] = Number(v.toFixed(2));
		if (v >= t.noulYes) return "yes";
		if (v <= t.noulNo) return "no";
		return "unsure";
	};
}
const unsure = (evidence, axis) => ({
	status: "abstained",
	note: `unsure whether the ${axis}`,
	evidence
});
const missing = (key) => ({
	status: "abstained",
	note: `no answer for ${key}`
});
function decideBug(answers, ctx) {
	const evidence = {};
	const read = reader(answers, ctx.config.thresholds, BUG_EVIDENCE_LABELS, evidence);
	const decided = (slot, note) => ({
		status: "decided",
		add: [slot],
		note,
		evidence
	});
	const broken = read("broken");
	if (broken === void 0) return missing("broken");
	if (broken === "unsure") return unsure(evidence, "build is unusable");
	let verdict;
	if (broken === "yes") {
		const viaVite = read("via_vite");
		const regression = read("regression");
		if (viaVite === void 0) return missing("via_vite");
		if (regression === void 0) return missing("regression");
		if (viaVite === "yes") verdict = decided("p1", "build unusable through Vite");
		else if (regression === "yes") verdict = decided("p1", "build unusable, a regression");
		else if (viaVite === "unsure" || regression === "unsure") return unsure(evidence, "unusable build reaches Vite users or is a regression");
		else verdict = decided("p2", "build unusable in a specific non-Vite setup");
		if (read("mainstream") === "yes") verdict = {
			...verdict,
			forceSuggest: "could be p0",
			humanNote: "could be p0 if it hits most users or blocks the rolldown-vite upgrade"
		};
	} else {
		const workaround = read("workaround");
		if (workaround === void 0) return missing("workaround");
		if (workaround === "unsure") return unsure(evidence, "reporter has a workaround");
		verdict = workaround === "yes" ? decided("p3", "build usable, workaround described") : decided("p2", "build usable, no workaround described");
	}
	const argues = answers.noul("argues_priority");
	if (argues !== void 0) evidence[BUG_EVIDENCE_LABELS.argues_priority] = Number(argues.toFixed(2));
	if (ctx.flags.priorityWords || (argues ?? 0) >= ctx.config.thresholds.arguesPriority) verdict = {
		...verdict,
		forceSuggest: "the report argues its own priority"
	};
	return verdict;
}
/**
* Crashes get their own branch. Every panic is `broken: yes`, so the bug tree
* can only ever reach p1 or p2 through `via_vite`/`regression` — and those read
* low for CLI, plugin and dev-engine crashes, which is how 21 of 31 decisions
* collapsed onto p2 while p3 stayed structurally unreachable. What maintainers
* actually sort on is how ordinary the conditions are that reach the crash.
*/
function decidePanic(answers, ctx) {
	const t = ctx.config.thresholds;
	const evidence = {};
	const invalid = reader(answers, t, PANIC_EVIDENCE_LABELS, evidence)("panic_invalid_input");
	if (invalid === void 0) return missing("panic_invalid_input");
	if (invalid === "yes") return {
		status: "decided",
		add: ["p3"],
		note: "crash while rejecting invalid input; an error message is the fix",
		evidence
	};
	const reach = answers.score("panic_reach");
	if (!reach) return missing("panic_reach");
	evidence[PANIC_EVIDENCE_LABELS.panic_reach] = `${reach.score.toFixed(1)}/${reach.top}`;
	if (reach.confidence < t.panicConfidence) {
		const fallback = ctx.options.panicFallback;
		if (!fallback || fallback === "off" || fallback === "p0") return {
			status: "abstained",
			note: "unsure how ordinary the crash conditions are",
			evidence
		};
		return {
			status: "decided",
			add: [fallback],
			note: `crash, too unclear to place; defaulting to ${fallback}`,
			evidence,
			humanNote: "the model could not place this crash; these skew more severe, not less"
		};
	}
	let verdict;
	if (reach.score >= t.panicReachP1) verdict = {
		status: "decided",
		add: ["p1"],
		note: "crash in an ordinary build",
		evidence
	};
	else if (reach.score >= t.panicReachP2) verdict = {
		status: "decided",
		add: ["p2"],
		note: "crash behind a particular package, syntax or sequence",
		evidence
	};
	else verdict = {
		status: "decided",
		add: ["p3"],
		note: "crash behind a specific platform, host or experimental flag",
		evidence
	};
	const argues = answers.noul("argues_priority");
	if (argues !== void 0) evidence[BUG_EVIDENCE_LABELS.argues_priority] = Number(argues.toFixed(2));
	if (ctx.flags.priorityWords || (argues ?? 0) >= t.arguesPriority) verdict = {
		...verdict,
		forceSuggest: "the report argues its own priority"
	};
	return verdict;
}
function decideFeature(answers, ctx) {
	const t = ctx.config.thresholds;
	const evidence = {};
	const framework = reader(answers, t, FEATURE_EVIDENCE_LABELS, evidence)("framework_need");
	if (framework === void 0) return missing("framework_need");
	if (framework === "unsure") return unsure(evidence, "request blocks a named framework");
	if (framework === "yes") return {
		status: "decided",
		add: ["p1"],
		note: "a named framework needs this to run on rolldown-vite",
		evidence,
		forceSuggest: "p1 for a feature request needs a human"
	};
	const usefulness = answers.score("usefulness");
	if (!usefulness) return missing("usefulness");
	evidence[FEATURE_EVIDENCE_LABELS.usefulness] = `${usefulness.score.toFixed(1)}/${usefulness.top}`;
	if (usefulness.confidence < t.scoreConfidence) return {
		status: "abstained",
		note: "unsure how widely the feature would be used",
		evidence
	};
	return usefulness.score >= t.usefulnessP2 ? {
		status: "decided",
		add: ["p2"],
		note: "useful to a recognizable group of users",
		evidence
	} : {
		status: "decided",
		add: ["p3"],
		note: "serves a particular setup",
		evidence
	};
}
const priority = defineCheck({
	id: "priority",
	defaultMode: "apply",
	defaultOptions: {
		applyLabels: [
			"p1",
			"p2",
			"p3"
		],
		panicFallback: "p1"
	},
	questions(ctx) {
		const panic = ctx.flags.isPanic ? panicQuestions : {};
		switch (ctx.kind) {
			case "bug": return {
				...bugQuestions,
				...panic
			};
			case "feature": return featureQuestions;
			case "unknown": return {
				...bugQuestions,
				...featureQuestions,
				...panic
			};
			default: return null;
		}
	},
	decide(answers, ctx) {
		let verdict;
		switch (ctx.kind) {
			case "bug":
				verdict = ctx.flags.isPanic ? decidePanic(answers, ctx) : decideBug(answers, ctx);
				break;
			case "feature":
				verdict = decideFeature(answers, ctx);
				break;
			case "task": return {
				status: "skipped",
				reason: "task"
			};
			case "question": return {
				status: "skipped",
				reason: "looks like a question, not a bug or feature"
			};
			default: return {
				status: "abstained",
				note: "could not tell whether this is a bug or a feature"
			};
		}
		if (verdict.status === "decided" && !verdict.forceSuggest) {
			const slot = verdict.add.find((s) => s.startsWith("p"));
			if (slot && !ctx.options.applyLabels.includes(slot)) verdict = {
				...verdict,
				forceSuggest: `${slot} is suggest-only by configuration`
			};
		}
		return verdict;
	}
});
//#endregion
//#region src/questions/repro.ts
const reproQuestions = {
	runnable: noul({
		question: "Using only what this report itself contains, could a maintainer run the problem and see it happen, without writing code from a description, supplying their own project, or rebuilding a setup that is only described in prose?",
		focus: "Judge `issue.sections`, usually `reproduction` with `actual`. Ask what a maintainer would have to supply themselves before anything could run."
	}, {
		true: {
			what: "Everything needed is present: the input files or config plus the command or steps to run them, or a snippet small enough to paste and run as-is.",
			examples: [
				"two files and a build script, then `node build.mjs`",
				"an npx command against an inline source file",
				"numbered steps over a named public package a maintainer can install"
			]
		},
		false: {
			what: "Running it would need the reporter's own application, a project of a size or shape only described, a machine, host or account the maintainer does not have, or code the maintainer would have to write from the description.",
			not_for: "Length, precision, a root-cause analysis, stack traces, log excerpts, version matrices, links to other issues or CI runs, and correct technical detail do not make the answer yes. A well-written report with nothing to run is still no.",
			examples: [
				"reproduces in our large internal app, which I cannot publish",
				"happens on our CI runners, roughly one build in ten",
				"take a medium-to-large SPA and compare the chunk counts"
			]
		}
	}),
	self_evident: noul({
		question: "Could a maintainer start investigating this from what the report already contains, without the reporter supplying anything further?",
		focus: "Judge `issue.sections`. Ask whether the report carries its own evidence, not whether that evidence is a set of steps."
	}, {
		true: {
			what: "The report quotes or links the thing that is wrong, so a maintainer can go straight to it: conflicting type or API declarations, published package metadata, a named test or file in this project, a linked CI run of this project, or a panic pointing at a specific source location.",
			examples: [
				"quotes the two type declarations that are incompatible",
				"links the published package.json that is missing a field",
				"names the failing test in this repository and the run that failed"
			]
		},
		false: {
			what: "The evidence is a symptom inside the reporter's own project, so a maintainer has nothing of their own to look at until the reporter provides more.",
			not_for: "A stack trace from the reporter's bundle, a version matrix, or a description of their app is not evidence a maintainer can start from.",
			examples: ["our SSR build 500s, here is the stack from our own output", "our CI crashes about one build in ten"]
		}
	}),
	repro_quality: score({
		question: "How much of what a maintainer needs in order to run this is written down in the report?",
		focus: "Judge only what is written in `issue.sections`. Links to documentation, other issues, screenshots, or CI logs are evidence but are not steps."
	}, [
		"Only says something is broken or pastes an error, with no code, no steps, and no description of the project setup.",
		"Names the feature, option, or error and describes the project loosely, but gives no code and no steps a maintainer could follow.",
		"Gives either concrete steps or a code sample or config, but a maintainer would still have to guess the rest to run it.",
		"Gives everything needed to run it: the input code or config plus the command or steps, or a self-contained snippet with the observed and expected output, so a maintainer can reproduce it without guessing."
	]),
	explains_no_repro: noul({
		question: "Does the reporter give a concrete reason why a minimal reproduction link cannot be provided, and describe the environment where it occurs instead?",
		focus: "`issue.sections.reproduction` and `issue.sections.additional`."
	}, {
		true: {
			what: "Names a constraint the REPL or StackBlitz cannot express (a specific OS, CI runner, container CPU limit, private code, nondeterminism, a native binding) and gives enough environment detail to try it elsewhere.",
			examples: ["needs a Linux cgroup CPU limit, so here is a Docker setup", "only with Windows paths; the REPL runs on Linux"]
		},
		false: {
			what: "No reason is given, the reason is lack of time, or the reporter asks the maintainers to reproduce it from the description.",
			not_for: "A vague \"it happens in my large project\" is not a concrete reason."
		}
	})
};
//#endregion
//#region src/checks/reproduction.ts
function describe(link) {
	switch (link.kind) {
		case "repl": return `REPL link (${link.detail ?? "ok"})`;
		case "stackblitz": return "StackBlitz link";
		case "codesandbox": return "CodeSandbox link";
		case "webcontainer": return `${new URL(link.url).hostname} link`;
		case "gist": return "gist link";
		case "github_repo": return "GitHub repository link";
		default: return link.kind;
	}
}
/** Characters of real prose across every section the model would be shown. */
function contentLength(ctx) {
	return Object.values(ctx.state.issue.sections).join(" ").replace(/\s+/g, " ").trim().length;
}
/** No runnable link, nothing in the template, and less than a sentence of prose. */
function isEmptyReport(ctx) {
	return ctx.flags.runnableLinks.length === 0 && contentLength(ctx) < 80;
}
//#endregion
//#region src/checks/index.ts
/** Every check the action knows about. Enable them per repo with the `checks` input. */
const checks = [
	defineCheck({
		id: "reproduction",
		defaultMode: "apply",
		questions(ctx) {
			if (ctx.kind === "feature" || ctx.kind === "task" || ctx.kind === "question") return null;
			if (ctx.flags.runnableLinks.length > 0) return {};
			return reproQuestions;
		},
		decide(answers, ctx) {
			if (isEmptyReport(ctx)) return {
				status: "decided",
				add: ["needsReproduction"],
				note: "the report has no reproduction and almost no content",
				gate: "fail"
			};
			switch (ctx.kind) {
				case "feature": return {
					status: "skipped",
					reason: "feature request"
				};
				case "task": return {
					status: "skipped",
					reason: "task"
				};
				case "question": return {
					status: "skipped",
					reason: "question"
				};
				case "unknown": return {
					status: "abstained",
					note: "could not tell whether this is a bug",
					gate: "unsure"
				};
			}
			const runnable = ctx.flags.runnableLinks;
			if (runnable.length > 0) {
				const first = runnable[0];
				const more = runnable.length > 1 ? ` (+${runnable.length - 1} more)` : "";
				return {
					status: "decided",
					add: [],
					note: `${describe(first)}${more}`,
					gate: "pass"
				};
			}
			if (ctx.flags.replInvalid) return {
				status: "abstained",
				note: "REPL link is empty or truncated",
				gate: "unsure"
			};
			const t = ctx.config.thresholds;
			const canRun = answers.noul("runnable");
			const selfEvident = answers.noul("self_evident");
			const quality = answers.score("repro_quality");
			const explains = answers.noul("explains_no_repro");
			if (canRun === void 0) return {
				status: "abstained",
				note: "no answer for runnable",
				gate: "unsure"
			};
			const evidence = { runnable: Number(canRun.toFixed(2)) };
			if (selfEvident !== void 0) evidence["self-evident"] = Number(selfEvident.toFixed(2));
			if (quality) evidence.steps = `${quality.score.toFixed(1)}/${quality.top}`;
			if (explains !== void 0) evidence["explains no link"] = Number(explains.toFixed(2));
			const missingFields = ctx.parsed.requiredMissing.length > 0 ? `; template fields missing: ${ctx.parsed.requiredMissing.join(", ")}` : "";
			if (canRun >= t.reproRunnableYes) return {
				status: "decided",
				add: [],
				note: "no link, but the report is runnable as written",
				evidence,
				gate: "pass"
			};
			if ((explains ?? 0) >= t.noulYes) return {
				status: "abstained",
				note: "no link; the report explains why, needs a human",
				evidence,
				gate: "unsure"
			};
			if ((selfEvident ?? 0) >= t.reproSelfEvident) return {
				status: "abstained",
				note: "nothing to run, but the report carries its own evidence",
				evidence,
				gate: "unsure"
			};
			if (canRun <= t.reproRunnableNo && (quality?.score ?? 0) <= t.reproLow) return {
				status: "decided",
				add: ["needsReproduction"],
				note: `no reproduction found${missingFields}`,
				evidence,
				gate: "fail"
			};
			return {
				status: "abstained",
				note: `no link and the report is hard to judge${missingFields}`,
				evidence,
				gate: "unsure"
			};
		}
	}),
	priority,
	hasWorkaround
];
//#endregion
//#region src/core/comment.ts
const MARKER = "<!-- rolldown-triager -->";
/** Text added when a label is *applied*; the reporter needs to know what to do next. */
const APPLIED_ADVICE = { needsReproduction: "Please add a REPL, StackBlitz or repository link; the label closes the issue after 14 days without activity." };
function code(label) {
	return `\`${label}\``;
}
function evidenceOf(result) {
	const v = result.verdict;
	if (v.status === "skipped" || !v.evidence) return "";
	const parts = Object.entries(v.evidence).map(([k, val]) => `${k} ${val}`);
	return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}
function renderLine(result, labels) {
	const v = result.verdict;
	const head = `- ${result.id}:`;
	if (v.status === "skipped" || result.effective === "skipped") return `${head} skipped (${v.status === "skipped" ? v.reason : "off"})`;
	if (v.status === "abstained") return `${head} ${v.note}${evidenceOf(result)}`;
	const parts = [];
	if (result.labels.length > 0) {
		const verb = result.effective === "applied" ? "set" : "suggest";
		const removed = result.effective === "applied" && result.labels.some((l) => l.startsWith("p")) ? `, removed ${code(labels.needsTriage)}` : "";
		parts.push(`${verb} ${result.labels.map(code).join(", ")}${removed} — ${v.note}`);
	} else parts.push(v.note);
	if (v.humanNote) parts.push(`; ${v.humanNote}`);
	let line = `${head} ${parts.join("")}${evidenceOf(result)}`;
	if (result.effective === "applied") {
		for (const [slot, advice] of Object.entries(APPLIED_ADVICE)) if (result.labels.includes(labels[slot])) line += ` ${advice}`;
	}
	if (result.effective === "suggested" && result.downgradedBecause.length > 0) line += ` [not applied: ${result.downgradedBecause.join("; ")}]`;
	return line;
}
function renderComment(report, labels, meta = {}) {
	const model = report.model ?? "no model call";
	const lines = [
		MARKER,
		`Automated triage by rolldown-triager (Jev ${model}). A maintainer will confirm.`,
		"",
		...report.results.map((r) => renderLine(r, labels)),
		""
	];
	const footer = [`Re-run: re-add ${code(labels.needsTriage)}. Manual labels win.`];
	if (meta.runUrl) footer.push(`[run](${meta.runUrl})`);
	lines.push(footer.join(" "));
	return lines.join("\n");
}
/** Everything, for `$GITHUB_STEP_SUMMARY`. */
function renderSummary(report, labels) {
	const rows = report.results.map((r) => {
		const v = r.verdict;
		const note = v.status === "skipped" ? v.reason : v.note;
		const evidence = v.status !== "skipped" && v.evidence ? Object.entries(v.evidence).map(([k, x]) => `${k}=${x}`).join(", ") : "";
		return `| ${r.id} | ${r.mode} | ${r.effective} | ${r.labels.map(code).join(", ")} | ${note} | ${evidence} | ${r.downgradedBecause.join("; ")} |`;
	});
	const usage = report.usage ? `${report.usage.input_tokens} in / ${report.usage.output_tokens} out` : "—";
	return [
		`## rolldown-triager: [#${report.issue.number}](${report.issue.htmlUrl}) ${report.issue.title}`,
		"",
		report.shortCircuit ? `Short-circuit: **${report.shortCircuit}**` : "",
		`- kind: **${report.kind}** (from ${report.kindSource}${report.kindConfidence === null ? "" : `, confidence ${report.kindConfidence.toFixed(2)}`})`,
		`- model: ${report.model ?? "none"} · questions: ${report.questionsAsked} · tokens: ${usage}`,
		`- flags: template followed ${report.flags.templateFollowed}, runnable links ${report.flags.runnableLinks.length}, priority words ${report.flags.priorityWords}, truncated [${report.flags.truncated.join(", ")}]`,
		`- labels: add [${report.plan.add.map(code).join(", ")}] remove [${report.plan.remove.map(code).join(", ")}]`,
		"",
		"| check | mode | result | labels | note | evidence | downgraded |",
		"| --- | --- | --- | --- | --- | --- | --- |",
		...rows,
		"",
		"```",
		renderComment(report, labels),
		"```"
	].filter((l) => l !== "").join("\n");
}
//#endregion
//#region src/core/config.ts
/** Exact label names on rolldown/rolldown. */
const ROLLDOWN_LABELS = {
	p0: "p0: urgent",
	p1: "p1: important",
	p2: "p2: significant / minor bug",
	p3: "p3: nice to have / edge case",
	needsTriage: "needs-triage",
	needsReproduction: "needs-reproduction",
	hasWorkaround: "has workaround"
};
const DEFAULT_THRESHOLDS = {
	noulYes: .75,
	noulNo: .25,
	scoreConfidence: .6,
	reproLow: 3,
	reproSelfEvident: .65,
	reproRunnableYes: .7,
	reproRunnableNo: .2,
	reproOk: 2.25,
	reproConfidence: .7,
	panicReachP1: 1.5,
	panicReachP2: .5,
	panicConfidence: .35,
	usefulnessP2: 1,
	workaroundLabel: .85,
	arguesPriority: .6,
	kindConfidence: .7
};
const DEFAULT_CHECKS = ["reproduction", "priority"];
/**
* Measured on rolldown issues triaged since 2026-03 (`pnpm cli eval`):
* priority agrees with maintainers on ~57% of decided bugs and p1 precision is
* ~57%, so it only suggests until the questions improve. Reproduction at the
* default thresholds was 3/3 correct with 19% recall, so it applies.
*/
const DEFAULT_MODES = {
	reproduction: "apply",
	priority: "suggest"
};
const MODES = /* @__PURE__ */ new Set([
	"apply",
	"suggest",
	"off"
]);
const COMMENT_MODES = /* @__PURE__ */ new Set([
	"always",
	"when-acting",
	"when-needed",
	"never"
]);
var ConfigError = class extends Error {
	name = "ConfigError";
};
function parseJsonObject(name, text) {
	const trimmed = text?.trim();
	if (!trimmed) return {};
	let value;
	try {
		value = JSON.parse(trimmed);
	} catch (error) {
		throw new ConfigError(`\`${name}\` is not valid JSON: ${error.message}`);
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ConfigError(`\`${name}\` must be a JSON object`);
	return value;
}
function parseList(text) {
	return (text ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}
function parseModes(text) {
	const modes = {};
	for (const entry of parseList(text)) {
		const [id, mode, ...rest] = entry.split("=").map((s) => s.trim());
		if (!id || !mode || rest.length > 0 || !MODES.has(mode)) throw new ConfigError(`\`modes\` entry ${JSON.stringify(entry)} must look like \`check=apply|suggest|off\``);
		modes[id] = mode;
	}
	return modes;
}
function resolveConfig(raw = {}) {
	const checks = raw.checks?.trim() ? parseList(raw.checks) : [...DEFAULT_CHECKS];
	const labels = { ...ROLLDOWN_LABELS };
	for (const [key, value] of Object.entries(parseJsonObject("labels", raw.labels))) {
		if (!LABEL_SLOTS.includes(key)) throw new ConfigError(`\`labels\` has unknown slot ${JSON.stringify(key)}`);
		if (typeof value !== "string" || !value.trim()) throw new ConfigError(`\`labels.${key}\` must be a non-empty string`);
		labels[key] = value;
	}
	const thresholds = { ...DEFAULT_THRESHOLDS };
	for (const [key, value] of Object.entries(parseJsonObject("thresholds", raw.thresholds))) {
		if (!(key in DEFAULT_THRESHOLDS)) throw new ConfigError(`\`thresholds\` has unknown key ${JSON.stringify(key)}`);
		if (typeof value !== "number" || !Number.isFinite(value)) throw new ConfigError(`\`thresholds.${key}\` must be a number`);
		thresholds[key] = value;
	}
	if (thresholds.noulNo >= thresholds.noulYes) throw new ConfigError("`thresholds.noulNo` must be below `thresholds.noulYes`");
	const comment = raw.comment?.trim() || "never";
	if (!COMMENT_MODES.has(comment)) throw new ConfigError(`\`comment\` must be one of always, when-acting, when-needed, never`);
	return {
		labels,
		checks,
		modes: {
			...DEFAULT_MODES,
			...parseModes(raw.modes)
		},
		options: parseJsonObject("options", raw.options),
		comment,
		model: raw.model?.trim() || "jev-1.13.0",
		thresholds
	};
}
//#endregion
//#region src/core/errors.ts
const MAX_LENGTH = 400;
const HTML_RE = /<(?:!doctype|html)\b/i;
const STATUS_RE = /^\s*(\d{3})\b/;
const TITLE_RE = /<title[^>]*>([^<]*)<\/title>/i;
const RAY_RE = /Ray ID:\s*<strong[^>]*>([0-9a-f]+)</i;
function truncate(message) {
	return message.length > MAX_LENGTH ? `${message.slice(0, MAX_LENGTH)}…` : message;
}
/**
* One line for any error, with HTML error pages summarized rather than dumped.
* The status, the page title and Cloudflare's Ray ID are the parts worth
* keeping: together they say who rejected the request and identify it in their
* logs. A blocked request never reached the model, so the issue stays
* `needs-triage` for a human — the point of the line is to make that visible.
*/
function formatError(error) {
	const raw = error instanceof Error ? error.message : String(error);
	if (!HTML_RE.test(raw)) return truncate(raw);
	const status = STATUS_RE.exec(raw)?.[1];
	const title = TITLE_RE.exec(raw)?.[1]?.trim();
	const ray = RAY_RE.exec(raw)?.[1];
	const parts = [];
	if (status) parts.push(status);
	parts.push(title ? JSON.stringify(title) : "HTML error page");
	if (ray) parts.push(`Ray ID ${ray}`);
	parts.push(`${raw.length} bytes of HTML, not an API response`);
	return parts.join(" · ");
}
//#endregion
//#region src/core/github.ts
var GitHubError = class extends Error {
	name = "GitHubError";
	status;
	method;
	path;
	constructor(status, method, path, message) {
		super(`${method} ${path} → ${status}: ${message}`);
		this.status = status;
		this.method = method;
		this.path = path;
	}
};
function createGitHubClient(options) {
	const baseUrl = (options.baseUrl ?? "https://api.github.com").replace(/\/+$/, "");
	const doFetch = options.fetch ?? fetch;
	const issuesPath = `/repos/${options.repo}/issues`;
	async function request(method, path, body) {
		const response = await doFetch(`${baseUrl}${path}`, {
			method,
			headers: {
				accept: "application/vnd.github+json",
				authorization: `Bearer ${options.token}`,
				"x-github-api-version": "2022-11-28",
				"user-agent": options.userAgent ?? "rolldown-triager",
				...body === void 0 ? {} : { "content-type": "application/json" }
			},
			body: body === void 0 ? void 0 : JSON.stringify(body)
		});
		const text = await response.text();
		if (!response.ok) {
			let message = text;
			try {
				message = JSON.parse(text).message ?? text;
			} catch {}
			throw new GitHubError(response.status, method, path, message.slice(0, 300));
		}
		return text ? JSON.parse(text) : void 0;
	}
	const toComment = (c) => ({
		id: c.id,
		body: c.body ?? "",
		htmlUrl: c.html_url
	});
	const toIssue = (raw) => ({
		number: raw.number,
		title: raw.title,
		body: raw.body ?? "",
		typeName: raw.type?.name ?? null,
		labels: raw.labels.map((l) => typeof l === "string" ? l : l.name),
		htmlUrl: raw.html_url
	});
	return {
		async getIssue(number) {
			const raw = await request("GET", `${issuesPath}/${number}`);
			if (raw.pull_request) throw new Error(`#${number} is a pull request, not an issue`);
			return toIssue(raw);
		},
		async listComments(number) {
			const comments = [];
			for (let page = 1; page < 50; page++) {
				const batch = await request("GET", `${issuesPath}/${number}/comments?per_page=100&page=${page}`);
				comments.push(...batch.map(toComment));
				if (batch.length < 100) break;
			}
			return comments;
		},
		async createComment(number, body) {
			return toComment(await request("POST", `${issuesPath}/${number}/comments`, { body }));
		},
		async updateComment(id, body) {
			return toComment(await request("PATCH", `${issuesPath}/comments/${id}`, { body }));
		},
		async setLabels(number, labels) {
			await request("PUT", `${issuesPath}/${number}/labels`, { labels });
		},
		async listIssues({ label, since, limit }) {
			const out = [];
			for (let page = 1; out.length < limit && page < 50; page++) {
				const params = new URLSearchParams({
					state: "all",
					labels: label,
					per_page: "100",
					page: String(page)
				});
				if (since) params.set("since", since);
				const batch = await request("GET", `${issuesPath}?${params}`);
				for (const raw of batch) {
					if (raw.pull_request) continue;
					out.push({
						...toIssue(raw),
						createdAt: raw.created_at,
						state: raw.state
					});
					if (out.length >= limit) break;
				}
				if (batch.length < 100) break;
			}
			return out;
		},
		async listLabelsEverAdded(number) {
			const names = /* @__PURE__ */ new Set();
			for (let page = 1; page < 20; page++) {
				const batch = await request("GET", `${issuesPath}/${number}/events?per_page=100&page=${page}`);
				for (const e of batch) if (e.event === "labeled" && e.label?.name) names.add(e.label.name);
				if (batch.length < 100) break;
			}
			return [...names];
		}
	};
}
//#endregion
//#region src/core/jev.ts
function createTypeSafeJev(apiKey, options = {}) {
	const client = new TypeSafeClient({
		apiKey,
		timeout: options.timeout ?? 3e4,
		logLevel: "off",
		...options.baseURL ? { baseURL: options.baseURL } : {},
		...options.fetch ? { fetch: options.fetch } : {}
	});
	return { async ask(state, questions, model) {
		const result = await client.systemOne({
			state,
			questions,
			model
		});
		return {
			model: result.model,
			answers: { ...result.answers },
			usage: result.usage
		};
	} };
}
//#endregion
//#region src/core/answers.ts
/** Builds a check's view of the batch answers: keys under `${prefix}:` with the prefix removed. */
function answersFor(all, prefix) {
	const raw = {};
	const marker = `${prefix}:`;
	for (const [key, value] of Object.entries(all)) if (key.startsWith(marker)) raw[key.slice(marker.length)] = value;
	return {
		raw,
		has: (key) => key in raw,
		noul(key) {
			const a = raw[key];
			return a?.type === "noul" ? a.noul : void 0;
		},
		score(key) {
			const a = raw[key];
			if (a?.type !== "score") return void 0;
			const probabilities = {};
			let top = 0;
			for (const [level, p] of Object.entries(a.probabilities)) {
				probabilities[level] = p;
				top = Math.max(top, Number(level));
			}
			return {
				score: a.score,
				confidence: a.confidence,
				top,
				probabilities
			};
		},
		choice(key) {
			const a = raw[key];
			if (a?.type !== "choice") return void 0;
			return {
				choice: a.choice,
				confidence: a.confidence,
				probabilities: { ...a.probabilities }
			};
		}
	};
}
//#endregion
//#region src/core/repl.ts
const REPL_HOSTS = ["repl.rolldown.rs", "rolldown-repl.netlify.app"];
/** zlib header: CMF 0x78 (deflate, 32k window) and (CMF << 8 | FLG) divisible by 31. */
function isZlib(bin) {
	const cmf = bin[0];
	const flg = bin[1];
	return cmf === 120 && flg !== void 0 && (cmf << 8 | flg) % 31 === 0;
}
function decodeReplUrl(url) {
	const hashAt = url.indexOf("#");
	if (hashAt < 0 || hashAt === url.length - 1) return {
		ok: false,
		error: "no-payload"
	};
	let raw = url.slice(hashAt + 1);
	try {
		raw = decodeURIComponent(raw);
	} catch {}
	raw += "=".repeat(-raw.length & 3);
	const bin = Buffer.from(raw, "base64");
	if (bin.length === 0) return {
		ok: false,
		error: "undecodable"
	};
	let text;
	try {
		text = isZlib(bin) ? inflateSync(bin).toString("utf8") : decodeURIComponent(bin.toString("latin1"));
	} catch {
		return {
			ok: false,
			error: "undecodable"
		};
	}
	let state;
	try {
		state = JSON.parse(text);
	} catch {
		return {
			ok: false,
			error: "undecodable"
		};
	}
	if (typeof state !== "object" || state === null) return {
		ok: false,
		error: "malformed"
	};
	const { f, v } = state;
	if (typeof f !== "object" || f === null || Array.isArray(f)) return {
		ok: false,
		error: "malformed"
	};
	const files = [];
	for (const [name, meta] of Object.entries(f)) {
		const m = meta ?? {};
		const content = typeof m.c === "string" ? m.c : typeof m.code === "string" ? m.code : "";
		files.push({
			name: typeof m.n === "string" ? m.n : name,
			content,
			entry: m.e === true
		});
	}
	return {
		ok: true,
		version: typeof v === "string" && v ? v : "unknown",
		files
	};
}
function replHasContent(decoded) {
	return decoded.ok && decoded.files.some((f) => f.content.trim().length > 0);
}
function summarizeRepl(decoded) {
	if (!decoded.ok) return decoded.error === "no-payload" ? "no payload" : "undecodable (truncated link?)";
	if (!replHasContent(decoded)) return "empty";
	const n = decoded.files.length;
	return `${n} file${n === 1 ? "" : "s"}, rolldown ${decoded.version}`;
}
//#endregion
//#region src/core/links.ts
const URL_RE = /https?:\/\/[^\s<>()[\]"'`]+/g;
/** Repos whose links are references (docs, source, other issues), not reproductions. */
const REFERENCE_OWNERS = /* @__PURE__ */ new Set([
	"rolldown",
	"vitejs",
	"rollup",
	"oxc-project",
	"evanw",
	"nodejs",
	"microsoft",
	"webpack",
	"web-infra-dev"
]);
const STARTER_RE = /rolldown-starter-stackblitz/i;
function extractReproLinks(body) {
	const seen = /* @__PURE__ */ new Set();
	const links = [];
	for (const match of body.matchAll(URL_RE)) {
		const url = match[0].replace(/[.,;:!?]+$/, "");
		if (seen.has(url)) continue;
		seen.add(url);
		const link = classify(url);
		if (link) links.push(link);
	}
	return links;
}
function classify(url) {
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
	const path = parsed.pathname;
	const segments = path.split("/").filter(Boolean);
	if (REPL_HOSTS.includes(host)) {
		const decoded = decodeReplUrl(url);
		return {
			kind: "repl",
			url,
			ok: replHasContent(decoded),
			detail: summarizeRepl(decoded)
		};
	}
	if (host === "stackblitz.com") {
		if (STARTER_RE.test(path)) return {
			kind: "stackblitz",
			url,
			ok: false,
			detail: "starter template, not a reproduction"
		};
		if (/^\/(edit|github|fork|~)\//.test(path)) return {
			kind: "stackblitz",
			url,
			ok: true
		};
		return null;
	}
	if (host === "codesandbox.io" || host.endsWith(".csb.app")) return {
		kind: "codesandbox",
		url,
		ok: true
	};
	if (host === "vite.new" || host === "vitest.new" || host === "stackblitz.new") return {
		kind: "webcontainer",
		url,
		ok: true
	};
	if (host === "gist.github.com") return segments.length >= 2 ? {
		kind: "gist",
		url,
		ok: true
	} : null;
	if (host === "github.com") {
		const [owner, repo, section] = segments;
		if (!owner || !repo) return null;
		if (REFERENCE_OWNERS.has(owner.toLowerCase()) || STARTER_RE.test(repo)) return null;
		if (section === void 0 || section === "tree" || section === "archive") return {
			kind: "github_repo",
			url,
			ok: true
		};
		if (section === "releases" && path.includes("/download/")) return {
			kind: "github_repo",
			url,
			ok: true
		};
		return null;
	}
	return null;
}
//#endregion
//#region src/core/parse.ts
const HEADING_RE = /^#{2,3}\s+(.+?)\s*#*\s*$/;
const FENCE_RE$1 = /^\s*(```|~~~)/;
const ALIASES = [
	{
		re: /^(minimal )?reproduction( link)?( or steps| repo(sitory)?)?:?$/i,
		key: "reproduction"
	},
	{
		re: /^(steps to|how to|to) reproduce:?$/i,
		key: "reproduction"
	},
	{
		re: /^(what is )?expected( behaviou?r| result)?\??:?$/i,
		key: "expected"
	},
	{
		re: /^what is actually happening\??:?$/i,
		key: "actual"
	},
	{
		re: /^(actual|current|observed) (behaviou?r|result):?$/i,
		key: "actual"
	},
	{
		re: /^describe the bug:?$/i,
		key: "actual"
	},
	{
		re: /^panic message:?$/i,
		key: "panic_message"
	},
	{
		re: /^(system info(rmation)?|environment|versions?):?$/i,
		key: "system_info"
	},
	{
		re: /^(any )?additional (comments?|context|information|notes?)\??:?$/i,
		key: "additional"
	},
	{
		re: /^what problem does this feature solve\??:?$/i,
		key: "problem"
	},
	{
		re: /^(problem|motivation|use case):?$/i,
		key: "problem"
	},
	{
		re: /^what does the proposed api look like\??:?$/i,
		key: "proposed_api"
	},
	{
		re: /^proposed (api|solution|change):?$/i,
		key: "proposed_api"
	}
];
/** Exact form labels per template; two or more matches identify the template. */
const TEMPLATE_HEADINGS = {
	bug: [
		"reproduction link or steps",
		"what is expected?",
		"what is actually happening?",
		"system info",
		"any additional comments?"
	],
	panic: [
		"panic message",
		"reproduction",
		"system info",
		"additional context"
	],
	feature: ["what problem does this feature solve?", "what does the proposed api look like?"]
};
const REQUIRED = {
	bug: [
		"reproduction",
		"expected",
		"actual",
		"system_info"
	],
	panic: [
		"panic_message",
		"reproduction",
		"system_info"
	],
	feature: ["problem", "proposed_api"],
	none: []
};
function isEmptyResponse(text) {
	const t = text?.trim() ?? "";
	return t === "" || /^_no response_$/i.test(t);
}
function aliasFor(heading) {
	for (const { re, key } of ALIASES) if (re.test(heading)) return key;
	return null;
}
function parseSections(body) {
	const lines = body.replace(/\r\n?/g, "\n").split("\n");
	const headings = [];
	const known = {};
	const other = [];
	let target = [];
	other.push(target);
	let inFence = false;
	for (const line of lines) {
		if (FENCE_RE$1.test(line)) inFence = !inFence;
		const m = inFence ? null : HEADING_RE.exec(line);
		if (m?.[1]) {
			const heading = m[1].trim();
			headings.push(heading.toLowerCase());
			const key = aliasFor(heading);
			if (key) {
				target = known[key] ?? (known[key] = []);
				if (target.length > 0) target.push("");
			} else {
				target = [`${heading}:`];
				other.push(target);
			}
			continue;
		}
		target.push(line);
	}
	const sections = {};
	for (const [key, value] of Object.entries(known)) {
		const text = value.join("\n").trim();
		if (text) sections[key] = text;
	}
	const leftovers = other.map((chunk) => chunk.join("\n").trim()).filter(Boolean);
	if (Object.keys(sections).length === 0) {
		const text = leftovers.join("\n\n").trim();
		return {
			sections: text ? { body: text } : {},
			headings
		};
	}
	if (leftovers.length > 0) sections.additional = [...leftovers, sections.additional].filter(Boolean).join("\n\n");
	return {
		sections,
		headings
	};
}
function detectTemplate(headings, title) {
	const seen = new Set(headings);
	let best = "none";
	let bestCount = 1;
	for (const [template, labels] of Object.entries(TEMPLATE_HEADINGS)) {
		const count = labels.filter((l) => seen.has(l)).length;
		if (count > bestCount) {
			best = template;
			bestCount = count;
		} else if (count === bestCount && count > 1 && titlePrefix(title) === template) best = template;
	}
	return best;
}
function titlePrefix(title) {
	const t = title.trimStart();
	if (/^\[panic\]/i.test(t)) return "panic";
	if (/^\[bug\]/i.test(t)) return "bug";
	if (/^\[feature( request)?\]/i.test(t)) return "feature";
	return null;
}
function requiredMissing(template, sections) {
	return REQUIRED[template].filter((key) => isEmptyResponse(sections[key]));
}
function detectKind(issue, template) {
	switch (issue.typeName?.toLowerCase()) {
		case "bug": return {
			kind: "bug",
			source: "type"
		};
		case "feature": return {
			kind: "feature",
			source: "type"
		};
		case "task": return {
			kind: "task",
			source: "type"
		};
	}
	if (template === "bug" || template === "panic") return {
		kind: "bug",
		source: "template"
	};
	if (template === "feature") return {
		kind: "feature",
		source: "template"
	};
	const prefix = titlePrefix(issue.title);
	if (prefix === "bug" || prefix === "panic") return {
		kind: "bug",
		source: "title"
	};
	if (prefix === "feature") return {
		kind: "feature",
		source: "title"
	};
	return {
		kind: "unknown",
		source: "none"
	};
}
//#endregion
//#region src/core/policy.ts
const isPriority = (slot) => PRIORITY_SLOTS.includes(slot);
function modeFor(check, modes) {
	return modes[check.id] ?? check.defaultMode ?? "suggest";
}
function applyPolicy(inputs, ctx) {
	const { labels, modes, thresholds } = ctx.config;
	const priorityNames = new Set(PRIORITY_SLOTS.map((s) => labels[s]));
	const hasPriorityAlready = ctx.issue.labels.some((l) => priorityNames.has(l));
	const kindWeak = ctx.kindSource === "model" && (ctx.kindConfidence ?? 0) < thresholds.kindConfidence;
	const plan = {
		add: [],
		remove: []
	};
	const results = [];
	for (const { check, verdict } of inputs) {
		const mode = modeFor(check, modes);
		const downgradedBecause = [];
		let effective;
		let slots = [];
		if (mode === "off") effective = "skipped";
		else if (verdict.status === "skipped") effective = "skipped";
		else if (verdict.status === "abstained") effective = "abstained";
		else {
			slots = verdict.add.filter((s) => {
				if (s === "p0") {
					downgradedBecause.push("p0 is never applied automatically");
					return false;
				}
				return true;
			});
			if (verdict.forceSuggest) downgradedBecause.push(verdict.forceSuggest);
			if (slots.length > 0) {
				if (slots.some(isPriority) && hasPriorityAlready) downgradedBecause.push("issue already has a priority label");
				if (kindWeak) downgradedBecause.push("issue kind came from the model with low confidence");
			}
			effective = mode === "apply" && downgradedBecause.length === 0 ? "applied" : "suggested";
			if (effective === "applied") for (const slot of slots) {
				const name = labels[slot];
				if (!plan.add.includes(name)) plan.add.push(name);
				if (isPriority(slot) && !plan.remove.includes(labels.needsTriage)) plan.remove.push(labels.needsTriage);
			}
		}
		results.push({
			id: check.id,
			verdict,
			mode,
			effective,
			labels: slots.map((s) => labels[s]),
			downgradedBecause
		});
	}
	return {
		results,
		plan
	};
}
//#endregion
//#region src/core/sanitize.ts
const REPL_URL_RE = new RegExp(`https?://(?:${REPL_HOSTS.map((h) => h.replaceAll(".", "\\.")).join("|")})/?#[^\\s<>()[\\]"'\`]*`, "g");
const LONG_URL_RE = /https?:\/\/([^\s<>()[\]"'`/]+)[^\s<>()[\]"'`]{200,}/g;
const FENCE_RE = /^\s*(```|~~~)/;
const OMITTED = (n) => `[... ${n} lines omitted ...]`;
function replaceReplUrls(text) {
	return text.replace(REPL_URL_RE, (url) => `<repl-link: ${summarizeRepl(decodeReplUrl(url))}>`);
}
function stripHtml(text) {
	return text.replace(/<!--[\s\S]*?-->/g, "").replace(/!\[[^\]]*]\([^)]*\)/g, "[image]").replace(/<img\b[^>]*>/gi, "[image]").replace(/<video\b[\s\S]*?<\/video>/gi, "[video]").replace(/<\/?(details|summary|p|div|br|b|i|em|strong|kbd|sup|sub)\b[^>]*>/gi, "");
}
function trimFences(text, max, head, tail) {
	const lines = text.split("\n");
	const out = [];
	let fence = null;
	for (const line of lines) {
		if (FENCE_RE.test(line)) {
			if (fence === null) fence = [line];
			else {
				fence.push(line);
				const inner = fence.length - 2;
				if (inner > max) {
					const open = fence[0] ?? "";
					const close = fence.at(-1) ?? "";
					const body = fence.slice(1, -1);
					out.push(open, ...body.slice(0, head), OMITTED(inner - head - tail), ...body.slice(-tail), close);
				} else out.push(...fence);
				fence = null;
			}
			continue;
		}
		if (fence) fence.push(line);
		else out.push(line);
	}
	if (fence) out.push(...fence);
	return out.join("\n");
}
function headTail(text, head, tail) {
	const lines = text.split("\n");
	if (lines.length <= head + tail) return text;
	return [
		...lines.slice(0, head),
		OMITTED(lines.length - head - tail),
		...lines.slice(-tail)
	].join("\n");
}
function keepMatching(text, re) {
	const lines = text.split("\n");
	const kept = lines.filter((l) => re.test(l));
	return (kept.length > 0 ? kept : lines.slice(0, 10)).map((l) => l.trim()).join("\n");
}
function capOnLine(text, cap) {
	if (text.length <= cap) return {
		text,
		truncated: false
	};
	const cut = text.lastIndexOf("\n", cap);
	return {
		text: `${text.slice(0, cut > cap / 2 ? cut : cap).trimEnd()}\n[... truncated ...]`,
		truncated: true
	};
}
function sanitizeSection(raw, opts) {
	let text = raw.replace(/\r\n?/g, "\n");
	text = stripHtml(text);
	text = replaceReplUrls(text);
	text = text.replace(LONG_URL_RE, (_m, host) => `${host}/...`);
	text = trimFences(text, opts.fenceMax ?? 40, opts.fenceHead ?? 25, opts.fenceTail ?? 10);
	const lineMax = opts.lineMax ?? 500;
	text = text.split("\n").map((l) => l.length > lineMax ? `${l.slice(0, lineMax)}...` : l).join("\n");
	text = text.replace(/(^|[^\w`])@[\w-]+/g, "$1@user");
	if (opts.keepLines) text = keepMatching(text, opts.keepLines);
	if (opts.headLines !== void 0 && opts.tailLines !== void 0) text = headTail(text, opts.headLines, opts.tailLines);
	text = text.replace(/\n{3,}/g, "\n\n").trim();
	return capOnLine(text, opts.cap);
}
/** Body text with fenced blocks and inline code removed, for prose-only heuristics. */
function proseOnly(text) {
	return text.replace(/```[\s\S]*?```/g, " ").replace(/~~~[\s\S]*?~~~/g, " ").replace(/`[^`\n]*`/g, " ");
}
//#endregion
//#region src/core/state.ts
const CAPS = {
	reproduction: { cap: 4e3 },
	expected: { cap: 1500 },
	actual: { cap: 3e3 },
	panic_message: {
		cap: 2e3,
		headLines: 30,
		tailLines: 10
	},
	system_info: {
		cap: 600,
		keepLines: /\b(OS|CPU|Memory|Node|npm|pnpm|yarn|bun|deno|rolldown|vite|tsdown)\b/i
	},
	additional: { cap: 2e3 },
	problem: { cap: 3e3 },
	proposed_api: { cap: 3e3 },
	body: { cap: 8e3 }
};
/** ~10k tokens; well under the 32k state budget even with every question attached. */
const STATE_BUDGET = 4e4;
const PANIC_RE = /panicked at|rolldown panicked|\bSIGSEGV\b|\bSIGBUS\b|\bsegmentation fault\b|\bbus error\b/i;
const PRIORITY_WORDS_RE = /\b(p[0-3]|urgent(ly)?|blocker|top priority|highest priority|asap|please prioriti[sz]e|show[- ]?stopper)\b/i;
function buildState(issue, parsed, kind) {
	const sections = {};
	const truncated = [];
	const caps = Object.fromEntries(Object.entries(CAPS).map(([k, v]) => [k, v.cap]));
	const render = () => {
		for (const key of Object.keys(CAPS)) {
			const raw = parsed.sections[key];
			if (raw === void 0 || isEmptyResponse(raw)) continue;
			const { text, truncated: cut } = sanitizeSection(raw, {
				...CAPS[key],
				cap: caps[key]
			});
			if (text) sections[key] = text;
			else delete sections[key];
			if (cut && !truncated.includes(key)) truncated.push(key);
		}
	};
	render();
	const state = { issue: {
		title: issue.title.trim().slice(0, 300),
		kind,
		template: parsed.template,
		sections
	} };
	for (let i = 0; i < 12 && JSON.stringify(state).length > STATE_BUDGET; i++) {
		const largest = Object.entries(sections).sort((a, b) => b[1].length - a[1].length)[0];
		if (!largest) break;
		caps[largest[0]] = Math.max(200, Math.floor(largest[1].length / 2));
		render();
	}
	const runnableLinks = parsed.links.filter((l) => l.ok);
	return {
		state,
		flags: {
			priorityWords: PRIORITY_WORDS_RE.test(proseOnly(`${issue.title}\n${issue.body}`)),
			templateFollowed: parsed.template !== "none" && parsed.requiredMissing.length === 0,
			runnableLinks,
			replInvalid: runnableLinks.length === 0 && parsed.links.some((l) => l.kind === "repl" && !l.ok),
			isPanic: parsed.template === "panic" || Boolean(parsed.sections.panic_message) || PANIC_RE.test(`${issue.title}\n${issue.body}`),
			truncated
		}
	};
}
//#endregion
//#region src/questions/kind.ts
const kindQuestion = choice({
	question: "What is the reporter asking for?",
	focus: "Judge by what they want to happen next, not by the words bug or feature in the title."
}, {
	bug: "Rolldown did something the reporter did not expect: an error, a crash or panic, output that misbehaves, or output that differs from Rollup or the documentation. They want it fixed.",
	feature: "Rolldown behaves as designed, but the reporter wants a new option, API, platform binding, or a change to the intended behavior.",
	question: "The reporter asks how to do something or whether something is supported, and does not assert a defect or request a change.",
	other: "Too little content to tell, or none of the above."
});
//#endregion
//#region src/core/runner.ts
const KIND_KEY = "core:kind";
function selectChecks(all, config) {
	const byId = new Map(all.map((c) => [c.id, c]));
	return config.checks.map((id) => {
		const check = byId.get(id);
		if (!check) throw new Error(`unknown check ${JSON.stringify(id)}; available: ${[...byId.keys()].join(", ")}`);
		return check;
	});
}
function parseIssue(issue) {
	const { sections, headings } = parseSections(issue.body);
	const template = detectTemplate(headings, issue.title);
	const { kind, source } = detectKind(issue, template);
	return {
		template,
		sections,
		requiredMissing: requiredMissing(template, sections),
		links: extractReproLinks(issue.body),
		kind,
		kindSource: source
	};
}
async function runTriage(input) {
	const { issue, config, jev } = input;
	const base = {
		issue: {
			number: issue.number,
			title: issue.title,
			htmlUrl: issue.htmlUrl
		},
		model: null,
		usage: null
	};
	const { kind: kind0, kindSource: kindSource0, ...parsed } = parseIssue(issue);
	const { state, flags } = buildState(issue, parsed, kind0);
	if (!input.force && !issue.labels.includes(config.labels.needsTriage)) return {
		...base,
		kind: kind0,
		kindSource: kindSource0,
		kindConfidence: null,
		flags,
		results: [],
		plan: {
			add: [],
			remove: []
		},
		questionsAsked: 0,
		shortCircuit: "already-triaged"
	};
	const enabled = selectChecks(input.checks, config).filter((c) => modeFor(c, config.modes) !== "off");
	const ctxFor = (check, kind, kindSource, kindConfidence) => ({
		issue,
		parsed,
		state,
		flags,
		kind,
		kindSource,
		kindConfidence,
		config,
		options: {
			...check.defaultOptions,
			...config.options[check.id]
		}
	});
	const merged = {};
	const asked = /* @__PURE__ */ new Map();
	for (const check of enabled) {
		const q = check.questions(ctxFor(check, kind0, kindSource0, null));
		asked.set(check.id, q !== null);
		if (!q) continue;
		for (const [key, question] of Object.entries(q)) {
			if (key.includes(":")) throw new Error(`check ${check.id}: question key ${JSON.stringify(key)} must not contain ':'`);
			merged[`${check.id}:${key}`] = question;
		}
	}
	if (kind0 === "unknown" && [...asked.values()].some(Boolean)) merged[KIND_KEY] = kindQuestion;
	let answers = {};
	let model = null;
	let usage = null;
	const questionsAsked = Object.keys(merged).length;
	if (questionsAsked > 0) {
		const result = await jev.ask(state, merged, config.model);
		answers = result.answers;
		model = result.model;
		usage = result.usage;
	}
	let kind = kind0;
	let kindSource = kindSource0;
	let kindConfidence = null;
	const kindAnswer = answers[KIND_KEY];
	if (kind === "unknown" && kindAnswer?.type === "choice") {
		kind = {
			bug: "bug",
			feature: "feature",
			question: "question",
			other: "unknown"
		}[kindAnswer.choice] ?? "unknown";
		kindSource = "model";
		kindConfidence = kindAnswer.confidence;
	}
	const inputs = enabled.map((check) => ({
		check,
		verdict: check.decide(answersFor(answers, check.id), ctxFor(check, kind, kindSource, kindConfidence))
	}));
	const anyCheck = enabled[0];
	const { results, plan } = anyCheck ? applyPolicy(inputs, ctxFor(anyCheck, kind, kindSource, kindConfidence)) : {
		results: [],
		plan: {
			add: [],
			remove: []
		}
	};
	return {
		...base,
		kind,
		kindSource,
		kindConfidence,
		flags,
		results,
		plan,
		model,
		usage,
		questionsAsked,
		...questionsAsked === 0 && results.every((r) => r.effective === "skipped") ? { shortCircuit: "no-questions" } : {}
	};
}
async function applyReport(report, config, gh, options) {
	if (report.shortCircuit === "already-triaged") return {
		labelsChanged: false,
		skipped: "already-triaged"
	};
	const suggested = report.results.some((r) => r.effective === "suggested" && r.labels.length > 0);
	const acted = report.plan.add.length > 0 || suggested;
	const needed = suggested || report.plan.add.includes(config.labels.needsReproduction);
	const comment = options.commentMode === "always" || options.commentMode === "when-acting" && acted || options.commentMode === "when-needed" && needed ? renderComment(report, config.labels, options.meta) : void 0;
	if (options.dryRun) return {
		labelsChanged: false,
		...comment ? { comment } : {},
		skipped: "dry-run"
	};
	const fresh = await gh.getIssue(report.issue.number);
	if (!options.force && !fresh.labels.includes(config.labels.needsTriage)) return {
		labelsChanged: false,
		skipped: "already-triaged"
	};
	let labelsChanged = false;
	let finalLabels = fresh.labels;
	if (report.plan.add.length > 0 || report.plan.remove.length > 0) {
		finalLabels = fresh.labels.filter((l) => !report.plan.remove.includes(l));
		for (const l of report.plan.add) if (!finalLabels.includes(l)) finalLabels.push(l);
		if (finalLabels.length !== fresh.labels.length || finalLabels.some((l) => !fresh.labels.includes(l))) {
			await gh.setLabels(report.issue.number, finalLabels);
			labelsChanged = true;
		}
	}
	let commentUrl;
	if (comment) {
		const existing = (await gh.listComments(report.issue.number)).find((c) => c.body.includes(MARKER));
		commentUrl = (existing ? await gh.updateComment(existing.id, comment) : await gh.createComment(report.issue.number, comment)).htmlUrl;
	}
	return {
		labelsChanged,
		finalLabels,
		...comment ? { comment } : {},
		...commentUrl ? { commentUrl } : {}
	};
}
//#endregion
//#region src/action.ts
function input(name) {
	return (process.env[`INPUT_${name.replaceAll(" ", "_").toUpperCase()}`] ?? "").trim();
}
function appendTo(envVar, text) {
	const file = process.env[envVar];
	if (file) appendFileSync(file, text.endsWith("\n") ? text : `${text}\n`);
}
function setOutput(name, value) {
	const delimiter = `ghadelim_${Math.random().toString(36).slice(2)}`;
	appendTo("GITHUB_OUTPUT", `${name}<<${delimiter}\n${value}\n${delimiter}`);
}
function isTrue(value) {
	return /^(true|1|yes)$/i.test(value);
}
function priorityOutput(report) {
	for (const r of report.results) {
		const label = r.labels.find((l) => /^p[0-3]/.test(l));
		if (label && (r.effective === "applied" || r.effective === "suggested")) return label;
	}
	return "";
}
async function main() {
	const apiKey = input("typesafe-api-key");
	if (!apiKey) throw new ConfigError("`typesafe-api-key` is required");
	const token = input("token") || (process.env.GITHUB_TOKEN ?? "");
	if (!token) throw new ConfigError("`token` is required");
	const repo = input("repository") || (process.env.GITHUB_REPOSITORY ?? "");
	if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new ConfigError(`\`repository\` must be owner/repo, got ${JSON.stringify(repo)}`);
	const issueNumber = Number.parseInt(input("issue-number"), 10);
	if (!Number.isInteger(issueNumber) || issueNumber <= 0) throw new ConfigError("`issue-number` is required (defaults to the issue of an `issues` event)");
	const dryRun = isTrue(input("dry-run"));
	const config = resolveConfig({
		checks: input("checks"),
		modes: input("modes"),
		options: input("options"),
		labels: input("labels"),
		thresholds: input("thresholds"),
		comment: input("comment"),
		model: input("model")
	});
	const gh = createGitHubClient({
		token,
		repo
	});
	const jev = createTypeSafeJev(apiKey);
	const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : void 0;
	console.log(`::group::rolldown-triager on ${repo}#${issueNumber}${dryRun ? " (dry run)" : ""}`);
	const report = await runTriage({
		issue: await gh.getIssue(issueNumber),
		config,
		jev,
		checks
	});
	for (const r of report.results) console.log(`${r.id}: ${r.effective}${r.labels.length ? ` ${r.labels.join(", ")}` : ""}${r.downgradedBecause.length ? ` (${r.downgradedBecause.join("; ")})` : ""}`);
	console.log(`labels: +[${report.plan.add.join(", ")}] -[${report.plan.remove.join(", ")}]`);
	const outcome = await applyReport(report, config, gh, {
		dryRun,
		commentMode: config.comment,
		...runUrl ? { meta: { runUrl } } : {}
	});
	console.log("::endgroup::");
	if (report.shortCircuit === "already-triaged" || outcome.skipped === "already-triaged") console.log(`::notice::#${issueNumber} no longer carries ${config.labels.needsTriage}; nothing done`);
	else if (outcome.skipped === "dry-run") console.log(`::notice::dry run; would set labels +[${report.plan.add.join(", ")}] -[${report.plan.remove.join(", ")}]`);
	else if (outcome.labelsChanged) console.log(`::notice::labels now [${(outcome.finalLabels ?? []).join(", ")}]`);
	appendTo("GITHUB_STEP_SUMMARY", renderSummary(report, config.labels));
	setOutput("report", JSON.stringify(report));
	setOutput("priority", priorityOutput(report));
	setOutput("needs-reproduction", String(report.results.some((r) => r.labels.includes(config.labels.needsReproduction) && r.effective !== "skipped")));
	setOutput("comment-url", outcome.commentUrl ?? "");
}
main().catch((error) => {
	console.log(`::error::${formatError(error)}`);
	process.exitCode = 1;
});
//#endregion
export {};
