# Page template & voice — tutorials and how-tos

Load this when writing or revising a guidebook page. Every page (tutorial or how-to) uses the same shape and voice.

## Voice rules

- **Second person, task-first.** "You" do things. Lead with the goal, not the mechanism.
- **Short imperative steps.** One action per numbered step. Prefer "Click **New project**" over describing component internals.
- **Real controls only.** Every button/field/route named must exist in the code discovered in Step 2. Never invent UI.
- **Friendly, not chatty.** No marketing fluff, no "simply"/"just". Plain and encouraging.
- **English content.** Page body and frontmatter are English.

## Frontmatter (Docusaurus/Starlight-compatible)

```markdown
---
id: <kebab-id>            # unique within the guidebook
title: <Friendly Title>   # sentence case
sidebar_position: <n>     # order within its section
---
```

## Body shape

```markdown
# <Friendly Title>

<One or two sentences: what you'll accomplish and why it matters.>

**Before you start:** <prerequisites — account, role, an existing project, etc.>

## Steps

1. <Plain-language action>. Go to `<route>` and <do X>.
   ![<alt text>](../assets/screenshots/<mediaId>.png)
2. <Next action> …

> **Expected result:** <what the user should now see / what changed.>

## Troubleshooting

- **<Symptom the user might hit>** — <cause and the fix.>
- **<Another symptom>** — <fix.>
```

## Rules per section

- **Intro sentence** — outcome-focused. "By the end you'll have a project connected to your repo."
- **Before you start** — only true prerequisites surfaced from the code/flow (auth state, role, prior journey). Omit the block if there are none.
- **Steps** — numbered, each tied to a concrete route from Step 2. Add a media ref only where a screenshot genuinely helps (a dialog, a non-obvious screen); not on trivial steps. Each media ref must have a matching `media[]` slot in the manifest.
- **Expected result** — always present, as a blockquote callout. It's how the reader self-checks success.
- **Troubleshooting** — at least one realistic item derived from the flow (e.g. permission/role gate, empty-state, a required field). Omit only if genuinely nothing can go wrong.

## How-tos vs tutorials

Same template. The difference is scope, not shape:

- **Tutorial** — an end-to-end journey across several screens; "Before you start" is light; the reader learns by completing the whole flow.
- **How-to** — one focused task on usually one screen; assumes the reader already knows the basics; more prerequisites, fewer steps.
