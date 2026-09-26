import type { Issue } from "./types.ts";

// A fetch-only client for the handful of endpoints the bot needs. Keeping this
// dependency-free keeps the committed `dist/` small enough to review.

export interface IssueComment {
  id: number;
  body: string;
  htmlUrl: string;
}

export interface ListedIssue extends Issue {
  createdAt: string;
  state: "open" | "closed";
}

export interface IssueClient {
  getIssue(number: number): Promise<Issue>;
  listComments(number: number): Promise<IssueComment[]>;
  createComment(number: number, body: string): Promise<IssueComment>;
  updateComment(id: number, body: string): Promise<IssueComment>;
  /** Replaces the label set in one call, so add+remove is atomic. */
  setLabels(number: number, labels: string[]): Promise<void>;
  /** Issues (never PRs) carrying `label`, newest first; `since` filters on updated_at. */
  listIssues(query: {
    label: string;
    since?: string | undefined;
    limit: number;
  }): Promise<ListedIssue[]>;
  /** Names of every label ever added to the issue, from its event timeline. */
  listLabelsEverAdded(number: number): Promise<string[]>;
}

export class GitHubError extends Error {
  override name = "GitHubError";
  readonly status: number;
  readonly method: string;
  readonly path: string;
  constructor(status: number, method: string, path: string, message: string) {
    super(`${method} ${path} → ${status}: ${message}`);
    this.status = status;
    this.method = method;
    this.path = path;
  }
}

export interface GitHubClientOptions {
  token: string;
  /** `owner/repo` */
  repo: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  userAgent?: string;
}

interface RawLabel {
  name: string;
}
interface RawIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  labels: (RawLabel | string)[];
  type?: { name?: string } | null;
  author_association?: string | null;
  pull_request?: unknown;
}
interface RawListedIssue extends RawIssue {
  created_at: string;
  state: "open" | "closed";
}
interface RawEvent {
  event: string;
  label?: { name?: string } | null;
}
interface RawComment {
  id: number;
  body: string | null;
  html_url: string;
}

export function createGitHubClient(options: GitHubClientOptions): IssueClient {
  const baseUrl = (options.baseUrl ?? "https://api.github.com").replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;
  const issuesPath = `/repos/${options.repo}/issues`;

  async function request<T>(
    method: "GET" | "POST" | "PATCH" | "PUT",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await doFetch(`${baseUrl}${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${options.token}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": options.userAgent ?? "rolldown-triager",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      let message = text;
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? text;
      } catch {
        // plain-text error body
      }
      throw new GitHubError(response.status, method, path, message.slice(0, 300));
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  const toComment = (c: RawComment): IssueComment => ({
    id: c.id,
    body: c.body ?? "",
    htmlUrl: c.html_url,
  });
  const toIssue = (raw: RawIssue): Issue => ({
    number: raw.number,
    title: raw.title,
    body: raw.body ?? "",
    typeName: raw.type?.name ?? null,
    labels: raw.labels.map((l) => (typeof l === "string" ? l : l.name)),
    htmlUrl: raw.html_url,
    authorAssociation: raw.author_association ?? null,
  });

  return {
    async getIssue(number) {
      const raw = await request<RawIssue>("GET", `${issuesPath}/${number}`);
      if (raw.pull_request) throw new Error(`#${number} is a pull request, not an issue`);
      return toIssue(raw);
    },
    async listComments(number) {
      const comments: IssueComment[] = [];
      for (let page = 1; page < 50; page++) {
        const batch = await request<RawComment[]>(
          "GET",
          `${issuesPath}/${number}/comments?per_page=100&page=${page}`,
        );
        comments.push(...batch.map(toComment));
        if (batch.length < 100) break;
      }
      return comments;
    },
    async createComment(number, body) {
      return toComment(
        await request<RawComment>("POST", `${issuesPath}/${number}/comments`, { body }),
      );
    },
    async updateComment(id, body) {
      return toComment(
        await request<RawComment>("PATCH", `${issuesPath}/comments/${id}`, { body }),
      );
    },
    async setLabels(number, labels) {
      await request<unknown>("PUT", `${issuesPath}/${number}/labels`, { labels });
    },
    async listIssues({ label, since, limit }) {
      const out: ListedIssue[] = [];
      for (let page = 1; out.length < limit && page < 50; page++) {
        const params = new URLSearchParams({
          state: "all",
          labels: label,
          per_page: "100",
          page: String(page),
        });
        if (since) params.set("since", since);
        const batch = await request<RawListedIssue[]>("GET", `${issuesPath}?${params}`);
        for (const raw of batch) {
          if (raw.pull_request) continue;
          out.push({ ...toIssue(raw), createdAt: raw.created_at, state: raw.state });
          if (out.length >= limit) break;
        }
        if (batch.length < 100) break;
      }
      return out;
    },
    async listLabelsEverAdded(number) {
      const names = new Set<string>();
      for (let page = 1; page < 20; page++) {
        const batch = await request<RawEvent[]>(
          "GET",
          `${issuesPath}/${number}/events?per_page=100&page=${page}`,
        );
        for (const e of batch) if (e.event === "labeled" && e.label?.name) names.add(e.label.name);
        if (batch.length < 100) break;
      }
      return [...names];
    },
  };
}
