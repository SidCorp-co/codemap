# Improvement playbook

Each proposed change in the draft issue should cite one of these principles, so the human reviewer sees the *rationale*, not just the edit. Distilled from Anthropic's prompt/skill/memory guidance and community skill libraries.

## Prompt-design principles (Anthropic)

- **literal-scope** — Opus 4.x is literal. An instruction that doesn't state its scope ("format the section") may apply to only the first instance. Fix: state scope explicitly — "apply to every affected file/section, not just the first." Use when auditing finds an instruction the agent under-applied.
- **avoid-aggressive-language** — Newer models over-trigger on "CRITICAL / YOU MUST / NEVER." Replace with calm conditional phrasing — "Use this tool when…", "Before pushing, run…". Reserve emphasis for the one or two genuinely load-bearing rules. Use against `over-aggressive-language` findings.
- **coverage-before-filtering** — For review/audit stages, instruct the agent to enumerate findings first and filter second; otherwise it self-censors and under-reports. Use against `rubber-stamp` / `coverage-gap`.
- **explain-why-not-just-what** — A rule the agent understands the reason for is followed more reliably than a bare directive (the Constitution principle). When a stage skips a step, adding the *why* often fixes it better than adding emphasis.
- **role-then-constraints-then-task** — System prompt = one-line role + standing "always/never" constraints + output format. Variable per-issue context belongs in the user turn, not the system prompt. Use against per-state prompts that inline per-issue detail (also helps prompt-economy).
- **structure-with-xml-or-headings** — Distinct content types (instructions, exit contract, examples, constraints) wrapped in tags/headings yield more consistent output than a prose wall. Use when a skill body is an unstructured paragraph dump.
- **context-high-instructions-low** — Long reference material goes near the top; the actionable instruction/exit contract goes last where the model attends most. Use when a skill buries its exit contract mid-body.

## Prompt-economy

- **prompt-economy** — Every line in a skill/prompt is a recurring per-job token cost and cache consideration. Cut narration, history, and one-time notes; keep standing instructions. Prefer `append` overrides (preserve the shared cache-friendly preamble) over `replace` (cache-miss every job). Use against `token-bloat`.
- **progressive-disclosure** — Keep the skill body lean; move long rubrics/examples to `references/*.md` loaded on demand. A 500+ line SKILL.md is a smell. Use when proposing to split a bloated skill.

## Skill-authoring

- **description-as-trigger** — A skill is auto-selected from its `description`; put the primary use-case and concrete trigger phrases first (it's truncated in listings). Use when a skill isn't firing when it should, or fires when it shouldn't.
- **exit-contract-specificity** — A stage skill must state its exit precisely enough that the next stage needs no re-derivation. The plan-stage exemplar: name every affected file with the specific change. Use against `vague-plan` / `silent-divergence` / `lossy-handoff`.
- **focused-single-purpose** — One skill, one job. If audit findings show a skill straddling two stages' concerns, propose splitting. 

## Verdict / gate patterns (community)

- **verdict-4-level** — Replace binary pass/fail gates with `PASS / CONCERNS / FAIL / BLOCKED`-style enums (ln-500-story-quality-gate). Captures "advanced but defective," which is exactly the hidden-defect case. Use when a stage's exit is a crude boolean.
- **categorized-failure-output** — A judge/review stage should emit the *failure category*, not just a verdict (system-prompt-learning loop). Actionable downstream. Use to upgrade a review/test skill that only says approve/reject.
- **adversarial-verify** — High-stakes findings/claims get independent refute passes before they're trusted; default-refuted under uncertainty. Use when proposing a stricter review or QA gate.
- **multi-criteria-checklist** — For validation stages, an explicit weighted checklist (ln-310-multi-agent-validator) beats freeform "review this." Use to harden a thin review/test skill.

## Memory

- **behavior-changing-memory-only** — A memory entry earns its place only if it changes what the agent does next time; documentation/history does not. Use when proposing a pgvector memory write — state the behavior it changes. Pure staleness/duplication cleanup defers to `forge-memory-builder`.
- **facts-not-procedures** — CLAUDE.md / knowledge holds standing facts (commands, conventions, "always X"); multi-step procedures belong in skills. Use when a finding wants to add a workflow to CLAUDE.md — redirect it into a skill instead.

## Self-eval loop (why this skill exists)

- **judge-rubric-is-the-ceiling** — The quality of a self-improvement loop is bounded by the judge rubric, not the volume of runs analyzed (Arize system-prompt-learning). Investing in `references/rubric.md` matters more than sampling more issues. If audits feel shallow, sharpen the rubric before widening the sample.
- **propose-then-human-gate** — Proposed prompt/skill edits land as reviewable drafts, never auto-applied, with rollback implicit (the human merges or discards). This skill embodies that; keep it that way.

## Source pointers (for the curious reviewer; not loaded at runtime)

- Anthropic prompt-engineering guide + Claude Code skills/memory docs (platform.claude.com, code.claude.com).
- ComposioHQ/awesome-claude-skills; levnikolaevich/claude-code-skills (verdict + validator patterns); trailofbits/skills (differential-review, fp-check).
- Arize "System Prompt Learning for Coding Agents" (LLM-as-judge → meta-prompt loop); OpenAI Cookbook self-evolving agents; EvalPlanner (thinking-LLM-as-judge).
