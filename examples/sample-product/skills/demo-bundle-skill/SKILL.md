---
name: sample:demo-bundle-skill
category: principle
description: Bundle-profile sample skill that pulls in an agent and a rule via manifest dependencies, exercising the cross-asset resolver.
---

# Demo Bundle Skill

Demonstrates the **bundle** profile: a skill that declares dependencies on agents and rules so the installer's planner can fan out into a multi-asset install.

## When to Activate

- Testing the manifest's `dependencies.agents` / `dependencies.rules` resolver
- Demonstrating bundle-profile selection to a downstream product
