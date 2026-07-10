---
name: ui-discover
description: "Discover live external UI/UX resources via web search; return a verified, filtered shortlist (2-4), not a dump. Auto-detects mode: explore (styles/trends), implement (libs/templates verified on GitHub/npm), chart (chart type + anti-patterns)."
---

# UI Discover

Find what already exists — live, from the web — and return a **short, verified, filtered** recommendation. The skill's value is NOT the search; raw search results mix gems with SEO farms. The value is the filter + verify + synthesis discipline below. Never dump a long list.

## Core principle

> Search wide, recommend narrow. Every named library/template MUST be verified before you recommend it. Drop SEO template farms. Return 2–4 items with evidence, never a raw list.

## 1. Detect the mode

Infer from the request; state which mode you picked in one line.

| Mode | Trigger | Goal |
|---|---|---|
| **explore** | "inspiration", "trend", "ideas", "how should this look", vague visual direction | Fresh UI/UX styles & design ideas |
| **implement** | "what library/component/template for X", "is there an existing X", building/setting up a project, a named stack | Reusable libs/components/templates that exist today |
| **chart** | "which chart", "how to visualize", a description of data/metrics | Right chart type for the data + anti-patterns |

If genuinely ambiguous, ask one short question. If the request spans modes (e.g. "build a dashboard with charts"), run implement then chart.

## 2. Build the query

Pattern: `<context/domain> + <artifact type> + <stack/constraint> + <current year>`

- **Always append the current year** — the FE ecosystem moves fast; you want what ships now.
- **implement**: always include the stack keyword the user is on (React / Next.js / shadcn / Tailwind / Vue / Flutter…). If unknown, infer from the repo or ask.
- **chart**: describe the data by *number of variables + variable types + intent* (comparison / trend / part-to-whole / relationship / distribution / flow). Search the intent, not just "chart".

Run 1–3 focused queries. Fetch a promising source with WebFetch when the snippet isn't enough.

## 3. Rank sources by trust (3 tiers)

| Mode | Tier 1 — trust, prefer | Tier 2 — leads only, then verify | Tier 3 — drop / distrust |
|---|---|---|---|
| explore | Dribbble, Mobbin, Figma Community, Awwwards, Muzli, Godly, Land-book | Medium / dev.to, roundup blogs | SEO template farms, image-only boards |
| implement | **GitHub** (verify!), official docs, npm trends | listicle roundups ("N best…"), vendor UI blogs | blogs selling a single product |
| chart | data-to-viz.com, datavizproject.com, datavizcatalogue.com, FT Visual Vocabulary, Datawrapper blog | vendor charting blogs | content-marketing pushing one tool |

## 4. Verify before recommending (MANDATORY for implement)

Any library/template you name must pass a verification check — do not recommend on the strength of a listicle alone:

- **GitHub**: stars, **last commit < ~6 months**, open-issue health, license.
- **npm**: weekly downloads (is it actually used?).
- Prefer sources citing concrete evidence (stars, dates, downloads) over adjective-heavy prose.
- If you can't verify it, say so and downgrade confidence — don't present it as a top pick.

Use WebFetch on the GitHub repo / npm page, or the github MCP tools, to confirm. Ecosystem churns fast — freshness matters.

## 5. Output shape

- **Shortlist of 2–4**, not a dump. If you cut candidates, say so — never imply you covered everything.
- Each item: **name + why it beats the others + link + one verified fact** (stars / weekly downloads / last commit).
- Be opinionated: name the single top pick and why over the runner-up.
- **explore**: 2–4 concrete references (with links) + the named style/pattern so the user can search further; note the recurring design cues you saw.
- **chart**: recommended chart type + **the anti-pattern to avoid** (e.g. "pie hides conversion rate — use a funnel") + which library renders it in the user's stack. Then stop — rendering is the build step's job.

## Boundaries

- **This skill DISCOVERS and FILTERS only.** It does not decide the final style, pick palette/font, or write/render code. Its job ends at "here is the verified resource + the named pattern."
- Hand the output to whatever build/styling step the project uses — direct implementation, or an installed helper skill **if present**. Downstream styling/rendering skills are OPTIONAL — never assume they exist and never block on them.
- WebSearch is US/EN-biased — acceptable for UI/UX, but say so if it likely skews results.
