---
name: CodeMap
description: Comments only for what no tool can derive; couplings declared as cm: annotations
keep-coding-instructions: true
force-for-plugin: true
---

## Comments

Write **zero** ordinary comments. The compiler, the type system, the file path and the LSP already
state what the code does; restating it is invalid, not merely verbose.

Never write: section banners (`// --- Helpers ---`), restatements (`// Load the config`), change
narration (`// Now also handle X`), docstrings that repeat the signature, or anything addressed to
the reader of the diff rather than the reader of the code.

Language exceptions the tooling already knows about, so do not fight them: Go doc comments above
exported declarations, PHPStan/Psalm docblocks, Rust `///` and `// SAFETY:`, and every compiler or
linter pragma.

## The five annotations

When you know something **no tool can derive**, record it as a `cm:` annotation on a line comment
next to the code — never inside a block or doc comment.

```
// cm:guard <invariant or rule whoever edits this must obey>
// cm:edge  <contract|ordering|lockstep|sideeffect|naming|protocol> -> <repo/relative/path> — <why>
// cm:flow  <flow>/<step> [after:<step>] — <what this step does>
// cm:hack  ISS-<n> until:<condition> — <what the workaround is>
// cm:why   <rationale that the code cannot express>
```

Reach for one when you find yourself about to explain, in prose, that:

- two sides must agree on a string/format nothing type-checks → `cm:edge contract`
- these files must change together → `cm:edge lockstep`
- the effect happens in SQL, a cron, or another process → `cm:edge sideeffect`
- the coupling is a *name*, not a reference → `cm:edge naming`
- this call replaces rather than merges, or must run before that one → `cm:edge protocol` / `ordering`
- breaking this condition corrupts state → `cm:guard`

Do **not** write `TODO`/`FIXME`. Outstanding work belongs in the issue tracker, which is the
authority on its status; a TODO in code is a stale second copy. Use `cm:hack` only for a workaround
that is in the code right now, and only with an issue and an exit condition.

## Cite the incident, never retell it

An annotation carries the rule and its consequence. When the rule came from an incident, name the
incident — `(ISS-807)`, a date, a measured number — and stop there.

Measured on a consumer repo five weeks after adoption: guards averaged **306 characters**, 65% of
those characters sitting after the em-dash and a quarter of them past-tense narrative. Over the
same window policed prose fell ~203 KB while annotations added ~527 KB. The comments did not go
away; they changed channel — into the one loaded into your context before every edit of that file.

So write `— a stale kind on a non-waiting issue renders as a live banner (ISS-807)`, not the
paragraph telling how it was found. History already has a home: the changelog, the commit message,
the tracker. Under ~30 characters an annotation is usually deletable; past ~200, look for the
paragraph that should have been a citation.

A cited issue must exist and be the one you mean. A number nobody filed — or somebody else's — is
worse than no citation at all, because it looks checked.

Adding an annotation makes you the owner of the comment block it lands in. Delete every ordinary
comment glued to it — the baseline spares legacy prose everywhere else, but never in a block you have
just annotated, so leaving the noise there turns the site red. An annotation added on top of four
lines of restatement has made the file worse, not better.

Before finishing an edit, re-read your own diff and delete every comment that fails the
derivability test. A hook enforces this; getting it right the first time is faster than being sent
back.

## Acting on injected couplings

When context arrives announcing guards, edges or flow steps for a file you are about to change,
treat it as part of the task: obey the guards, and when an edge's other side needs the same change,
make it now rather than leaving the pair inconsistent.
