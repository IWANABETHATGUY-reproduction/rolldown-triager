import { describe, expect, it } from "vitest";

import { createGitHubClient, GitHubError } from "../src/core/github.ts";

interface Call {
  method: string;
  url: string;
  body?: unknown;
}

function fakeFetch(routes: Record<string, (call: Call) => { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const call: Call = {
      method: init?.method ?? "GET",
      url,
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    };
    calls.push(call);
    const key = `${call.method} ${new URL(url).pathname}${new URL(url).search}`;
    const route = routes[key] ?? routes[`${call.method} ${new URL(url).pathname}`];
    if (!route) return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    const { status = 200, body } = route(call);
    return new Response(body === undefined ? "" : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("createGitHubClient", () => {
  it("maps an issue, reading the native type and label names", async () => {
    const { calls, fetchImpl } = fakeFetch({
      "GET /repos/o/r/issues/5": () => ({
        body: {
          number: 5,
          title: "t",
          body: null,
          html_url: "u",
          labels: [{ name: "needs-triage" }, "extra"],
          type: { name: "Bug" },
        },
      }),
    });
    const gh = createGitHubClient({ token: "tok", repo: "o/r", fetch: fetchImpl });
    expect(await gh.getIssue(5)).toEqual({
      number: 5,
      title: "t",
      body: "",
      typeName: "Bug",
      labels: ["needs-triage", "extra"],
      htmlUrl: "u",
      authorAssociation: null,
    });
    expect(calls[0]?.method).toBe("GET");
  });

  it("refuses pull requests", async () => {
    const { fetchImpl } = fakeFetch({
      "GET /repos/o/r/issues/5": () => ({
        body: { number: 5, title: "t", html_url: "u", labels: [], pull_request: {} },
      }),
    });
    await expect(
      createGitHubClient({ token: "t", repo: "o/r", fetch: fetchImpl }).getIssue(5),
    ).rejects.toThrow("pull request");
  });

  it("paginates comments and upserts", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      body: `c${i}`,
      html_url: `h${i}`,
    }));
    const { calls, fetchImpl } = fakeFetch({
      "GET /repos/o/r/issues/5/comments?per_page=100&page=1": () => ({ body: page1 }),
      "GET /repos/o/r/issues/5/comments?per_page=100&page=2": () => ({
        body: [{ id: 100, body: "last", html_url: "h100" }],
      }),
      "POST /repos/o/r/issues/5/comments": (c) => ({
        status: 201,
        body: { id: 9, body: (c.body as { body: string }).body, html_url: "new" },
      }),
      "PATCH /repos/o/r/issues/comments/9": (c) => ({
        body: { id: 9, body: (c.body as { body: string }).body, html_url: "edited" },
      }),
    });
    const gh = createGitHubClient({ token: "t", repo: "o/r", fetch: fetchImpl });
    expect(await gh.listComments(5)).toHaveLength(101);
    expect(await gh.createComment(5, "hi")).toEqual({ id: 9, body: "hi", htmlUrl: "new" });
    expect(await gh.updateComment(9, "hi2")).toEqual({ id: 9, body: "hi2", htmlUrl: "edited" });
    expect(calls.at(-1)).toMatchObject({ method: "PATCH", body: { body: "hi2" } });
  });

  it("sets labels with one PUT", async () => {
    const { calls, fetchImpl } = fakeFetch({
      "PUT /repos/o/r/issues/5/labels": () => ({ body: [] }),
    });
    await createGitHubClient({ token: "t", repo: "o/r", fetch: fetchImpl }).setLabels(5, [
      "a",
      "b",
    ]);
    expect(calls[0]).toMatchObject({ method: "PUT", body: { labels: ["a", "b"] } });
  });

  it("throws a GitHubError with the API message", async () => {
    const { fetchImpl } = fakeFetch({
      "GET /repos/o/r/issues/5": () => ({
        status: 403,
        body: { message: "Resource not accessible by integration" },
      }),
    });
    const err = await createGitHubClient({ token: "t", repo: "o/r", fetch: fetchImpl })
      .getIssue(5)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect((err as GitHubError).status).toBe(403);
    expect((err as Error).message).toContain("Resource not accessible");
  });
});
