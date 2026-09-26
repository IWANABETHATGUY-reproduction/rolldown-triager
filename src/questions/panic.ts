import { noul, score } from "@typesafe-ai/sdk";

// Asked instead of `via_vite`/`regression` when the report is a crash.
//
// Measured on the 40 panic issues rolldown has prioritised: what separates p1
// from p3 is not how violent the crash is — they all abort the build — but how
// ordinary the conditions are that reach it. The general bug tree sends every
// panic through `via_vite`, which reads low for CLI, plugin and dev-engine
// crashes, so 21 of 31 decisions collapsed onto p2 and p3 was unreachable.

export const panicQuestions = {
  panic_invalid_input: noul(
    {
      question:
        "Did Rolldown crash while rejecting something the reporter supplied — a malformed pattern, an unsupported option value, a path it cannot accept — where printing a clear error instead of crashing would be the whole fix?",
      focus: "`issue.sections.panic_message` together with `reproduction` and `actual`.",
    },
    {
      true: {
        what: "The crash message names the offending input and says what would have been valid; the build was going to fail either way, and only the presentation is wrong.",
        examples: [
          "Invalid glob pattern: *.js, it must start with '/' or './'",
          "In virtual modules, all globs must start with '/'",
        ],
      },
      false: {
        what: "The input was valid and Rolldown failed on its own: an internal invariant, an index out of bounds, an unreachable branch, a symbol or entry it could not resolve, a segfault.",
        not_for:
          "An internal assertion that happens to mention a user file is not the reporter supplying something invalid.",
      },
    },
  ),

  panic_reach: score(
    {
      question: "How ordinary are the conditions needed to reach this crash?",
      focus:
        "Judge the setup described in `issue.sections`: the options, platform, host, packages and steps required before it happens. Ignore how severe the crash itself is.",
    },
    [
      "Needs a specific operating system feature, CI provider, package manager, hosting sandbox, or a flag the docs mark experimental or opt-in.",
      "Needs a named third-party package, an unusual character or syntax, or a precise sequence of actions such as interrupting a watch build at the right moment.",
      "Needs a documented option or a recognisable code pattern, in an otherwise ordinary build.",
      "Happens in an ordinary build with common options and ordinary code, with nothing unusual required to reach it.",
    ],
  ),
};

export const PANIC_EVIDENCE_LABELS: Record<keyof typeof panicQuestions, string> = {
  panic_invalid_input: "invalid input",
  panic_reach: "reach",
};
