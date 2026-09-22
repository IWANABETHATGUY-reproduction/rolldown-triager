# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A GitHub Action (plus a local CLI over the same core) that triages new rolldown issues with TypeSafe's Jev
model: one batched request per issue, code decides, one comment, labels applied under strict invariants.
README.md has the user-facing description and the measured accuracy; this file is about working in the code.

## Commands

```
pnpm install                       # pnpm 10 via corepack (packageManager field)
pnpm lint                          # oxlint + oxfmt --check   (pnpm fmt fixes both)
pnpm typecheck                     # tsgo --noEmit; erasableSyntaxOnly is on (see below)
pnpm test                          # vitest, fully offline (recorded answers in test/fixtures/answers)
pnpm test -- test/priority.test.ts # one file;  pnpm test -- -t "unsure band"  for one test name
pnpm build                         # node build.ts → dist/index.js (rolldown, everything bundled but node builtins)
pnpm check:dist                    # build + git diff --exit-code -- dist   (CI runs this; commit dist/)
pnpm cli state|run|record|eval ... # loads .env (JEV_KEY or TYPESAFE_API_KEY); GitHub token from gh auth
```

`pnpm cli run --issue N` is a dry run and forces the run even without `needs-triage`; `--apply` writes for
real and then respects the label. Only `record` and `eval` (first time) spend Jev tokens; both are cheap.

## Architecture

**One request per issue.** `src/core/runner.ts` collects `questions(ctx)` from every enabled check, prefixes
keys with `${check.id}:`, adds `core:kind` only when the issue kind is unknown, and makes a single
`systemOne` call. Extra questions are nearly free and answers are independent, so checks never need a
second round trip. Each check then gets `answersFor(id)` — its own keys, prefix stripped — and returns a
`Verdict` of label _slots_ (`p2`, `needsReproduction`), never label names.

**Checks are the extension seam** (`src/core/types.ts` `Check`, `src/checks/`). A check is `questions(ctx)`

- `decide(answers, ctx)`; it knows nothing about other checks, modes, or label names. `questions` returning
  `null` means "not applicable", `{}` means "decide without the model" (reproduction does this when a runnable
  link was found in code). Question text lives in `src/questions/` and is shared (has-workaround reuses
  `bugQuestions.workaround`).

**Every invariant is in `src/core/policy.ts`** — never p0, `p*` ⇒ remove `needs-triage`, only
`needs-triage` is ever removed, existing `p*` ⇒ suggest, gating check `fail`/`unsure` ⇒ everyone else
suggest, model-guessed kind with low confidence ⇒ suggest, `forceSuggest` from a check ⇒ suggest, per-check
`mode`. Add a rule there, not in a check.

**Deterministic first, model second.** `parse.ts` (form sections from `### ` headings, template detection,
required fields), `links.ts` (repro links by host; REPL hashes decoded by `repl.ts`, a port of the
`rolldown-repl` skill decoder), `detectKind` (native issue `type` › template › title prefix) all run before
any question is written. `sanitize.ts` + `state.ts` build the _only_ thing Jev sees: title, kind, template,
capped sections. Labels, author, comments, dates, and the link list are never sent — Jev's accuracy drops
with irrelevant state, and issue bodies are attacker-controlled (a report saying "P0 blocker" only trips
`argues_priority`, which forces suggest).

**Kind resolution.** When kind is unknown, priority asks both branches and reproduction asks its rubric;
`decide` uses the kind the model settled on. Still one request.

**Recorded answers.** `createRecordedJev` keys recordings by `requestHash(state, questions, model)`. Any
change to sanitizing, question text, or the model invalidates them on purpose: tests throw `FixtureStale`
until you run `pnpm cli record --issue <n>` for the 12 fixtures in `test/fixtures/issues`. The eval cache in
`.cache/eval` works the same way, so threshold and decision-code changes re-evaluate offline for free.

**Priority mapping is empirical.** `checks/priority.ts` `decideBug` is `.github/issue-workflow.md` adjusted to
what maintainers actually label (numbers in README and in `DEFAULT_MODES`' comment). If you change it, run
`pnpm cli eval --since 2026-03-01` and update both.

## Things that bite

- Node runs `src/**/*.ts` with type stripping, so no enums, namespaces, or constructor parameter properties
  (`erasableSyntaxOnly` makes typecheck catch it); imports use `.ts` extensions.
- `dist/index.js` is what the Action executes. Rebuild and commit it with any source change.
- The consumer workflow triggers on `labeled` == `needs-triage`, not `opened` (templates add the label ~1 s
  after creation, so `opened` double-fires; re-adding the label is the re-run mechanism).
- `GITHUB_TOKEN` writes don't trigger rolldown's other workflows; the comment text therefore includes the
  repro request itself, and must never contain ``Issues marked with `needs-reproduction` `` (rolldown's
  comment bot greps for it and would overwrite ours).
- `test/fixtures/**` is excluded from oxfmt; recordings stay byte-for-byte as captured.
- Question keys must not contain `:`; the runner uses it as the namespace separator and the API accepts it.
