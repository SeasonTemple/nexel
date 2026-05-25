// U7 (plan 2026-05-25-001): scaffold-plugin generator.
//
// Generates the three-platform plugin manifest layout (Claude / Codex /
// OpenCode) from a ProductConfig so downstream products do not have to
// hand-author drift-prone plugin.json + marketplace.json files.
//
// Composition:
//   - `scaffoldPlugin(productConfig, opts)` — pure function (file-system
//     side-effect plus a single optional dep-audit read). Returns
//     `{ written, skipped, warnings }`. Default behavior never overwrites
//     existing files; pass `force: true` to clobber.
//   - `dispatchScaffold(args, ctx)` — argv adapter wired into createCli
//     when the caller passes `enablePluginScaffolder: true`. Reads
//     `args.force`, `args.target`, and `ctx.productConfig` / `ctx.repoRoot`
//     to call `scaffoldPlugin`, then formats output.
//
// Lazy-validation: `productConfig.repositoryUrl` is required at scaffold
// time; missing field surfaces an actionable error pointing the user at
// agent-skills.config.mjs.
//
// Downstream dep audit (default-on, `--no-deps` to skip): the generated
// OpenCode plugin entry imports `nexel/adapters/opencode-plugin`. If the
// target product's package.json does not declare `nexel` in `dependencies`
// or `peerDependencies`, the scaffolder emits a warning explaining the
// runtime requirement. The scaffolder never edits the downstream
// package.json — keeping it single-responsibility.

import fs from "node:fs";
import path from "node:path";

import { CommandError } from "./index.mjs";
import { ERR_ARGS, ERR_INVALID_PRODUCT_CONFIG } from "../../core/errors.mjs";

const NEXEL_DEP_NAME = "nexel";

function repositoryUrlOrThrow(productConfig) {
  if (!productConfig?.repositoryUrl) {
    throw new CommandError(
      "scaffold: ProductConfig is missing `repositoryUrl`. " +
        "Add `repositoryUrl: \"https://...\"` to your agent-skills.config.mjs and re-run.",
      ERR_INVALID_PRODUCT_CONFIG,
      { field: "repositoryUrl" },
    );
  }
  return productConfig.repositoryUrl;
}

// defineProductConfig eager-normalizes pluginName + marketplaceName, so a
// valid ProductConfig always carries both. These accessors stay narrow so
// adapter callers can pass the ProductConfig directly without re-deriving.
function pluginNameOf(pc) { return pc.pluginName; }
function marketplaceNameOf(pc) { return pc.marketplaceName; }

function renderClaudePluginJson(pc, version) {
  return {
    name: pluginNameOf(pc),
    version,
    description: pc.pluginDescription ?? `${pc.productName} plugin.`,
    skills: ["./skills/"],
  };
}

function renderClaudeMarketplaceJson(pc, version) {
  return {
    name: marketplaceNameOf(pc),
    description: pc.pluginDescription ?? `${pc.productName} marketplace.`,
    ...(pc.pluginAuthor ? { owner: { name: pc.pluginAuthor } } : {}),
    plugins: [
      {
        name: pluginNameOf(pc),
        description: pc.pluginDescription ?? `${pc.productName} plugin.`,
        version,
        source: ".",
      },
    ],
  };
}

function renderCodexPluginJson(pc, version) {
  return {
    name: pluginNameOf(pc),
    version,
    description: pc.pluginDescription ?? `${pc.productName} plugin.`,
    homepage: pc.repositoryUrl,
    repository: pc.repositoryUrl.endsWith(".git") ? pc.repositoryUrl : `${pc.repositoryUrl}.git`,
    license: "MIT",
    keywords: [pc.productName],
    skills: "./skills/",
    interface: {
      displayName: pc.productName,
      shortDescription: pc.pluginDescription ?? `${pc.productName} plugin.`,
      ...(pc.pluginAuthor ? { developerName: pc.pluginAuthor } : {}),
      category: "Developer Tools",
      capabilities: ["Read"],
      websiteURL: pc.repositoryUrl,
    },
  };
}

function renderCodexMarketplaceJson(pc) {
  return {
    name: marketplaceNameOf(pc),
    interface: {
      displayName: pc.productName,
      shortDescription: pc.pluginDescription ?? `${pc.productName} marketplace.`,
    },
    plugins: [
      {
        name: pluginNameOf(pc),
        source: { source: "local", path: "../.." },
        policy: { installation: "AVAILABLE", authentication: "NONE" },
        category: "Developer Tools",
      },
    ],
  };
}

