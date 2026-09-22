import { noul } from "@typesafe-ai/sdk";

// The bug branch of rolldown's `.github/issue-workflow.md`, decomposed into
// observable outcomes. Every question is a single condition phrased so that a
// high value means yes; none asks for a judgment of urgency, so a report that
// calls itself "P0" answers nothing here. `argues_priority` catches exactly that.

export const bugQuestions = {
  broken: noul(
    {
      question:
        "Does the report describe a build or dev server that cannot be used: the process crashes or panics, the build exits with an error, it never finishes, or the emitted output throws, hangs, fails to load, or differs between identical builds?",
      focus:
        "Judge only the observed outcome described in `issue.sections` (usually `actual`, `panic_message` and `reproduction`).",
    },
    {
      true: {
        what: "The build does not complete, or the produced bundle does not run correctly: a runtime error, a hang, a blank page, wrong execution order, a missing export at runtime, or output that changes between identical builds.",
        examples: [
          "vite build exits with UNRESOLVED_ENTRY",
          "Rolldown panicked",
          "the app never mounts and the console shows init_x is not a function",
          "the same input produces different chunk names on every build",
        ],
      },
      false: {
        what: "The build completes and the output runs; what is wrong is secondary: bundle size, speed, sourcemaps, warnings, type declarations, formatting, or a missed optimization.",
        not_for:
          "The reporter calling it critical, urgent, blocking or P0 does not make the answer yes.",
        examples: [
          "minify sourcemap has an empty names array",
          "no tree-shaking after a guaranteed throw",
          "RenderedChunk is not assignable to PreRenderedChunk",
        ],
      },
    },
  ),

  mainstream: noul(
    {
      question:
        "Would this happen in a typical project using default options, a common framework, and ordinary code, rather than needing a specific option, plugin, platform, environment, or unusual code pattern?",
      focus:
        "Look at what the reporter had to configure or write to hit it: options and code in `issue.sections.reproduction`, the environment in `issue.sections.system_info`.",
    },
    {
      true: {
        what: "Default or very common configuration, a mainstream OS and Node version, and ordinary import/export code. Anyone running a normal build could hit it.",
        examples: [
          "every build on the WASI binding",
          "any project with code splitting enabled",
          "plain ESM imports of a popular package",
        ],
      },
      false: {
        what: "Needs a particular option (advancedChunks groups, strictExecutionOrder, preserveModules), a specific plugin, a rare platform or container setup, a Windows-only path form, or an unusual code pattern (direct eval, webpack-style module registries, top-level-await cycles).",
        not_for:
          "A small reproduction is still ordinary code; do not answer no because the example is minimal.",
      },
    },
  ),

  via_vite: noul(
    {
      question:
        "Is the reporter running Rolldown through Vite (vite build, vite dev, vite.config, a Vite plugin, Vitest, rolldown-vite, or a Vite-based framework) rather than the rolldown CLI, the rolldown API, or tsdown?",
      focus: "Commands, config file names and package names anywhere in `issue.sections`.",
    },
    {
      true: {
        what: "Mentions vite build, vite dev, vite.config, a Vite plugin, Vitest, Nuxt, SvelteKit, Astro, or another Vite-based framework as the way Rolldown is invoked.",
      },
      false: {
        what: "Uses rolldown.config, the rolldown CLI or JS API, tsdown, or does not say.",
        not_for: "Comparing output against Rollup or esbuild is not using Vite.",
      },
    },
  ),

  workaround: noul(
    {
      question:
        "Does the reporter state a way to avoid the problem, such as changing an option, restructuring code, pinning a version, or using a different setting?",
      focus: "Only what is written in `issue.sections`. Do not invent workarounds.",
    },
    {
      true: {
        what: "A concrete workaround is described, even if the reporter finds it inconvenient.",
        examples: [
          "setting output.codeSplitting: false avoids it",
          "works if I disable the plugin",
          "downgrading to 1.2.0 fixes it",
        ],
      },
      false: {
        what: "No way around it is given, or the reporter says they tried things and nothing helped.",
        not_for: "A different bundler working is not a workaround for Rolldown.",
      },
    },
  ),

  regression: noul(
    {
      question:
        "Does the reporter say this worked in an earlier version of Rolldown or Vite and stopped working in a newer one?",
      focus: "Explicit version comparisons anywhere in `issue.sections`.",
    },
    {
      true: {
        what: "Names or clearly implies a version that worked and a version that fails.",
        examples: ["1.2.8 was fine, 1.2.9 errors", "regression since the last release"],
      },
      false: {
        what: "No earlier working version is mentioned, or the reporter says it never worked, or only compares against Rollup.",
        not_for: "Rollup or esbuild behaving differently is not a regression.",
      },
    },
  ),

  argues_priority: noul(
    {
      question:
        "Does the reporter argue for how the issue should be prioritized or labeled, rather than only describing what happens?",
      focus:
        "Statements about urgency, importance, blocking status, or which label or priority the issue deserves.",
    },
    {
      true: {
        what: "Text such as: this is a P0, urgent, critical, blocker, must fix before release, please prioritize, affects everyone.",
        not_for: "Plainly stating consequences, like the build fails, is not arguing.",
      },
      false: {
        what: "Describes behavior and impact without asking for a priority.",
      },
    },
  ),
};

/** Short labels for the comment, in the order the decision tree consults them. */
export const BUG_EVIDENCE_LABELS: Record<keyof typeof bugQuestions, string> = {
  broken: "unusable",
  via_vite: "via vite",
  regression: "regression",
  mainstream: "common setup",
  workaround: "workaround",
  argues_priority: "argues priority",
};
