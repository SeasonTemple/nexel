# Sample Rule

Plain-markdown rule. Rules carry no frontmatter — they are dropped verbatim
into the target agent's rules directory.

## Purpose

Demonstrates the simplest possible asset type in the installer manifest:
no validation, no parsing, just file-copy semantics.

## When to Cite

Reference this rule from a bundle-profile skill's `dependencies.rules`
array to exercise the resolver's cross-asset path lookup.
