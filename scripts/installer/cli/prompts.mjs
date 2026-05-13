import * as clack from "@clack/prompts";
import figlet from "figlet";

import { listAdapterStatus, getAdapter } from "../adapters/index.mjs";
import { ERR_CANCELLED } from "../core/errors.mjs";

// Per-category short description shown as hint in filter prompts.
// Keep these GENERIC — listing specific skill ids here goes stale (e.g. tool
// originally listed collector/analyzer/absorber but two of those are
// repo-only and never reach the install picker). The actual installable
// count is rendered separately as '(N)'.
const CATEGORY_DESCRIPTIONS = {
  principle: "经典书籍/方法论原则 (obey-* 系列)",
  "best-practice": "语言/技术栈具体编码做法",
  test: "测试策略与流程 (TDD、unit/e2e)",
  review: "代码/安全审查与合规",
  tool: "技能管理工具链 (部分仅在 repo 内可用)",
  setup: "平台/环境配置",
};

export function renderBanner({ title = "NetOps Skills", enabled = process.stdout.isTTY, version = "" } = {}) {
  if (!enabled) return;
  try {
    const banner = figlet.textSync(title, { horizontalLayout: "default", width: 80 });
    process.stdout.write(banner + "\n");
    if (version) process.stdout.write(`  v${version} — agent skill installer\n\n`);
  } catch {
    // Banner is decorative. Failure must not block install.
  }
}

export class CancelledError extends Error {
  constructor(stage = "unknown") {
    super(`cancelled at ${stage}`);
    this.name = "CancelledError";
    this.code = ERR_CANCELLED;
    this.stage = stage;
  }
}

function makeCancelCheck(prompts) {
  return (value, stage) => {
    if (prompts.isCancel(value)) throw new CancelledError(stage);
    return value;
  };
}

export async function gatherActionChoice({ prompts = clack } = {}) {
  const checkCancel = makeCancelCheck(prompts);
  const action = checkCancel(
    await prompts.select({
      message: "What would you like to do?",
      options: [
        { value: "install", label: "Install  —  add new skills/bundles to an agent" },
        { value: "uninstall", label: "Uninstall  —  remove managed skills/bundles" },
        { value: "update", label: "Update  —  refresh installed skills against latest sources" },
        { value: "exit", label: "Exit" },
      ],
      initialValue: "install",
    }),
    "action"
  );
  return action;
}

/**
 * Interactive uninstall: list agents with managed state, let user pick agent(s),
 * union the installed selectionIds, multiselect what to remove.
 *
 * Reads each adapter's state.json via the supplied reader (default: fs).
 * The reader is injected so tests can stub it without touching the filesystem.
 */
