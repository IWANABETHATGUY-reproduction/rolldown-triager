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
        "Could a maintainer start investigating this from what the report already contains, without the reporter supplying anything further?",
      focus:
        "Judge `issue.sections`. Ask whether the report carries its own evidence, not whether that evidence is a set of steps.",
    },
    {
      true: {
        what: "The report quotes or links the thing that is wrong, so a maintainer can go straight to it: conflicting type or API declarations, published package metadata, a named test or file in this project, a linked CI run of this project, or a panic pointing at a specific source location.",
        examples: [
          "quotes the two type declarations that are incompatible",
          "links the published package.json that is missing a field",
          "names the failing test in this repository and the run that failed",
        ],
      },
      false: {
        what: "The evidence is a symptom inside the reporter's own project, so a maintainer has nothing of their own to look at until the reporter provides more.",
        not_for:
          "A stack trace from the reporter's bundle, a version matrix, or a description of their app is not evidence a maintainer can start from.",
        examples: [
          "our SSR build 500s, here is the stack from our own output",
          "our CI crashes about one build in ten",
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
