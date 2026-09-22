import type { Check } from "../core/types.ts";
import { hasWorkaround } from "./has-workaround.ts";
import { priority } from "./priority.ts";
import { reproduction } from "./reproduction.ts";

/** Every check the action knows about. Enable them per repo with the `checks` input. */
export const checks: Check[] = [reproduction, priority, hasWorkaround];
