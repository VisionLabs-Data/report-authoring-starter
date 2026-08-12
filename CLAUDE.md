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

## Where the data lives

**One dataset per client**, named after the client, in your agency's GCP project. All three
layers live in it, told apart by table prefix:

| Prefix | What it is | Use it? |
|---|---|---|
| `raw_<provider>_*` | Straight from Airbyte — `raw_meta_ads_ads`, `raw_google_ads_campaign`. Connector-shaped, deduped but not reconciled. | Only when nothing above covers it |
| `staging_*` | Cleaned and typed, one concept per table. Intermediate. | Rarely — usually a step on the way to `main_` |
| `main_*` | Modelled and reporting-ready. Joined, named in business terms. | **Default. Build reports on these.** |

Reaching past `main_` into `raw_` usually means re-deriving something the pipeline already
computed — with a different answer, which is how two reports end up disagreeing. If the
number you need isn't in `main_`, that's a pipeline gap: say so rather than rebuilding it in
report SQL. Check `list_metrics` first; a governed metric beats your own aggregate.

The dataset name is fixed when the client is created and never changes, so a query written
today keeps working. **`get_client_schema` remains the only source of truth for what
actually exists** — this table tells you which layer to prefer, not what to assume is there.

Clients onboarded before Aug 2026 may use the older layout (a dataset per layer:
`<client>_raw`, `<client>_staging`, `<client>_main`). Same three layers, different
packaging. `get_client_schema` reports whichever one the client has.

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

## Shared knowledge — the self-improving loop

The portal is your team's shared brain. Everything you learn about a client lives there over
MCP (after `select_client`), so the next person — or the next session — doesn't relearn it.

- **Recall liberally, before you build.** At the start of any client work, `search_memories`
  / `list_memories` and `list_documents` (then `get_document`) for that client. Prior data
  quirks, table meanings, naming gotchas, and client preferences are usually already written
  down — read them instead of rediscovering.
- **Write back liberally, as you go.** The moment you learn something reusable — a column's
  real meaning, a table that's stale/empty, a query pattern that worked, a client's stated
  preference — save it: `create_memory` with `shared: true` (so the whole team sees it) for a
  fact, or `create_document` for anything longer. A 30-second write saves the next person an
  hour. Don't hoard it in the chat.
- **After a hard session, leave a skill.** When you just fought through something non-obvious
  (a gnarly join, a data pipeline surprise, a multi-step fix), `create_skill` capturing what
  you learned and the steps to do it next time. That's how the loop compounds: today's debug
  becomes tomorrow's playbook.

Bias toward over-sharing. Duplicate-ish memory? Save it anyway; noise is cheaper than a lost
lesson. If unsure whether something's worth recording, it is.

## Rules

- A report's `id` == its `.report.json` filename == its folder name (kebab-case).
- `portal.sync: true` is what makes a report sync; leave it false for scratch work.
- Only `sql` queries (BigQuery) are supported. Query only tables `get_client_schema`
  returns — if the data doesn't exist, say so; never guess table names.
- Never commit `.env` (the API key). `portal.config.json` holds no secrets.
- If sync reports `conflict`, someone edited that report in the portal — resolve there
  before re-syncing; the sync never overwrites portal edits.

## Creating a new client

When the user asks to create/add a client (and the key has the **Clients** capability),
do ALL of these — creating the client alone is not enough; it must be wired into the repo:

1. **Create it** — call the `create_client` MCP tool with the client `name` (optionally
   `description`, `access_mode`, `timezone`). It returns `{ id, slug }`. The `id` is what
   the repo binds to; the returned `slug` is an internal uuid — do NOT use it as the folder name.
2. **Pick a folder name** — a short kebab-case label you choose (e.g. `acme-co`), NOT the
   returned uuid. This is a local label only.
3. **Bind it** — add to `portal.config.json` under `clients`:
   `"acme-co": { "portalClientId": "<the id returned by create_client>" }`.
4. **Scaffold** — create `clients/acme-co/client.config.json` (`name`, and once BigQuery is
   configured, `gcp_project_id` + `datasets` + `branding.company_name`) and an empty
   `reports/` folder.
5. **Tell the user to configure data in the portal admin** — `create_client` sets metadata
   only. Before any live-data report will work, the client's **BigQuery integration** must
   be set up in the portal admin (credentials can't be set from here, by design). A plain
   Looker Studio / URL-embed report needs no BigQuery and can be authored right away.
6. Then plan + author as usual. `get_client_schema` only returns tables once step 5 is done.

Existing clients created in the portal admin skip steps 1–2 — just add the binding (id from
the portal) and the folder.
