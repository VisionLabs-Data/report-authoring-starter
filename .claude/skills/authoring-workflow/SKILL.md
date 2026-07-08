---
name: authoring-workflow
description: >-
  The end-to-end loop for authoring a client report in this repo and shipping it to the
  Reporting Suite portal — plan, explore the client's BigQuery schema over MCP, author split-file
  HTML/CSS/JS, build, sync as a draft for preview, and publish. Use this whenever the
  user wants to build, create, edit, preview, publish, or sync a report/dashboard, e.g.
  "build a report", "add a chart to the overview", "publish it", "why isn't it syncing".
---

# Authoring Workflow

Reports are authored as **files in this repo** (version-controlled, fully custom) and
shipped to the portal with the sync script. The MCP tools are your data-exploration and
validation tier; the files are the delivery tier.

## 0. Which client?

Each `clients/{slug}/` folder is one client, bound to a portal client in
`portal.config.json`. For MCP exploration, call `list_clients` then `select_client`
with the same client.

**New client:** if the key has the Clients capability, call the `create_client` MCP tool
(returns `{ id, slug }`), then wire it into the repo — bind `portalClientId` to the returned
`id` in `portal.config.json` under a folder name you pick (a kebab label, NOT the returned
uuid), scaffold `clients/{label}/client.config.json` + `reports/`, and tell the user to set
up the client's BigQuery integration in the portal admin before authoring live-data reports.
See the "Creating a new client" section in CLAUDE.md for the full sequence. (No Clients
capability? Create the client in the portal admin and just add the binding + folder here.)

## 1. Plan

Load the **report-planner** skill. Know the story before writing files: headline
metric, breakdowns, time range. If vague, ask one or two sharp questions.

## 2. Explore the data (MCP)

- `get_client_schema` — the client's authorized BigQuery tables + columns. This is
  the ONLY source of table names. If the data isn't there, tell the user their data
  pipeline needs the table added — never guess refs.
- Draft each SQL query, then confirm it with `validate_query` (dry-run: returns
  columns + bytes, or the rejection reason). Parameterize dates with `@date_start` /
  `@date_end`.

## 3. Author the files

Load the **report-builder** skill for the full contract. In short:

- `clients/{slug}/reports/{id}.report.json` — `id` (== filename, kebab-case), `title`,
  `description` (the AI sidebar reads this — write it well), `data_mode: "live"`,
  `interactivity: "interactive"`, `source_tables`, `queries{}`, `filters[]`,
  `portal: { sync: true, status, category }` (`status`: `"published"` default, or
  `"draft"` to sync-but-hide while in progress — see report-builder for details).
- `clients/{slug}/reports/{id}/` — `template.html` (body only; the platform provides
  the page shell, base CSS, and Chart.js), `styles.css`, `01-*.js` (numbered order).
- Data binding: declarative `.vl-metric` / `.vl-chart` / `.vl-table-wrapper` elements,
  or `VL.onData("queryName", rows => ...)` for custom rendering.

## 4. Build → draft → preview → publish

```bash
npm run build -- {client} {id}       # split files → {id}.report.html
npm run sync -- {client} --draft     # push draft → PREVIEW URL printed
# open the preview, iterate: edit → build → sync --draft (same draft updates)
npm run sync -- {client}             # publish → live in the client's portal
```

- Never claim a report is shipped unless the sync output shows `create`/`apply`.
- Publishing is explicit — only when the user asks, or when they've approved the preview.

## Sync outcomes

| Output | Meaning |
|---|---|
| `create` / `apply` | Synced. Drafts include a preview URL. |
| `in-sync` | No changes since last sync. |
| `conflict` | The report was edited in the portal — DO NOT force; tell the user to resolve in the portal admin, then re-sync. |
| `skip (portal.sync is not true)` | Set `portal.sync: true` in the `.report.json`. |
| 4xx on the whole sync | Check `REPORTING_SUITE_API_KEY` scopes (reports:write) and the `portal.config.json` client binding. |

## Sync from git (CI/CD)

If the repo has `.github/workflows/sync.yml`, syncing also happens automatically on push —
you don't have to run `npm run sync` by hand for the final publish:

- **PR touching `clients/**`** → CI runs `sync --draft` (preview URLs in the job log,
  nothing client-visible). Good for review before merge.
- **Merge to `main`** → CI publishes, gated behind a `production` environment approval.

Two consequences for how you work:

- Local `npm run sync -- {client} --draft` is still the fast iteration loop; you don't
  need to push to preview. Push/merge is for the *shipped* version, with a human approval.
- A report's **`portal.status`** governs the publish run: leave it `"draft"` in the
  `.report.json` while a report is in progress and it stays hidden even after a merge to
  `main`; flip to `"published"` only when it's ready. Never flip it to `"published"`
  yourself unless the user has approved the report — merging then makes it live.
