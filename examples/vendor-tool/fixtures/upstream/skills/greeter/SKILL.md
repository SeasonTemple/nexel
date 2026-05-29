---
name: upstream:greeter
category: best-practice
description: Fixture upstream skill used to dogfood @nexel/vendor pull/diff/fork.
---

# Greeter

A trivial upstream skill that exists only so the vendor-tool example has a
real local source to pull from. On `pull`, the `name:` prefix above is
rewritten from `upstream:greeter` to `<product>:<as>` (e.g.
`sample:vendored-greeter`) so it validates against the consuming product's
ProductConfig.

## When to Activate

- Exercising `vendor pull` against a fresh target
- Demonstrating drift detection after a local edit
- Demonstrating `vendor fork` cutting the provenance umbilical
