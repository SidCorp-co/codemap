# Journey catalog & how-to candidates

Load this in Step 3 (Map journeys). These are starting templates, not a fixed list. Adapt every title/step to what Step 2 actually discovered, and **drop any journey whose screens don't exist** in the project.

## How to use the catalog

1. For each template below, check whether its typical screens were found in Step 2's screen list.
2. If yes, write a tutorial for it; adapt the story and steps to the real routes and controls.
3. If a screen exists but fits no journey and is clearly user-facing, make it a **how-to** instead.
4. Tag each page with a primary role so the manifest can group by audience.

## Built-in journey templates (tutorials)

| Journey id | Role | Typical screens (match against discovery) | Story arc |
|---|---|---|---|
| `get-started` | any | register/login, connect-device, projects, project setup | Sign in, connect your device, create your first project |
| `run-issue-pipeline` | developer | project detail, pipeline, pipeline-run, jobs | Create an issue and follow it through the pipeline to release |
| `monitor-progress` | PM | dashboard, pipeline, usage, chat-logs | Track work, watch pipeline runs, and read cost/usage |

### The pipeline tutorial

`run-issue-pipeline` is the central journey. Build its step order from the pipeline registry discovered in Step 2 (typically triage → clarify → plan → code → review → test → release → fix). Each registry step becomes a stage in the story: what the user does, what the agent does, what the user sees next. Use the project's own step names — do not hardcode the list above if the registry differs.

## How-to candidates (single-task)

Emit one only when the matching screen was discovered:

| How-to id | Screen it documents |
|---|---|
| `set-up-mcp` | MCP settings |
| `manage-tokens` | tokens settings |
| `manage-notifications` | notification settings |
| `manage-devices` | devices settings |
| `admin-users-projects` | admin users / projects |

## Role tagging

Use the role to populate `journeys[].role` in the manifest and to order pages (any → developer → PM → admin). Roles seen in Forge projects: `any`, `developer`, `pm`, `admin`. Pick the primary audience; a journey can mention other roles in prose but gets one tag.

## Coverage rule

Idea-2 docs are journey-first, **not** exhaustive reference. Cover the main journeys and the high-value how-tos well; do not generate a page per route. A screen that only ever appears mid-journey does not need its own how-to.
