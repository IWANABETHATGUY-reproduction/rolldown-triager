import { choice } from "@typesafe-ai/sdk";

// Only asked when the native issue type, the template and the title all fail
// to say what the issue is.
export const kindQuestion = choice(
  {
    question: "What is the reporter asking for?",
    focus: "Judge by what they want to happen next, not by the words bug or feature in the title.",
  },
  {
    bug: "Rolldown did something the reporter did not expect: an error, a crash or panic, output that misbehaves, or output that differs from Rollup or the documentation. They want it fixed.",
    feature:
      "Rolldown behaves as designed, but the reporter wants a new option, API, platform binding, or a change to the intended behavior.",
    question:
      "The reporter asks how to do something or whether something is supported, and does not assert a defect or request a change.",
    other: "Too little content to tell, or none of the above.",
  },
);
