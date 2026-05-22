---
name: sample:hello-world
category: best-practice
description: Minimal hello-world skill demonstrating the SKILL.md frontmatter contract used by agent-skills-installer.
opencode-instructions: references/opencode-instructions.md
---

# Hello World

This is a sample skill used by the `agent-skills-installer` test suite and as a reference for downstream products.

## When to Activate

- Verifying the installer kernel can load + install a skill end-to-end
- Onboarding to the project — minimal viable example to read first
- Building a new downstream product — copy this directory and rename

## Frontmatter Contract

Every `SKILL.md` must have YAML frontmatter with three required fields:

- `name`: `<prefix>:<dirname>` where `<prefix>` matches `ProductConfig.skillIdPrefix` and `<dirname>` matches the parent directory
- `category`: one of the enum values declared by the project's lint rules
- `description`: non-empty one-line string

Other fields (`tools`, `model`, `origin`, …) are passed through unchanged.
`opencode-instructions` is skill metadata for OpenCode plugin runtime; it is
not a separately installable asset.
