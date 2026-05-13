// printHelp — render top-level help text by composing string blocks from
// cli/strings.mjs. productConfig provides binName / skillIdPrefix /
// envProfile / envBannerTitle; adapters list is supplied by the caller.
//
// The actual text lives in cli/strings.mjs (the i18n seam). Future
// locale providers can override individual blocks without touching this
// module.

import { strings } from "./strings.mjs";

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
  const binName = productConfig.binName;
  const prefix = productConfig.skillIdPrefix;
  const adapterList = adapters.join(" | ");
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
