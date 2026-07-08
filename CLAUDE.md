# Agency Report Authoring — Project Context

This repo authors **fully custom reports** for a Reporting Suite client portal. Reports are
freehand HTML/CSS/JS you write here (any layout, any interaction), rendered by the
platform's report service on your agency's own report host, and embedded in each
client's portal. The portal's AI sidebar automatically knows every report's queries,
tables, and description — that context syncs with the report.

## Repo shape

```
clients/{slug}/
  client.config.json        # client name, GCP project, datasets, branding
  reports/
    {id}.report.json        # metadata: title, description, queries (SQL), filters, portal
    {id}/                   # split-file source (freehand)
      styles.css            #   your CSS (base design system is provided by the platform)
      template.html         #   your body HTML
      01-*.js, 02-*.js      #   your JS, concatenated in filename order
portal.config.json          # portal URL + repo-slug → portal-client bindings
scripts/build-reports.ts    # assembles split files → {id}.report.html
scripts/sync.ts             # pushes built reports to the portal
```

## The loop

**Always load the relevant skill before starting** — they carry the contracts:

| Skill | When |
|---|---|
| **report-planner** | Before building any report — explore data, decide the story |
| **report-builder** | Creating/modifying report files — the split-file + runtime contract |
| **dataviz** | Choosing charts, layout, and visual design |
| **authoring-workflow** | The end-to-end loop reference |

1. **Plan** (report-planner skill) — what question does the report answer?
2. **Explore data** over MCP: `select_client` → `get_client_schema` (the client's real
   BigQuery tables + columns). Use ONLY tables it returns.
3. **Write queries** in `{id}.report.json` — parameterize dates with `@date_start` /
   `@date_end`; validate each with the MCP `validate_query` tool before trusting it.
4. **Author** the split files (report-builder skill has the full `VL.*` runtime and
   component reference).
5. **Build**: `npm run build -- {client} {id}`
6. **Preview**: `npm run sync -- {client} --draft` → prints a preview URL. Open it,
   iterate (edit → build → sync --draft again; same draft updates in place).
7. **Publish**: `npm run sync -- {client}` — the report appears in the client's portal.

## Rules

- A report's `id` == its `.report.json` filename == its folder name (kebab-case).
- `portal.sync: true` is what makes a report sync; leave it false for scratch work.
- Only `sql` queries (BigQuery) are supported. Query only tables `get_client_schema`
  returns — if the data doesn't exist, say so; never guess table names.
- Never commit `.env` (the API key). `portal.config.json` holds no secrets.
- If sync reports `conflict`, someone edited that report in the portal — resolve there
  before re-syncing; the sync never overwrites portal edits.
- Adding a client = new `clients/{slug}/` folder + a `portal.config.json` binding
  (portal client id from your portal admin).
