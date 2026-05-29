// Example @nexel/vendor config.
//
// A real downstream repo places this at its root. The vendor tool reads only
// three things from the exported object:
//   skillIdPrefix    — what the vendored skill's `name:` prefix is rewritten to
//   targetSkillsDir  — absolute path where vendored skill dirs land
//   vendorFrom       — declarative list of {source, path, as[, divergencePolicy]}
//
// This example is intentionally self-contained: it hard-codes the prefix and
// imports NOTHING (not the kernel, not another example). That keeps the
// "vendor-tool touches no kernel code" invariant unambiguous and lets the
// arch-guard assert it across every file in this directory.
//
// In a real product you would source the prefix from your own ProductConfig:
//
//   import productConfig from "./agent-skills.config.mjs";
//   export default { skillIdPrefix: productConfig.skillIdPrefix, ... };
//
// That routes through the public `installer/index.mjs` surface (the supported
// consumer pattern) — still zero kernel changes.

import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export default {
  // Matches the sample-product ProductConfig's skillIdPrefix ("sample") so the
  // demo mirrors a real consumer, without importing it.
  skillIdPrefix: "sample",
  targetSkillsDir: path.join(HERE, "consumer", "skills"),
  vendorFrom: [
    {
      source: path.join(HERE, "fixtures", "upstream"),
      path: "skills/greeter",
      as: "vendored-greeter",
      divergencePolicy: "manual-merge",
    },
  ],
};
