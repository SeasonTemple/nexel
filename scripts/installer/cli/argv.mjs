// CLI argument parser. Pure function: takes argv + the caller's set of
// recognized verbs, returns a parsed args object. No env reads, no I/O,
// no productConfig dependency. Generic across downstream products.
//
// The verb whitelist is passed in by the caller (dispatcher) rather than
// hard-coded so different products can expose different verbs without
// touching this module.

/**
 * Parse a Node.js argv array into a structured args object.
 *
 * Strips the leading `node` + script path automatically (argv.slice(2)).
 * The first remaining token, if it appears in `validVerbs`, becomes
 * `out.verb`; otherwise verb is null and the token is treated as a
 * positional argument by downstream code.
 *
 * @param {string[]} argv  process.argv-style array
 * @param {Object} options
 * @param {Set<string>} options.validVerbs  Set of recognized verb names
 * @returns {Object} parsed args
 */
export function parseArgs(argv, { validVerbs } = {}) {
  if (!(validVerbs instanceof Set)) {
    throw new TypeError("parseArgs: options.validVerbs must be a Set");
  }
  const a = argv.slice(2);
  let verb = null;
  if (a.length > 0 && validVerbs.has(a[0])) {
    verb = a.shift();
  }
  const out = {
    verb,
    help: false,
    json: false,
    yes: false,
    dryRun: false,
    overwrite: false,
    force: false,
    allowNoCli: false,
    noBanner: false,
    bannerTitle: null,
    skills: [],
    bundles: [],
    selectionIds: [],
    acceptModified: [],
    adapter: null,
    adapters: [],
    target: null,
    mode: "direct",
    all: false,
    printPath: null,
    apply: false,
    profile: null,
    lang: null,
    positional: [],
  };
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === "--help" || x === "-h") { out.help = true; continue; }
    if (x === "--json") { out.json = true; continue; }
    if (x === "--yes" || x === "-y") { out.yes = true; continue; }
    if (x === "--dry-run" || x === "--plan") { out.dryRun = true; continue; }
    if (x === "--overwrite") { out.overwrite = true; continue; }
    if (x === "--force") { out.force = true; continue; }
    if (x === "--all") { out.all = true; continue; }
    if (x === "--apply") { out.apply = true; continue; }
    if (x === "--profile") { out.profile = a[++i]; continue; }
    if (x.startsWith("--profile=")) { out.profile = x.slice(10); continue; }
    if (x === "--lang") { out.lang = a[++i]; continue; }
    if (x.startsWith("--lang=")) { out.lang = x.slice(7); continue; }
    if (x === "--skill" || x === "-s") {
      while (i + 1 < a.length && !a[i + 1].startsWith("-")) out.skills.push(a[++i]);
      continue;
    }
    if (x.startsWith("--skill=")) { out.skills.push(...x.slice(8).split(",").map((s) => s.trim()).filter(Boolean)); continue; }
    if (x === "--bundle" || x === "-b") {
      while (i + 1 < a.length && !a[i + 1].startsWith("-")) out.bundles.push(a[++i]);
      continue;
    }
    if (x.startsWith("--bundle=")) { out.bundles.push(...x.slice(9).split(",").map((s) => s.trim()).filter(Boolean)); continue; }
    if (x === "--accept-modified") {
      while (i + 1 < a.length && !a[i + 1].startsWith("-")) out.acceptModified.push(a[++i]);
      continue;
    }
    if (x === "--agent" || x === "-a") {
      const val = a[++i];
      out.adapter = val;
      out.adapters.push(...val.split(",").map((s) => s.trim()).filter(Boolean));
      continue;
    }
    if (x.startsWith("--agent=")) {
      const val = x.slice(8);
      out.adapter = val;
      out.adapters.push(...val.split(",").map((s) => s.trim()).filter(Boolean));
      continue;
    }
    if (x === "--allow-no-cli") { out.allowNoCli = true; continue; }
    if (x === "--no-banner") { out.noBanner = true; continue; }
    if (x === "--banner-title") { out.bannerTitle = a[++i]; continue; }
    if (x.startsWith("--banner-title=")) { out.bannerTitle = x.slice(15); continue; }
    if (x === "--target") { out.target = a[++i]; continue; }
    if (x.startsWith("--target=")) { out.target = x.slice(9); continue; }
    if (x === "--mode") { out.mode = a[++i]; continue; }
    if (x.startsWith("--mode=")) { out.mode = x.slice(7); continue; }
    if (x === "--print-path") { out.printPath = a[++i]; continue; }
    if (x.startsWith("--print-path=")) { out.printPath = x.slice(13); continue; }
    if (!x.startsWith("-")) { out.positional.push(x); continue; }
  }
  out.selectionIds = [...out.skills, ...out.bundles];
  out.adapters = [...new Set(out.adapters)];
  // Normalize: single-agent verbs read out.adapter, multi-agent verbs read out.adapters.
  // When user passes "--agent a,b", out.adapter is "a,b" (raw) — replace with adapters[0]
  // so single-agent code never sees a comma string.
  if (out.adapters.length > 0) out.adapter = out.adapters[0];
  return out;
}
