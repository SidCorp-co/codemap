# `naming`

> The coupling is a *name*, not a reference. Nothing links the two ends; only the string matches.

```ts
// cm:edge naming -> skills/codemap/SKILL.md — the config key must equal the skill directory name
```

## When it applies

- A config map key that must equal a directory name, a class name, a route segment, or an enum value.
- Convention-based dispatch: a handler found by `require(`./${type}.js`)`, a template chosen by
  `views/${name}.html`, a job resolved from a string.
- A CSS class, a test id, or a feature-flag key shared between two codebases.

## What breaks without it

Rename refactoring is the whole risk. Every IDE will rename the symbol and every reference to it —
and leave the string that had to match untouched, because to the tooling it was never a reference at
all. The build stays green.

## How to spot the candidate

Anywhere a string is used to *find* something: dynamic import, reflection, a registry keyed by name,
a filename derived at runtime. If a grep for the literal is the only way to find the other side, it
is a `naming` edge.

## Anti-pattern

Do not use `naming` for a value both sides import from one constant. That is a reference, LSP sees
it, and the annotation would restate what a tool derives.
