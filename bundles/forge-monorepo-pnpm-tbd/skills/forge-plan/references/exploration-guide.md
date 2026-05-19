# Exploration Guide (Complex tier)

For Complex issues, full codebase exploration before writing the plan. The cost (10–30 file reads) is worth it because the plan will be followed by an expensive coding agent that can't easily backtrack.

## What to read

### 1. Knowledge base
- `.forge/knowledge.json` — paths, domains, conventions, recipes
- Top-level `CLAUDE.md` and any per-package `CLAUDE.md`
- `README.md` for repo conventions

### 2. Schema / contracts
- `packages/core/src/db/schema.ts` (or equivalent) — find tables touched
- `packages/contracts/` (if the project has shared contracts package) — shared types
- API route files for the affected endpoints

### 3. Existing patterns
For every new thing the plan creates, find a similar existing thing and read it:
- New endpoint → read 1–2 existing endpoints in the same package
- New React component → read 1–2 similar components
- New hook → read 1 existing hook
- New migration → read the last 2 migrations in `drizzle/migrations/`

### 4. Tests
- Read 1–2 existing test files for the package to understand the testing pattern (test framework setup, mocking, fixtures).

### 5. Data flow trace
For a feature that spans backend → frontend, trace end-to-end:
- API definition (schema, route)
- DB layer (query, model)
- Frontend hook (React Query, fetch)
- Component (display)

This is where architectural mismatches are caught (e.g., backend returns ISO date string but frontend expects Date object).

## What NOT to read

- Generated code (`drizzle/meta/_journal.json`, type generators)
- `node_modules/`
- Test fixtures unless directly relevant
- Logs, build output

## When to stop reading

Done exploring when:
1. You can list every file the plan will touch.
2. You know the function/component names the plan will create or modify.
3. You can answer: "what pattern does the new code follow?"

If after 30+ file reads you still can't answer these, the issue is genuinely under-specified — bounce to `needs_info` with the specific gap.

## Grep over Read

When looking for "how is X done elsewhere":
- `Grep` first for the pattern across the package
- Then `Read` only the top 2 hits

Saves context vs reading entire files.

## Output

The exploration shouldn't be visible in the plan — write the plan as if you already knew the codebase. The plan reader doesn't need to see exploration steps; they need the concrete instructions.
