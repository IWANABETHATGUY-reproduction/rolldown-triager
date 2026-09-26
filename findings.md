Found **12 actionable issues** across the project. The first two risk overwriting human contributions.

**Status (v0.8.0, 2026-09-26):** all twelve reproduced against the source; ten fixed outright, two fixed in part
(#8 by deliberate choice, #11 leaving the staleness half open). Re-measured afterwards: reproduction holds precision 1.00 / recall 1.00 on the
100-issue set, the 40-panic benchmark moved 52%→55% exact at unchanged coverage, 144 tests pass.

1. ✅ **[P1] Comment updates do not verify ownership** — [runner.ts:250](/Users/victor/Documents/rolldown-rs/rolldown-triager/src/core/runner.ts:250)
   Any comment containing `<!-- rolldown-triager -->` becomes the update target, including a reporter quoting an earlier report. I reproduced selection of a reporter’s comment for replacement. Preserve comment author information and require the expected bot identity alongside the marker.
   **Fixed** — the comment must start with the marker (a quote is prefixed `> `) and a Bot author is preferred. `IssueComment` now carries `authorLogin`/`authorIsBot`. Residual: with a non-Bot token and no prior bot comment, a pasted marker at position 0 could still be selected.

2. ✅ **[P1] Replacing all labels can erase concurrent changes** — [runner.ts:243](/Users/victor/Documents/rolldown-rs/rolldown-triager/src/core/runner.ts:243)
   A label added after the final GET disappears when `setLabels` submits its older snapshot; removed labels can similarly return. GitHub’s PUT endpoint [replaces the entire label set](https://docs.github.com/en/rest/issues/labels#set-labels-for-an-issue). Use targeted additions and remove only `needs-triage`.
   **Fixed** — `setLabels` replaced by `addLabels` (POST) and `removeLabel` (DELETE); the whole-set PUT is gone, so concurrent edits survive.

3. ✅ **[P2] The final reread ignores newly assigned priorities** — [runner.ts:229](/Users/victor/Documents/rolldown-rs/rolldown-triager/src/core/runner.ts:229)
   If a maintainer adds `p1` during inference while `needs-triage` remains, the original `p2` plan still applies. My reproduction ended with both priorities. Reevaluate the existing-priority rule against the fresh issue before applying the plan.
   **Fixed** — the existing-priority rule is re-evaluated against the fresh read; a priority added during inference now suppresses ours instead of joining it.

4. ✅ **[P2] Short features and tasks receive `needs-reproduction`** — [reproduction.ts:77](/Users/victor/Documents/rolldown-rs/rolldown-triager/src/checks/reproduction.ts:77)
   The empty-report shortcut runs before the kind exclusions. Both a native `Task` and `Feature` containing “Add support for custom extensions.” received the label under default configuration. Check excluded kinds first; returning `null` from `questions()` currently does not prevent `decide()` from running.
   **Fixed** — the kind switch runs before the empty-report rule, so features, tasks and questions are skipped first.

5. ✅ **[P2] Some priority branches bypass the self-prioritization guard** — [priority.ts:160](/Users/victor/Documents/rolldown-rs/rolldown-triager/src/checks/priority.ts:160)
   Panic fallback and invalid-input branches return before checking `argues_priority`; the feature branch omits that guard altogether. With `priority=apply`, an explicitly “P0 urgent blocker” report still automatically received a fallback `p1`. Apply this invariant after branch selection.
   **Fixed** — the guard moved out of the branches into the `decide` wrapper, so the panic invalid-input path, the panic fallback and the feature branch all reach it.

6. ✅ **[P2] REPL metadata injects arbitrary content into bot comments** — [repl.ts:81](/Users/victor/Documents/rolldown-rs/rolldown-triager/src/core/repl.ts:81)
   The URL payload’s unrestricted `v` field flows through the reproduction note into rendered comments. I reproduced injected new paragraphs and an `@mention`. Validate and cap the version, and escape untrusted content before rendering Markdown.
   **Fixed** — `cleanVersion` strips everything outside `[\w.+-]` and caps at 24 characters before the version reaches a note. Note the severity was lower than written: since v0.3.0 `comment` defaults to `never`, so it reached the job summary rather than an issue comment.

7. ✅ **[P2] REPL decompression happens without an output bound** — [repl.ts:43](/Users/victor/Documents/rolldown-rs/rolldown-triager/src/core/repl.ts:43)
   Attacker-controlled compressed data expands before sanitization or state limits apply. A roughly 11 KB URL expanded into an accepted 8 MiB file in a bounded probe. Set [`maxOutputLength`](https://nodejs.org/api/zlib.html) and reject oversized decoded payloads before parsing and processing them.
   **Fixed** — `inflateSync` is called with `maxOutputLength: 2 MiB`; an oversized payload is refused as undecodable rather than expanded.

8. 🟡 **[P2] Non-reproduction URLs bypass reproduction assessment** — [links.ts:66](/Users/victor/Documents/rolldown-rs/rolldown-triager/src/core/links.ts:66)
   `https://codesandbox.io/pricing` and bare `https://vite.new` both count as runnable reproductions and suppress model assessment. The latter [opens a starter template](https://vite.new/). Require project-specific paths and distinguish starter/reference links from supplied reproductions.
   **Fixed in part** — CodeSandbox now requires a project path (`/s/`, `/p/`, `/embed/`, `/devbox/`, `/sandbox/`), so `codesandbox.io/pricing` no longer counts. A bare `vite.new` is **deliberately still accepted**: for rolldown#10938 opening it *is* the reproduction, and rejecting it would regress a recorded fixture. (Bare `stackblitz.com` was already rejected before this review.)

9. ✅ **[P2] Comment failures cannot recover through ordinary reruns** — [runner.ts:243](/Users/victor/Documents/rolldown-rs/rolldown-triager/src/core/runner.ts:243)
   Labels—including removal of `needs-triage`—are committed before comment delivery. If posting fails, rerunning immediately returns `already-triaged`, leaving the required comment missing. I reproduced this with a simulated API failure. Keep incomplete comment delivery retryable.
   **Fixed** — the comment is written before any label mutation, so a comment failure leaves `needs-triage` in place and a rerun retries it.

10. ✅ **[P2] Custom priority names break outputs and reporting** — [action.ts:36](/Users/victor/Documents/rolldown-rs/rolldown-triager/src/action.ts:36)
    Priority detection assumes names start with `p0`–`p3`. Mapping `p2` to `severity: medium` produced an empty `priority` output despite a valid decision. Evaluation repeats this assumption, and comment rendering uses another prefix heuristic. Identify priorities through configured slots instead.
    **Fixed** — all three real sites (`action.ts`, `comment.ts`, `eval.ts`) match against configured label names. `priority.ts:270` needed no change: it matches `LabelSlot` values, not configured names.

11. 🟡 **[P2] Evaluation caches reuse stale or unrelated label histories** — [eval.ts:69](/Users/victor/Documents/rolldown-rs/rolldown-triager/src/eval/eval.ts:69)
    Event caches use only issue numbers and never refresh. Evaluating another repository with the same issue number reused the first repository’s `needs-reproduction` history without fetching events. Namespace by repository and invalidate histories when issues change.
    **Fixed in part** — the event cache directory is namespaced by repository, so histories no longer leak
    between repos. The second half is **not** done: a cached history is still never refreshed, so an issue
    that gains `needs-reproduction` after it was cached keeps the old answer until `.cache` is cleared.
    Low impact — the cache is a local eval aid, not used in triage — but it is a real staleness bug.

12. ✅ **[P3] Deterministic empty-report decisions still require the model** — [reproduction.ts:61](/Users/victor/Documents/rolldown-rs/rolldown-triager/src/checks/reproduction.ts:61)
    A known bug with an empty body still asks all four reproduction questions, although `decide()` ignores their answers. This adds cost and makes an otherwise deterministic decision fail during model outages. Return `{}` for this case.
    **Fixed** — `questions()` returns `{}` for an empty report, so nothing is asked and the verdict no longer depends on the model being reachable.

Original validation (pre-fix): **131 tests passed**, plus typechecking, linting, and committed-bundle verification. Targeted offline probes reproduced the cases above. No project changes or live triage writes were made.
