# skillctl — Kernel CLI Contract for AI Agents

This document is the **product-agnostic** behavioral contract for any CLI
built on the `skillctl` kernel (via `createCli` + a `ProductConfig`). It
describes what every skillctl-derived bin guarantees so an agent can drive
it non-interactively without scraping help text or guessing.

It is intentionally **not** a product install guide. Where a verb behaves a
certain way, that behavior comes from the kernel, not from any one product.
Product specifics — how a particular tool is distributed, which skills it
ships, how an installed skill is triggered — are out of scope here and are
deliberately excluded from the kernel (see [ADR-0006](./adr/0006-kernel-generic-agent-cli-contract-doc-boundary.md)
and [ADR-0004](./adr/0004-absorption-provenance-netops-tier-1-2.md)).

Throughout, `<bin>` is the product's `ProductConfig.binName`. The kernel
never hardcodes a bin name; substitute whatever the product you are driving
is called. The same applies to the skill-id prefix and manifest filename —
all are product-supplied via `ProductConfig`.

---

## 0. Preconditions

- **Node ≥ 18**, ESM. The bin is a self-contained Node script.
- The bin self-anchors its working directory to its own location at boot —
  you may invoke it from any cwd.
- A manifest (`install.json` by default; product may override the filename)
  must exist at the product root. Verbs that read it fail with a structured
  error (see §3) rather than hanging if it is missing.
- No network is required for any kernel verb. Adapter targets (Claude Code,
  Codex, OpenCode, or product-supplied adapters) are detected locally.

## 1. Verbs

Eleven kernel verbs are always available (plus `help`). All accept `--json` for machine-readable output, with one exception: `export` **always** emits a JSON envelope (it is a machine-to-machine format) — passing `--json` to it is a no-op, not an error.

| Verb | Purpose |
|---|---|
| `install` | Install skills / agents / rules into one or more adapter targets |
| `uninstall` | Remove previously installed assets (state-aware) |
| `update` | Refresh managed files whose source changed (hash-checked) |
| `repair` | Reconcile recorded state against disk (scan-only unless `--apply`) |
| `plan` | Preview what `install` would do, without writing |
| `list` | List manifest assets and installed status |
| `agents` | Detect supported adapter targets and writable status |
| `validate` | Lint a single `SKILL.md` frontmatter file |
| `export` | Dump the installed selection set as JSON to stdout |
| `import` | Read a selection-set JSON envelope from stdin and install |
| `doctor` | Health-check the installer environment per adapter |
| `help` | Print usage (handled in the CLI shell, not dispatched) |

## 2. Non-interactive contract — REQUIRED for agents

- **`--yes` / `-y` is mandatory for `install` and `uninstall`.** Without it,
  those verbs may prompt; an agent without a TTY must always pass it.
- **`--json`** makes output machine-readable on every verb. Always pass it
  when consuming output programmatically.
- **`--dry-run`** (and the `plan` verb) preview without writing — use to
  inspect intent before a mutating run.
- Selection is explicit: `--skill <id…>`, `--bundle <id…>`, or `--all`.
  Skill ids carry the product's prefix (`<prefix>:<name>`); discover real
  ids with `<bin> list --json`, never guess them.
- Multi-target: `--agent` is repeatable / comma-separable
  (`--agent=codex,claude-code`).
- An unknown verb is not an error — the bin prints full help and exits `0`.
  Do not rely on a nonzero code to detect a typo'd verb; check the verb
  against §1 first.

## 3. Exit-code contract — branch on these

| Exit | Meaning |
|---|---|
| `0` | Success — or a help/unknown-verb fallback render |
| non-zero (typed) | A kernel error. The error's own exit code if it sets one, else `1`. `doctor` exits `1` when a check fails. `validate` exits `1` on **any** lint finding (including a YAML parse error in the target `SKILL.md`); it exits `2` only for a precondition failure — missing path argument or file-not-found |
| `130` | Cancelled (interactive prompt aborted, e.g. Ctrl-C) — `cancelled at <stage>` on stderr |

In `--json` mode, an error is emitted on **stdout** as a uniform envelope:

```json
{ "ok": false, "error": "<ERR_CODE>", "message": "<human message>", "details": { } }
```

Success envelopes are verb-shaped (e.g. `list --json` → `{ "skills": [...],
"bundles": [...] }`). The `ok:false` shape above is the only error shape;
branch on the process exit code first, then parse stdout. In text mode,
errors go to **stderr** (`error[<CODE>]: <message>`); stdout stays clean.

## 4. Discovering usage at runtime

- `<bin> help` — full reference (all verbs + the common flag table).
- `<bin> <verb> --help` — focused, verb-scoped usage block.
- `<bin> help <verb>` — same verb-scoped block, alternate form.

**Help-affordance contract (exact):** only `<bin> <verb> --help` and
`<bin> help <verb>` produce verb usage. `<bin> <verb> help` does **not** —
`help` is then a positional argument to the verb, so the verb's handler
runs with `help` as input (e.g. `install help` attempts an install and
errors on missing selection). Never emit the verb-first `<verb> help` form
expecting usage text.

## 5. Behavioral contract (internalize this)

- **Idempotent reads.** `list`, `plan`, `agents`, `doctor`, `export`,
  `validate`, and `repair` (without `--apply`) never mutate disk or state.
- **State-aware mutation.** `install`/`update`/`uninstall` track managed
  files; locally-edited managed files block destructive operations unless
  you pass `--force` plus `--accept-modified <relPath>` per edited file.
  This is a safety contract — do not blanket-force.
- **`repair` is scan-only by default.** It reports drift and exits without
  writing unless `--apply` is given.
- **No frozen snapshots.** `import` re-installs from the destination's repo
  manifest, not from a captured payload; pair it with `export` for portable
  selection sets, not for version pinning.
- **Behavior is the kernel's, identity is the product's.** Verb semantics,
  exit codes, and the `--json` envelope shape are stable kernel contracts.
  The bin name, skill prefix, manifest filename, and which assets exist are
  product-supplied and vary per product.

## 6. Worked example

`examples/sample-product/bin.mjs` is a complete, runnable instantiation —
a real `ProductConfig` wrapping `createCli`. Use it to see every contract
above concretely:

```sh
node examples/sample-product/bin.mjs list --json
node examples/sample-product/bin.mjs plan --agent codex --skill sample:hello-world --json
node examples/sample-product/bin.mjs install --help
```

Its bin name is `sample-installer` — note that `skillctl` never appears in
its user-facing output. That is the product-agnostic guarantee this
contract rests on.

---

*This is the kernel-generic agent CLI contract. It is intentionally not a
port of any downstream product's agent-install guide (e.g. a
product-specific `INSTALL-FOR-AGENTS.md`): tag resolution, distribution
channels, and skill-trigger semantics are product concerns the kernel does
not own. See [ADR-0006](./adr/0006-kernel-generic-agent-cli-contract-doc-boundary.md).*
