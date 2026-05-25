// createCli — public factory entry point for external npm consumers.
//
// Constructs a CLI runner bound to a specific productConfig + adapter
// registry. The returned `run(argv)` method:
//   - parses argv via cli/argv.mjs
//   - handles --help / help verb via cli/help.mjs
//   - dispatches the verb via cli/dispatch.mjs (kernel handlers + caller's
//     optional extraHandlers)
//   - on unknown verb, falls back to printing help and exiting 0
//   - on error, formats via cli/error-format.mjs and exits with code
//
// Interactive flows are NOT included here — they are product-specific
// UX layered on top by the wrapping bin (e.g. examples/sample-product/bin.mjs).
//
// API:
//   createCli({ adapters, productConfig, version, events?, extraHandlers?, validVerbs? })
//     → { run(argv: string[]): Promise<void>, productConfig, version, events }

import { ProductConfigError } from "../core/errors.mjs";
import { ERR_MISSING_PRODUCT_CONFIG } from "../core/errors.mjs";
import { createAdapterRegistry } from "../adapters/index.mjs";
import { parseArgs } from "./argv.mjs";
import { printHelp, renderHelp } from "./help.mjs";
import { handleError } from "./error-format.mjs";
import { dispatchVerb, KERNEL_HANDLERS } from "./dispatch.mjs";
import { CancelledError } from "./prompts.mjs";
import { applyLocale } from "./locale.mjs";
import { dispatchScaffold } from "./commands/scaffold-plugin.mjs";

const DEFAULT_VERBS = new Set([
  ...Object.keys(KERNEL_HANDLERS),
  "help",
]);

/**
 * Construct a CLI runner bound to a product identity.
 *
 * @param {Object} options
 * @param {Array} options.adapters             Adapter module list (e.g. [claude, codex, opencode]).
 * @param {Object} options.productConfig       Constructed via defineProductConfig().
 * @param {string} [options.version]           Version string for help / banner.
 * @param {Object} [options.events]            Reserved for future event subscribers.
 * @param {Object} [options.extraHandlers]     Caller-supplied additional verb handlers
 *                                             (kernel handlers always take precedence).
 * @param {Set<string>} [options.validVerbs]   Override the recognized-verb whitelist.
 *                                             Defaults to KERNEL_HANDLERS keys + "help".
 * @returns {{ run: (argv: string[]) => Promise<void>, productConfig, version, events }}
 */
export function createCli({
  adapters,
  productConfig,
  version,
  events,
  extraHandlers,
  validVerbs,
  enablePluginScaffolder = false,
} = {}) {
  if (!adapters) {
    throw new Error("createCli: adapters[] is required");
  }
  if (!productConfig) {
    throw new ProductConfigError(
      "createCli: productConfig is required",
      ERR_MISSING_PRODUCT_CONFIG,
      {}
    );
  }
  const adapterRegistry = createAdapterRegistry(adapters);
  const adapterIds = adapters.map((a) => a.id);
  // v0.7: scaffold verb is opt-in. When the caller passes
  // enablePluginScaffolder: true, fold it into the effective extraHandlers
  // map so pure-installer downstreams never see the verb in --help. The
  // kernel-provided scaffold appears FIRST so a caller-supplied
  // extraHandlers.scaffold shadows it — explicit user override wins over
  // the convenience default.
  const effectiveExtras = enablePluginScaffolder
    ? { scaffold: dispatchScaffold, ...extraHandlers }
    : extraHandlers;
  const verbs = validVerbs ?? (effectiveExtras
    ? new Set([...DEFAULT_VERBS, ...Object.keys(effectiveExtras)])
    : DEFAULT_VERBS);
  const repoRoot = process.cwd();
  const ctx = Object.freeze({
    repoRoot,
    version: version ?? "0.0.0",
    productConfig,
    adapterRegistry,
  });

  return Object.freeze({
    async run(argv) {
      if (!Array.isArray(argv)) {
        throw new Error("createCli.run(argv): argv must be an array");
      }
      const args = parseArgs(argv, { validVerbs: verbs });
      applyLocale({ args, env: process.env, productConfig });
      if (args.help || args.verb === "help") {
        // No stream passed — renderHelp's stream=process.stdout default
        // resolves it. Verb-scoped (`<verb> --help`, `help <verb>`) routes
        // to a focused block; everything else falls back to the unchanged
        // composed full body.
        renderHelp({ args, productConfig, version: ctx.version, adapters: adapterIds });
        process.exit(0);
      }
      if (args.profile && productConfig.envProfile) {
        process.env[productConfig.envProfile] = args.profile;
      }
      try {
        const handled = await dispatchVerb({ verb: args.verb, args, ctx, extraHandlers: effectiveExtras });
        if (handled) return;
        // Unknown verb: fall back to help, exit 0.
        printHelp({ productConfig, version: ctx.version, adapters: adapterIds });
        process.exit(0);
      } catch (e) {
        if (e instanceof CancelledError) {
          const { strings } = await import("./strings.mjs");
          process.stderr.write(strings.errors.cancelled({ stage: e.stage }) + "\n");
          process.exit(130);
        }
        handleError(e, args);
        process.exit(typeof e?.exitCode === "number" ? e.exitCode : 1);
      }
    },
    productConfig,
    version: version ?? null,
    events: events ?? null,
  });
}
