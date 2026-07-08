# Agency Reports

Author fully custom, data-driven client reports with Claude Code — freehand HTML/CSS/JS,
version-controlled in this repo, rendered on your agency's own report host, and embedded
in each client's Mythic OS portal. The portal's AI assistant automatically understands
every report you ship (its queries, tables, and description sync with it).

## Setup (once)

1. **API key.** In your portal admin → API Keys, create an **agency-scoped** key with the
   **Reports** capability (read + write).
2. **Configure.** `cp .env.example .env`, fill in `MYTHIC_API_KEY` (and the MCP URL).
   In `portal.config.json`, set `portalApiUrl` and map each `clients/{slug}` folder to its
   portal client id (from the portal admin).
3. **Install.** `npm install` (Node 22+).

No DNS or hosting setup — your reports render on your agency's report host automatically.

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

Open this folder in Claude Code and ask for a report:

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

## What's in the box

- `clients/example-client/` — a working example report to copy from
- `scripts/build-reports.ts` / `scripts/sync.ts` — the whole toolchain (no server to run)
- `.claude/skills/` — the authoring skills: **report-planner**, **report-builder**
  (split-file + runtime reference), **dataviz**, **authoring-workflow**
- `.mcp.json` — the portal MCP connection (client selection, schema exploration,
  query validation, plus the portal's chat-authoring tools)

## Report anatomy (30 seconds)

`clients/{slug}/reports/{id}.report.json` — metadata + **named SQL queries** (BigQuery,
`@date_start`/`@date_end` params) + filters + `portal: { sync: true }`.

`clients/{slug}/reports/{id}/` — your freehand source: `template.html` (body HTML),
`styles.css`, `01-*.js`. The platform wraps it with the base design system, Chart.js,
and a data runtime: declarative bindings (`.vl-metric`, `.vl-chart`, `.vl-table-wrapper`)
or `VL.onData("query", rows => ...)` for anything custom. See the report-builder skill
for the full reference.
