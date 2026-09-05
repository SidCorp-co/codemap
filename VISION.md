# codemap — vision

> **Every codebase carries a machine-checkable layer of declared intent, and any agent — from any
> vendor — reads it before it changes a line.**

This document is the **ceiling**. [`NORTH-STAR.md`](./NORTH-STAR.md) is today, plus the one number
that decides whether this survives and the criteria that kill it. Where the two disagree,
NORTH-STAR wins: a vision is a direction, not a permission slip.

---

## 1. The bet

Software correctness stands on two pillars. **Types** state the shape of data. **Tests** state the
behaviour of a path. Both are machine-checked, both are enforced continuously, and between them they
cover everything a tool can derive.

They do not cover the third thing, and everyone knows it:

> *These two files must change together. This call replaces rather than merges. Break this condition
> and the state corrupts. The order is mandatory. That effect happens in SQL, not here.*

That knowledge exists — it is why senior engineers are expensive — and it lives in heads, wikis,
review comments, and the scar tissue of past incidents. None of those reach the person, or the
process, that is editing the file right now.

The bet is that this third body of knowledge deserves the same treatment the first two got:
**a declared form, a checker, and enforcement at the moment of the edit.**

Two forces make the bet urgent rather than merely interesting:

1. **Agents write an increasing share of code**, and an agent has no memory between sessions. The
   dominant failure of agentic engineering is not a type error or a wrong algorithm — it is the
   silent violation of a constraint nobody wrote down.
2. **Agents produce comments as waste.** Banning them yields a vacuum. Redirecting them yields an
   index. codemap's whole design follows from choosing the second.

---

## 2. The ladder

Each rung is a strictly larger claim than the one below it. Each is falsifiable, and the order is not
negotiable: a rung that has not held cannot support the next.

### Rung 1 — the file *(held today)*

A constraint that lived in one person's head becomes a line the checker verifies and the hook injects
into the editor's context before the edit. Measured: 2 350 files, 494 guards, 181 edges in one
production repo; both `PreToolUse` and `PostToolUse` in place.

### Rung 2 — the repository

`cm graph --json` is not a report. It is an **intermediate representation of human intent**: not an
AST, not a call graph, but the graph of constraints that are *not references*. Rung 2 holds when
other tools consume it rather than re-deriving it — impact analysis, review tooling, an agent's
retrieval step. The evidence it is reachable already exists in the other direction: the advisory tier
consumes `archmap graph --json` as evidence today.

**The ambition on this rung is a format, not a feature.**

### Rung 3 — across repositories

Today an edge points inside its own tree. The couplings that actually cost organisations money cross
that boundary: a service that emits a token another service parses, a migration that a third repo's
cron depends on, a Rust writer and a TypeScript reader in two different repositories.

Rung 3 is the **federated edge**: repo A declares `contract -> B#endpoint`, and B's CI knows it just
broke A's expectation. No compiler in existence can see that coupling, and every multi-service
organisation is paying for it in incidents right now.

### Rung 4 — the dependency graph

A library ships types so consumers know the *shape* of its API. Nothing ships the *protocol*: PATCH
replaces rather than merges, call B before A, these two options must move together, this callback
fires twice under retry. That knowledge sits in changelogs, in issue #482, and in the maintainer's
head.

Rung 4 is **libraries publishing their own codemap graph** alongside their types, so any consumer —
human or agent — reads the caveats at the moment of integration instead of after the outage.

### Rung 5 — the third pillar

Rung 5 is reached when a codebase without a declared-intent layer looks the way a codebase without
tests looks now: not wrong, just visibly unfinished. Types, tests, and declared intent — three
machine-checked layers, each covering what the other two structurally cannot.

OpenAPI did exactly this for the HTTP contract. Before it, the contract lived in a wiki, and everyone
accepted that as normal.

---

## 3. What has to become true

Ranked by how much each moves the one number in NORTH-STAR §5 — *repos not owned by the author where
somebody wrote an annotation by hand* — which is **zero** today.

1. **Delivery stops being vendor-specific.** The annotations are portable; the hooks are Claude Code.
   `cm impact --json` and `cm graph --json` already exist, so the missing piece is an adapter — an
   MCP server, a CI comment, or nothing more than an instruction telling any agent to run
   `cm impact <file>` first. Until this holds, rungs 2–5 have no audience.
2. **The first annotation must be cheap to reach.** A stranger with a legacy repo needs value in ten
   minutes, not after a migration. Candidate discovery from evidence already in the repo — prose that
   names another file, co-change history — is what makes minute ten productive. Candidates are not
   facts: a person still has to say *why*, and that is the part no tool derives.
3. **A quality measure for annotations, not a count.** `cm metrics` counts what the gate did;
   `cm ls` counts how many annotations exist. Neither says which annotation ever prevented anything.
   Without that measure, "every number rising while the value is zero" is indistinguishable from
   success — the exact trap that killed the products before this one. The measurable form already
   exists in the data: a `(code, line)` that fired and was **held**.
4. **Public evidence.** A layer whose only visible surface is a private repo cannot recruit anyone.
   A PR comment that says *"this touched A but not B, declared lockstep"* is both a feature and the
   only free advertising this idea has.

---

## 4. What this must never become

The ambition above raises the pressure on every one of these. That is why they are here and not only
in NORTH-STAR §7.

- **Not a general-purpose linter.** Anything expressible as a lint rule belongs to the linter. The
  value of this layer is exactly what it refuses to hold.
- **Not a unified layer over codemap + archmap.** That is gatemap; it died twice, and the gap between
  the two products is deliberate. Rungs 3 and 4 are codemap widening its *own* boundary — never a
  second system placed on top of two.
- **Not dependent on anything.** Zero dependencies is a condition of existence: a plugin that needs
  `npm install` before its hooks work is a plugin that gets disabled, and a disabled gate guards
  nothing.
- **Not defended with documentation.** If NORTH-STAR §6 fires — twelve months, zero outside
  annotations — the answer is to withdraw it, not to write a better README. A vision document is the
  most tempting place to break that rule, so it is written into the vision itself.

---

## 5. Why the ceiling is worth the climb

Institutional knowledge evaporates. A senior engineer leaves and takes with them the reason a
condition exists, and the organisation pays for it again — as an incident, then as a runbook line,
then as an incident again after the runbook goes stale.

A declared, checked, injected layer turns that knowledge into an asset that **compounds**: written
once by whoever paid to learn it, verified continuously so it cannot rot silently, and delivered
automatically to whoever — or whatever — edits the file next.

The number that proves it is not how much knowledge is stored. It is how often storing it changed
what happened next.
