---
name: forge-guidebook
description: "Generate friendly, task-oriented end-user docs for a Forge project from source: journey tutorials and how-tos plus a guidebook.json manifest in docs/guidebook/. Use when building user docs, writing a user guide, or generating a product guidebook."
user-invocable: true
argument-hint: "[outputDir] [--capture-media]"
---

# forge-guidebook — task/journey end-user documentation generator

Turns a Forge project's source of truth (web feature modules, app routes, the pipeline registry, `knowledge.json`) into **friendly, journey-based** end-user documentation. The voice is task-oriented — "you → click → see" — not an API reference. The skill is a **generator only**: it produces content + a manifest. It never builds a renderer, a chat UI, or a docs framework. Those are future consumers of the manifest.

The whole generation runs **read-only against the codebase with no app running**. Real screenshots are an optional, separate step (see Media), so updating docs never requires deploying the app.

## Usage

```
/forge-guidebook [outputDir] [--capture-media]
```

- `outputDir` — where to write. Default `docs/guidebook/`.
- `--capture-media` — opt in to capturing real screenshots (Tier 1). Off by default.

## Tools

`Read`, `Glob`, `Grep`, `Write`. Optional: Forge MCP (`forge_projects`, `forge_config`, `forge_issues`, `forge_pipeline_runs`) for project identity and realistic sample data; `Bash` + a browser tool only when `--capture-media` is set.

## Output

```
<outputDir>/
├── guidebook.json            # MANIFEST — nav, journeys, page↔route map, media registry
├── intro.md                  # what the product is, who it's for, where to start
├── tutorials/                # end-to-end journeys (Diataxis "tutorial")
│   ├── get-started.md
│   ├── run-issue-pipeline.md
│   └── monitor-progress.md
├── how-to/                   # single focused tasks (Diataxis "how-to")
│   ├── set-up-mcp.md
│   ├── manage-tokens.md
│   └── admin-users-projects.md
└── assets/screenshots/       # filled only when media is captured (Tier 1)
```

Every `.md` carries Docusaurus/Starlight-compatible frontmatter and a consistent body shape (see Page template).

## Workflow

### Step 1 — Resolve target

- Read the `outputDir` argument; default to `docs/guidebook/` under the repo root.
- Resolve project identity: if Forge MCP is wired, `forge_projects → get` / `forge_config` for name + slug + `<baseBranch>`; otherwise fall back to the root `package.json` `name` and `CLAUDE.md`.
- Do not assume a fixed package path. Locate the web package by globbing for the Next.js app dir (`**/src/app/**/page.tsx`); the package that contains it is the web UI. Locate feature modules under that package's `src/features/`.

### Step 2 — Discover the surface (read-only, no app needed)

Gather what the user can actually do, from code:

1. **Screens & URLs** — `Glob **/src/app/**/page.tsx`. Each `page.tsx` is a user-facing route; derive its URL from the path (strip route-group folders like `(auth)`/`(protected)`, keep `[param]` segments). This is the canonical screen list.
2. **Capabilities per screen** — for each relevant feature, read `src/features/<domain>/{api.ts,types.ts}` to learn the actions and data the screen exposes (what buttons/flows exist, what entities are shown). Read at most 1–2 component files only when a step's wording needs a real control name.
3. **The pipeline journey** — read the pipeline registry under the shared contracts package (`**/contracts/**/pipeline-registry*.ts`) for the ordered step sequence (triage → clarify → plan → code → review → test → release → fix). This drives the central tutorial.
4. **Domain language** — skim `.forge/knowledge.json` and `CLAUDE.md` so the docs use the project's own vocabulary.
5. **Optional live examples** — if Forge MCP is wired, `forge_issues` / `forge_pipeline_runs` for realistic sample names. In prose use only obvious example markers (e.g. `example.com`, a placeholder issue number) — never paste real UUIDs, hostnames, or tokens.

### Step 3 — Map journeys

Match the discovered screens against the built-in journey templates, tagging each with a primary role. A screen that fits no journey but is clearly user-facing becomes a **how-to** candidate.

