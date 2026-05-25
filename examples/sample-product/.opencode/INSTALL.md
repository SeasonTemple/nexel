# Installing the sample-product OpenCode plugin

The sample-product is a worked-example layout shipped inside the nexel
repository. It is not published as a standalone npm package — it exists
to demonstrate the three-platform plugin manifest convention that
downstream products copy.

## Requirements

The generated OpenCode plugin entry at `.opencode/plugins/sample-product.js`
imports `nexel/adapters/opencode-plugin`. Real downstream products that
use this layout as a template must declare `nexel` in their own
`package.json` dependencies before running `opencode plugin <dir>`.

## Install from a local clone

```bash
TAG=v0.6.1
git clone --depth 1 --branch "$TAG" https://github.com/SeasonTemple/nexel
PLUGIN_DIR="$PWD/nexel/examples/sample-product"

opencode plugin "$PLUGIN_DIR" --global --force
```

The OpenCode plugin loader reads `.opencode/plugins/sample-product.js`,
which invokes the runtime helper exported by `nexel/adapters/opencode-plugin`
to append the plugin's skills directory and any `opencode-instructions:`
files declared in skill frontmatter to your OpenCode config.

## Skills + ambient instructions

The plugin runtime helper handles both:

- `config.skills.paths` — appends `<PLUGIN_DIR>/skills/`, allowing
  OpenCode to auto-discover SKILL.md files.
- `config.instructions` — appends any file referenced by an
  `opencode-instructions:` frontmatter field inside a skill directory.

Both updates are idempotent — running `opencode plugin <PLUGIN_DIR>`
again does not duplicate entries.
