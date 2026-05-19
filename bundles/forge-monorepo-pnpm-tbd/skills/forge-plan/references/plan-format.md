# Plan Format

The plan goes into the issue's `plan` field via `forge_issues → update`. It must be markdown, structured so the coding agent can follow step-by-step without re-exploring the codebase.

## Required sections

### 1. Goal (1 paragraph)

What the change should accomplish in plain language. No code, no file paths. The reader should understand the intent in 30 seconds.

### 2. Affected Files

Every file that will be modified, created, or deleted. Group by package:

```
**packages/core**:
- `src/feature/route.ts` — new endpoint POST /api/feature
- `src/feature/schema.ts` — new request/response schemas
- `src/db/schema.ts` — add `feature` table

**packages/web**:
- `src/features/feature/FeatureForm.tsx` — new component
- `src/features/feature/hooks/useFeature.ts` — React Query hook
```

### 3. Implementation Steps

Numbered steps, each scoped to one logical unit of work. Each step is a clear input → action → output.

For Simple/Medium plans, focus on *what* — the coding agent figures out *how* by reading code.

For Complex plans, be concrete about *both* — name functions, reference existing patterns by file path.

### 4. Acceptance Criteria Coverage

Map each `acceptanceCriteria` line in the issue to which implementation step addresses it. Catches plans that miss requirements.

```
- AC1: User can submit form → Step 3 (form component) + Step 5 (endpoint)
- AC2: Validation prevents empty input → Step 4 (Zod schema)
- AC3: Successful submit shows toast → Step 6 (success handler)
```

### 5. Relations (only if relevant)

Include only when relations affect implementation (overlapping files with another in-flight issue, dependency on an in-progress schema change). Skip if relations are informational.

### 6. Risks / Edge Cases

Anything the coding agent should be aware of that isn't obvious from the steps:
- Migration safety concerns
- Backward compatibility implications
- Performance / data volume considerations
- Hard-to-test edge cases

Keep this short — 2–4 bullets. If the list grows, the plan probably underestimated complexity; consider escalating to Complex.

## Length guide

- Simple: 15–25 lines total
- Medium: 30–60 lines
- Complex: 80–200 lines

Plans longer than 200 lines suggest the issue should have been decomposed at triage. Note this in the comment but proceed; PM can split later.

## Output rules

- Markdown only — the plan goes into a markdown field.
- No file paths from outside the project root.
- English only.
- Don't include implementation code in the plan — only paths + behaviour intent. Actual code lives in the files, written by `forge-code`.