function renderOpenCodeInstallMd(pc) {
  return `# Installing the ${pluginNameOf(pc)} OpenCode plugin

## Requirements

The generated OpenCode plugin entry at \`.opencode/plugins/${pluginNameOf(pc)}.js\`
imports \`nexel/adapters/opencode-plugin\`. Your product's \`package.json\`
must declare \`nexel\` in \`dependencies\` or \`peerDependencies\` before
running \`opencode plugin <dir>\`.

## Install from a tagged clone

\`\`\`bash
TAG=<your-tag>
git clone --depth 1 --branch "$TAG" ${pc.repositoryUrl}
PLUGIN_DIR="$PWD/$(basename "${pc.repositoryUrl}")"

opencode plugin "$PLUGIN_DIR" --global --force
\`\`\`

The OpenCode plugin loader reads \`.opencode/plugins/${pluginNameOf(pc)}.js\`,
which invokes the runtime helper from \`nexel/adapters/opencode-plugin\` to
append the plugin's skills directory and any \`opencode-instructions:\` files
declared in skill frontmatter to your OpenCode config.
`;
}

function renderOpenCodePluginEntry(pc) {
  return `// Generated by \`<bin> scaffold\` — do not edit by hand.
// Requires \`nexel\` as a runtime dependency in your product package.json.
import path from "node:path";
import { fileURLToPath } from "node:url";

import { configureOpenCode } from "nexel/adapters/opencode-plugin";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.resolve(HERE, "../../skills");

const ${camelCase(pluginNameOf(pc))}Plugin = async () => ({
  config: async (config) => configureOpenCode(config, SKILLS_DIR),
});

export default ${camelCase(pluginNameOf(pc))}Plugin;
`;
}

function camelCase(name) {
  return name
    .split(/[-_]/)
    .map((p, i) => (i === 0 ? p : p[0].toUpperCase() + p.slice(1)))
    .join("");
}

// Audit downstream package.json for a nexel dependency declaration. Returns
// a warning string when missing, or null when the requirement is satisfied
// (or no package.json exists at targetDir, which we treat as "the user
// will wire deps themselves").
function auditNexelDep(targetDir) {
  const pkgPath = path.join(targetDir, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const inDeps = !!(pkg.dependencies && NEXEL_DEP_NAME in pkg.dependencies);
    const inPeer = !!(pkg.peerDependencies && NEXEL_DEP_NAME in pkg.peerDependencies);
    if (inDeps || inPeer) return null;
    const relPkg = path.relative(targetDir, pkgPath) || "package.json";
    return (
      `Generated OpenCode plugin entry imports "nexel/adapters/opencode-plugin"; ` +
      `add "${NEXEL_DEP_NAME}" to ${relPkg} dependencies (or peerDependencies) before running ` +
      `\`opencode plugin <dir>\`.`
    );
  } catch {
    // Malformed package.json — let the caller see it; we are not the linter.
    return null;
  }
}

/**
 * Scaffold the three-platform plugin layout for a product.
 *
 * @param {Object} productConfig — frozen result of defineProductConfig().
 * @param {Object} opts
 * @param {string}  opts.repoRoot   Repo root (used when targetDir is null).
 * @param {string?} opts.targetDir  Where to write. Default: `<repoRoot>` so a
 *                                  bare downstream repo scaffolds at the root.
 *                                  Pass an explicit path to write into a
 *                                  sandbox or alternate location.
 * @param {boolean} opts.force      Overwrite existing files. Default false.
 * @param {boolean} opts.depAudit   Run the nexel-dep audit. Default true.
 * @returns {{ written: string[], skipped: string[], warnings: string[], targetDir: string }}
 */
