# Agency Reports

Author fully custom, data-driven client reports with Claude Code — freehand HTML/CSS/JS,
version-controlled in this repo, rendered on your agency's own report host, and embedded
in each client's Reporting Suite portal. The portal's AI assistant automatically understands
every report you ship (its queries, tables, and description sync with it).

## Setup (once)

1. **API key.** In your portal admin → API Keys, create an **agency-scoped** key with the
   **Reports** capability (read + write). Add the **Clients** capability (write) too if you
   want to create/manage clients from here (see below).
2. **Configure.** `cp .env.example .env` and paste your key into `REPORTING_SUITE_API_KEY` —
   that's the only value you need. The portal URL is already wired in `.mcp.json` and
   `portal.config.json`.
3. **Bind a client.** In `portal.config.json`, map each `clients/{slug}` folder to its portal
   client id. You can get that id two ways: copy it from the portal admin, or — with the
   Clients capability on your key — just ask Claude Code (*"create a client named Acme Co"*)
   and it returns the new id via the `create_client` tool.
4. **Install.** `npm install` (Node 22+).
5. **Register the client.** `npm run sync -- <slug>` once, before asking for anything.
   The first sync is what tells the portal your `gcp_project_id` and `datasets` — which
   is what `get_client_schema` reads. Ask Claude for a report before this and it gets
   *"No configuration found for client …"* on its very first tool call.
   You do **not** need a report to exist first: a client with only a `client.config.json`
   registers fine. (It didn't until 2026-08-08 — sync bailed before sending anything when
   a client had no syncable report, so the one command that registers a client refused to
   run until the client was already usable.)

No DNS or hosting setup — your reports render on your agency's report host automatically.

## Managing clients from Claude Code

With the **Clients (write)** capability on your key, Claude Code can create and manage the
agency's clients over MCP — handy for first-run bootstrapping:

- `create_client` — *"create a client named Acme Co"* → returns its `id` (use it in
  `portal.config.json`) and `slug`.
- `update_client` — rename, change description / access mode / timezone, or un-archive.
- `archive_client` — soft-delete (hide from the portal; reversible).

These are **metadata only** — BigQuery/PostHog/AI credentials and branding are set in the
portal admin, and `clients:write` is restricted to agency-scoped keys. Once a client has its
BigQuery integration configured in the portal, its reports can query live data.

## Scopes: how `reports:read` / `reports:write` work

The one key in your `.env` powers **both** the MCP connection (`.mcp.json`) and the sync
script (`scripts/sync.ts`) — so it needs the **Reports capability at read + write**:

| Scope | Unlocks |
|-------|---------|
| `reports:read` | The authoring reads — `list_components`, `get_client_schema`, `validate_query` — plus `list_reports`. This is what Claude Code uses to plan against the client's real schema and dry-run queries before you build. |
| `reports:write` | Saving/publishing — `save_report` over MCP and `POST /v1/report-authoring/sync` from `npm run sync`. Implies `reports:read`, so granting write alone is enough for the whole loop. |

**Why the key must be agency-scoped.** Scopes say *what* you can touch; the key's tier
decides *publish vs draft*:

- **Agency-scoped key (what this repo uses) → trusted.** `npm run sync` publishes;
  `save_report` may publish. This is why setup step 1 says agency-scoped.
- **Client-scoped key → draft-only**, even with `reports:write`, and only if that client
  has a guardrails policy configured. It can propose reports but never make them live.

`reports:write` is **staff-grantable only** (not client self-serve) — creating the key
this repo needs is an agency-admin action in the portal.

**Targeting a client.** The key is agency-wide; the client is chosen per request. The
sync script sends the portal client id (from `portal.config.json`'s `portalClientId`
binding) as the `X-Client-Id` header; over MCP, `select_client` picks it per session.
Your `clients/{slug}` folder name is just a local label — the binding is the real link.

## Daily loop

Open this folder in Claude Code and ask for a report (after setup step 5 — the client
must be registered before Claude can read its schema):

