# Federated edges — a design for VISION rung 3 (ISS-17)

**This is a design, not a spec.** Nothing here changes `spec/SPEC.md`, `parse.mjs`, or
`graph.mjs`; `federated:` is not a grammar `cm verify` recognizes. ISS-17's own text is explicit:
*"implementation follows only if the design survives its own constraints."* This document is that
design, plus a working prototype that tested the one mechanism the whole thing depends on against
two real repositories — `codemap` and its sibling `archmap` — not a diagram.

Depends on ISS-16 (closed, shipped 0.8.0): an edge may target a coordinate outside the tree,
verified against its **declaration**, not a file. Rung 3 is that same trade with a stronger far
side — the target is not an opaque name any more, it is another git repository, which means the
declaration can be checked against real, current content instead of trusted blind.

## The coupling this was designed against

Not a hypothetical. `cli/lib/archmap.mjs` in this repo already depends on the shape of
`archmap graph --json`'s output — `formatVersion`, `edges[].fromFile/toFile/resolved` — and
archmap's own source already says so, in its own `cm:why`, because ISS-16 style out-of-tree
declaration cannot reach a coupling that lives in a *sibling repository* the same organisation
owns:

```
# /home/forge/projects/archmap/src/graph/export.mjs, lines 1-5
cm:why this document is a CONSUMED CONTRACT, not a debug dump. Other tools read it to answer
  "does A depend on B" with the same graph archmap evaluates its own contracts over — codemap's
  CM301 today guesses coupling from a basename match and cannot be locked because of it. The
  `formatVersion` field is the promise: additive fields are a minor change, removing or renaming
  a field, or changing what one means, bumps it. Nothing in archmap reads this back.
```

That comment is a `cm:edge` this design cannot yet write: codemap depends on archmap's
`GRAPH_FORMAT_VERSION` and the `edges[]` field list, archmap is a real, independently-versioned
git repository, and today nothing declares that dependency machine-checkably in either direction.
Every example below uses this real pair.

## The four questions ISS-17 asked

### 1. Where does the declaration live?

**Decided: one side — the consuming repo**, exactly as `external:` already decided for a system
that is not even a repository (ISS-16). Here that is `codemap`, since `cli/lib/archmap.mjs` is
the file that already carries the expectation in code; archmap owes it nothing until told.

Rejected:
- **Both sides.** The issue's own framing names the failure mode — two declarations drift, and
  now there are two things to keep in sync instead of one.
- **A third place** (a shared registry, a federation service). Needs an owner, becomes
  infrastructure, and VISION §4 already forbids exactly this shape for a related reason: *"Not a
  unified layer over codemap + archmap... Rungs 3 and 4 are codemap widening its own boundary,
  never a second system placed on top of two."* A central federation registry is that second
  system with a different name.

Reversal cost if wrong: low. Nothing about "who declares" is baked into the wire format below —
§4's opt-in `dependents:` list is additive to a far repo that later wants to be told too, not a
rewrite of the one-sided form.

### 2. How does the far side learn, without either repo running a service?

**Decided: it doesn't, automatically — there is no push.** Zero dependencies (VISION §4) rules
out a daemon or a webhook receiver on either end. What replaces it is a **pull**, built entirely
out of `git` — a dependency every repo in scope already has:

1. Fetch the declared `<ref>` from the declared remote, shallow (`--depth 1`), into a scratch
   bare repo — no working-tree checkout of the far side, ever.
2. Read the one declared path out of that fetch (`git show <sha>:<path>`).
3. Check the optional `#symbol` the same way `CM106` already does in-tree: a word-boundary match
   on the anchor's first dot-segment (`graph.mjs`'s `anchorPresent`) — not resolution, no parse,
   no LSP, just "does this name still appear".

`git archive --remote` was tried first and rejected: it is the same idea but most hosted git
providers (GitHub included) refuse the upload-archive service over their smart protocols, so it
would work in this sandbox and fail in production. `fetch` + `show` uses only the universally
supported fetch/upload-pack path — the same one every `git clone`/`git pull` already relies on.

### 3. What does verification mean when the far side is not on disk?

**Stronger than `external:`, because the far side genuinely is inspectable git content, not an
opaque name.** Three outcomes, never two:

| Outcome | Meaning | Blocks anything? |
|---|---|---|
| `VERIFIED` | fetched the current tip of `<ref>`; path exists; symbol (if given) present | no — this is the passing case |
| `BROKEN` | fetched successfully; path or symbol is genuinely gone | this is the one real finding |
| `UNVERIFIED (unreachable)` | fetch failed — no network, no credentials, no such ref, timeout | **never** — degrades to "not verified this run", exactly as `external:`'s registry-only check already does for a system with no path to verify at all |

The middle row is the actual improvement over `external:`: today an out-of-tree edge is
"verified" the moment its name is spelled correctly, forever. A federated edge can go from
`VERIFIED` to `BROKEN` the day the far side's author renames the symbol — the whole point of
rung 3 per VISION: *"repo A declares `contract -> B#endpoint`, and B's CI knows it just broke
A's expectation."*

The unreachable row is not a compromise made for this prototype — it is load-bearing. A CI
runner scoped to one repository (this very session has no credentials for `archmap`'s remote —
see evidence below) must never turn red because of a permission boundary that has nothing to do
with whether the coupling actually broke.

### 4. Who is told, and when?

