# Complexity Rules

Triage classifies issues as Simple / Medium / Complex. This determines:
- Whether `forge-clarify` runs (only Medium+).
- Planning depth: lightweight (Simple/Medium) vs deep exploration (Complex).
- Whether `forge-plan` auto-approves or sets `waiting` for human review (Complex → waiting).

## Simple

A single isolated change. Blast radius is one file or a tight cluster.

Examples:
- Copy / label / placeholder text edit
- Bump a single dependency version
- Add a missing `aria-label`
- Toggle a feature-flag default
- Fix a typo in a comment or docstring
- Change a single CSS value (color, spacing, font-size) in one component

## Medium

2–5 files touched, but all within the same package. Logic involved but architecture stays the same.

Examples:
- New endpoint following an existing pattern
- New form field with validation
- Refactor a hook to extract shared logic
- Add a column to an existing table
- New page that reuses existing layouts and components
- Fix a logic bug across a controller + service pair

## Complex

Crosses package boundaries OR introduces architectural decisions.

Examples:
- New schema with migration + API + UI + tests
- New cross-package dependency (e.g. types moved to a `contracts` package)
- Auth / permissions changes
- New external integration (webhook, third-party API)
- Performance optimization that changes data shape
- Anything requiring discussion about trade-offs

## When uncertain

Lean toward Medium. `forge-plan` reads the actual codebase and can upgrade to Complex during exploration. The auto-approve in Medium is a calibrated risk — for genuinely Complex issues that slip through as Medium, the coding agent's self-review or `forge-review` will catch the architectural gap and reopen.
