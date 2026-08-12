---
name: forge-memory-curator
description: "Synthesize, dedupe and index a Forge project's memory in the FORGE CLOUD store (shared across devices) so forge_memory_search recalls accurately. Triggers: curate/update/audit/index memory, memory hygiene, dedupe, make memory searchable."
---

# forge-memory-curator (Forge-native)

Keep a project's memory **synthesized, current, and indexed for accurate recall** — stored in the **Forge cloud** so every device that works on the project shares one memory.

## Storage rule (canonical)
- **Source of truth = Forge cloud memory** (`forge_memory_*`), scoped by the **Forge projectId**. A project can run on many devices; the cloud store is the only place memory is shared. Resolve projectId from the `forge` MCP `X-Forge-Project-Slug` header (or `forge_projects_list`).
- **Local files (`~/.claude/projects/<slug>/memory/`) are a per-machine cache only — NOT canonical.** Never treat a local memory as authoritative for a Forge project; the cloud row wins.
- **One topic per row, keyed by `(projectId, source, sourceRef)`.** `sourceRef` = a stable kebab/snake **slug** (e.g. `dispatch-device-pick`). Writing the same slug **UPSERTs** → dedupe + "one memory = one topic" is enforced at the key level.

## Taxonomy → Forge `source`
| Knowledge kind | `source` |
|---|---|
| user preferences + working rules / conventions ("how to work") | `policy` |
| durable project facts, architecture, ops-gotchas, runbooks, pointers | `knowledge` |
| recorded design decisions | `decision` |
| low-tier / transient (use sparingly) | `note` |

`issue` / `comment` / `job` are auto-indexed Forge entities — **never hand-write** them.

## The 3-question gate (answer ALL before every `forge_memory_write`)
Before writing/updating any memory, the agent MUST answer these three. Fail one → don't store as-is (drop it, send it to docs, or rewrite it).

1. **WORTH IT?** — *"If the next session didn't know this, would it do the wrong thing or redo work from scratch?"*
   → No ⇒ **don't store** (transient / trivial / obvious). Yes ⇒ continue.
2. **RIGHT PLACE?** — *"Is this ABSENT from code/git/CLAUDE.md/docs, AND operational knowledge (gotcha / preference / decision / pointer) rather than deep architecture?"*
   → In the repo already ⇒ **don't mirror it**. Deep architecture / business-logic ⇒ **repo `docs/` + a one-line `knowledge` pointer**, not a full memory. Else ⇒ continue.
3. **SAFE & FINDABLE?** — *"Can I write it as ONE self-contained, secret-free fact (pointer for any cred) under a stable slug within the size limit — and what query will a future session search to find it?"*
   → Can't keep it to one secret-free topic, or can't name the retrieval query ⇒ **split / scrub / rewrite first**, then store.

Q1 decides store-or-not · Q2 decides memory-vs-docs · Q3 decides how to write it (secret + format gate).

**Maps to source:** preferences/working-rules → `policy` · durable facts/ops-gotchas/runbooks/pointers → `knowledge` · design decision + rationale → `decision`.
**Boundary example:** *"ISS-393 merged"* → fails Q2 (git has it), don't store. *"failed job WITH a terminal handoff → mark done (`completed_via_handoff`); no handoff → still retry"* → passes all 3, store as `knowledge`/`decision`.

## 🔒 Secret rule (HARD)
Forge memory is **shared with every project member AND embedded** for search. **NEVER put secrets in `textContent`** — no tokens, passwords, DB/connection creds, API keys, cookies. Store a **pointer instead** (e.g. "readonly DB cred lives in `forge_projects_get → previewDeploy.testCredentials`"). This is the key difference from a private local memory file.

## Recall is EXPLICIT (not auto-loaded)
The Claude Code harness auto-injects only LOCAL `MEMORY.md`; **Forge cloud memory is NOT auto-loaded**. So:
- **At the start of a task / when you need project context, call `forge_memory_search(projectId, query, sourceFilter, topK)`** (semantic) and/or `forge_memory_get` (natural-key/slug lookup). Don't assume memory is already in context.
- Still **verify before trusting** — memory is point-in-time; check claims against `git log`/`git grep`/files before asserting (the big win is catching "shipped since" staleness).

## Write protocol
`forge_memory_write({ projectId, source, sourceRef:<slug>, textContent, metadata })`:
- **`textContent` = a self-contained, keyword-rich search key.** Lead with the durable fact (not an issue number); pack the concrete nouns someone would query by — feature, file, flag, command, device/project name, error string. Make sibling entries DISTINCT so search disambiguates. Convert dates to absolute; cite evidence (commit/issue/file) for any "shipped/changed" claim. (NO secrets — see above.)
- **`metadata`** carries structured bits: `{ type, tier, updatedAt, links:[slugs] }`.

