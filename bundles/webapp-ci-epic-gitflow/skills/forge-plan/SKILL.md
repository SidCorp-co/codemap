---
name: forge-plan
description: "Write implementation plans for confirmed Forge issues, and decompose epics onto a shared integration branch. Use this skill whenever an issue needs a plan before coding — exploring the codebase, identifying affected files, writing step-by-step instructions into the plan field — or when a large issue must be split into children that merge into one feature branch. Triggers on: /forge-plan, planning issues, writing implementation plans, decomposing epics, moving issues from confirmed to approved."
user_invocable: true
arguments: "documentId"
---

# Forge Plan (epic integration-branch profile)

This is the second step in the issue pipeline: `confirmed → approved`. Its job is to turn a triaged issue into a concrete implementation plan that a coding agent (or developer) can follow without re-exploring the codebase.

This profile adds **epic decomposition onto a shared integration branch**. When an issue is large enough to split, this skill creates children that all merge into one `feature/ISS-<n>` branch; only the parent later promotes that branch to `<baseBranch>`. Read `references/epic-branch-model.md` for the full model — it is the source of truth every skill in this profile follows.

Planning is the highest-value step in the pipeline. A good plan saves the coding step from wasting tokens on exploration, wrong turns, and rework.

## Usage

```
/forge-plan <documentId>
```

## Tools

`forge_issues`, `forge_comments`, `forge_config`, `forge_pm_set_dependency`, plus codebase exploration tools (Read, Glob, Grep) and `Bash` (to create the integration branch when decomposing).

## Two-Tier Planning

Not every issue needs deep codebase exploration. The planning depth should match the complexity:

**Lightweight plan (Simple/Medium):** Use `knowledge.json` + issue description + targeted Glob to identify files and write the plan. Read at most 1-2 source files. The coding agent reads the files during implementation anyway, so duplicate deep-reading wastes tokens.

**Deep plan (Complex):** Full codebase exploration. Read all affected files, trace dependencies, verify patterns. Complex issues involve architectural decisions where a wrong plan costs more than the exploration.

The tier is determined by the triage comment's complexity classification.

## Workflow

### Step 1: Fetch Issue & Triage Context

Fetch the issue and its comments in parallel:

```
forge_issues → get → { documentId: "<id>" }
forge_comments → list → { filters: { issue: "<documentId>" } }
forge_config → get
```

Verify status is `confirmed`. If the issue isn't confirmed yet, stop and explain — planning an untriaged issue skips the completeness check.

Find the triage comment (starts with `**Triage**`) and extract the **complexity** classification. This determines both the planning depth and the exit behavior.

Checkout the latest `<baseBranch>` (from `forge_config`) so exploration sees current code.

### Step 2: Understand the Issue

Read everything available: title, description, acceptanceCriteria / aiAcceptanceCriteria, suggestedSolution / aiSuggestedSolution, the triage comment, **attachments** (fetch and read each image/file), and **relations**.

Synthesize: what area of the system is affected, what the change should accomplish, and what constraints exist.

#### Handle Relations

If the issue has relations, fetch each related issue and apply:

- **`blocked_by` / `depends_on`** — if the blocker isn't `developed` or beyond, flag it as a prerequisite in the plan.
- **`related_to`** — note overlapping files so the plan accounts for merge conflicts.
- **`duplicate_of`** — shouldn't reach planning; if it does, stop and comment.
- **`caused_by` / `fixed_by`** — read for root-cause context.

### Step 3: Build the File Map

Read `.forge/knowledge.json` to resolve the issue into concrete file paths (`paths`, `domains`, `recipes`, `conventions`). Then use targeted Glob to confirm the files exist.

### Step 4: Explore (Depth Depends on Tier)

**Simple/Medium (lightweight):** the file list from knowledge.json + Glob is usually enough; read 1-2 files max.

**Complex (deep):** read `references/exploration-guide.md`; read all affected files, trace data flow, Grep for shared dependencies, read existing tests.

### Step 5: Write the Plan

Write the plan following `references/plan-format.md` into the issue's `plan` field:

```
forge_issues → update → { documentId: "<id>", data: { plan: "<markdown plan>" } }
```

### Step 5.5: Decide whether to decompose into an integration-branch epic

Decompose when the issue is a large feature that splits into **independently codeable slices that must ship together as one unit** to `<baseBranch>`. Read `references/epic-branch-model.md` before decomposing.

**When to decompose:**
- Each child is independently codeable and reviewable, but the feature only makes sense shipped whole.
- 2-6 children. (Children run **serially** under cap=1 — see the model doc — so more children means a longer wall-clock, not more parallelism.)
- The parent has a meaningful **integration test** over the combined result.