**Primary, and the only half this design actually delivers: the consuming repo, whenever it
runs the check.** Unlike every other tier, a federated edge can go stale with **no commit in
this tree at all** — the far side moved. So this cannot live in the edit-time hook (§ below);
it runs on a schedule or a CI trigger the consuming repo already owns, the same way `external:`
verification runs where the declaration lives (ISS-16).

**The harder half — telling B's author at the moment THEY break it, before their own merge —
is explicitly not solved by the one-sided form**, and is named here rather than hidden:
without B opting in, B's CI has no reason to know `codemap` exists. The honest answer, offered
as a documented option and **not prototyped or decided here**: B may declare, in its own
registry, an opt-in `dependents:` list (repos B has agreed to answer to). B's own CI then
shallow-fetches each listed dependent's declared federated edges and re-checks them against B's
*own* working tree before B merges. This is opt-in, can drift (a consumer B never added is
invisible to B), and that gap is the same class of silence VISION already accepts elsewhere
(*"the framework is silent about it rather than wrong about it"*) — bounded and visible once
named, not a correctness bug. It needs its own measurement before it is decided, on ISS-15's
evidentiary bar, so it stays a documented option, not a decision.

## Proposed grammar (not shipped)

```
<leader> cm:edge contract -> federated:<name>/<path>[#symbol] — <text>
```

`<name>` is **registered**, never a raw URL in the annotation — the same closed-vocabulary
reason `external:` closes its names (§2 principle 3 of `spec/SPEC.md`: unknown value is an
error, never a warning). Proposed registry addition, additive to `.forge/codemap.json` (§8):

```json
{
  "remotes": [{ "name": "archmap", "url": "git@github.com:SidCorp-co/archmap.git", "ref": "master" }]
}
```

Proposed diagnostics, next free codes, never gating the exit code the grammar/referential tiers
do:

| Code | Tier | Meaning |
|---|---|---|
| `CM108` | referential | `federated:` names a remote the registry does not declare (mirrors `CM107`) |
| `CM109` | federated (new, opt-in, never in a hook) | a federated edge's far side was reached and is confirmed `BROKEN` |

A **new tier**, `federated`, distinct from grammar/referential/structural/advisory: never runs
in `PreToolUse`/`PostToolUse`, never in a bare `cm verify`. This project already paid for
learning this lesson once — ISS-14's auto-enable-on-presence attempt stalled every edit ~15s
before the archmap cache existed. A network fetch has no local cache to fall back to and no
upper bound on latency without a hard timeout; it is strictly worse than the thing that already
burned this project. `--tier federated` or a dedicated `cm federate check`, wired into the
consuming repo's own CI, on a cadence — never inline with an edit.

## What the prototype proved

`spec/prototypes/federation-check.mjs` — a standalone script, no new dependency, not wired into
`cm`, `graph.mjs`, or `parse.mjs` — implements exactly the mechanism in §2/§3 above: shallow
`git fetch` into a scratch bare repo, `git show` for the one path, the same anchor check `CM106`
uses. Run against the real `archmap` repository on this box (its actual current `master`, not a
fixture):

| Case | Command target | Result | Exit |
|---|---|---|---|
| Real symbol, real repo | `archmap@master` `src/graph/export.mjs#GRAPH_FORMAT_VERSION` | `VERIFIED`, fetched `1c78ffa…` | 0 |
| Far side renames the symbol | a scratch clone of `archmap` with `GRAPH_FORMAT_VERSION` → `GRAPH_SCHEMA_REVISION`, committed | `BROKEN` — "exists but … is gone" | 1 |
| Far side deletes the file | same scratch clone, file removed, committed | `BROKEN` — "no longer exists there" | 1 |
| No credentials for the real remote | `git@github.com:SidCorp-co/archmap.git` (this session has no key for it — confirmed: `git ls-remote` on it returns `Permission denied (publickey)`) | `UNVERIFIED (unreachable)` | 0 |
| Missing arguments | (none) | usage message | 2 |

Four outcomes, four correct answers, against a repository this design did not write and does
not control. The unreachable case is not simulated — it is the actual, present limitation of
this sandbox's credentials, which is exactly the failure mode §3 says must never block.

## What remains before this can ship — explicitly out of scope here

- `federated:` in `parse.mjs`'s target grammar and `CM005`; `remotes` in the registry schema
  (`schema/codemap.schema.json`) and `CM108` in `graph.mjs`.
- The `federated` tier itself and `cm federate check` — timeout policy, retry policy, where the
  scratch clone's cache lives (mirrors `cli/lib/archmap.mjs`'s cache-dir pattern, not designed
  here), and how `cm impact`/the hook mark a federated edge distinctly from both an in-tree edge
  and an `external:` edge (ISS-16's own business rule — "a reader must never have to guess which
  kind they are looking at" — applies here too).
- The `dependents:` (B-opts-in) direction from §4 — named as an option, not designed or measured.
- Pinning to a specific commit vs. tracking a moving `ref` — this prototype always asks for the
  *current* tip; a repo that wants "verified against the commit I last approved" needs a pinned
  sha and a deliberate re-pin step, not designed here.

Recommend a follow-up implementation issue, scoped to the one-sided (`federated:` + `CM108` +
`cm federate check`, A-side only) form first — it needs no cooperation from archmap's owners,
unlike `dependents:`, which needs its own measurement before it is decided.
