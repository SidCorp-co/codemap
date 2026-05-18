---
name: forge-memory-builder
description: "Self-driving memory health agent for Claude Code auto-memory. Builds a project baseline (CLAUDE.md + active skills + code + Forge MCP), reads each memo semantically, verifies claims against current state, and acts: auto-normalizes frontmatter/body per Claude Code spec, auto-renames for convention, auto-trims verbose entries, auto-deletes verifiable noise (in-progress specs with active issues, ship logs, CLAUDE.md duplicates, code-derivable mechanism dumps). Escalates only when a deletion would erase a non-obvious operational rule with no alternative source."
user_invocable: true
arguments: "[dry-run|audit|run|promote]"
---

# forge-memory-builder

Self-driving. The skill **understands** each memo before acting — it does NOT pattern-match filenames or substring-grep. Memory must bind to the project's actual logic, verified against current state.

## Modes

- `run` (default): full sweep — baseline + analyze + auto-execute + escalate. End-to-end.
- `dry-run`: show actions that would be taken; don't apply.
- `audit`: read-only structural report (frontmatter spec compliance, broken cross-links, content overlap, naming consistency).
- `promote`: skip cleanup; ask "any new evergreen rule to save?"

Single-table output per run. No drip-feeding.

## Memory location

```bash
MEM_DIR="$HOME/.claude/projects/$(pwd | sed 's|/|-|g')/memory"
```

If missing, exit early. `MEMORY.md` is the index; other `*.md` are entries.

## Phase 1 — Build project baseline

Before touching memory, snapshot what the project IS today:

1. Read every `CLAUDE.md` from cwd downward (project-level + sub-project).
2. List `*/SKILL.md` under both `.claude/skills/` (wrapper + project scope).
3. Sample 1–2 skill bodies relevant to memo topics for the rules currently encoded.
4. If Forge MCP is wired: `forge_projects_list` + `forge_skills_list_registrations` for active project.
5. Note: top-level repo dirs, language stack, package manager.

Cap output to ~6 lines — this is the lens for every classify decision. Memos must align with this baseline; misaligned memos are stale.

## Phase 2 — Semantic per-memo analysis

For each `*.md` (skip `MEMORY.md`):

1. Read the FULL file (not just frontmatter or first 30 lines).
2. Extract the core claim in ≤ 1 sentence.
3. Verify the claim against current state:
   - File:line cite → read the path; if file moved/deleted, the cite is stale (rule may still hold).
   - Issue ID → `forge_issues.list` / `forge_issues.get`; if closed or missing, that's a signal.
   - Function name → grep for definition; if renamed/removed, claim may be obsolete.
   - Commit SHA → `git cat-file -e <sha>` to confirm reachable.
4. Compare to baseline:
   - Already in CLAUDE.md? (≥ 70% line overlap with a CLAUDE.md section)
   - Already in an active SKILL.md? (the operational rule is encoded in the skill body)
   - Still applies to current code? (or refactored away)
5. Classify into ONE bucket:

| Bucket | Meaning | Default action |
|---|---|---|
| **A** | Load-bearing rule — non-obvious from code, affects regular work, no alternative source | KEEP (maybe normalize structure) |
| **B** | Stale but valuable — rule was true, code drifted; user may still expect old behavior | ESCALATE: update or delete? |
| **C** | Code-derivable — covered by CLAUDE.md or SKILL.md verbatim, OR a 30-second grep reveals it | AUTO DELETE |
| **D** | In-progress spec / single-shot incident — active issue / git log / changelog is authoritative | AUTO DELETE |
| **E** | Verbose but valid — bucket A core wrapped in incident text / fix recipes / file:line cites | AUTO TRIM to rule + Why + How |

