import { noul, score } from "@typesafe-ai/sdk";

// Only asked when no runnable link was found in code. Levels describe
// situations, adapted from TypeSafe's `report_quality` rubric.

export const reproQuestions = {
  repro_quality: score(
    {
      question:
        "How completely does the report let a maintainer reproduce the problem without guessing?",
      focus:
        "Judge only what is written in `issue.sections` (usually `reproduction` together with `actual`). Links to documentation, other issues, screenshots, or CI logs are evidence but are not steps.",
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
