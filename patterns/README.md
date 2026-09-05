# The pattern book

`spec/SPEC.md` is the grammar: what is legal. This book is the judgement: **which tag to reach for,
and when a constraint has earned an annotation at all.**

Read [`choosing-a-tag.md`](choosing-a-tag.md) first. Then the page for the edge kind you need.

| Page | The coupling it carries |
|---|---|
| [`choosing-a-tag.md`](choosing-a-tag.md) | guard vs edge vs flow vs hack vs why — decided by consumer, not by feeling |
| [`contract.md`](contract.md) | two sides must agree on a value or format neither type-checks |
| [`ordering.md`](ordering.md) | A must happen before B, and nothing enforces it |
| [`lockstep.md`](lockstep.md) | these files must change in the same commit |
| [`sideeffect.md`](sideeffect.md) | the effect happens outside this language — SQL, cron, a queue |
| [`naming.md`](naming.md) | the coupling is a *name*, not a reference |
| [`protocol.md`](protocol.md) | call semantics the signature does not show |
| [`finding-candidates.md`](finding-candidates.md) | where the first ten annotations in a legacy repo come from |

## The one test every page applies

> **If a tool can derive it, you may not write it.**

Types derive shapes. LSP derives references. Paths derive modules. git derives history. An
annotation is only legitimate in the complement of all four.

## The second test, applied just as often

> **What breaks when somebody does not know this?**

A constraint whose violation costs nothing is a preference, not a constraint, and it does not earn an
annotation. If the answer is "nothing, it is just cleaner", delete the annotation and move on. The
channel is narrow on purpose: every line of noise in it is a line the next agent has to read before
touching the file.
