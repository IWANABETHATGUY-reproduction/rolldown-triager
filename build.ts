import { builtinModules } from "node:module";

import { build } from "rolldown";

// GitHub Actions run `dist/index.js` without installing dependencies, so
// everything except Node builtins is bundled in.
await build({
  input: "src/action.ts",
  platform: "node",
  external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
  output: {
    dir: "dist",
    format: "esm",
    entryFileNames: "index.js",
  },
});
