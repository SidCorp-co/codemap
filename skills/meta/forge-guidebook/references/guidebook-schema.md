# guidebook.json schema & worked example

Load this in Step 6 (write the manifest) and whenever you need a gold-standard output to anchor on. The manifest is the integration contract — one artifact that an SSG sidebar, a future RAG/chat, and in-app help all read.

## Schema

| Field | Type | Notes |
|---|---|---|
| `project.slug` | string | from `forge_projects → get` / `forge_config`, else repo `package.json` name |
| `project.name` | string | display name |
| `generatedAt` | string (ISO 8601) | generation timestamp |
| `nav` | array of node | sidebar tree; shaped to drop into Docusaurus/Starlight |
| `nav[].title` | string | section/page label |
| `nav[].path` | string \| null | relative path to a `.md`, or null for a pure group |
| `nav[].children` | array of node | nested nodes (same shape); `[]` if leaf |
| `journeys` | array | one per tutorial |
| `journeys[].id` | string | kebab id, matches the page filename |
| `journeys[].title` | string | friendly title |
| `journeys[].role` | enum | `any` \| `developer` \| `pm` \| `admin` |
| `journeys[].screens` | string[] | routes the journey touches (must exist in discovery) |
| `journeys[].page` | string | relative path to the tutorial `.md` |
| `media` | array | one per image slot referenced by any page |
| `media[].id` | string | kebab id; matches the image filename stem |
| `media[].page` | string | page that references this image |
| `media[].route` | string | route to navigate to for the shot |
| `media[].recipe` | string[] | exact steps to reproduce the screenshot |
| `media[].status` | enum | `pending` \| `captured` \| `reused` |
| `media[].path` | string | relative path under the output dir |

Rules: every inline `![](...)` in a page has exactly one matching `media[]` slot, and vice-versa. `status: pending` means the image isn't on disk yet (text docs still complete). `captured`/`reused` means `path` points to a real file.

## Worked example

### `tutorials/get-started.md`

```markdown
---
id: get-started
title: Get started
sidebar_position: 1
---

# Get started

By the end of this guide you'll be signed in, your device connected, and your first project created.

**Before you start:** an account and access to the codebase you want to manage.

## Steps

1. Sign in. Go to `/login` and enter your email and password.
2. Connect your device. Go to `/connect-device` and follow the pairing prompt.
   ![Device pairing screen](../assets/screenshots/connect-device.png)
3. Create a project. Go to `/projects` and click **New project**, then point it at your repository.
   ![New project dialog](../assets/screenshots/create-project-dialog.png)

> **Expected result:** your new project appears on the projects list and opens to its dashboard.

## Troubleshooting

- **Pairing code expired** — reopen `/connect-device` to get a fresh code.
- **Repository not listed** — confirm your account has access, then refresh the page.
```

### Matching `guidebook.json` (excerpt)

```json
{
  "project": { "slug": "<projectSlug>", "name": "<projectName>" },
  "generatedAt": "2026-01-01T00:00:00Z",
  "nav": [
    { "title": "Getting started", "path": "intro.md", "children": [
      { "title": "Get started", "path": "tutorials/get-started.md", "children": [] }
    ] }
  ],
  "journeys": [
    {
      "id": "get-started",
      "title": "Get started",
      "role": "any",
      "screens": ["/login", "/connect-device", "/projects"],
      "page": "tutorials/get-started.md"
    }
  ],
  "media": [
    {
      "id": "connect-device",
      "page": "tutorials/get-started.md",
      "route": "/connect-device",
      "recipe": ["Go to /connect-device", "Screenshot the pairing screen"],
      "status": "pending",
      "path": "assets/screenshots/connect-device.png"
    },
    {
      "id": "create-project-dialog",
      "page": "tutorials/get-started.md",
      "route": "/projects",
      "recipe": ["Go to /projects", "Click \"New project\"", "Screenshot the dialog"],
      "status": "pending",
      "path": "assets/screenshots/create-project-dialog.png"
    }
  ]
}
```

After writing the output, run `scripts/verify-guidebook.py <outputDir>` to confirm the manifest and cross-references are well-formed.