export async function gatherUninstallChoices({
  env = process.env,
  prompts = clack,
  adapters: adaptersOverride,
  readState,
  manifest = null,
} = {}) {
  const checkCancel = makeCancelCheck(prompts);
  if (!readState) {
    throw new Error("gatherUninstallChoices requires a readState({ targetRoot }) function");
  }

  const adapters = adaptersOverride || listAdapterStatus({ env }).filter((a) => a.supportsDirect);
  const managed = [];
  for (const a of adapters) {
    const state = readState({ targetRoot: a.targetRoot });
    if (state && state.installations && state.installations.length > 0) {
      managed.push({ adapter: a, state });
    }
  }
  if (managed.length === 0) {
    prompts.log.error("No agent has any managed installations on this machine. Nothing to uninstall.");
    throw new CancelledError("no-installs");
  }

  const adapterIds = checkCancel(
    await prompts.multiselect({
      message: "Pick agent(s) to uninstall from",
      options: managed.map(({ adapter, state }) => ({
        value: adapter.id,
        label: `${adapter.displayName}  (${adapter.targetRoot})`,
        hint: `${state.installations.length} installation(s)`,
      })),
      required: true,
      initialValues: [],
    }),
    "uninstall-adapter"
  );

  const chosenList = Array.isArray(adapterIds) ? adapterIds : [adapterIds];
  // Union of selectionIds across chosen agents, with their category for filter UX.
  const byId = new Map();
  for (const aid of chosenList) {
    const entry = managed.find((m) => m.adapter.id === aid);
    if (!entry) continue;
    for (const inst of entry.state.installations) {
      const rec = byId.get(inst.selectionId) || { agents: new Set(), kind: inst.selectionKind || "skill" };
      rec.agents.add(aid);
      byId.set(inst.selectionId, rec);
    }
  }
  if (byId.size === 0) {
    prompts.log.error("Selected agent(s) have no installations.");
    throw new CancelledError("no-installs");
  }

  // Group choice mirrors install: bundles / skills (filter by category) / all-standalone / all.
  // Counts shown live, derived from byId + manifest (if provided).
  const installedBundles = [...byId.keys()].filter((sid) => {
    const rec = byId.get(sid);
    if (rec.kind === "bundle") return true;
    if (manifest?.bundles?.[sid]) return true;
    return false;
  });
  const installedSkills = [...byId.keys()].filter((sid) => !installedBundles.includes(sid));
  const installedStandalone = installedSkills.filter((sid) => manifest?.skills?.[sid]?.profile === "standalone");

  const groupOpts = [
    { value: "all", label: `Remove ALL ${byId.size} installation(s)` },
    ...(installedBundles.length > 0 ? [{ value: "bundle", label: `Bundle  —  ${installedBundles.length} installed bundle(s)` }] : []),
    { value: "skills", label: `Skills  —  filter by category, then pick or take all (${installedSkills.length} installed)` },
    ...(installedStandalone.length > 0 ? [{ value: "all-standalone", label: `All installed standalone skills (${installedStandalone.length})` }] : []),
    { value: "pick", label: "Pick specific installations (multi-select)" },
  ];

  const groupChoice = checkCancel(
    await prompts.select({
      message: `What to remove (${byId.size} installation(s) across ${chosenList.length} agent(s))`,
      options: groupOpts,
      initialValue: "pick",
    }),
    "uninstall-scope"
  );

  let selectionIds;
  if (groupChoice === "all") {
    selectionIds = [...byId.keys()];
  } else if (groupChoice === "all-standalone") {
    selectionIds = installedStandalone;
  } else if (groupChoice === "bundle") {
    // Multiselect: user may want to remove multiple bundles at once.
    // For a single installed bundle we still use multiselect (one option) — clack's
    // multiselect with required:true forces an explicit confirm, which is the right
    // safety bar for uninstall.
    const bids = checkCancel(
      await prompts.multiselect({
        message: "Which bundle(s) to uninstall — space toggle, enter confirm (≥1)",
        options: installedBundles.map((b) => ({ value: b, label: b })),
        required: true,
        initialValues: [],
      }),
      "uninstall-bundle"
    );
    selectionIds = Array.isArray(bids) ? bids : [bids];
  } else if (groupChoice === "skills") {
    // Category filter over INSTALLED skills only.
    const byCat = new Map();
    for (const sid of installedSkills) {
      const cat = manifest?.skills?.[sid]?.category || "unknown";
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(sid);
    }
    const sortedCats = [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const filterChoice = checkCancel(
      await prompts.select({
        message: "Filter by category",
        options: [
          { value: "__all__", label: `All installed skills (${installedSkills.length})` },
          ...sortedCats.map(([cat, list]) => ({ value: cat, label: `${cat}  (${list.length})` })),
        ],
        initialValue: "__all__",
      }),
      "uninstall-filter-category"
    );
    const pool = filterChoice === "__all__" ? installedSkills : (byCat.get(filterChoice) || []);
    const actionChoice = checkCancel(
      await prompts.select({
        message: `Action (${pool.length} installed skill(s) in ${filterChoice === "__all__" ? "all categories" : filterChoice})`,
        options: [
          { value: "pick", label: "Pick specific skills (multi-select)" },
          { value: "all", label: `Remove all ${pool.length} skill(s) in this filter` },
        ],
        initialValue: "pick",
      }),
      "uninstall-skills-action"
    );
    if (actionChoice === "all") {
      selectionIds = pool;
    } else {
      selectionIds = checkCancel(
        await prompts.multiselect({
          message: "Which skill(s) to remove — space toggle, enter confirm",
          options: pool.sort().map((sid) => {
            const rec = byId.get(sid);
            return { value: sid, label: sid, hint: `installed on: ${[...rec.agents].join(", ")}` };
          }),
          required: true,
          initialValues: [],
        }),
        "uninstall-skills-pick"
      );
    }
  } else {
    // "pick" — flat multiselect (back-compat fallback)
    selectionIds = checkCancel(
      await prompts.multiselect({
        message: "Which installation(s) to remove (space toggle, enter confirm)",
        options: [...byId.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([sid, rec]) => ({
            value: sid,
            label: sid,
            hint: `${rec.kind} · installed on: ${[...rec.agents].join(", ")}`,
          })),
        required: true,
        initialValues: [],
      }),
      "uninstall-selection"
    );
  }

  return { adapterIds: chosenList, selectionIds };
}

export async function gatherInstallChoices({ manifest, env = process.env, prompts = clack, adapters: adaptersOverride } = {}) {
  const checkCancel = makeCancelCheck(prompts);
  prompts.intro("NetOps Agent Skills installer");

  const adapters = adaptersOverride || listAdapterStatus({ env });

  const mode = checkCancel(
    await prompts.select({
      message: "Install mode",
      options: [
        { value: "direct", label: "Direct  —  selected skills + managed state (recommended for selective installs)" },
        { value: "plugin", label: "Plugin  —  full bundle via native plugin marketplace" },
      ],
      initialValue: "direct",
    }),
    "mode"
  );

  if (mode === "plugin") {
    const adapterId = checkCancel(
      await prompts.select({
        message: "Which agent?",
        options: adapters.map((a) => ({ value: a.id, label: `${a.displayName}` })),
      }),
      "plugin-adapter"
    );
    const adapter = getAdapter(adapterId);
    return { mode: "plugin", adapterId, instructions: adapter.pluginInstallInstructions() };
  }

  const directAdapters = adapters.filter((a) => a.supportsDirect);
  if (directAdapters.length === 0) {
    prompts.log.error("No agents support direct mode in v1. Use plugin mode.");
    throw new CancelledError("no-direct-adapters");
  }

  const cliReady = directAdapters.filter((a) => a.cliPresent);
  if (cliReady.length === 0) {
    prompts.log.error(
      "No agent CLI detected on this machine. Direct install is blocked.\n" +
        directAdapters
          .map((a) => `  - ${a.displayName}: '${a.cliBinary}' not in PATH → install: ${a.cliInstallUrl}`)
          .join("\n")
    );
    throw new CancelledError("no-cli-detected");
  }

  const adapterIds = checkCancel(
    await prompts.multiselect({
      message: "Target agent(s) — space toggle, enter confirm (≥1)",
      options: directAdapters.map((a) => {
        const fsHint = a.exists ? (a.writable ? "found, writable" : "found, read-only") : "absent (will be created)";
        const cliHint = a.cliPresent ? "cli=yes" : `⚠ cli=NOT FOUND (install: ${a.cliInstallUrl})`;
        return {
          value: a.id,
          label: `${a.displayName}  (${a.targetRoot})`,
          hint: `${fsHint} | ${cliHint}`,
        };
      }),
      required: true,
      initialValues: [],
    }),
    "direct-adapter"
  );

  const chosenList = Array.isArray(adapterIds) ? adapterIds : [adapterIds];
  const noCliChosen = chosenList
    .map((id) => directAdapters.find((a) => a.id === id))
    .filter((a) => a && !a.cliPresent);
  if (noCliChosen.length > 0) {
    prompts.log.error(
      `Selected agent(s) without CLI in PATH:\n` +
        noCliChosen.map((a) => `  - ${a.displayName} ('${a.cliBinary}') — install: ${a.cliInstallUrl}`).join("\n")
    );
    throw new CancelledError("selected-agent-no-cli");
  }
  // Keep `adapterId` (singular) for backward-compat with single-agent callers.
  const adapterId = chosenList[0];

  const groupChoice = checkCancel(
    await prompts.select({
      message: "What to install",
      options: [
        { value: "bundle", label: "Bundle  —  predefined group" },
        { value: "skills", label: "Skills  —  filter by category, then pick individuals or take all" },
        { value: "all-standalone", label: "All standalone skills" },
      ],
    }),
    "group"
  );

  let selectionIds = [];
  if (groupChoice === "all-standalone") {
    selectionIds = Object.values(manifest.skills)
      .filter((s) => s.profile === "standalone")
      .map((s) => s.id);
  } else if (groupChoice === "bundle") {
    const installableBundles = Object.values(manifest.bundles).filter((b) => b.id !== "skill-lifecycle");
    const bundleId = checkCancel(
      await prompts.select({
        message: "Which bundle",
        options: installableBundles.map((b) => ({ value: b.id, label: b.id, hint: b.description.slice(0, 80) })),
      }),
      "bundle"
    );
    selectionIds = [bundleId];
  } else {
    const installable = Object.values(manifest.skills).filter((s) => s.profile !== "repo-only");
    const byCategory = new Map();
    for (const s of installable) {
      if (!byCategory.has(s.category)) byCategory.set(s.category, []);
      byCategory.get(s.category).push(s);
    }
    const sortedCats = [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    const filterChoice = checkCancel(
      await prompts.select({
        message: "Filter by category",
        options: [
          { value: "__all__", label: `All (${installable.length})`, hint: "no filter — show every installable skill" },
          ...sortedCats.map(([cat, list]) => ({
            value: cat,
            label: `${cat}  (${list.length})`,
            hint: CATEGORY_DESCRIPTIONS[cat] || "",
          })),
        ],
        initialValue: "__all__",
      }),
      "filter-category"
    );

    const pool = filterChoice === "__all__" ? installable : byCategory.get(filterChoice);
    const actionChoice = checkCancel(
      await prompts.select({
        message: `Action (${pool.length} skill(s) in ${filterChoice === "__all__" ? "all categories" : filterChoice})`,
        options: [
          { value: "pick", label: "Pick specific skills (multi-select)" },
          { value: "all", label: `Install all ${pool.length} skill(s) in this filter` },
        ],
        initialValue: "pick",
      }),
      "skills-action"
    );

    if (actionChoice === "all") {
      selectionIds = pool.map((s) => s.id);
    } else {
      const ids = checkCancel(
        await prompts.multiselect({
          message: `Select skills — space toggle, enter confirm`,
          options: pool
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((s) => ({
              value: s.id,
              label: `${s.id}  [${s.profile}/${s.category}]`,
              hint: s.description.slice(0, 80),
            })),
          required: true,
        }),
        "skills"
      );
      selectionIds = ids;
    }
  }

  return { mode: "direct", adapterId, adapterIds: chosenList, selectionIds };
}

export async function confirmPlan({ planText, prompts = clack, message = "Proceed with install?", noteTitle = "Install plan" } = {}) {
  const checkCancel = makeCancelCheck(prompts);
  prompts.note(planText, noteTitle);
  const ok = checkCancel(
    await prompts.confirm({ message, initialValue: false }),
    "confirm"
  );
  return ok === true;
}

export function endInteractive({ ok, message, prompts = clack } = {}) {
  if (ok) prompts.outro(message);
  else prompts.cancel(message);
}

/**
 * Render a 'Next steps' panel after a successful install. Lists the target
 * paths touched and reminds the user what to do next (restart agent CLI,
 * verify with `list`, etc.).
 *
 * @param {{
 *   targets: Array<{ adapterId: string, displayName?: string, targetRoot: string, writtenCount: number }>,
 *   selectionIds: string[],
 *   prompts?: typeof clack,
 * }} opts
 */
export function renderNextSteps({ targets, selectionIds, prompts = clack } = {}) {
  const lines = [];
  if (targets?.length) {
    lines.push("Installed to:");
    for (const t of targets) {
      const name = t.displayName || t.adapterId;
      lines.push(`  • ${name}: ${t.targetRoot}  (${t.writtenCount} file(s))`);
    }
    lines.push("");
  }
  if (selectionIds?.length) {
    lines.push(`Selection(s): ${selectionIds.join(", ")}`);
    lines.push("");
  }
  lines.push("Next steps:");
  lines.push("  1. Restart your agent CLI (claude / codex / opencode) so it picks up the new skill files.");
  lines.push("  2. In the agent, verify the skill is loaded — e.g. opencode: type '/skills' or ask 'what skills are available'.");
  lines.push("  3. To check or update later:");
  lines.push("       node scripts/install-skills.mjs list --agent <id>");
  lines.push("       node scripts/install-skills.mjs update --agent <id>");
  lines.push("  4. To remove:");
  lines.push("       node scripts/install-skills.mjs uninstall --agent <id> --skill <selectionId> -y");
  prompts.note(lines.join("\n"), "Next steps");
}

export function startSpinner({ prompts = clack, label = "Working" } = {}) {
  const s = prompts.spinner();
  s.start(label);
  return {
    update: (msg) => s.message(msg),
    stop: (msg, code = 0) => s.stop(msg, code),
  };
}