> Build a revenue overview for Acme Co — monthly trend, KPI row, top products table.

Claude plans against the client's real BigQuery schema (via the built-in MCP tools),
writes the report source under `clients/acme-co/reports/`, then:

```bash
npm run build -- acme-co            # assemble split files → .report.html
npm run sync -- acme-co --draft     # push as draft → prints a preview URL
npm run sync -- acme-co             # publish → visible in the client's portal
```

Drafts update in place — iterate with edit → build → sync --draft until the preview
looks right. Publishing is explicit. Portal-side edits are never overwritten (the sync
flags a conflict instead).

## Edits made in the portal (`npm run pull`)

Reports synced from this repo stay editable in the portal's AI Studio — but the repo is
the arbiter, so an edit there does **not** go live. The portal stages the edited source
and marks the report as ahead of the repo; nothing changes for the client until the repo
produces a new build.

```bash
npm run pull                  # write pending Studio edits into clients/*/reports/*/
git diff                      # review — this is the point of the round trip
npm run build && npm run sync # publish them
```

`npm run pull -- --check` writes nothing and exits non-zero if anything is pending —
wire it into CI to catch a portal edit that never made it back to git.

There's no acknowledgement to send: the next `npm run sync` stamps the report and it
drops off the pending list, so a failed pull is safe to re-run.

## Continuous sync (GitHub Actions)

`.github/workflows/sync.yml` runs the same build + sync on every change under
`clients/**`, so you can drive the whole loop from git instead of your terminal:

| Event | What runs | Result |
|-------|-----------|--------|
| **PR** touching `clients/**` | `npm run sync -- --draft` | Everything synced as **drafts** — preview URLs in the job log, nothing client-visible. Review the report before merging. |
| **Merge to `main`** | `npm run sync` | **Publishes**, honoring each report's `portal.status`. |

Two things to set up on GitHub (once):

1. **Secret** — `Settings → Secrets and variables → Actions` → add
   `REPORTING_SUITE_API_KEY` (your agency key, `reports:read` + `reports:write`).
2. **Approval gate** — `Settings → Environments` → create **`production`** and add
   required reviewers. The publish job is pinned to it, so a merge to `main` **waits
   for approval** before anything goes live. Delete the `environment:` line in the
   workflow to publish automatically instead.

Push-to-publish is convenient but easy to fire by accident, which is why publishing
sits behind the approval gate and per-report `portal.status` (below) — a report you're
not ready to ship never goes live just because it landed on `main`.

## What's in the box

- `clients/example-client/` — a working example report to copy from
- `scripts/build-reports.ts` / `scripts/sync.ts` — the whole toolchain (no server to run)
- `.claude/skills/` — the authoring skills: **report-planner**, **report-builder**
  (split-file + runtime reference), **dataviz**, **authoring-workflow**
- `.mcp.json` — the portal MCP connection (client selection, schema exploration,
  query validation, plus the portal's chat-authoring tools)

## Report anatomy (30 seconds)

`clients/{slug}/reports/{id}.report.json` — metadata + **named SQL queries** (BigQuery,
`@date_start`/`@date_end` params) + filters + `portal: { sync, status, category }`:

- `portal.sync` — `true` to include this report in `npm run sync`; anything else skips it.
- `portal.status` — `"published"` (default) or `"draft"`. A draft report syncs but stays
  hidden from the client (preview-only), even on a publish run / merge to `main` — set it
  while a report is still in progress, flip to `"published"` when it's ready. The `--draft`
  sync flag is a global override that forces every report to draft regardless.
- `portal.category` — optional grouping label in the portal.

`clients/{slug}/reports/{id}/` — your freehand source: `template.html` (body HTML),
`styles.css`, `01-*.js`. The platform wraps it with the base design system, Chart.js,
and a data runtime: declarative bindings (`.vl-metric`, `.vl-chart`, `.vl-table-wrapper`)
or `VL.onData("query", rows => ...)` for anything custom. See the report-builder skill
for the full reference.