**When NOT to decompose:**
- Single-file changes, localized refactors, bug fixes — plan normally and exit (Step 6/7).
- Slices that should each ship to production on their own → that is the base `decomposes` model, not this one. Do not use this profile for that.

**How to decompose (integration-branch model):**

1. **Create the integration branch** from `<baseBranch>` and push it:
   ```bash
   git fetch <remoteName>
   git checkout <baseBranch> && git pull <remoteName> <baseBranch>
   git checkout -b feature/ISS-<id>
   git push -u <remoteName> feature/ISS-<id>
   ```
   `<id>` is the parent issue's short ISS number. Verify the push succeeded before continuing.

2. **Stamp the parent** as the epic. The parent works *on* the integration branch and later merges *to* `<baseBranch>`:
   ```
   forge_issues → update → {
     documentId: "<parent id>",
     data: { metadata: {
       useIntegrationBranch: true,
       integrationBranch: "feature/ISS-<id>",
       branchConfig: { baseBranch: "feature/ISS-<id>", targetBranch: "<baseBranch>" }
     } }
   }
   ```

3. **Create each child** at `approved` with its own scoped plan and branch config. Children branch off and merge back into the integration branch:
   ```
   forge_issues → create → {
     data: {
       title: "<child slice title>",
       description: "<scoped description>",
       plan: "<child-specific implementation plan>",
       status: "approved",
       priority: <inherit>,
       category: <inherit>,
       complexity: <inherit or per-slice>,
       manualHold: false,
       metadata: {
         integrationParent: "<parent documentId>",
         branchConfig: { baseBranch: "feature/ISS-<id>", targetBranch: "feature/ISS-<id>" }
       }
     }
   }
   ```
   Children start at `approved` so they go straight to `forge-code` (the parent's plan already scoped them; no per-child re-triage). Record each child's returned `documentId`.

4. **Set the barrier edges** — one per child, direction `child --blocks--> parent`:
   ```
   forge_pm_set_dependency → {
     projectId: "<projectId>",     // from Step 1: forge_config → get → response.project.id
     fromIssueId: "<childId>",     // child blocks...
     toIssueId:   "<parentId>",    // ...the parent
     kind: "blocks"
   }
   ```
   Verify each call returns `{ id, created: true|false }`. If a call throws `FORBIDDEN` or `CYCLE_DETECTED`, **stop and post a comment** — never claim a dependency in plan prose unless the MCP call landed. Do **not** use `kind: "decomposes"` here (see the model doc — it deadlocks against `blocks`).

   If some children must be coded in a fixed order (e.g. a shared-schema slice first), add `sibling-blocks` edges too — `fromIssueId` = the slice that ships first, `toIssueId` = the slice that waits, `kind: "blocks"`.

5. **Write the parent `plan`** as the index: one section per child (title, scope, files, acceptance criteria) plus a **Integration test** section describing what the parent verifies once all children land. Each child's own `description`/`plan` carries its implementation detail.

6. **Set the parent to `approved`** (status LAST). Its `forge-code` job enqueues immediately but is gated by the `blocks` edges until every child is marked merged — no human gate, no watcher.

7. **Post a decomposition comment** summarizing: which children, why this split, integration-branch name, what the integration test will verify.

After decomposing, **skip Step 6/7 below** — the epic exit is handled here.

### Step 6: Validate the Plan

For non-decomposed issues, sanity-check before posting: every "Affected Files" path exists, the steps cover all acceptance criteria, obvious risks are addressed.

### Step 7: Post Comment & Set Status

Non-decomposed issues exit by complexity (from the triage comment):

**Simple or Medium:**
```
forge_comments → create → { data: { body: "<plan comment>", issue: "<documentId>", author: "Alakazam" } }
forge_issues → update → { documentId: "<id>", data: { status: "approved" } }
```

**Complex:**
```
forge_comments → create → { data: { body: "<plan comment>", issue: "<documentId>", author: "Alakazam" } }
forge_issues → update → { documentId: "<id>", data: { status: "waiting" } }
```
Set `waiting` — Complex issues wait for a human to review the plan. **Status update is LAST.**

**If no triage comment found** (manual invocation): default to auto-approve (treat as Medium).

### Plan Comment Format

```markdown
**Plan** — <one-line summary of the approach>

**Affected files:** <count> files in <package(s)>
**Status:** <Auto-approved / Awaiting human approval / Decomposed into N children on feature/ISS-<id>>

The full plan has been written to the issue's plan field.
```

## Plan-specific output reminder

The plan goes to the API (`forge_issues → update` on the `plan` field), NOT to chat output. Don't print it twice. (See pipeline preamble for general output rules.)
