// Help rendering + routing. Four surfaces:
//   - printHelp     — composes the top-level full body from the
//                     cli/strings.mjs blocks (byte-stable; R2 guard).
//   - renderHelp    — the shared routing entry point: `<verb> --help`
//                     and `help <verb>` → verb-scoped block; everything
//                     else → printHelp fallback.
//   - hasVerbHelp   — predicate: does this verb have a per-verb block?
//   - printVerbHelp — writes one verb's scoped block (private).
//
// productConfig provides binName / skillIdPrefix / envProfile /
// envBannerTitle; the adapters list is supplied by the caller. The
// actual text lives in cli/strings.mjs (the i18n seam) — future locale
// providers can override individual blocks without touching this module.

import { strings } from "./strings.mjs";

/**
 * Map a productConfig + adapter list to the identity params every
 * strings.help renderer takes. Single source of the adapter-list
 * delimiter so a verb block and the composed full body can never
 * disagree on it.
 *
 * @param {Object} productConfig
 * @param {string[]} adapters
 * @returns {{ binName: string, prefix: string, adapterList: string }}
 */
function renderParams(productConfig, adapters) {
  return {
    binName: productConfig.binName,
    prefix: productConfig.skillIdPrefix,
    adapterList: adapters.join(" | "),
  };
}

/**
 * Print the help text to stdout (or a supplied stream).
 *
 * @param {Object} options
 * @param {Object} options.productConfig  Constructed via defineProductConfig().
 * @param {string} options.version         Installer version string.
 * @param {string[]} options.adapters      Adapter id list.
 * @param {NodeJS.WriteStream} [options.stream=process.stdout]
 */
export function printHelp({ productConfig, version, adapters, stream = process.stdout }) {
  const { binName, prefix, adapterList } = renderParams(productConfig, adapters);
  const envProfile = productConfig.envProfile || "<envProfile>";
  const envBannerTitle = productConfig.envBannerTitle || "<envBannerTitle>";

  const blocks = [
    strings.help.header({ binName, version }),
    "",
    strings.help.usage({ binName }),
    "",
    strings.help.verbsBlock(),
    "",
    strings.help.flagsBlock({ adapterList, envProfile, envBannerTitle, binName }),
    "",
    strings.help.examplesBlock({ binName, prefix }),
    "",
  ];

  stream.write(blocks.join("\n"));
}

/**
 * True iff `verb` has a registered per-verb help block. `help` itself is
 * never verb-helped (bare `help` renders the composed full body via
 * printHelp).
 *
 * @param {*} verb
 * @returns {boolean}
 */
export function hasVerbHelp(verb) {
  return typeof verb === "string"
    && verb !== "help"
    && typeof strings.help.verb?.[verb] === "function";
}

/**
 * Write a single verb's usage block to stdout (or a supplied stream).
 * Parameterized off productConfig so a downstream product's identity
 * flows through with zero forking. `stream` defaults to process.stdout
 * (mirrors printHelp) — load-bearing: renderHelp's only production caller
 * (cli.mjs) passes no stream, and the help.test.mjs capture() harness
 * relies on the default resolving to the swapped global.
 *
 * @param {Object} options
 * @param {string} options.verb            Verb name with a registered block.
 * @param {Object} options.productConfig
 * @param {string[]} options.adapters
 * @param {NodeJS.WriteStream} [options.stream=process.stdout]
 */
function printVerbHelp({ verb, productConfig, adapters, stream = process.stdout }) {
  const render = strings.help.verb?.[verb];
  if (typeof render !== "function") return;
  stream.write(render(renderParams(productConfig, adapters)));
}

/**
 * Single help-routing decision shared by every entry point so their
 * behavior cannot diverge. The caller still owns its own control-flow
 * exit (cli.mjs: process.exit(0)).
 *
 *   `<verb> --help`   → args.help && hasVerbHelp(args.verb)        → verb help
 *   `help <verb>`     → args.verb === "help" && positional[0]      → verb help
 *   bare `help` / `--help` / unknown → composed full body (printHelp)
 *
 * `stream` defaults to process.stdout and is threaded to BOTH the verb
 * path and the printHelp fallback so printHelp's existing stream-injection
 * contract is preserved end-to-end. The default is mandatory: the cli.mjs
 * call site passes no stream; without it the verb path would do
 * `undefined.write(...)` on every real `<bin> <verb> --help`.
 *
 * @param {Object} options
 * @param {Object} options.args            Parsed argv (needs help, verb, positional).
 * @param {Object} options.productConfig
 * @param {string} options.version
 * @param {string[]} options.adapters
 * @param {NodeJS.WriteStream} [options.stream=process.stdout]
 */
export function renderHelp({ args, productConfig, version, adapters, stream = process.stdout }) {
  let target = null;
  if (args?.help && hasVerbHelp(args.verb)) {
    target = args.verb;
  } else if (args?.verb === "help" && hasVerbHelp(args?.positional?.[0])) {
    target = args.positional[0];
  }
  if (target) {
    printVerbHelp({ verb: target, productConfig, adapters, stream });
    return;
  }
  printHelp({ productConfig, version, adapters, stream });
}
