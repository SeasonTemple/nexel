---
date: 2026-05-29
item: adv-009 deactivate verb (ADR-0017 candidate)
type: preflight memo (read-only research)
scope: code surface — no design proposals
---

# Deactivate verb preflight

## 1. Activate verb call trail

- `cli/dispatch.mjs:27` — `import { runActivate } from "./commands/activate.mjs"`
- `cli/dispatch.mjs:41` — `activate: runActivate` in `KERNEL_HANDLERS` (frozen L29)
- `cli/commands/activate.mjs:242` — `runActivate(args, ctx)`
- `cli/commands/activate.mjs:154` — `activateCommand({...})`
- `cli/commands/activate.mjs:193` — `activateClaude({...})`
- `cli/commands/activate.mjs:207` — `activateCodex({...})`
- `adapters/claude-plugin.mjs:142` — `writeAmbientFence` call
- `adapters/codex-plugin.mjs:132` — `writeAmbientFence` call

CLI/strings references at `strings.en.mjs:40,301,304-328`, `strings.zh.mjs:39,299,302-326`.

## 2. Ambient fence marker format

Literals from `core/ambient-fence.mjs`:
- `:26` `BEGIN_PREFIX = "<!-- nexel:"`
- `:27` `BEGIN_SUFFIX = ":begin -->"`
- `:28` `END_PREFIX = "<!-- nexel:"`
- `:29` `END_SUFFIX = ":end -->"`
- `:36` `MANAGED_HEADER = "<!-- nexel-managed-fence v1; do not edit between markers -->"`

Per-product literal `productName` embedded raw (no hash, no prefix beyond `nexel:`). Validation at `:42` `/^[a-zA-Z][a-zA-Z0-9_-]*$/`.

## 3. writeAmbientFence + hasAmbientFence

`writeAmbientFence` at `:129`:
- Params: `{targetPath, productName, contentBlock, logger?}`
- Return: `{action: "created"|"appended"|"updated", changed, targetPath}`
- Throws: TypeError (bad args); Error (symlink at target `:146`, symlink at lock `:166`, unbalanced markers `:230`, untrusted markers `:240`); Error with `code = ERR_LOCKED` (`:194`)

`hasAmbientFence` at `:270`:
- Params: `(targetPath, productName)`
- Return: `boolean`

**No `removeAmbientFence` export** (`:269` end-of-module).

## 4. CLI verb registry

`KERNEL_HANDLERS` at `dispatch.mjs:29-42` (frozen): list/agents/doctor/repair/export/import/validate/plan/install/uninstall/update/activate.

`DEFAULT_VERBS` at `cli.mjs:30-33` = `Object.keys(KERNEL_HANDLERS) ∪ {"help"}`.

`strings.help.verb` Object.freeze at `strings.en.mjs:91` / `strings.zh.mjs:299`.

## 5. State/lock interaction during activate

Activate does **NOT** read or write `state.json`. Only ambient-fence file write.

Lock at `core/ambient-fence.mjs`:
- `:161` `lockPath = ${targetPath}.lock`
- `:185` `release = lockfile.lockSync(targetPath, {realpath: false, stale: 10000})`
- `:203` `release()` in `finally`

**No reference counting; no persistent ownership record**. Post-activate evidence = fence block + transient `.lock` directory only.

## 6. Multi-product host scenario

Code anticipating ≥2 ProductConfigs sharing one host:
- `core/ambient-fence.mjs:14-15` comment: "single home CLAUDE.md can host fences from multiple coexisting nexel-managed products"
- `:64-71` `fenceRegex(productName)` — non-global, lazy, per-product literal
- Tests `:134, 158` lock "preserves other products' fences byte-identically"
- `adapters/claude-plugin.mjs:18` comment
- `docs/AGENT-CLI-CONTRACT.md:127`
- `docs/adr/0012-...:130`

**NO code enumerates installed products** on host. No cross-product ownership index.

## 7. Hard-to-reverse invariants

- **ADR-0006** — kernel/product boundary
- **ADR-0001 D2** — frozen identity fields (productName is fence disambiguator)
- **Fence marker format** — bytes locked since v0.8.x; v0.8.2 + v0.8.3 added tolerance only
- **ADR-0014** — `--json` envelope `{ok, error, message, details}`
- **ADR-0015** — error code cleanup; constants `ERR_ACTIVATE_OPENCODE_REFUSED`, `ERR_ACTIVATE_INVALID_SCOPE`, `ERR_LOCKED`
- **ADR-0012** — host instructions unified key

## 8. Existing tests for activate

- `cli/commands/activate.test.mjs` (225 lines) — 7 tests
- `core/ambient-fence.test.mjs` (470 lines) — 21 tests including multi-product preservation, regex-safety, productName validation, CRLF tolerance, unbalanced markers, orphan markers, sentinel positional, symlink defenses, parent-dir creation, `hasAmbientFence` presence
- `adapters/claude-plugin.test.mjs` (232 lines)
- `adapters/codex-plugin.test.mjs` (155 lines)
- `cli/dispatch.test.mjs` + `help.test.mjs` — verb registry

No `deactivate.test.mjs` or `removeAmbientFence` test.

## 9. Trade-off options surfaced (no judgment)

- **Exact-invert vs unconditional removal**: INTERLOCK §"Marker format" L31-32
- **`--all-products` flag**: not present in code
- **Dry-run shape**: activate has `dryRun` reporting `would-activate` with `discovered`; deactivate dry-run shape unspecified
- **Idempotency on already-deactivated**: activate uses `action: "updated", changed: false` for byte-identical re-runs
- **Lock semantics**: writeAmbientFence takes `<target>.lock`; remove sharing same path = serializes
- **OpenCode**: activate refuses with `ERR_ACTIVATE_OPENCODE_REFUSED`; deactivate stance unspecified

## 10. Risks specific to this item

- **Cross-touch with CI bless path**: INTERLOCK §"PR merge order" L72-81 — merge deactivate before CI bless
- **Marker format change invalidates installed hosts** — any byte change strands prior fences
- **`removeAmbientFence` purely additive** — architecture guard ensures no forbidden imports
- **Multi-product unconditional sweep violates isolation** — option (b) breaks `ambient-fence.test.mjs:134,158`
- **State/disk ownership gap** — no on-disk record of which products wrote fences; `deactivate --all-products` cannot enumerate
- **Verb-help frozen** — `strings.help.verb` Object.freeze at module init; add deactivate renderer in literal pre-freeze