Decision must be based on SEMANTICS (the claim's value), not surface patterns (filename, substring presence).

## Phase 3 — Auto-execute (no user approval)

Apply these mechanically. Track each in a single batch summary at end.

**Normalize (any bucket):**
- Move legacy `type:` at frontmatter root → `metadata: { type: ... }` per Claude Code spec.
- Ensure `description:` is a single one-line summary.
- Rewrap body of type=feedback/project to `<rule/fact line>\n\n**Why:** ...\n\n**How to apply:** ...` structure.

**Rename (when majority pattern is clear):**
- Detect majority naming pattern in dir (e.g. `{type}_{topic}.md`).
- Rename divergent files to match. Update all `[[name]]` cross-links accordingly.

**Trim (bucket E):**
- Strip: incident history, recovery bash, file:line citations, commit SHAs, "we did X 3 weeks ago" narrative.
- Keep: the rule, the Why (1-2 lines), the How to apply.

**Delete (buckets C + D):**
- Bucket C: when verbatim duplicate found in CLAUDE.md / SKILL.md.
- Bucket D: when corresponding issue ID resolves OR git log shows the SHA.

**Cross-link repair:**
- If `[[name]]` references a file that got renamed → update.
- If `[[name]]` references a deleted file → leave the broken link; signals the topic moved out of memory.

## Phase 4 — Escalate (ask user)

Single batch table, NEVER drip-feed. Escalate ONLY for:

1. **Bucket A deletion candidate** — never auto-delete a load-bearing rule.
2. **Bucket B** — stale but valuable; ask whether to update body to current state or delete.
3. **Merge candidates** — two memos with ≥ 70% description overlap but distinct nuances.
4. **Naming convention switch** — if memory has mixed conventions AND rename would touch > 3 files.
5. **Orphaning > 2 cross-links** — heavy rename impact.

Table format:

```
## Decisions needing your input

| # | Files | Action | Reason | Suggested |
|---|---|---|---|---|
| 1 | feedback_X.md | DELETE? | Bucket A but baseline shows code refactored — rule may no longer apply | Verify with grep, then keep or delete |
| 2 | feedback_Y, project_Z | MERGE? | 75% description overlap, different angle | Merge into feedback_Y |
```

After user replies, apply each decision in one final pass.

## Phase 5 — Sync MEMORY.md

After all changes:

1. Enumerate remaining `*.md`.
2. Rewrite MEMORY.md index. One line per file: `- [Title](file.md) — one-line hook (from description frontmatter)`.
3. Update header: `<!-- last cleaned YYYY-MM-DD by forge-memory-builder -->`.
4. Verify: file count = index line count. If mismatch, surface as warning.
5. If MEMORY.md > 200 lines, flag — index gets truncated by harness.

## Output format

Single batch at end of run:

```
## Baseline
<6-line project snapshot>

## Auto-applied (N actions)
- Normalize frontmatter: file_X, file_Y
- Rename: file_A → file_B (cross-link updated in file_C)
- Trim bucket E: file_D (-60%), file_E (-45%)
- Delete bucket D: file_F (ISS-### closed, git log SHA confirmed)
- Delete bucket C: file_G (verbatim duplicate of CLAUDE.md §3)

## Decisions needing your input
<table or "(none)">

## Summary
Memory: M files → N files. MEMORY.md: M lines → N lines.
```

## Constraints

- **Semantic, never surface.** Read body, understand claim, then decide. No `grep "psql" && delete` heuristics.
- **Project-bound.** Every memo evaluated against current CLAUDE.md + skills + code. Trust current code over old memos.
- **Auto where safe.** Mechanical fixes (frontmatter, naming, cross-link repair) + clear-cut buckets C/D/E → no approval.
- **Escalate where load-bearing.** Bucket A precious — losing one silently is worse than asking once.
- **Atomic.** Each run applies all auto-changes or none (no half-applied state on error).
- **Single output.** One batch summary at end. No streaming intermediate states.
- **English in memo bodies** for the OSS jarvis-agents workspace; conversation back to user matches user's language.
- **MEMORY.md is index only.** Never write memo body into it; never delete `MEMORY.md` itself.
- **Body structure per Claude Code spec.** type=feedback/project body MUST be `<rule>\n\n**Why:**\n\n**How to apply:**`. type=reference body is a pointer paragraph. type=user body is profile facts.

## Anti-patterns the skill enforces during audit

Surface these in audit output (they make memos noise instead of signal):

- Backfill recipe (`psql`, `git reset`, `kill -TERM <pid>`)
- Fallback branch description ("if X fails, do Y") inside memo body
- Ship-log SHA dump (`commit abc1234`, `PR #N merged 2026-MM-DD`)
- File:line citation (`foo.ts:178-201`) — will rot
- Stale ID drift — ISS-### that no longer exists
- CLAUDE.md duplicate — covered there already
- Mixed concerns — one memo covering rule + incident + recipe; should be rule only
- Missing structure — type=feedback/project without `**Why:**` and `**How to apply:**` blocks

## Boundary with related skills

- `forge-knowledge-sync` extracts knowledge from session transcripts into Forge pgvector for RAG. Different system (server-side). This skill manages local Claude Code auto-memory (cross-session per-cwd).
- `lessons-learned` writes WRONG/CORRECT examples into coding-standards docs. Different artefact (project docs vs auto-memory).
- `update-config` manages `settings.json`. Different artefact.

Defer to those when the request is closer to their scope.
