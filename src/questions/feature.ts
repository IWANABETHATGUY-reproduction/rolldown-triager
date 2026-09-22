import { noul, score } from "@typesafe-ai/sdk";

// The feature branch of `.github/issue-workflow.md`. "Blocks frameworks using
// Vite to try rolldown-vite" is only inferable when the reporter names the
// blocked project, so that is what is asked.

export const featureQuestions = {
  framework_need: noul(
    {
      question:
        "Does the reporter say a specific framework, meta-framework, or Vite plugin needs this in order to run on Vite with Rolldown?",
      focus: "Whether a blocked project is named in `issue.sections` (usually `problem`).",
    },
    {
      true: {
        what: "The reporter maintains or names a framework or plugin (Nuxt, SvelteKit, Astro, Angular, Remix, a vite-plugin-*) and says it cannot adopt rolldown-vite without this.",
        examples: [
          "vite-plugin-x needs this hook to support rolldown-vite",
          "SvelteKit relies on this Rollup option",
        ],
      },
      false: {
        what: "A request from an application project, a general nice-to-have, or Rollup parity with no blocked project named.",
        not_for: "Mentioning that Vite exists is not enough; a blocked project must be named.",
      },
    },
  ),

  usefulness: score(
    {
      question: "Who would use this feature?",
      focus:
        "The situation in `issue.sections.problem` and how general the API in `issue.sections.proposed_api` is.",
    },
    [
      "Serves one project's particular setup or an uncommon workflow; most users would never touch it.",
      "Serves a recognizable group: users of a particular framework, platform, output format, or plugin ecosystem, or people migrating from Rollup or another bundler.",
      "Would be used in most builds: defaults, the CLI or config surface most projects use, the plugin hooks most plugins use, or something users rely on today in Rollup or Vite.",
    ],
  ),
};

export const FEATURE_EVIDENCE_LABELS: Record<keyof typeof featureQuestions, string> = {
  framework_need: "named framework blocked",
  usefulness: "usefulness",
};
