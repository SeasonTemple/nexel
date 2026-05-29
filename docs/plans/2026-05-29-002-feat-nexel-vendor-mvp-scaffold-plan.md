---
date_created: 2026-05-29
status: completed
idea_ref: "Idea 1 — @nexel/vendor sister package (docs/backlog/v0.9.x-candidates.md §Verified-remaining #3)"
hash_decision_ref: "memory project-idea1-vendor-hash-decision (tool-private sha256, NOT kernel hash)"
kernel_changes: none
adr_required: none
---

# Plan: `@nexel/vendor` MVP scaffold (`examples/vendor-tool/`)

## Why now

Idea 1 is the confirmed "best v0.11+ ecosystem move" and the only
verified-remaining candidate that is **genuinely unbuilt** with **kernel zero
changes**. The gating hash fork was resolved in a prior session
(tool-private sha256). This plan lands the **design + scaffold** that ADR-0005
allows pre-adoption; the actual `@nexel/vendor` *npm release* stays blocked on
the publish clock.

## Resolved design forks (this session)

| Fork | Decision |
|------|----------|
| `source` fetch semantics | **Local filesystem path only.** Zero network/auth/git dep. git + registry deferred to v2. |
| default `divergencePolicy` | **`manual-merge`** — local edits → refuse fast-forward, emit diff, non-zero exit. |
| frontmatter `name:` prefix on `pull` | **Rewrite + hash post-rewrite.** `name: <upstream>:x` → `name: <product-skillIdPrefix>:<as>`; `originHash` computed over rewritten bytes (apples-to-apples drift detection). |
| MVP location | **`examples/vendor-tool/`** — sibling of `sample-product/`, downstream-consumer pattern. |
| `originHash` algorithm | **tool-private sha256** (memory decision). NOT `core/filesystem` `hashBytes`. Keeps kernel public surface unchanged. |
| MVP verbs | **`pull` + `diff` + `fork`.** (`diff` folded into MVP — reuses the conflict-path machinery `pull` already builds; standalone deferral was arbitrary.) |

## Scope (MVP)

In: `pull`, `diff`, `fork`, local-path sources, manual-merge gate,
prefix-rewrite, `.vendored.json` sidecar, `--all`/`<as>` targeting,
`--dry-run`, `--json`, self-contained fixture upstream, tests, README,
arch-guard.

Out (deferred, documented as known-limitations): git/registry
sources, true 3-way *merge* (MVP shows 2-way unified diff on conflict),
`supersedes` chaining, multi-skill bundle vendoring, npm publish.

## Files

```
examples/vendor-tool/
├── vendor.mjs              # core lib: fetch · rewrite · hash · sidecar · gate (pure, testable)
├── bin.mjs                 # CLI: vendor pull|fork [--all|<as>] [--dry-run] [--json]
├── vendor.config.mjs       # example config → wires to sample-product + fixture upstream
├── fixtures/
│   └── upstream/
│       └── skills/
│           └── greeter/
│               ├── SKILL.md            # name: upstream:greeter  (gets rewritten to sample:vendored-greeter)
│               └── references/notes.md
├── vendor-tool.test.mjs    # node --test suite
└── README.md               # usage + exit codes + known-limitations
```

Edits to existing files:
- `package.json` `test` script — append `examples/vendor-tool/vendor-tool.test.mjs`.
- `scripts/installer/architecture.test.mjs` — add a test asserting
  `examples/vendor-tool/bin.mjs` imports only `node:*` / npm / its own config
  (mirrors the existing `sample-product/bin.mjs` guard; vendor-tool imports
  nothing from `installer/` in MVP, which is trivially compliant — the guard
  locks that in against future regressions).

## `.vendored.json` sidecar schema

Lives **inside** the vendored skill dir: `<skillsDir>/<as>/.vendored.json`.
Excluded from the payload hash (self-reference). Kernel skill discovery keys
on dir + `SKILL.md`, so the extra dotfile is invisible to the kernel → zero
kernel changes holds.

```json
{
  "schema": 1,
  "originUri": "file:///abs/source#skills/greeter",
  "originHash": "<sha256 of REWRITTEN payload>",
  "vendoredAt": "<ISO-8601>",
  "divergencePolicy": "manual-merge",
  "supersedes": null,
  "rewrite": { "namePrefix": "<product skillIdPrefix>", "as": "<local dirname>" }
}
```

