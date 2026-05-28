// Verb -> handler dispatch table. Replaces the per-verb switch/case
// that lived in scripts/install-skills.mjs pre-skillctl.
//
// `dispatchVerb({ verb, args, ctx })` looks the verb up in VERB_HANDLERS
// and invokes it. Returns true if a handler ran, false if the verb was
// not recognized (caller decides whether to fall back to interactive
// mode, print help, or error out).
//
// Downstream products can register additional verbs by passing their own
// handlers map via the `extraHandlers` parameter; the kernel handlers
// always win on conflicts so a product cannot accidentally shadow a
// built-in verb's semantics.

import {
  runList,
  runAgents,
  runValidate,
  runExport,
  runImport,
  runRepair,
  runDoctor,
  runPlan,
  runInstall,
  runUninstall,
  runUpdate,
} from "./run.mjs";
import { runActivate } from "./commands/activate.mjs";

const KERNEL_HANDLERS = Object.freeze({
  list: runList,
  agents: runAgents,
  doctor: runDoctor,
  repair: runRepair,
  export: runExport,
  import: runImport,
  validate: runValidate,
  plan: runPlan,
  install: runInstall,
  uninstall: runUninstall,
  update: runUpdate,
  activate: runActivate,
});

/**
 * Dispatch a parsed verb to its handler.
 *
 * @param {Object} options
 * @param {string} options.verb           Verb name (e.g., "list", "install")
 * @param {Object} options.args           Parsed argv
 * @param {Object} options.ctx            { repoRoot, version, productConfig }
 * @param {Object} [options.extraHandlers] Optional product-supplied handlers
 *                                         (keyed by verb name). Kernel handlers
 *                                         always take precedence on conflicts.
 * @returns {Promise<boolean>}  true if a handler ran, false if verb unknown
 */
export async function dispatchVerb({ verb, args, ctx, extraHandlers = {} }) {
  const handlers = { ...extraHandlers, ...KERNEL_HANDLERS };
  const handler = handlers[verb];
  if (!handler) return false;
  await handler(args, ctx);
  return true;
}

export { KERNEL_HANDLERS };
