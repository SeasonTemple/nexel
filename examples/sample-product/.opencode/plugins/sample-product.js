import path from "node:path";
import { fileURLToPath } from "node:url";

import { configureOpenCode } from "nexel/adapters/opencode-plugin";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.resolve(HERE, "../../skills");

export const SampleProductPlugin = async () => ({
  config: async (config) => {
    configureOpenCode(config, SKILLS_DIR);
  },
});

export default SampleProductPlugin;