export function scaffoldPlugin(productConfig, opts = {}) {
  if (!productConfig || typeof productConfig !== "object") {
    throw new CommandError("scaffoldPlugin: productConfig is required", ERR_ARGS, {});
  }
  const repositoryUrl = repositoryUrlOrThrow(productConfig); // lazy required
  const { repoRoot, targetDir: targetDirOpt, force = false, depAudit = true, version: versionOpt } = opts;
  if (!repoRoot && !targetDirOpt) {
    throw new CommandError("scaffoldPlugin: repoRoot or targetDir is required", ERR_ARGS, {});
  }
  const targetDir = targetDirOpt ? path.resolve(targetDirOpt) : path.resolve(repoRoot);

  // Sandbox guard — refuse to scaffold into a directory that doesn't look
  // like a product root or a prior scaffold output. Acceptance:
  //   (a) targetDir is missing or empty
  //   (b) targetDir contains a package.json (looks like a product root)
  //   (c) targetDir already contains a scaffolder-owned subdirectory
  //       (.claude-plugin / .codex-plugin / .agents / .opencode) — i.e.,
  //       we have written here before; second-run/force is legitimate.
  // This blocks accidental `--target=$HOME` style invocations from
  // scattering manifest files into an unrelated tree.
  if (fs.existsSync(targetDir)) {
    const entries = fs.readdirSync(targetDir);
    const isEmpty = entries.length === 0;
    const hasPackageJson = entries.includes("package.json");
    const hasPriorScaffold =
      entries.includes(".claude-plugin") ||
      entries.includes(".codex-plugin") ||
      entries.includes(".agents") ||
      entries.includes(".opencode");
    if (!isEmpty && !hasPackageJson && !hasPriorScaffold) {
      throw new CommandError(
        `scaffold: refusing to write into ${targetDir} — directory is non-empty, lacks package.json, and shows no prior scaffold output. ` +
          `Point --target at a product root (must contain package.json), an empty directory, or a directory you previously scaffolded.`,
        ERR_ARGS,
        { targetDir },
      );
    }
  }

  const version = versionOpt ?? readVersionForScaffold(repoRoot, targetDir);

  const pluginName = pluginNameOf(productConfig);

  const files = [
    {
      rel: ".claude-plugin/plugin.json",
      content: jsonText(renderClaudePluginJson(productConfig, version)),
    },
    {
      rel: ".claude-plugin/marketplace.json",
      content: jsonText(renderClaudeMarketplaceJson(productConfig, version)),
    },
    {
      rel: ".codex-plugin/plugin.json",
      content: jsonText(renderCodexPluginJson(productConfig, version)),
    },
    {
      rel: ".agents/plugins/marketplace.json",
      content: jsonText(renderCodexMarketplaceJson(productConfig)),
    },
    {
      rel: ".opencode/INSTALL.md",
      content: renderOpenCodeInstallMd(productConfig),
    },
    {
      rel: `.opencode/plugins/${pluginName}.js`,
      content: renderOpenCodePluginEntry(productConfig),
    },
  ];

  const written = [];
  const skipped = [];
  for (const f of files) {
    const abs = path.join(targetDir, f.rel);
    if (fs.existsSync(abs) && !force) {
      skipped.push(f.rel);
      continue;
    }
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, f.content);
      written.push(f.rel);
    } catch (e) {
      // Surface as CommandError with details so the caller (dispatchScaffold
      // / external orchestrator) can render an actionable JSON envelope.
      // Carry the partial-state lists so the caller can clean up if needed.
      throw new CommandError(
        `scaffold: failed to write ${f.rel} into ${targetDir}: ${e.code || ""} ${e.message}`,
        ERR_ARGS,
        { targetDir, failedAt: f.rel, written, skipped, cause: e.code || null },
      );
    }
  }

  const warnings = [];
  if (depAudit) {
    const w = auditNexelDep(targetDir);
    if (w) warnings.push(w);
  }
  // Surface that we used the lazy-validated repositoryUrl so the caller can
  // double-check the resolved value in its own logs.
  return { written, skipped, warnings, targetDir, repositoryUrl };
}

function jsonText(obj) {
  return JSON.stringify(obj, null, 2) + "\n";
}

// Best-effort version source: scaffolding is most useful when the version
// in plugin manifests tracks something authoritative. Prefer the
// targetDir's package.json (downstream product); fall back to repoRoot's
// package.json (this nexel repo, useful when scaffolding into examples/).
// Final fallback: "0.0.0".
function readVersionForScaffold(repoRoot, targetDir) {
  for (const dir of [targetDir, repoRoot].filter(Boolean)) {
    const p = path.join(dir, "package.json");
    if (fs.existsSync(p)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
        if (pkg.version) return pkg.version;
      } catch {
        // fall through
      }
    }
  }
  return "0.0.0";
}

/**
 * argv adapter — wired into KERNEL_HANDLERS only when the createCli caller
 * opts in via enablePluginScaffolder: true.
 */
export async function dispatchScaffold(args, ctx) {
  if (!ctx?.productConfig) {
    throw new CommandError(
      "scaffold: productConfig missing from ctx. Wire createCli({ productConfig }) before enabling scaffolder.",
      ERR_ARGS,
      {},
    );
  }
  const result = scaffoldPlugin(ctx.productConfig, {
    repoRoot: ctx.repoRoot,
    targetDir: args?.target ?? null,
    force: !!args?.force,
    depAudit: !args?.noDeps,
  });

  if (args?.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }

  process.stdout.write(`scaffold: targetDir=${result.targetDir}\n`);
  process.stdout.write(`  wrote   ${result.written.length} file(s)\n`);
  for (const r of result.written) process.stdout.write(`    + ${r}\n`);
  if (result.skipped.length > 0) {
    process.stdout.write(`  skipped ${result.skipped.length} file(s) (use --force to overwrite)\n`);
    for (const r of result.skipped) process.stdout.write(`    = ${r}\n`);
  }
  if (result.warnings.length > 0) {
    process.stdout.write(`  warnings:\n`);
    for (const w of result.warnings) process.stdout.write(`    ! ${w}\n`);
  }
}
