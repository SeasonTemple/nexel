# `@nexel/vendor` (MVP scaffold)

Declarative **skill vendoring** for nexel downstream products: pull a skill
from a local upstream source into your product's skills dir, track its
provenance in a `.vendored.json` sidecar, and safely re-pull as the upstream
evolves — refusing to clobber local edits.

This directory is a **pre-adoption scaffold** (see
`docs/plans/2026-05-29-002-feat-nexel-vendor-mvp-scaffold-plan.md` and
`docs/backlog/v0.9.x-candidates.md` §Idea 1). It lives under `examples/` so the
nexel test suite can exercise it; the eventual `@nexel/vendor` npm package
extraction stays blocked on the ADR-0005 publish clock.

## Kernel boundary

The tool imports **nothing** from the kernel (`scripts/installer/**`). The
consuming product's identity (`skillIdPrefix`, skills dir) is supplied by the
config. `originHash` is a **tool-private sha256** over the rewritten payload —
deliberately *not* the kernel's content hash — so vendoring requires zero
kernel changes (memory: `project-idea1-vendor-hash-decision`).

## Config

`vendor.config.mjs` exports an object the tool reads three fields from:

| Field | Meaning |
|-------|---------|
| `skillIdPrefix` | prefix the vendored skill's frontmatter `name:` is rewritten to |
| `targetSkillsDir` | absolute path where vendored skill dirs land |
| `vendorFrom` | list of `{ source, path, as, divergencePolicy? }` entries |

`vendorFrom` entry:

| Field | Meaning |
|-------|---------|
| `source` | local filesystem path to the upstream repo/dir (MVP: local only) |
| `path` | subpath within `source` to the skill dir (containing `SKILL.md`) |
| `as` | local dirname under `targetSkillsDir`; also the rewritten name suffix |
| `divergencePolicy` | `"manual-merge"` (default) |

## Usage

```
vendor pull [<as> | --all] [--dry-run] [--json]   # default --all
vendor diff [<as> | --all] [--json]               # read-only
vendor fork (<as> | --all) [--json]
vendor --help
```

```bash
node examples/vendor-tool/bin.mjs pull --all
node examples/vendor-tool/bin.mjs diff vendored-greeter
node examples/vendor-tool/bin.mjs fork vendored-greeter
```

### What `pull` does

1. Reads the origin payload (`SKILL.md` + any `references/**`).
2. Rewrites `name: <upstream>:x` → `name: <skillIdPrefix>:<as>` (surgical;
   every other byte preserved) so the skill validates against your product.
3. Hashes the **rewritten** payload (tool-private sha256).
4. Decides:
   - no sidecar, target empty/absent → **fresh** vendor (write payload + sidecar)
   - no sidecar, target **non-empty** → **untracked**: refuse to overwrite an
     existing-but-unvendored dir (guards the crash-orphan case), exit 2
   - sidecar, on-disk unchanged, origin unchanged → **up-to-date** (no-op)
   - sidecar, on-disk unchanged, origin changed → **fast-forward** (overwrite,
     pruning files deleted upstream; bump sidecar)
   - on-disk already equals the new origin (re-converged) → **up-to-date** /
     **fast-forward** (sidecar refresh only) — never a spurious conflict
   - sidecar, on-disk **changed** and differs from origin → **conflict** under
     `manual-merge`: refuse, print attribution (`local-only` / `both` changed)
     + a 2-way diff, exit 2

### `fork`

Removes the `.vendored.json` sidecar, leaves the payload in place — the skill
becomes product-owned and is no longer tracked against upstream.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | ok |
| `1` | usage / fatal / not-vendored |
| `2` | refused (manual-merge conflict, or untracked target) — human action required |

## `.vendored.json` sidecar

Lives inside the vendored skill dir; excluded from the payload hash. The kernel
discovers skills by directory + `SKILL.md`, so the extra dotfile is invisible
to it.

```json
{
  "schema": 1,
  "originUri": "file:///abs/source#skills/greeter",
  "originHash": "<sha256 of rewritten payload>",
  "vendoredAt": "<ISO-8601>",
  "divergencePolicy": "manual-merge",
  "supersedes": null,
  "rewrite": { "namePrefix": "sample", "as": "vendored-greeter" }
}
```

## Known limitations (deferred)

- **Local-path sources only.** git ref / npm registry sources are v2.
- **2-way diff, not 3-way merge.** Conflict display shows origin-new vs
  on-disk-local; there is no merge assistance or stored base content yet.
- **`manual-merge` only.** `pinned` / `auto-FF` policies are not implemented.
- **`supersedes` is recorded but not chained.**
- **`pull --all` applies entries independently.** A conflict/untracked entry is
  refused, but other entries in the same run are still applied; the run exits 2
  if *any* entry was refused. Read the `--json` per-entry `action` for an exact
  breakdown rather than treating exit 2 as "nothing changed".
- **Writes are not crash-atomic.** A process killed mid-write leaves a partial
  payload; the next `pull` detects the missing sidecar and refuses it as
  `untracked` (no silent clobber), but full temp-then-rename atomicity is
  deferred.
- **Sidecar has no integrity check.** `.vendored.json` is trusted plaintext; a
  hand-edited `originHash` can force a false conflict or false up-to-date. There
  is no MAC — provenance is only as protected as the file itself.
- **Symlinks in the payload are skipped, not followed.** A symlinked file in the
  upstream skill dir is omitted from the vendored payload (and its hash).
- No npm publish (ADR-0005 publish clock).