## Entry contract (limits · format · template)
**API hard caps** (ceilings, NOT targets): `textContent` ≤ 100000 chars, `sourceRef` ≤ 512. The RULE is much tighter, for retrieval quality:
- **`sourceRef`** = kebab slug, optionally namespaced (`<ns>/<topic>` or `<ns>:<topic>`, e.g. `forge-test/beta-...`, `core/...`) — regex `^[a-z0-9]+(?:[-/:][a-z0-9]+)*$`, ≤ ~96 chars, stable + descriptive (it IS the dedupe key). Namespace by skill/domain to coexist with pipeline-agent memory; distinguish further by `metadata` (type/category/skill), NOT by forcing a flat slug.
- **`textContent`** = ONE topic, written **DENSE for an LLM reader, not prose for a human.** Target **~150–800 chars**; hard stop **~4000** (beyond → split into two slugs, or promote to docs + pointer). Min ~40. A long/prosey blob embeds poorly → recall mis-ranks.
- **Density rule (the point of terse):** drop articles / filler / hedging / narrative; KEEP entities, relations, identifiers (`file:line`, flags, IDs, commands, error strings) — those ARE the search keys. Prefer `X → Y`, `A=B`, `cap=1`, arrows/tables/abbreviations over sentences; one fact per line. Terse ≠ cryptic — keep the nouns that disambiguate. Rationale only as a short `why:` clause when load-bearing, not a paragraph.
- **First line ≤ ~160 chars = the lead / search-key summary** — highest-signal text for ranking. Front-load the durable fact + concrete nouns.
- **No secrets** — pointer only (🔒 rule). **Absolute dates**; cite evidence (commit/issue/file) for "shipped/changed".
- **`metadata`** = `{ type, tier?, updatedAt (ISO yyyy-mm-dd), links:[slugs], evidence? }`.

**textContent template (dense):**
```
<lead: durable fact + search nouns — one line, ≤160 chars>
<2–5 dense lines: facts / small table / pointers — one fact per line>
why: <short clause, only if load-bearing>
apply: <what to do differently>   (policy / feedback)
[[related-slug]]
```
**Dense example (good):** `code/fix job fail WITH terminal handoff for the attempt → mark done (reason completed_via_handoff, finalize-done.ts); no handoff → still retry (ISS-393). shipped 2026-06-07 5ad62d4e. why: runner misses CLI result event → false fail.`
**vs prosey (avoid):** "When a code or fix job fails but the agent had already written its handoff, we should treat it as done because the runner sometimes doesn't capture the result event…" (same fact, 2× longer, weaker embedding).
**Volume rule:** one fact per row; no historical play-by-play; if it sprawls past the cap, it's business-logic → docs. Run the bundled validator after writing/migrating: dump rows via `forge_memory_get` to JSON then `node validate.mjs --json rows.json` (or `--dir <local-cache>`) — it lints slug/length/lead/secret-leak/metadata + dup keys (ERROR on secret leak or bad slug; WARN on oversize/missing-date). It does NOT judge semantics — that's the agent's `forge_memory_search` sanity-check.

## Run modes (usually both)

### A. SYNTHESIZE — capture durable knowledge from recent work
Distill what this session established that is durable + non-obvious (decisions, gotchas, root causes, shipped changes, user prefs, runbooks). For each: matches an existing slug? → `forge_memory_write` same slug (upsert). New topic? → new slug. Skip anything derivable from code/git/CLAUDE.md or only relevant now.

### B. CURATE + INDEX — make the whole store accurate and findable
1. **Enumerate** the agent-authored rows: `forge_memory_get(projectId, source)` for each of `policy`/`knowledge`/`decision`/`note` (paginate). This is the audit set.
2. **Verify** each against the repo; classify KEEP / UPDATE (say what changed + evidence) / MERGE / DELETE (`forge_memory_delete` by slug) / PROMOTE→docs. Present before deleting unless the user prefers clean-break.
3. **Index for recall:** one topic per slug; if two rows would match the same likely query, MERGE or sharpen; rewrite `textContent` as a strong distinct search key. Preserve operational truth on updates ("shipped BUT not deployed/released, so in practice X still…").
4. **Sanity-check retrieval:** run a few `forge_memory_search` queries a future session would use; confirm the right single row comes back top-1/2. Fix descriptions that mis-rank.

### C. PROMOTE business-logic → repo docs (cross-device via git)
Durable architecture / business rules belong in the repo `docs/` (use `project-doc-builder` if present), then shrink the Forge memory to a one-line `knowledge` pointer to the doc. Docs ship via git → branch/worktree + review path + confirm before pushing.

## Migrating an existing local store → Forge
When a project still has local `memory/*.md`: read them, **scrub any secrets to pointers**, map each to a `source` + slug, `forge_memory_write` to the cloud, then keep local only as a disposable cache (or delete). Verify with `forge_memory_get` counts + a few `forge_memory_search` probes.

## Guardrails
- Don't delete what you can't replace — residual operational truth = UPDATE, not DELETE.
- Memory = cross-session working knowledge + pointers; docs = durable team knowledge that outlives a session.
- Verify, cite, hedge. Secrets are pointers, never content.
- End with a summary: rows by source before/after, what was synthesized / updated / merged / deleted / promoted.

## Verify the result
1. **Lint (mechanical):** dump the agent rows — `forge_memory_get` per source → write a JSON array to a temp file → `node <skill-dir>/validate.mjs --json rows.json`. Must be 0 ERROR (no secret leaks, valid slugs, no dup keys); resolve WARNs (oversize → split/tighten, missing `updatedAt`).
2. **Recall (semantic):** run a handful of `forge_memory_search` queries a future session would actually ask; confirm the correct single row ranks top-1/2. Fix any `textContent` that mis-ranks (sharpen the lead + nouns).
