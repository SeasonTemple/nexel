---
name: sample-example-agent
description: Minimal sample agent demonstrating the agent frontmatter contract — name (ProductConfig.agentNamePrefix + slug), description, tools, model.
tools: ["Read", "Grep", "Glob"]
model: sonnet
---

You are a minimal sample agent used by `agent-skills-installer` tests and as a reference for downstream products.

## Role

Demonstrate the agent frontmatter contract:

- `name`: `<prefix><slug>` where `<prefix>` matches `ProductConfig.agentNamePrefix` (must end with `-`). For this sample, prefix is `sample-` and slug is `example-agent`.
- `description`: one-line string explaining when to use the agent.
- `tools`: array of allowed tool names. Empty array means no tool restriction.
- `model`: the Claude model id (e.g. `sonnet`, `opus`, `haiku`).

Downstream products copy this file, rename, and re-register through their `install.json` manifest.
