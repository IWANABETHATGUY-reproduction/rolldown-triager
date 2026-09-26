import { noul, score } from "@typesafe-ai/sdk";

// Only asked when no runnable link was found in code.
//
// `runnable` is the axis the label actually depends on, and it is deliberately
// not a quality judgement: a report can be long, precise and well argued and
// still leave a maintainer with nothing to run. Measured on 100 issues, the
// old prose-completeness rubric alone scored such reports 2.0-2.6 out of 3 and
// never reached the label. `repro_quality` is kept as the second axis, for how
// much detail exists at all, and only decides where `runnable` is uncertain.

export const reproQuestions = {
  runnable: noul(
    {
      question:
        "Using only what this report itself contains, could a maintainer run the problem and see it happen, without writing code from a description, supplying their own project, or rebuilding a setup that is only described in prose?",
      focus:
        "Judge `issue.sections`, usually `reproduction` with `actual`. Ask what a maintainer would have to supply themselves before anything could run.",
    },
    {
      true: {
        what: "Everything needed is present: the input files or config plus the command or steps to run them, or a snippet small enough to paste and run as-is.",
        examples: [
          "two files and a build script, then `node build.mjs`",
          "an npx command against an inline source file",
          "numbered steps over a named public package a maintainer can install",
        ],
      },
      false: {
        what: "Running it would need the reporter's own application, a project of a size or shape only described, a machine, host or account the maintainer does not have, or code the maintainer would have to write from the description.",
        not_for:
          "Length, precision, a root-cause analysis, stack traces, log excerpts, version matrices, links to other issues or CI runs, and correct technical detail do not make the answer yes. A well-written report with nothing to run is still no.",
        examples: [
          "reproduces in our large internal app, which I cannot publish",
          "happens on our CI runners, roughly one build in ten",
          "take a medium-to-large SPA and compare the chunk counts",
        ],
      },
    },
  ),

  self_evident: noul(
    {
      question:
        "Does this report contain enough for a maintainer to both find the defect and know what the correct behaviour should be, without going back to the reporter?",
      focus:
        "Judge `issue.sections`. Ask whether a maintainer could write the fix *and* a test asserting the right result, from what is written here.",
    },
    {
      true: {
        what: "The report carries the answer as well as the fault: declarations that contradict each other so the correct one is visible, published metadata measured against a documented requirement, a named failing test in this project that already asserts the expected result, or a linked run of this project's own CI.",
        examples: [
          "quotes the two type declarations that are incompatible, and the one rollup ships",
          "links the published package.json and names the field the spec requires",
          "names the failing test in this repository and the run that failed",
        ],
      },
      false: {
        what: "The report localises the fault but leaves the intended behaviour open, or the evidence is a symptom inside the reporter's own project.",
        not_for:
          "A crash location is not enough on its own. A panic naming a file and line says where execution stopped, not whether the input should have been accepted — the fix could be to reject it cleanly or to support it, and nothing here decides which.",
        examples: [
          "panicked at src/utils.rs:397, invalid glob pattern '*.js'",
          "our SSR build 500s, here is the stack from our own output",
        ],
      },
    },
  ),

  repro_quality: score(
    {
      question:
        "How much of what a maintainer needs in order to run this is written down in the report?",
      focus:
        "Judge only what is written in `issue.sections`. Links to documentation, other issues, screenshots, or CI logs are evidence but are not steps.",
    },
    [
      "Only says something is broken or pastes an error, with no code, no steps, and no description of the project setup.",
      "Names the feature, option, or error and describes the project loosely, but gives no code and no steps a maintainer could follow.",
      "Gives either concrete steps or a code sample or config, but a maintainer would still have to guess the rest to run it.",
      "Gives everything needed to run it: the input code or config plus the command or steps, or a self-contained snippet with the observed and expected output, so a maintainer can reproduce it without guessing.",
    ],
  ),

  explains_no_repro: noul(
    {
      question:
        "Does the reporter give a concrete reason why a minimal reproduction link cannot be provided, and describe the environment where it occurs instead?",
      focus: "`issue.sections.reproduction` and `issue.sections.additional`.",
    },
    {
      true: {
        what: "Names a constraint the REPL or StackBlitz cannot express (a specific OS, CI runner, container CPU limit, private code, nondeterminism, a native binding) and gives enough environment detail to try it elsewhere.",
        examples: [
          "needs a Linux cgroup CPU limit, so here is a Docker setup",
          "only with Windows paths; the REPL runs on Linux",
        ],
      },
      false: {
        what: "No reason is given, the reason is lack of time, or the reporter asks the maintainers to reproduce it from the description.",
        not_for: 'A vague "it happens in my large project" is not a concrete reason.',
      },
    },
  ),
};
