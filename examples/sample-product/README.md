# sample-product

This directory is the runnable downstream-product example for `nexel`.
It shows how a product supplies identity, content, and a thin bin while the
installer kernel owns validation, planning, install, state, update, and repair.

## Files

```text
examples/sample-product/
├── agent-skills.config.mjs    # ProductConfig: product name, id prefixes, bin name, env names
├── sample.install.json        # Manifest: installable skills, agents, rules, and bundles
├── skills/                    # Skill source directories
├── agents/                    # Agent source files
├── rules/                     # Rule source files
├── bin.mjs                    # Real product bin wrapping createCli()
└── *.test.mjs                 # Spawn-based example and plugin tests
```

## Run the visual install demo

From the repository root:

```sh
node scripts/install-skills.mjs
```

The demo reuses this sample product, shows the install flow, previews the
plan, then writes to a temporary target directory. It does not install into
real `~/.codex`, `~/.claude`, or OpenCode config directories by default.

For a non-interactive smoke test:

```sh
node scripts/install-skills.mjs --demo --yes --json --cleanup
```

## Drive the sample bin directly

`bin.mjs` is what a real downstream product would publish as its executable:

```sh
node examples/sample-product/bin.mjs help
node examples/sample-product/bin.mjs list --json
node examples/sample-product/bin.mjs plan --target /tmp/nexel-demo --bundle sample-demo
node examples/sample-product/bin.mjs install --target /tmp/nexel-demo --bundle sample-demo --yes
```

The root `scripts/install-skills.mjs` convenience script forwards ordinary
verbs such as `list`, `plan`, `install`, and `doctor` to this bin. Its no-arg
mode only adds the visual demo wrapper around the same kernel path.
