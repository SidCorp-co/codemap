# Review checklist — forge-review Step 6

Run through the full checklist against the diff. Each finding gets a severity tag (`blocker` / `major` / `minor` / `nit`) — see [`SKILL.md` Step 8](../SKILL.md) for how severity maps to verdict.

## Bugs & logic

- Wrong logic, off-by-one errors, control-flow mistakes.
- Null/undefined risk — missing optional-chaining where data shape allows null.
- Race conditions — shared state mutation, concurrent fetches without dedupe.
- Missing error handling at boundaries (DB calls, network, parsing).
- Throw-vs-return-vs-default inconsistencies within a code path.

## Security

- Injection: SQL, command, XSS, prototype pollution.
- Credentials in code: hardcoded keys, tokens in commits, console.log of secrets.
- Missing auth checks on new endpoints / mutations.
- Unsanitized user input flowing into queries, HTML, file paths.
- Broken access control: caller can act on another tenant's data, missing org/user scope filter.

## Performance

- N+1 queries — loops that issue per-row DB calls.
- Unnecessary re-renders — non-memoized callbacks/objects passed as props, missing key.
- Memory leaks — listeners/intervals not cleaned up in useEffect cleanup or component unmount.
- Unbounded data — queries without `LIMIT`, pagination, or guard.
- Missing indexes — new WHERE clauses on columns without coverage.

## TypeScript

- Unsafe casts (`as unknown as X`, `as any`).
- `any` leaks (any in return type, any from a third-party that's not narrowed).
- Missing type narrowing — branching on a union without exhaustive check.
- Generics used where concrete type would be clearer.

## React (web only)

- Wrong useEffect deps (missing, extra, or stale).
- State updates on unmounted components — missing cleanup or AbortController.
- Unstable keys in lists (using index where order changes).
- Hydration risks — server vs client render mismatch from `Date.now()`, `Math.random()`, or browser-only API calls.

## Migration safety (when SQL files in diff)

- NOT NULL added to populated table without backfill → migration breaks production.
- Missing rollback path — production-blocking changes need a documented revert.
- ON DELETE behavior — CASCADE may fire on production data unexpectedly.
- New indexes on large tables — CREATE INDEX should be CONCURRENTLY (Postgres) or the migration locks the table.

## English-only (project rule)

Any new UI string, comment, identifier MUST be English. See [`../../README.md` § English-only rule](../../README.md). Non-English text in user-facing copy = `blocker`.

## Consistency

- Matches project patterns — check sibling files for the established convention.
- Cross-package parity — if changing a type in `forge/contracts/`, downstream consumers in `forge/core/` and `forge/web/` must update in the same PR or via documented follow-up.
- Naming — does it match the project's existing vocabulary?

## Severity guide

- **`blocker`** — bug that ships incorrect behavior, security risk, broken access control, migration that'll fail in prod, English-only violation in user-facing copy.
- **`major`** — performance regression that affects users, missing test for new behavior, broken accessibility on a primary surface.
- **`minor`** — code-style inconsistency, missing docstring on exported API, suboptimal but functional logic.
- **`nit`** — naming preference, comment phrasing, optional refactor.

Only `blocker` severity gates the verdict (`REQUEST CHANGES` vs `APPROVE`). Non-blocker findings are recorded in the comment so they can be picked up by `forge-fix` opportunistically, but they do not halt the chain.
