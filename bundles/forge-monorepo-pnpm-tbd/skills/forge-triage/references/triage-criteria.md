# Triage Criteria

An issue is "actionable" — ready to leave `open` for `confirmed` — when a developer reading it cold can answer:

1. **What changes?** A specific page, endpoint, file, or behaviour is named.
2. **What does done look like?** Either explicit `acceptanceCriteria` OR enough context for a developer to write them.
3. **Where?** A page URL, file path, component name, or feature area is identifiable.
4. **For bugs**: reproduction steps OR enough evidence to reproduce (error message, screenshot, video).
5. **For features**: motivation OR a clear before/after.

If any of these is genuinely missing AND can't be inferred from context, route to `needs_info` with a specific question.

## Auto-accept patterns

These usually pass even when terse:
- Bug with stack trace or screenshot — the evidence is the description.
- "Update copy of X to Y" — explicit text change.
- "Bump dependency X to vY.Z" — explicit upgrade.
- Issue title that is already a complete spec ("Disable submit button while form is pristine").

## Auto-reject patterns

These usually need clarification:
- One-line vague issues: "this is broken", "doesn't work", "make it better".
- Multiple unrelated concerns bundled in one issue ("fix the navbar AND speed up loading AND add dark mode").
- Issues describing only motivation without an action ("we should improve UX").
- Issues with screenshots but no text describing what's wrong with them.

## Borderline

For genuinely borderline issues, **lean toward accepting**. The plan step will catch ambiguity and can bounce back. Bouncing at triage delays cheap stages; bouncing at plan only delays expensive ones if the plan agent has to backtrack.

## Specific-question rule for `needs_info` comments

Don't ask vague questions — they waste a round trip.

❌ "Can you provide more detail?"
❌ "What did you mean by X?" without quoting X
❌ Anything answerable by reading the codebase — triage doesn't read code

✅ "What URL does this happen on?"
✅ "Is this affecting all users or only X role?"
✅ "What did you expect to see instead?"
✅ "Quote: 'X is broken'. Which part of X — the form submission or the validation message?"
