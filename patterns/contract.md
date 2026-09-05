# `contract`

> Two sides must agree on a value or a format, and neither compiler checks the other.

```ts
// cm:edge contract -> packages/core/src/pipeline/failure-classifier.ts — the bracketed token this emits must have a matching pattern there
```

## When it applies

- One side **emits** a string, the other **parses** it: an error code, a log prefix, a bracketed
  token, a serialized enum.
- Two implementations of the same wire format in different languages: a Rust writer and a TypeScript
  reader, a Go struct tag and a SQL column, a queue message and its consumer.
- A regex in one file that only makes sense against text produced in another.

## What breaks without it

The emitting side is renamed by someone who greps for the symbol, finds nothing else, and ships. The
parser silently stops matching — no type error, no test failure if the test builds its own fixture,
and the failure surfaces as a category of event simply never firing again.

## How to spot the candidate

Search for string literals that appear in exactly two places in two languages. In field data, the
comment that already says *"must match the pattern in …"* is the single most common prose form of a
latent `contract` edge.

## Anti-pattern

Do not use `contract` where a shared type already exists. If both sides import the same enum, the
compiler is the contract and the annotation is a stale copy of it — `CM2xx` territory. `contract` is
for the case where the agreement has **no** shared symbol.

## Anchor it when you can

`-> path/to/file.ts#symbolName` verifies that the symbol is still there, not merely the file. In one
production repo, 110 of 186 edges carry an anchor; without one, the edge is verified no further than
"the file still exists".
