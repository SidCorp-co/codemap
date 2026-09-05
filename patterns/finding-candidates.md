# Finding the first ten annotations

A legacy repo does not need a migration. It needs ten annotations that would have prevented ten
things that already happened. Everything else can wait for the edit that touches the file.

## 1. The prose that already names another file

In one 503k-line production repo, **134 flagged comments named another file in the same repo** —
`(see product_create.go)`, `mirrors audience_helpers.go`, `see frontend/.../unknown-filters.ts`.
Each is a coupling somebody found, judged worth recording, and had no formal channel for. They are
unreachable: nothing indexes them, nothing validates them when the target moves, and they only reach
a reader who is already in the right file.

That is the cheapest possible source: the repo has already paid for these and cannot spend them.

```bash
cm sweep --limit 50      # what the baseline is hiding, most recently touched first
```

## 2. The incident that produced a runbook line

Anything a human wrote in a wiki, a pinned message, or a PR description that starts with *"remember
to"*, *"deploy X first"*, or *"don't forget the other file"* is an `ordering`, `lockstep` or
`contract` edge in the wrong medium. It reaches nobody at the moment of the edit.

## 3. The review comment that had to be repeated

If the same review comment has been written twice on two different PRs, the constraint is real, the
channel is wrong, and the second time is your evidence.

## 4. `git log` for co-change, then a human for the why

Files that change together far more often than chance, with no import between them, are `lockstep`
candidates. Read the tension honestly: history can *propose* the pair, but the reason they are bound
is what an annotation carries, and history cannot state it. Deriving the candidate is fine; deriving
the annotation is not.

## What not to do

- Do **not** annotate a flow nobody has been burned by. An unfired constraint is speculation, and
  speculation in this channel costs the next agent's attention.
- Do **not** mass-migrate the baseline. Legacy is frozen, never migrated; a bulk comment deletion is
  a separate, reviewable change with a separate blast radius.
- Do **not** let an agent generate annotations in bulk. Volume in this layer is not progress — the
  measure is whether an annotation ever blocked a real mistake, and a hundred plausible ones dilute
  the ten that would have.