The journey templates, how-to candidates, role tagging, and the coverage rule live in **`references/journey-catalog.md`** — load it for this step. Adapt every title/step to what Step 2 actually found; drop a journey whose screens don't exist.

### Step 4 — Write pages

For each journey write one tutorial; for each how-to candidate write one how-to. Tie every step to a **real route and control name** found in Step 2 — never invent UI that the code doesn't have. Insert media references inline as `![<alt>](../assets/screenshots/<mediaId>.png)` and register a matching slot in the manifest (Step 6).

The page template, voice rules, and the section-by-section conventions (intro, before-you-start, steps, expected-result, troubleshooting) live in **`references/page-template.md`** — load it for this step.

### Step 5 — Media (3-tier, default Tier 3)

Each place that benefits from an image gets a manifest media slot. Resolve each slot by the highest available tier:

- **Tier 1 — capture** (only if `--capture-media` AND a browser tool is available): run the slot's `recipe` against a locally running web app, save the PNG to `assets/screenshots/<mediaId>.png`, set `status: "captured"`.
- **Tier 2 — reuse**: if a fitting asset already exists in the repo (an existing diagram or exported HTML), link it and set `status: "reused"`.
- **Tier 3 — placeholder (default)**: emit the slot with a precise `recipe` (navigation + clicks needed to reproduce the shot) and `status: "pending"`. The markdown still renders; the image is filled later by re-running with `--capture-media`. **No app needs to run for the docs to be complete as text.**

### Step 6 — Write `guidebook.json`

The manifest is the integration contract — one artifact many consumers (an SSG sidebar, a future RAG/chat, in-app help) can read. `nav` is shaped to drop straight into a Docusaurus/Starlight sidebar; `media[].status` of `pending` | `captured` | `reused` lets a later pass fill images without touching prose.

The full field-by-field schema and a complete worked example (a sample tutorial + matching manifest) live in **`references/guidebook-schema.md`** — load it for this step.

### Step 7 — Verify

Run the helper, then self-check anything it can't see:

```
python3 scripts/verify-guidebook.py <outputDir>
```

It fails on: missing `intro.md`, manifest that doesn't parse or lacks top keys, nav/journey/media paths that don't exist on disk, invalid role/status, captured/reused media with no file, dead intra-doc links, and inline image refs without a matching `media[]` slot (and vice-versa, as a warning).

Then verify by reading what the script can't: every route referenced in a page appears in the Step-2 screen list (no invented screens), and the prose is friendly and task-first.

## Output format (chat summary at end)

```
## Generated guidebook → <outputDir>
- Tutorials: <n>  How-tos: <n>
- Media slots: <captured>/<total> captured (<pending> pending)
- Manifest: guidebook.json (<journeys> journeys, <nav> nav nodes)

## Next steps
- Render: point Docusaurus/Starlight at <outputDir> (nav mirrors guidebook.json).
- Fill images: re-run `/forge-guidebook <outputDir> --capture-media` with the app running.
```

## Constraints

- **Generator, not framework.** Produce markdown + manifest + assets only. Never scaffold a renderer, chat, or deploy pipeline.
- **Source-truthful.** Every step maps to a real route/control found in code. If a feature isn't in the code, it isn't in the docs.
- **Runs cold.** Full text docs generate with no app running and no network. Media capture is the only step that may need a live app, and it is opt-in.
- **Project-agnostic.** Discover paths by globbing; never hardcode a package path, project name, host, or token. Resolve per-project values from config / Forge MCP at runtime.
- **Friendly + task-first.** Second person, short steps, expected-result and troubleshooting on every page. Reference, explanation, and exhaustive option lists are out of scope.
- **Idempotent.** Re-running regenerates pages and merges media status (keeps `captured`/`reused`, refreshes prose); it does not duplicate files.
- **English content.** Docs and manifest are English; the chat summary matches the user's language.

## Boundary with related skills

- `forge-memory-builder` curates Claude Code auto-memory — a different artifact (cross-session memory, not user docs).
- Pipeline skills (`forge-plan`, `forge-code`, …) run the issue pipeline; this skill documents the product for its users. Defer to those for pipeline execution.
