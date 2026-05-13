// Sample ProductConfig — demonstrates the contract required by `createCli()`
// and `defineProductConfig()` from agent-skills-installer.
//
// In a real downstream repo, this file lives at the repo root and is the
// only product-identity surface the installer kernel ever reads. Rename
// fields freely — `agent-skills-installer` treats them as opaque tokens.

import { defineProductConfig } from "../../scripts/installer/index.mjs";

export default defineProductConfig({
  // Required identity fields — frozen in Adapter SPI v1.
  productName: "sample-product",
  skillIdPrefix: "sample",
  agentNamePrefix: "sample-",
  defaultManifestFile: "sample.install.json",
  binName: "sample-installer",

  // Optional fields — kernel falls back to these defaults when omitted.
  defaultSkillsDir: "skills",
  defaultAgentsDir: "agents",
  defaultRulesDir: "rules",

  // Optional env-var prefix overrides. Each downstream product picks its own
  // namespace so two products on the same machine can coexist without
  // clobbering each other's profile / telemetry / banner state.
  envProfile: "SAMPLE_PROFILE",
  envTelemetry: "SAMPLE_TELEMETRY",
  envBannerTitle: "SAMPLE_BANNER_TITLE",
  telemetryDirName: ".sample-installer",
});
