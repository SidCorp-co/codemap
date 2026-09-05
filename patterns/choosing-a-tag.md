# Choosing a tag

Five tags, and the set is exactly the size of the set of distinct **consumers**. Pick by asking who
reads it, never by how the sentence sounds.

| If the answer is… | Tag | Consumer |
|---|---|---|
| "whoever edits *this* file must obey it" | `cm:guard` | `PreToolUse` — injected before the edit |
| "editing this file implies something *elsewhere*" | `cm:edge` | `cm impact` — blast radius |
| "this file owns one step of a named runtime sequence" | `cm:flow` | `cm flow` — ordered trace, mermaid |
| "this is wrong on purpose, and here is when it goes" | `cm:hack` | `cm verify` — stale-workaround check |
| "the reason is not derivable, but nothing must be obeyed" | `cm:why` | nobody — read in place |

## The decision, in order

1. **Does something break if the next editor does not know?** No → no annotation. Stop here; most
   candidates die at this step, which is the point.
2. **Does the consequence land in another file?** Yes → `cm:edge`, and pick the kind from the six
   pages in this book. A target you cannot name is a sign the coupling is vaguer than you think.
3. **Is it a step in a sequence that spans files, languages or processes?** Yes → `cm:flow`. One
   flow, ordered by `after:`, is worth more than six guards each saying "runs after X".
4. **Is it temporary, with a condition under which it dies?** Yes → `cm:hack ISS-<n> until:<cond>`.
   No issue and no exit condition means it is not a hack, it is the design.
5. **Otherwise** → `cm:guard` if it must be obeyed, `cm:why` if it only has to be understood.

## Why `cm:why` exists

It is the pressure valve. Without it, every piece of hard-won rationale gets written as a `cm:guard`,
and the guard channel — the one that is injected into an agent's context before every edit — fills
with prose nobody must act on. `cm:why` keeps that channel expensive.

If you find yourself forcing a real constraint into `cm:why` and *losing information* by doing so,
that is the grammar failing: report it with the **cannot express** issue form.

## What does not exist, and why

- **`cm:invariant`, `cm:gotcha`** — their consumer is identical to `cm:guard`'s. Two names for one
  channel is how a vocabulary dies.
- **`cm:todo`** — the tracker owns outstanding work. A TODO in code is a second, non-authoritative
  copy of that state, and it is `CM010`. File the issue at `draft` instead.
