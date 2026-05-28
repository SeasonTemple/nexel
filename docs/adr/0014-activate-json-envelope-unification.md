---
status: accepted
date: 2026-05-29
---

# `nexel activate --json` failure envelope unified to AGENT-CLI-CONTRACT §3 standard shape

## Context

`AGENT-CLI-CONTRACT.md` §3 specifies a single failure envelope shape for
every verb's `--json` mode:

```json
{ "ok": false, "error": "<ERR_CODE>", "message": "<human message>", "details": { } }
```

§3 also notes that success envelopes are verb-shaped: each verb may emit
its own success-case structure, but every error case across the CLI uses
the standard envelope above.

The `nexel activate` verb shipped in v0.8.0 (refined through v0.8.3)
violated this on the failure path. Its `--json` output used the same
verb-shaped envelope for both success and failure:

```json
{ "ok": false, "scope": "...", "skillsDir": "...", "adapters": [ ... ], "warnings": [] }
```

This was flagged as **AC-03** by the api-contract reviewer during the
v0.8.0 retroactive review (round-2 review batch). It was deferred through
v0.8.1, v0.8.2, and v0.8.3 because closing it requires both a code
change (restructure the failure-path output) AND a contract-doc change
(update §3-aligned shape in AGENT-CLI-CONTRACT.md) AND an ADR — three
coupled surfaces.

Thrown precondition errors (`ERR_ACTIVATE_INVALID_SCOPE`, missing
`productConfig`, unknown adapter target) always used the §3 standard
envelope via `handleError` in `cli/error-format.mjs`. So the surface
producing two shapes was exactly the path where the run reached the
adapter loop and one or more adapters returned `refused`/`failed` —
i.e., the per-adapter envelope leaked to the top level.

## Decision

`nexel activate --json` failure runs (ok:false) emit the
AGENT-CLI-CONTRACT §3 standard error envelope. Per-adapter detail moves
under `details.adapters`:

```json
{
  "ok": false,
  "error": "<first failure's code>",
  "message": "activate: <adapter> refused — <reason>",
  "details": {
    "scope": "user",
    "skillsDir": "...",
    "productName": "...",
    "dryRun": false,
    "adapters": [ /* per-adapter envelopes */ ],
    "warnings": []
  }
}
```

Where:

- `error` = the first refused/failed entry's `code`. Pure-refused runs
  (e.g., `--target=opencode`) surface `ERR_ACTIVATE_OPENCODE_REFUSED`.
  Multi-adapter mixed outcomes surface the first failing adapter's code;
  `ERR_ACTIVATE_FAILED` (new constant, added to `core/errors.mjs` +
  re-exported from `installer/index.mjs`) is the fallback when no
  adapter carries a specific code.
- `message` is a one-line human summary derived from the first failure's
  details (`details.reason` for refused, `details.message` for failed).

Success runs keep the verb-shaped envelope unchanged (per §3 "Success
envelopes are verb-shaped"). The `warnings` field is preserved in both
shapes — failure runs surface it under `details.warnings` rather than
top-level.

## Consequences

- **AGENT-CLI-CONTRACT §3 alignment.** Every verb's failure path now
  uses the same envelope. Strict JSON consumers no longer need a
  per-verb conditional for activate.
- **Public API addition: `ERR_ACTIVATE_FAILED`.** New constant joins the
  public ERR_* surface (re-exported from `installer/index.mjs`). Used
  only as the fallback when no per-adapter code applies; current
  adapters always carry a specific code, so this fallback fires only
  in defensive paths.
- **Breaking change for v0.8.0–v0.8.3 consumers.** Any agent or
  downstream product that parsed `parsed.adapters` at the top level of
  the failure envelope must now read `parsed.details.adapters`. v0.8.0
  shipped less than a week ago with zero production adopters per the
  ADR-0005 / ADR-0008 zero-adoption premise that still holds — the
  break is paid for cheaply now rather than after the contract clock
  starts. The change is documented in the v0.8.4 release notes
  compatibility table.
- **Test surface.** The sample-bin E2E activate-refuses test asserts the
  new shape; the prior shape's assertion is gone. Future regressions
  to the legacy verb-shape would fail this test loudly.
- **Documentation surface.** AGENT-CLI-CONTRACT.md §1 (activate
  subsection) now documents both shapes side-by-side. The shape split
  matches §3's "success verb-shaped, failure standard" rule.

## References

- `docs/AGENT-CLI-CONTRACT.md` §1 (activate subsection — both shapes
  documented), §3 (the contract rule this ADR aligns with)
- `scripts/installer/cli/commands/activate.mjs` `runActivate` — the
  failure-path restructure
- `scripts/installer/core/errors.mjs` — `ERR_ACTIVATE_FAILED` added
- `scripts/installer/index.mjs` — `ERR_ACTIVATE_FAILED` re-export
- `examples/sample-product/sample-bin.test.mjs` — assertion rewritten
  to the standard envelope shape
- AC-03 finding (v0.8.0 retroactive review) — the original surfacing
- `docs/release-notes/v0.8.4.md` — compatibility table row for the
  breaking change to agents parsing the v0.8.0–v0.8.3 failure shape