## `originHash` (tool-private, deterministic, cross-platform)

```
payload = all files under skill dir EXCEPT `.vendored.json`
sort files by posix relpath (lexicographic)
sha256 over, per file:  `${relpath}\n` + rawBytes + `\n`
→ hex digest
```

`node:crypto` only. No kernel hashing import.

## `pull` logic (per entry)

1. Resolve origin = `<source>/<path>`; read payload (recursive, posix relpaths).
2. Rewrite `SKILL.md` frontmatter: parse with `yaml`, set
   `name = \`${skillIdPrefix}:${as}\``, re-serialize, splice body back verbatim.
3. `newOriginHash` = hash(rewritten payload).
4. Resolve target = `<targetRoot>/<skillsDir>/<as>`.
5. Gate:
   - **No target / no sidecar** → fresh vendor: write payload + sidecar.
   - **Target + sidecar present**:
     - `onDiskHash` = hash(current target payload, excl. sidecar).
     - `localChanged = onDiskHash !== sidecar.originHash`
     - `originChanged = newOriginHash !== sidecar.originHash`
     - `!localChanged` → clean: fast-forward if `originChanged` (overwrite payload + bump sidecar), else no-op (report up-to-date).
     - `localChanged` (policy `manual-merge`) → **refuse**: print attribution
       (`local-only` / `origin-only` / `both` changed via the two hash compares)
       + per-file 2-way unified diff (origin-new vs on-disk-local), **exit 2**.
6. `--dry-run` → compute + report decision, write nothing.
7. `--json` → structured envelope `{ verb, entries: [{ as, action, ... }] }`.

## `fork` logic (per entry / `<as>`)

1. Locate target + sidecar.
2. No sidecar → error "not vendored" (exit 1).
3. Delete `.vendored.json`; leave payload in place ("cut umbilical" — now a
   product-owned skill). `--json` reports `{ as, action: "forked" }`.

## CLI surface

```
vendor pull [<as> | --all] [--dry-run] [--json]   # default --all
vendor diff [<as> | --all] [--json]               # read-only: origin-new vs on-disk
vendor fork <as> [--json]
vendor --help
```

Exit codes (documented in README): `0` ok · `1` usage/fatal/not-vendored ·
`2` manual-merge refused (human action required). Mirrors the spirit of
`docs/AGENT-CLI-CONTRACT.md` without coupling to the kernel CLI.

## Minimal unified diff

Self-contained LCS line-diff helper in `vendor.mjs` (no npm diff dep, no git
shell-out — keeps the "zero git dep" property for local-path MVP). Used only
for human-readable conflict display.

## Tests (`vendor-tool.test.mjs`, `node --test`)

- `hashPayload` deterministic + order-independent + excludes `.vendored.json`.
- frontmatter rewrite: `upstream:greeter` → `sample:vendored-greeter`, body byte-preserved, non-name keys untouched.
- `pull` fresh: writes payload + sidecar with post-rewrite hash; skill `name` matches product prefix.
- `pull` clean re-run: no-op (up-to-date), sidecar stable.
- `pull` origin changed + local clean: fast-forward overwrites, sidecar bumped.
- `pull` local modified: exits 2, writes nothing, diff mentions changed file, attribution correct (local-only vs both).
- `pull --dry-run`: never writes.
- `fork`: removes sidecar, leaves payload; second `fork` → exit 1 "not vendored".
- `--json` envelope shape for pull + fork.
- arch-guard (in `architecture.test.mjs`): `bin.mjs` import surface clean.

All fixtures self-contained under `examples/vendor-tool/fixtures/`; tests use
`fs.mkdtempSync` temp targets — never mutate the committed fixture.

## Non-goals / kernel-boundary guarantees

- No edit to `scripts/installer/**` except the additive arch-guard test.
- No new public export from `index.mjs`.
- No ADR (downstream consumer; records its own design here). A future reversal
  to kernel-hash parity WOULD need an ADR (promotes a core internal to the
  public contract) — explicitly not happening in this MVP.

## Verification

`npm test` green (incl. new suite + arch guard). Manual dogfood:
`node examples/vendor-tool/bin.mjs pull --all` against the fixture upstream,
edit a vendored file, re-run → observe exit 2 + diff; `fork` → sidecar gone.
