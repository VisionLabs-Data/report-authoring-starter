# Report Builder Skill

Build custom interactive client reports for the Mythic client portal. Use this skill whenever a report plan is ready to implement, or the user asks to build, edit, or extend a report/dashboard — wiring data bindings, adding charts, filters, pages, modals, or funnels. Reports are authored as files in this repo (`clients/{slug}/reports/`), built with `npm run build`, and synced to the portal with `npm run sync`. Run the **report-planner** skill first for new reports — it produces the blueprint this skill executes.

## Architecture

Reports live in each client's `reports/` subfolder. Every report has:
- `{report-id}.report.json` — metadata, query definitions, filters, portal config
- `{report-id}.report.html` — layout using HTML with VL runtime data-binding (the **built output**)

**You write only body HTML/CSS/JS.** The platform renders reports server-side: it wraps your body HTML in a base template that provides the page shell, header/footer, **Chart.js** (plus `chartjs-plugin-annotation`), all **`.vl-*` CSS classes**, and the **`VL.*` runtime**. Never write `<html>`/`<head>`/`<body>` tags, never load Chart.js or fonts yourself. Reports render on your agency's own report host — the preview URL from a draft sync points there.

Reports can be authored in two ways:

### Monolithic (single file)
For small/simple reports, write directly into `{report-id}.report.html`. Good for reports under ~500 lines.

### Split-file (source directory)
For large/complex reports, author as separate files in a `{report-id}/` directory:

```
clients/{slug}/reports/{report-id}/
  ├── styles.css        → wrapped in <style>...</style>
  ├── template.html     → HTML body (inserted as-is)
  ├── 01-core.js        → JS files sorted by name,
  ├── 02-date-picker.js   concatenated, wrapped in
  ├── 03-utils.js         a single <script> tag
  ├── ...
  └── 08-trends.js
```

Run `npm run build` to assemble every split source directory into its `{report-id}.report.html`. The build:
- Wraps `styles.css` in `<style>...</style>`
- Inserts `template.html` as-is
- Sorts `*.js` files by filename, concatenates them, wraps in `<script>...</script>`
- Writes the output to `{report-id}.report.html` (the file the sync reads)

**When to split:** Use split-file format when a report exceeds ~500 lines or has multiple logical modules (e.g., separate pages, an ads module, a trends page). This makes each file small enough to read and edit in a single pass.

**JS file naming:** Use numeric prefixes for ordering (`01-`, `02-`, etc.). Name files by their logical module. Files within the same IIFE scope share closure variables — the build just concatenates them. Independent modules should be their own IIFE in their own file.

**After editing source files, always rebuild** before syncing or committing:
```bash
npm run build
```

The `.report.html` output should be committed alongside the source directory — the sync reads the built `.report.html`.

## Preview & Publish (no local server)

There is **no local report server** in this repo. Previewing goes through the portal's draft sync:

```bash
npm run build             # assemble split-file sources into .report.html
npm run sync -- --draft   # push as drafts → prints a preview URL per report
```

The sync POSTs built reports to the portal's authenticated endpoint (`POST /v1/report-authoring/sync`) using **`MYTHIC_API_KEY` from `.env`** — an agency API key with `reports:read` + `reports:write`. A draft sync returns a **preview URL** in its output — open it to verify the report renders with live data.

The iteration loop:

1. Edit source files
2. `npm run build`
3. `npm run sync -- --draft`
4. Open/refresh the preview URL
5. Repeat until right
6. `npm run sync` (no `--draft`) to **publish** — makes the report client-visible in the portal

Each `clients/{slug}` folder maps to a portal client via **`portal.config.json`'s clients map** — the sync uses that mapping (sent as `X-Client-Id`) to bind reports to the right portal client. If the sync reports the client isn't mapped or authoring isn't enabled, the portal admin needs to fix the mapping or the client's guardrails policy — tell the user; don't work around it.

## Report ID Convention

- kebab-case for filenames and IDs
- `{id}.report.json` and `{id}.report.html` — the `id` field in the JSON must match the filename, which becomes the report's slug in the portal

## Data Binding Quick Reference

- Simple metrics/charts/tables → use declarative `data-*` attributes (easiest)
- Custom logic or multi-dataset charts → use `VL.onData()` callback
- Start with declarative attributes. Only use `VL.onData()` when you need custom logic.

## Simple Starter Template

A minimal report with 1 metric row, 1 chart, and 1 table. Copy this as a starting point.

**`clients/{slug}/reports/my-report.report.json`:**
```json
{
  "id": "my-report",
  "title": "My First Report",
  "description": "Monthly revenue and order volume overview",
  "data_mode": "live",
  "interactivity": "fixed",
  "source_tables": ["your_dataset.orders_monthly"],
  "queries": {
    "summary": {
      "sql": "SELECT month, revenue, orders FROM `your-project.your_dataset.orders_monthly` ORDER BY month",
      "cache_ttl": "1h"
    }
  },
  "portal": {
    "sync": true,
    "category": "Analytics"
  }
}
```

**`clients/{slug}/reports/my-report.report.html`:**
```html
<!-- Metrics -->
<div class="vl-metric-row vl-animate-in" style="animation-delay: 0ms;">
  <div class="vl-metric" data-query="summary" data-field="revenue" data-aggregate="sum" data-format="currency" data-label="Total Revenue"></div>
  <div class="vl-metric" data-query="summary" data-field="orders" data-aggregate="sum" data-format="number" data-label="Total Orders"></div>
</div>

<!-- Chart -->
<div class="vl-chart vl-animate-in" style="animation-delay: 100ms;"
  data-query="summary" data-type="bar" data-x="month" data-y="revenue"
  data-title="Revenue by Month">
</div>

<!-- Table -->
<div class="vl-table-wrapper vl-animate-in" style="animation-delay: 200ms;"
  data-query="summary" data-columns="month,revenue,orders"
  data-title="Monthly Details">
</div>
```

Preview with `npm run build && npm run sync -- --draft`, then open the preview URL from the output.

## Component Pattern Catalog

Before writing custom HTML from scratch, check the **Advanced Interactive Components** section below — it contains battle-tested, copy-adaptable patterns for the common report building blocks:

| Component | Pattern section | Use For |
|-----------|-----------------|---------|
| **Scorecard** | KPI Scorecards with Sparklines | KPI cards with value, delta, sparkline |
| **Data table** | Pipeline/Data Tables | Data tables with right-aligned numbers, clickable rows |
| **Funnel** | Funnel Component | Vertical step funnel with detail sidebar |
| **Trend charts** | Multi-Dataset Line Chart / Combo Charts | Time-series charts with trendlines, comparison periods |
| **Modal** | Modal Dialogs | Drill-down dialogs for detail views |
| **Timeline** | Patient/Contact Timeline Modal | Vertical activity timeline with status dots |
| **Stage matrix** | Stage/Matrix Tables | Boolean journey stages with sticky first column |
| **Filter chips** | Client-Side Filter Chips | Dimension slicing without re-querying |
| **Toggle chips** | Toggle Chips | Show/hide datasets on multi-metric charts |
| **Date picker + compare** | Custom Date Picker with Compare Toggle | Period-over-period analysis |

The portal also exposes a `list_components` MCP tool describing its vetted component library (used by portal-side authoring) — useful for naming and visual consistency, but in this repo you implement components with the patterns below.

## Step-by-Step: Creating a Report

### 1. Read the Client Config

```bash
cat clients/{slug}/client.config.json
```

The config has: `name`, `gcp_project_id`, `datasets` (a logical→physical dataset map — e.g., `"analytics": "prod_analytics_v2"`), and `branding.company_name`. Use the physical dataset names from this map when writing fully-qualified table references in SQL. Binding to a portal client happens via `portal.config.json`'s clients map — not via the client config.

### 2. Check Available Data

Use the portal's MCP tools:

1. If your API key is agency-scoped, `list_clients` → `select_client` to pin the client for the session. (Skip if the key is client-scoped.)
2. `get_client_schema` — returns the client's **authorized** BigQuery tables and columns.

**Query only tables returned by `get_client_schema`.** Never guess table names. If the data the report needs doesn't exist in any returned table, stop and tell the user: **their data pipeline needs the table added** — don't try to work around it, and don't retry with guessed names.

Sample the data (via your BigQuery access if you have it — `bq` CLI, console, or a BigQuery MCP server):

```sql
SELECT * FROM `your-project.your_dataset.orders` LIMIT 10
```

If you have no direct BigQuery access, dry-run candidate queries with `validate_query` and confirm real values later via the draft preview.

### 3. Write Queries

Only **`sql` (BigQuery) queries** are supported — the portal's external authoring API is BigQuery-only. Design SQL that answers the report's question, optimizing for:
- Minimal data transfer (SELECT only needed columns)
- Appropriate aggregation (do math in BigQuery, not in the browser)
- Parameterizable date ranges where relevant (`@date_start` / `@date_end` — see Date Range Filtering below)
- Referencing only tables `get_client_schema` returned

**Validate every query with the `validate_query` MCP tool** (a BigQuery dry-run — checks syntax, table authorization, and bytes scanned without executing) before wiring it into the report.

### 4. Create the Report JSON

Create `clients/{slug}/reports/{report-id}.report.json`:

```json
{
  "id": "report-id",
  "title": "Short Title",
  "description": "Longer description with date ranges, data sources, and what the report shows",
  "data_mode": "live",
  "interactivity": "interactive",
  "source_tables": [
    "your_dataset.ad_performance_daily",
    "your_dataset.revenue_by_channel"
  ],
  "queries": {
    "query_name": {
      "sql": "SELECT ... FROM `your-project.your_dataset.table_name` WHERE event_date >= @date_start AND event_date <= @date_end ...",
      "cache_ttl": "1h"
    }
  },
  "filters": [
    {
      "type": "date_range",
      "param_start": "date_start",
      "param_end": "date_end",
      "default_start": "-30d",
      "default_end": "now",
      "label": "Date Range"
    }
  ],
  "portal": {
    "sync": true,
    "category": "Analytics"
  }
}
```

Field reference:

- **`id`**: must match the filename and becomes the report slug (kebab-case)
- **`data_mode`**: `"live"` — queries execute against BigQuery on each request (with server-side caching per `cache_ttl`)
- **`interactivity`**: `"fixed"` is a static display with no user controls; `"interactive"` gets filters/date pickers
- **`source_tables`**: documents which tables this report depends on — keeps lineage traceable from pipeline → report
- **`queries`**: named `sql` queries. Each query is exposed to the report at `GET /api/query/{client}/{report-id}/{query_name}` on the report host — this is what the VL runtime fetches, and what any custom fetch (e.g., compare-period data) should call
- **`filters`**: array of filter definitions (see "Date Range Filtering" below). Only rendered when `interactivity: "interactive"`
- **`portal.sync`**: must be `true` or the sync skips the report entirely
- **`portal.category`**: portal category grouping (e.g., "Analytics", "Performance", "Attribution", "Funnels")

### 5. Create the Report HTML

For simple reports, create `clients/{slug}/reports/{report-id}.report.html` directly.

For complex interactive reports (multiple pages, custom JS modules, likely to exceed ~500 lines), use the **split-file** format instead — create a source directory at `clients/{slug}/reports/{report-id}/` with `styles.css`, `template.html`, and numbered JS files, then `npm run build`. See the Architecture section above.

Whether monolithic or split, the HTML uses the VL runtime for data binding. Available components:

#### Metrics
```html
<div class="vl-metric-row">
  <div class="vl-metric" data-query="query_name" data-field="column" data-aggregate="sum" data-format="currency" data-label="Total Revenue"></div>
  <div class="vl-metric" data-query="query_name" data-field="column" data-aggregate="count" data-format="number" data-label="Count"></div>
</div>
```

Aggregates: `sum`, `avg`, `count`, `min`, `max`, `first`, `last`
Formats: `currency`, `number`, `percent`, `date`

#### Charts
```html
<div class="vl-chart" data-query="query_name" data-type="line" data-x="month" data-y="revenue" data-title="Revenue Over Time"></div>
```

Chart types: `line`, `bar`, `pie`, `doughnut` (anything Chart.js supports)

#### Tables
```html
<div class="vl-table-wrapper" data-query="query_name" data-columns="col1,col2,col3" data-title="Details"></div>
```

Omit `data-columns` to show all columns from the query result.

#### Multi-Page Reports

For reports with multiple logical sections, use page tabs. All data loads eagerly — switching is instant.

```html
<!-- Tab navigation -->
<div class="vl-page-nav">
  <button class="vl-page-tab active" data-page="overview">Overview</button>
  <button class="vl-page-tab" data-page="channels">Channels</button>
  <button class="vl-page-tab" data-page="trends">Trends</button>
</div>

<!-- Page containers — only the active one is visible -->
<div class="vl-page active" data-page="overview">
  <!-- metrics, charts, tables for overview -->
</div>
<div class="vl-page" data-page="channels">
  <!-- channel-specific content -->
</div>
<div class="vl-page" data-page="trends">
  <!-- trends content -->
</div>
```

Key details:
- First `vl-page-tab` and `vl-page` should both have class `active` for the default page
- Each page gets its own URL route on the report host (`{report-url}/{page-slug}`); browser back/forward works between pages
- `VL.showPage('page-slug')` available for programmatic switching
- All queries across all pages are fetched eagerly on load
- Tab styling comes from the base template

#### Custom JavaScript
```html
<script>
VL.onData('query_name', (rows) => {
  // Full access to raw data — do anything
  // rows is an array of objects
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  document.getElementById('custom-el').textContent = VL.format(total, 'currency');
});
</script>
```

`VL.onData()` auto-fetches queries — no `data-query` DOM elements needed. Use this for multi-dataset charts or any custom rendering.

#### Multi-Dataset Charts (Custom Chart.js)

The built-in `vl-chart` binding only supports **one dataset per chart**. For multi-line, multi-bar, or overlay charts, use `VL.onData()` with direct Chart.js.

#### Chart Styling Helpers

Every custom chart should use these two helpers for gradient fills. Define them in each report's `<script>` block — they are not provided globally by the runtime:

```js
// Line chart: fade from color to transparent underneath the line
function gradientFill(ctx, chartArea, color, opacity) {
  if (!chartArea) return color + '15';
  var g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  g.addColorStop(0, color + (opacity || '30'));
  g.addColorStop(1, color + '05');
  return g;
}

// Bar chart: two-tone gradient, lighter at top → full color at bottom
function barGradient(ctx, chartArea, color) {
  if (!chartArea) return color;
  var g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  g.addColorStop(0, color + '80');
  g.addColorStop(1, color);
  return g;
}
```

#### Multi-Dataset Line Chart Example

```html
<div class="vl-card">
  <div class="vl-chart-title">Revenue vs Spend</div>
  <div class="chart-wrap" style="height: 280px;"><canvas id="my-chart"></canvas></div>
</div>

<script>
VL.onData('monthly_data', function(rows) {
  new Chart(document.getElementById('my-chart'), {
    type: 'line',
    data: {
      labels: rows.map(r => r.month),
      datasets: [
        {
          label: 'Revenue',
          data: rows.map(r => r.revenue),
          borderColor: VL.colors[0],
          backgroundColor: function(context) {
            return gradientFill(context.chart.ctx, context.chart.chartArea, VL.colors[0], '25');
          },
          borderWidth: 2, pointRadius: 2, pointHoverRadius: 5, tension: 0.3, fill: true
        },
        {
          label: 'Spend',
          data: rows.map(r => r.spend),
          borderColor: VL.colors[1],
          backgroundColor: function(context) {
            return gradientFill(context.chart.ctx, context.chart.chartArea, VL.colors[1], '20');
          },
          borderWidth: 2, pointRadius: 2, pointHoverRadius: 5, tension: 0.3, fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: true } }
    }
  });
});
</script>
```

#### Bar Chart with Two-Tone Gradients

```html
<div class="chart-wrap" style="height: 200px;"><canvas id="my-bar"></canvas></div>
```

```js
new Chart(document.getElementById('my-bar'), {
  type: 'bar',
  data: {
    labels: labels,
    datasets: [{
      data: values,
      backgroundColor: function(context) {
        return barGradient(context.chart.ctx, context.chart.chartArea, '#6366f1');
      },
      borderColor: '#6366f1',
      borderWidth: 2,
      borderRadius: { topLeft: 3, topRight: 3 }
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false }
  }
});
```

#### Annotation Lines (Key Events)

The base template loads `chartjs-plugin-annotation` globally. Use it to mark inflection points:

```js
plugins: {
  annotation: {
    annotations: {
      myEvent: {
        type: 'line',
        xMin: '2025-10', xMax: '2025-10',
        borderColor: '#ef444490',
        borderWidth: 2,
        borderDash: [6, 4],
        label: {
          display: true, content: 'Oct 2025', position: 'start',
          backgroundColor: 'transparent', color: '#ef4444',
          font: { size: 11, weight: '600' }
        }
      }
    }
  }
}
```

#### Key Chart Rules

- **ALWAYS wrap canvases in a `.chart-wrap` div** — never place a bare `<canvas>` inside a flex/grid parent. Chart.js reads the parent's size to resize, which grows the parent, which triggers another resize — an infinite expansion loop. The wrapper breaks the loop by giving the canvas an absolute-positioned, fixed-size container:
  ```css
  .chart-wrap { position: relative; width: 100%; }
  .chart-wrap canvas { position: absolute; inset: 0; width: 100% !important; height: 100% !important; }
  ```
  Set the height on the wrapper (via class or inline style), **not** on the canvas:
  ```html
  <div class="chart-wrap" style="height: 280px;"><canvas id="my-chart"></canvas></div>
  ```
  Define reusable height classes for consistency across the report:
  ```css
  .chart-wrap-tall { height: 280px; }   /* daily volume, main charts */
  .chart-wrap-med  { height: 260px; }   /* horizontal bars, secondary charts */
  .chart-wrap-sq   { height: 300px; }   /* doughnut/pie charts */
  ```
- **ALWAYS set `maintainAspectRatio: false`** on every Chart.js instance. This tells Chart.js to respect the container's CSS dimensions instead of computing its own size. Without this, even a properly wrapped canvas will ignore the wrapper height.
- **Line charts**: Always use `fill: true` with `gradientFill` background
- **Bar charts**: Always use `barGradient` for two-tone depth, with `borderColor` matching the full color and `borderWidth: 2`
- **Tooltips**: Always set `interaction: { mode: 'index', intersect: false }` for column-based hover
- **Reference lines** (e.g., "100% parity"): Use `fill: false`, dashed border, no points

#### Available VL API
- `VL.onData(queryName, callback)` — register for query results (auto-fetches the query)
- `VL.format(value, format)` — format values (currency, number, percent, date)
- `VL.colors` — array of 8 chart-friendly theme colors
- `VL.applyFilters()` — reads filter inputs, clears data, destroys charts, re-fetches all queries (called by the date picker Apply button)
- `VL.showPage(pageSlug)` — switch to a page by slug (multi-page reports)

#### Custom Layout (full HTML flexibility)
```html
<style>
  .report-grid-2-1 {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 24px;
  }
  @media (max-width: 768px) {
    .report-grid-2-1 { grid-template-columns: 1fr; }
  }
</style>
<div class="report-grid-2-1">
  <div class="vl-chart" data-query="monthly" data-type="line" data-x="month" data-y="revenue"></div>
  <div>
    <h3>Key Insight</h3>
    <p>Revenue grew 15% month-over-month.</p>
    <div class="vl-metric" data-query="monthly" data-field="revenue" data-aggregate="last" data-format="currency" data-label="Latest Month"></div>
  </div>
</div>
```

#### Mobile Responsiveness

Reports are viewed on mobile (embedded dashboards, shared links). Follow these rules:

1. **Always use `<style>` blocks for grids** — never inline `style` grids without a mobile breakpoint:
   ```css
   .report-grid-2 {
     display: grid;
     grid-template-columns: 1fr 1fr;
     gap: 24px;
   }
   @media (max-width: 768px) {
     .report-grid-2 { grid-template-columns: 1fr; }
   }
   ```

2. **Reduce card padding on mobile**:
   ```css
   @media (max-width: 768px) {
     .chart-card, .chart-card-full { padding: 16px; }
   }
   ```

3. **Every `<canvas>` must be inside a `.chart-wrap` div** (see Key Chart Rules above). Reduce wrapper heights on mobile:
   ```css
   @media (max-width: 768px) {
     .chart-wrap-tall { height: 220px; }
     .chart-wrap-med  { height: 200px; }
     .chart-wrap-sq   { height: 240px; }
   }
   ```

4. **Limit x-axis label density** for charts with many data points:
   ```js
   ticks: {
     maxRotation: 45, minRotation: 45,
     maxTicksLimit: window.innerWidth < 768 ? 8 : undefined
   }
   ```

5. **Use `flex-wrap: wrap`** on all legend and header containers so they stack on mobile.

6. **Use `rem` units** for text sizing — the base template already handles responsive scaling for built-in classes.

The base template provides a `@media (max-width: 768px)` breakpoint that:
- Collapses `.vl-metric-row` to column layout
- Reduces wrapper padding to 16px
- Scales down title and metric font sizes

### 6. Build, Preview, Iterate

```bash
npm run build
npm run sync -- --draft
```

Open the preview URL from the sync output. Verify:
- The report renders with live data (no `.vl-error` states)
- Numbers match what your validated queries should return
- Charts, filters, and pages behave correctly
- Mobile layout works (resize the preview)

Iterate: edit → `npm run build` → `npm run sync -- --draft` → refresh preview.

### 7. Publish

Once the draft looks right and the user confirms:

```bash
npm run sync
```

This publishes the report to the portal — it becomes visible to the client. Commit the report JSON, built HTML, and split-file sources together.

### Date Range Filtering (Interactive Reports)

For reports where users should explore different time windows, add interactive date range filtering.

**The renderer automatically injects a calendar-based date picker with preset ranges** (Last 7 Days, Last 30 Days, Last 90 Days, Last 6 Months, Last Year, All Time, Custom) for any report that has `interactivity: "interactive"` and a `filters` array configured. **Do NOT add any date picker HTML, CSS, or JavaScript to the report** — the renderer provides it all.

> ⚠️ **Dark-themed reports are the exception — you MUST re-skin the picker.** The auto-injected `.vl-drp-*` picker is styled light-only (hard-coded `#fff` panels/inputs, `#f1f5f9` hovers, light range tint). On a dark report it renders as a white panel with invisible near-white text. Add a dark override block for the `.vl-drp-*` classes to the report's `styles.css` (report CSS loads after the renderer base, so plain `.vl-drp-*` selectors win). Always verify by screenshotting the picker *open*, not just the page.

#### Step 1: Add filter config to the report JSON

```json
{
  "interactivity": "interactive",
  "filters": [
    {
      "type": "date_range",
      "param_start": "date_start",
      "param_end": "date_end",
      "default_start": "-2y",
      "default_end": "now",
      "label": "Date Range"
    }
  ]
}
```

- `default_start`/`default_end` accept relative dates (`-2y`, `-30d`, `-6m`, `now`) or absolute dates (`2024-01-01`)
- The `param_start`/`param_end` names become BigQuery query parameters (`@date_start`, `@date_end`)

#### Step 2: Parameterize SQL queries

Replace hardcoded date literals with BigQuery `@param` syntax:

Before:
```sql
WHERE created_at >= '2024-01-01'
```

After:
```sql
WHERE created_at >= TIMESTAMP(@date_start) AND created_at <= TIMESTAMP(@date_end)
```

**All queries** in the report should include the date range filter so they all respond to the user's selection. Use the `TIMESTAMP()` wrapper when comparing against timestamp columns.

That's it — no HTML or CSS work is needed. The JSON config and parameterized queries are the only report-level changes.

#### How it works

1. The server resolves relative dates (e.g., `-2y` → `2024-03-10`) and passes them as BigQuery parameterized query values — no SQL injection risk
2. The renderer injects a `.vl-title-row` (flex row containing the report title and a date picker trigger button). The date picker is a calendar panel using `.vl-drp-*` namespaced CSS classes.
3. Hidden inputs `#vl-filter-date-start` and `#vl-filter-date-end` bridge the picker selection to the runtime
4. When the user selects a range (preset or custom) and confirms, `VL.applyFilters()` clears all cached data, destroys existing Chart.js instances, and re-fetches every query with the new date range as query params
5. Cache keys include the filter params, so different date ranges get separate cache entries

#### Custom date picker override

If a report needs a completely custom date picker (e.g., for a compare toggle), hide the auto-injected elements and implement your own:
```css
.vl-title-row,
.vl-drp-backdrop,
.vl-drp-panel { display: none !important; }
```
Then provide your own UI that follows this four-part contract:
1. **On init, read** `#vl-filter-date-start` / `#vl-filter-date-end` and seed your internal `selStart`/`selEnd` from those values when present (the runtime pre-populates them from `sessionStorage` so date ranges persist across reports for the same client). Fall back to your hardcoded default only if the inputs are empty.
2. **On apply, write** to those same hidden inputs (ISO `YYYY-MM-DD`) and call `VL.applyFilters()` — the runtime persists to `sessionStorage` automatically inside `applyFilters`.
3. **If you patch `VL.applyFilters`** (e.g. for compare-toggle behavior), always call the original via `_orig()` so the persistence write fires.
4. **Listen for `vl:date-range-changed`** so the picker UI live-updates when another iframe (a sibling report in the same portal tab) changes the range. The portal mounts iframes once and toggles visibility — without this listener, switching back to a previously-viewed report shows a stale trigger label even though the data is correct. Do NOT call `VL.applyFilters()` from this listener; the runtime already does it after dispatching the event.

```js
// 1) Init pattern — put this right after your default selStart/selEnd
var seededStart = document.getElementById('vl-filter-date-start');
var seededEnd   = document.getElementById('vl-filter-date-end');
var isoRe = /^\d{4}-\d{2}-\d{2}$/;
if (seededStart && seededEnd && isoRe.test(seededStart.value) && isoRe.test(seededEnd.value)) {
  selStart = new Date(seededStart.value + 'T00:00:00');
  selEnd   = new Date(seededEnd.value + 'T00:00:00');
  activePreset = 'Custom';
}

// 4) Live-sync listener — put this near your other event bindings
document.addEventListener('vl:date-range-changed', function(e) {
  selStart = new Date(e.detail.start + 'T00:00:00');
  selEnd = new Date(e.detail.end + 'T00:00:00');
  activePreset = 'Custom';
  updateTriggerLabel();
  updateInputs();  // if your picker has one
});
```

#### Chart cleanup on re-render

When filters are applied, all Chart.js instances are destroyed and recreated. The runtime handles this automatically:
- For **declarative charts** (`data-query` elements): the runtime calls `Chart.getChart(canvas).destroy()` before creating a new chart
- For **custom `VL.onData()` charts**: the runtime also destroys existing charts on the same canvas

No changes needed to report HTML — existing `VL.onData()` callbacks re-fire with the new data.

## File Locations

| File | Path |
|------|------|
| Client config | `clients/{slug}/client.config.json` |
| Portal client mapping | `portal.config.json` (clients map: `{slug}` → portal client) |
| Report definition | `clients/{slug}/reports/{id}.report.json` |
| Report layout (built) | `clients/{slug}/reports/{id}.report.html` |
| Report source (split) | `clients/{slug}/reports/{id}/` (styles.css, template.html, *.js) |
| API key | `.env` → `MYTHIC_API_KEY` (agency key, `reports:read` + `reports:write`) |

## CSS Classes Available

All reports share these classes (provided by the platform's base template):

- `.vl-metric-row` — flex row for metric cards
- `.vl-metric` — individual metric card (auto-bound with data attributes)
- `.vl-chart` — chart container (auto-bound with data attributes)
- `.vl-table-wrapper` — table container (auto-bound with data attributes)
- `.vl-chart-title` — section title
- `.vl-loading` — loading state
- `.vl-error` — error state

CSS custom properties available for custom styling:
- `--vl-primary`, `--vl-font`, `--vl-radius`
- `--vl-bg`, `--vl-bg-secondary`
- `--vl-text`, `--vl-text-secondary`, `--vl-border`

Prefer these variables over hardcoded colors so reports pick up the client's branding automatically.

---

## Advanced Interactive Components

These are battle-tested patterns from production reports. **Use these as default building blocks** for any new interactive report. Don't reinvent — copy and adapt.

### Formatting Utilities

Every interactive report should define these helpers in its `<script>` block (or a `01-utils.js` in split-file reports). They are **not** provided by the runtime:

```js
function fmt(n) { return (n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 }); }
function fmtCur(n) { return '$' + (n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 }); }
function fmtPct(n) { return ((n || 0) * 100).toFixed(1) + '%'; }
function fmtDate(d) { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function fmtDateShort(d) { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function isoDate(d) { return new Date(d).toISOString().slice(0, 10); }
function escHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
```

When a split-file report uses several components, keep a single shared copy of these (plus `destroyChart`) in `01-utils.js` to avoid duplication.

### KPI Scorecards with Sparklines

Use instead of plain `vl-metric` cards whenever the report has time-series data. Scorecards show the headline number, a contextual subtitle, a period-over-period delta (when compare is active), and a sparkline bar chart of the last 7 days.

**CSS:**
```css
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}
.kpi-grid.kpi-grid-5 { grid-template-columns: repeat(5, 1fr); }
.kpi-grid.kpi-grid-6 { grid-template-columns: repeat(3, 1fr); }
@media (max-width: 1024px) { .kpi-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 480px) { .kpi-grid { grid-template-columns: 1fr; } }

.kpi-card {
  background: var(--vl-bg);
  border: 1px solid var(--vl-border);
  border-radius: var(--vl-radius);
  padding: 20px;
  box-shadow: var(--vl-shadow, 0 1px 3px rgba(0,0,0,0.06));
  transition: box-shadow 200ms ease, transform 200ms ease;
  position: relative;
  overflow: hidden;
}
.kpi-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.1); transform: translateY(-2px); }
.kpi-label { font-size: 0.75rem; font-weight: 500; color: var(--vl-text-secondary); margin-bottom: 4px; }
.kpi-value { font-size: 2rem; font-weight: 700; color: var(--vl-text); line-height: 1.1; }
.kpi-sub { font-size: 0.72rem; color: var(--vl-text-secondary); margin-top: 4px; margin-bottom: 12px; }
.kpi-delta { font-size: 0.7rem; font-weight: 600; margin-top: 2px; display: none; }
.kpi-delta.visible { display: block; }
.kpi-delta.up { color: var(--vl-green, #22C55E); }
.kpi-delta.down { color: var(--vl-red, #E42313); }
.kpi-delta.flat { color: var(--vl-text-secondary); }
.kpi-spark-wrap { width: 100%; height: 36px; overflow: visible; position: relative; }
.kpi-spark { position: absolute; bottom: 0; left: 0; width: 100% !important; height: 36px !important; }
```

**HTML:**
```html
<div class="kpi-grid">
  <div class="kpi-card">
    <div class="kpi-label">New Leads</div>
    <div class="kpi-value" id="kpi-leads">—</div>
    <div class="kpi-delta" id="kpi-leads-delta"></div>
    <div class="kpi-sub" id="kpi-leads-sub">loading…</div>
    <div class="kpi-spark-wrap"><canvas class="kpi-spark" id="spark-leads"></canvas></div>
  </div>
  <!-- repeat for each KPI -->
</div>
```

**JS — Sparkline renderer:**
```js
function renderSparkline(canvasId, values, color, label) {
  destroyChart(canvasId);
  var canvas = document.getElementById(canvasId);
  if (!canvas || !values.length) return;
  _charts[canvasId] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: values.map(function(v) { return v.label; }),
      datasets: [{
        data: values.map(function(v) { return v.value; }),
        backgroundColor: color + '30',
        borderColor: color,
        borderWidth: 1,
        borderRadius: 2
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false }
      },
      scales: {
        x: { display: false },
        y: { display: false, beginAtZero: true }
      }
    }
  });
}

// Helper: aggregate last 7 daily values for sparkline
function getLast7DailyValues(rows, field) {
  var byDate = {};
  rows.forEach(function(r) {
    var d = r.event_date || r.date;
    if (!byDate[d]) byDate[d] = 0;
    byDate[d] += (r[field] || 0);
  });
  var sorted = Object.keys(byDate).sort();
  return sorted.slice(-7).map(function(d) {
    return { label: fmtDateShort(d), value: byDate[d] };
  });
}
```

**JS — Period delta rendering (requires compare data):**
```js
function renderKpiDeltas(current, previous, pairs) {
  // pairs: [{ id: 'kpi-leads-delta', cur: 150, prev: 120, isCurrency: false }]
  pairs.forEach(function(p) {
    var el = document.getElementById(p.id);
    if (!previous || p.prev === 0) { el.className = 'kpi-delta'; el.textContent = ''; return; }
    var pct = ((p.cur - p.prev) / p.prev) * 100;
    var arrow = pct > 0 ? '↑' : pct < 0 ? '↓' : '→';
    var cls = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
    el.className = 'kpi-delta visible ' + cls;
    var prevLabel = p.isCurrency ? fmtCur(p.prev) : fmt(p.prev);
    el.textContent = arrow + ' ' + Math.abs(pct).toFixed(1) + '% from ' + prevLabel;
  });
}
```

### Sticky Header

Pin the report title, date picker trigger, and filter chips to the top of the viewport. Use on any interactive report.

```css
.sticky-header {
  position: sticky;
  top: 0;
  z-index: 1000;
  background: var(--vl-bg, #fff);
  margin: -24px -24px 0 -24px;
  padding: 24px 24px 4px 24px;
}
.sticky-header::after {
  content: '';
  position: absolute;
  left: 0; right: 0; bottom: -8px;
  height: 8px;
  background: linear-gradient(to bottom, rgba(0,0,0,0.04), transparent);
  pointer-events: none;
  opacity: 0;
  transition: opacity 200ms;
}
.sticky-header.scrolled::after { opacity: 1; }

.report-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 0;
  gap: 16px;
}
```

```js
// Add scroll shadow
(function() {
  var el = document.getElementById('sticky-header');
  if (!el) return;
  var sp = el.closest('.vl-report') || document.documentElement;
  (sp === document.documentElement ? window : sp).addEventListener('scroll', function() {
    var st = sp === document.documentElement ? window.scrollY : sp.scrollTop;
    el.classList.toggle('scrolled', st > 10);
  }, { passive: true });
})();
```

### Custom Date Picker with Compare Toggle

For reports that need period-over-period comparison, override the renderer's built-in date picker and implement a custom one with a compare toggle. This enables fetching a second dataset for the previous period.

**Step 1: Hide the renderer's date picker**
```css
.vl-title-row,
.vl-drp-backdrop,
.vl-drp-panel { display: none !important; }
```

**Step 2: Date picker trigger button**
```html
<button class="drp-trigger" id="drp-trigger" type="button">
  <svg viewBox="0 0 16 16"><path d="M5 1v2M11 1v2M1 6h14M2 3h12a1 1 0 011 1v10a1 1 0 01-1 1H2a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>
  <span id="drp-label">Last 30 Days</span>
</button>
```

**Step 3: Date picker panel with presets + compare toggle**

The panel has three zones:
1. **Sidebar** — preset buttons (Today, Last 7d, Last 30d, etc.) + compare toggle
2. **Calendar area** — month grids with range selection
3. **Footer** — Apply / Cancel buttons

Key CSS classes: `.drp-panel`, `.drp-sidebar`, `.drp-presets`, `.drp-preset`, `.drp-compare-wrap`, `.drp-calendar-area`, `.drp-months`, `.drp-day`, `.drp-footer`, `.drp-btn-apply`, `.drp-btn-cancel`

**Step 4: Compare toggle markup (inside sidebar)**
```html
<div class="drp-compare-wrap">
  <label class="drp-compare-toggle">
    <input type="checkbox" id="drp-compare-check">
    <span class="drp-compare-slider"></span>
  </label>
  <span class="drp-compare-label">Compare</span>
</div>
```

**Step 5: Seed `selStart`/`selEnd` from the runtime-pre-populated hidden inputs**

Right after declaring your default `selStart`/`selEnd`, override with values the runtime seeded from `sessionStorage` so the picker UI matches a saved range from another report:

```js
var selStart = daysAgo(30);
var selEnd   = yesterday;
var activePreset = 'Last 30 days';

var seededStart = document.getElementById('vl-filter-date-start');
var seededEnd   = document.getElementById('vl-filter-date-end');
var isoRe = /^\d{4}-\d{2}-\d{2}$/;
if (seededStart && seededEnd && isoRe.test(seededStart.value) && isoRe.test(seededEnd.value)) {
  selStart = new Date(seededStart.value + 'T00:00:00');
  selEnd   = new Date(seededEnd.value + 'T00:00:00');
  activePreset = 'Custom';
}
```

Skipping this step is the most common cause of "the data is right but the trigger label says Last 30 Days." The `VL.applyFilters` patch in Step 7 must call `_orig()` so the runtime's persistence write fires — never replace `_orig` entirely.

**Step 6: Compare data fetching pattern**

Every query in the report JSON is served at `GET /api/query/{client}/{report-id}/{query_name}` on the report host — fetch the previous period by calling it with shifted `date_start`/`date_end` params:

```js
function fetchCompareData() {
  var startEl = document.getElementById('vl-filter-date-start');
  var endEl = document.getElementById('vl-filter-date-end');
  if (!startEl || !endEl || !startEl.value || !endEl.value) return;

  var startMs = new Date(startEl.value).getTime();
  var endMs = new Date(endEl.value).getTime();
  var rangeMs = endMs - startMs;
  var prevEnd = new Date(startMs - 86400000);
  var prevStart = new Date(prevEnd.getTime() - rangeMs);

  var ctx = window.__VL_CONTEXT || {};
  var baseUrl = (ctx.apiBase || '') + '/api/query/' + ctx.client + '/' + ctx.reportId;
  var qs = '?date_start=' + isoDate(prevStart) + '&date_end=' + isoDate(prevEnd);

  // Fetch all needed queries for the previous period in parallel
  Promise.all([
    fetch(baseUrl + '/query_name' + qs).then(function(r) { return r.json(); })
  ]).then(function(results) {
    _compareRows = results[0].data || [];
    // Re-render views that show comparison data
    renderKpiDeltas(currentValues, previousValues, pairs);
    renderTrends(_allRows);
  }).catch(function(err) { console.error('[Compare] fetch error:', err); });
}
```

**Step 7: Patch VL.applyFilters to integrate compare**
```js
(function patchApply() {
  if (typeof VL === 'undefined' || !VL.applyFilters) { setTimeout(patchApply, 50); return; }
  var _orig = VL.applyFilters.bind(VL);
  VL.applyFilters = function() {
    _compareRows = null;
    _orig();
    if (document.getElementById('drp-compare-check').checked) fetchCompareData();
  };
})();
```

**Step 8: Listen for `vl:date-range-changed` so the picker live-syncs across cached iframes**

The portal mounts each report's iframe once and toggles visibility — it does not unmount on switch. Without this listener, switching back to a previously-viewed report shows a stale trigger label and stale data even though sessionStorage has been updated.

```js
document.addEventListener('vl:date-range-changed', function(e) {
  selStart = new Date(e.detail.start + 'T00:00:00');
  selEnd = new Date(e.detail.end + 'T00:00:00');
  activePreset = 'Custom';
  updateTriggerLabel();
  updateInputs();  // if you have one
});
```

Do NOT call `VL.applyFilters()` from this listener — the runtime calls it after dispatching the event, and calling it again would loop.

### Client-Side Filter Chips

For reports where one query returns all data and the user needs to slice by dimensions (pipeline, rep, status, etc.), use inline filter chips with hidden `<select>` elements.

```css
.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 100px;
  font-size: 0.72rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 150ms;
  border: 1px solid var(--vl-border);
  background: var(--vl-bg);
  color: var(--vl-text-secondary);
  position: relative;
}
.filter-chip.active {
  background: #EFF6FF;
  border-color: #BFDBFE;
  color: #2563EB;
}
.filter-chip select {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
```

```html
<div class="filter-chips">
  <span class="filter-icon"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg></span>
  <span class="filter-chip" id="chip-pipeline">
    Pipeline
    <select id="filter-pipeline"><option value="">All Pipelines</option></select>
  </span>
  <!-- more filter chips -->
</div>
```

**JS — populate options and filter:**
```js
function populateFilterOptions(rows) {
  var vals = [...new Set(rows.map(r => r.pipeline_name))].sort();
  var sel = document.getElementById('filter-pipeline');
  sel.innerHTML = '<option value="">All Pipelines</option>';
  vals.forEach(function(v) {
    sel.innerHTML += '<option value="' + escHtml(v) + '">' + escHtml(v) + '</option>';
  });
}

function applyClientFilters() {
  var pipeline = document.getElementById('filter-pipeline').value;
  _filteredRows = _allRows.filter(function(r) {
    if (pipeline && r.pipeline_name !== pipeline) return false;
    // add more filter conditions
    return true;
  });
  // Update chip active states
  document.getElementById('chip-pipeline').classList.toggle('active', !!pipeline);
  renderAll(_filteredRows);
}

// Bind change events
document.getElementById('filter-pipeline').addEventListener('change', applyClientFilters);
```

### Toggle Chips (Metric Visibility)

Use for charts that show multiple datasets where the user can toggle individual metrics on/off.

```css
.chip-bar { display: flex; flex-wrap: wrap; gap: 8px; }
.chip {
  padding: 5px 14px 5px 10px;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 150ms ease;
  border: 1px solid transparent;
  user-select: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.chip .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.chip.active { color: #fff; }
.chip.inactive { background: #f1f5f9; color: var(--vl-text-secondary); border-color: #e2e8f0; }
```

```js
var metricVisibility = { new_leads: true, won_deals: true, consults: true };
var metricColors = { new_leads: '#61ACEE', won_deals: '#22C55E', consults: '#C8B4FF' };

function toggleMetric(key) {
  metricVisibility[key] = !metricVisibility[key];
  var chip = document.getElementById('chip-' + key);
  if (metricVisibility[key]) {
    chip.className = 'chip active';
    chip.style.background = metricColors[key];
  } else {
    chip.className = 'chip inactive';
    chip.style.background = '';
  }
  renderDailyChart(_filteredRows);  // re-render with new visibility
}
```

### Funnel Component (Vertical List with Detail Panel)

A vertical step-by-step funnel where each step is clickable, showing a detail panel on the right with KPIs and a contact table.

**Layout:** Two-column flex — `.funnel-v7-left` (step list) + `.funnel-v7-right` (detail panel, hidden by default).

Key CSS classes: `.funnel-step` (clickable row with background bar), `.funnel-conv` (conversion zone between steps), `.funnel-v7-right.active` (shows detail panel), `.funnel-detail-kpis` (3-column KPI row in detail), `.funnel-detail-tbl` (paginated contact table).

**Step row structure:**
```html
<div class="funnel-step" data-stage="leads">
  <div class="funnel-step-bg" style="background: #61ACEE; width: 100%;"></div>
  <div class="funnel-step-num">1</div>
  <div class="funnel-step-ind" style="background: #61ACEE;"></div>
  <div class="funnel-step-info">
    <div class="funnel-step-name">New Leads</div>
    <div class="funnel-step-sub">100% of total</div>
  </div>
  <div class="funnel-step-badge"><span>$12.50 CPL</span></div>
  <div class="funnel-step-val">450</div>
  <div class="funnel-step-arr">›</div>
</div>
<div class="funnel-conv">
  <span class="funnel-conv-icon">↓</span>
  <span class="funnel-conv-pct">65.2%</span>
</div>
```

**Detail panel pattern:** When a funnel step is clicked, populate `.funnel-v7-right` with:
1. Detail header (stage name + close button)
2. Three KPI cards (Total, Conversion Rate, Cost per Unit)
3. Paginated contact table (8 per page)

```js
var _funnelDetailState = { stage: null, page: 0, perPage: 8 };

function openFunnelDetail(stageName, contacts, stats) {
  _funnelDetailState = { stage: stageName, rows: contacts, page: 0, perPage: 8 };
  document.querySelector('.funnel-v7-right').classList.add('active');
  renderFunnelDetailPage();
}
```

Mobile: On screens ≤768px, the detail panel stacks below the funnel list instead of appearing as a right column.

### Modal Dialogs

Use for drill-down views (clicking a table row to see details, contact timelines, pipeline breakdowns).

**CSS framework:**
```css
.modal-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  z-index: 2000;
  justify-content: center;
  align-items: center;
  padding: 24px;
}
.modal-overlay.active { display: flex; }
.modal-box {
  background: var(--vl-bg);
  border-radius: var(--vl-radius-lg, 12px);
  box-shadow: 0 20px 60px rgba(0,0,0,0.15);
  width: 100%;
  max-width: 900px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid var(--vl-border);
}
.modal-title { font-size: 1.1rem; font-weight: 700; }
.modal-close {
  background: none; border: none; font-size: 1.4rem; cursor: pointer;
  color: var(--vl-text-secondary); padding: 4px 8px; border-radius: 4px;
}
.modal-close:hover { background: #f1f5f9; }
.modal-body { overflow-y: auto; padding: 0; flex: 1; }
.modal-footer {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 24px; border-top: 1px solid var(--vl-border);
  font-size: 0.82rem; color: var(--vl-text-secondary);
}
```

**HTML skeleton:**
```html
<div class="modal-overlay" id="detail-modal">
  <div class="modal-box">
    <div class="modal-header">
      <div class="modal-title" id="modal-title">—</div>
      <button class="modal-close" id="modal-close-btn">&times;</button>
    </div>
    <div class="modal-body" id="modal-body"></div>
    <div class="modal-footer" id="modal-footer"></div>
  </div>
</div>
```

**JS — open/close + pagination:**
```js
var _modalState = { rows: [], page: 0, perPage: 25 };

function openModal(title, rows) {
  _modalState = { rows: rows, page: 0, perPage: 25 };
  document.getElementById('modal-title').textContent = title;
  renderModalPage();
  document.getElementById('detail-modal').classList.add('active');
}

function closeModal() {
  document.getElementById('detail-modal').classList.remove('active');
}

// Close on backdrop click and close button
document.getElementById('detail-modal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});
document.getElementById('modal-close-btn').addEventListener('click', closeModal);

function renderModalPage() {
  var start = _modalState.page * _modalState.perPage;
  var pageRows = _modalState.rows.slice(start, start + _modalState.perPage);
  var totalPages = Math.ceil(_modalState.rows.length / _modalState.perPage);
  // Render table into #modal-body and pagination into #modal-footer
}
```

**Numbered pagination:**
```css
.modal-pages { display: flex; gap: 4px; align-items: center; }
.modal-pages button {
  width: 32px; height: 32px;
  border: 1px solid var(--vl-border);
  border-radius: var(--vl-radius-sm, 6px);
  background: var(--vl-bg);
  font-size: 0.8rem; font-weight: 600; cursor: pointer;
}
.modal-pages button.active { background: var(--vl-primary); color: #fff; border-color: var(--vl-primary); }
```

### Patient/Contact Timeline Modal

A specialized modal for showing a contact's journey as a vertical timeline with colored dots.

```css
.pt-event {
  display: flex; gap: 16px; position: relative; padding-bottom: 24px;
}
.pt-event::before {
  content: ''; position: absolute; left: 15px; top: 32px; bottom: 0;
  width: 2px; background: #E8E8E8;
}
.pt-event:last-child::before { display: none; }
.pt-dot {
  width: 12px; height: 12px; border-radius: 50%;
  border: 2px solid #fff; box-shadow: 0 0 0 2px currentColor;
}
.pt-dot.green { color: #22C55E; background: #22C55E; }
.pt-dot.blue  { color: #61ACEE; background: #61ACEE; }
.pt-dot.red   { color: #E42313; background: #E42313; }
.pt-dot.orange { color: #F59E0B; background: #F59E0B; }
.pt-dot.gray  { color: #94A3B8; background: #94A3B8; }
```

Use dot colors to represent event types: green=won/positive, blue=action/scheduled, red=missed/negative, orange=warning/pending, gray=neutral.

### Stage/Matrix Tables

For tables showing boolean stage progression (e.g., customer journey stages), use a matrix layout with sticky left column, check marks, and horizontal scroll.

```css
.stage-tbl-wrap { overflow-x: auto; max-height: 600px; overflow-y: auto; }
.stage-tbl { width: 100%; border-collapse: collapse; }
.stage-tbl th {
  padding: 10px 12px; font-size: 0.7rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.04em; color: var(--vl-text-secondary);
  position: sticky; top: 0; background: #fff; z-index: 3;
}
.stage-tbl .sticky-col {
  position: sticky; left: 0; z-index: 2; background: #fff;
  min-width: 160px; box-shadow: 2px 0 4px rgba(0,0,0,0.04);
}
.stage-tbl th.sticky-col { z-index: 4; }
.stage-tbl .check { color: #22C55E; font-size: 1rem; text-align: center; }
.stage-tbl .dash { color: #ccc; text-align: center; }
```

Pattern: first column (name/entity) is sticky, remaining columns are boolean stages rendered as ✓ / —.

### Percentage & Stage Badges

Reusable inline badge styles for status indicators and conversion percentages.

```css
.pct-badge {
  display: inline-block; padding: 2px 10px; border-radius: 12px;
  font-size: 0.78rem; font-weight: 700; white-space: nowrap;
}
.pct-badge.green  { background: #dcfce7; color: #166534; }
.pct-badge.red    { background: #fee2e2; color: #991b1b; }
.pct-badge.purple { background: #ede9fe; color: #5b21b6; }
.pct-badge.gray   { background: #f1f5f9; color: #475569; }

.stage-badge {
  display: inline-block; padding: 2px 10px; border-radius: 12px;
  font-size: 0.72rem; font-weight: 600; white-space: nowrap;
}
```

### Section Cards

Wrap each logical section in a card container for visual grouping.

> **House style: never add a colored left/side accent bar** (`border-left`/`border-right` as a colored strip) to cards or callouts — including status/alert/"needs attention" callouts. Convey state with a badge, dot, or tinted background instead.

```css
.section-card {
  background: var(--vl-bg);
  border: 1px solid var(--vl-border);
  border-radius: var(--vl-radius);
  padding: 24px;
  box-shadow: var(--vl-shadow, 0 1px 3px rgba(0,0,0,0.06));
  margin-bottom: 24px;
}
.section-title {
  font-size: 1rem; font-weight: 600; color: var(--vl-text); margin-bottom: 16px;
}
```

### Global State Management Pattern

Every interactive report should follow this pattern for managing data, filters, and charts:

```js
(function() {
  var _allRows = [];       // Full unfiltered dataset
  var _filteredRows = [];  // Rows after client-side filters
  var _compareRows = null; // Previous period data (when compare is on)
  var _charts = {};        // Chart.js instances keyed by canvas ID

  function destroyChart(id) {
    if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
  }

  function renderAll(rows) {
    renderKPIs(rows);
    renderChart(rows);
    renderTable(rows);
    // ... all render functions
  }

  VL.onData('query_name', function(rows) {
    // Normalize date objects from BigQuery
    rows.forEach(function(r) {
      if (r.date && typeof r.date === 'object' && r.date.value) r.date = r.date.value;
    });
    _allRows = rows;
    _filteredRows = rows;
    populateFilterOptions(rows);
    renderAll(rows);
  });
})();
```

Key rules:
1. Always normalize BigQuery date objects (`{ value: '2026-01-01' }` → `'2026-01-01'`)
2. Store all rows in `_allRows`, apply client-side filters to produce `_filteredRows`
3. Always `destroyChart(id)` before creating a new Chart.js instance on the same canvas
4. Wrap everything in an IIFE to avoid global namespace pollution
5. Every `<canvas>` must be inside a `.chart-wrap` div with explicit height — never bare in a flex/grid parent (see Key Chart Rules)

### Loading State (framework-provided — do NOT build your own)

**Never add a report-level full-screen loading overlay.** The report host injects a skeleton loader (`#vl-loading-overlay`) for every live report. The runtime dismisses it only after **all** initial queries settle and re-shows it automatically on `VL.applyFilters()` (date-range changes). Reports that ship their own overlay create a double-loader and premature dismissal.

Rules:
- No overlay HTML/CSS in the report, and no `classList.add/remove('active')` loading code in `VL.onData()` callbacks or `applyFilters` patches. The framework handles both show and dismiss.
- Never reuse the id `vl-loading-overlay` for report elements.
- Small **inline section loaders** (e.g., a spinner inside a lazy-loaded panel that fetches outside the VL runtime) are still fine — only full-page overlays are owned by the framework.

### Search Input (Table Filtering)

For tables with many rows, add a search input that filters in real-time.

```js
document.getElementById('search-input').addEventListener('input', function() {
  var q = this.value.toLowerCase();
  var filtered = _allRows.filter(function(r) {
    return (r.name || '').toLowerCase().includes(q) ||
           (r.email || '').toLowerCase().includes(q) ||
           (r.phone || '').toLowerCase().includes(q);
  });
  renderTable(filtered);
});
```

### Cross-Page Communication

When multiple pages share data or need to trigger re-renders across pages (e.g., compare data affecting another page's module):

```js
// Expose render functions on window for cross-page access
window._adsRenderCompare = function() {
  var compareRows = window._adsCompareRows;
  if (!compareRows) return;
  renderAdsKpiDeltas(compareRows);
};

// In the main page's compare fetch callback:
if (typeof window._adsRenderCompare === 'function') window._adsRenderCompare();
```

### Pipeline/Data Tables (Clickable Rows)

Standard pattern for data tables with right-aligned numbers, clickable rows that open modals.

```css
.pipeline-tbl { width: 100%; border-collapse: collapse; }
.pipeline-tbl th {
  text-align: left; padding: 10px 14px; font-size: 0.72rem; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.05em; color: var(--vl-text-secondary);
  background: #f8f9fa; border-bottom: 1px solid var(--vl-border);
}
.pipeline-tbl td { padding: 10px 14px; font-size: 0.88rem; border-bottom: 1px solid var(--vl-border); }
.pipeline-tbl tbody tr { cursor: pointer; transition: background 150ms; }
.pipeline-tbl tbody tr:hover { background: #f8f9fa; }
.pipeline-tbl .num { text-align: right; font-variant-numeric: tabular-nums; }
```

### Combo Charts (Bar + Line, Dual Axis)

For showing volume alongside rates (e.g., weekly spend bars + ROAS line):

```js
new Chart(canvas, {
  type: 'bar',
  data: {
    labels: labels,
    datasets: [
      {
        label: 'Spend', type: 'bar', yAxisID: 'y',
        data: spendData,
        backgroundColor: function(ctx) { return barGradient(ctx.chart.ctx, ctx.chart.chartArea, '#6366f1'); },
        borderColor: '#6366f1', borderWidth: 2, borderRadius: { topLeft: 3, topRight: 3 }
      },
      {
        label: 'ROAS', type: 'line', yAxisID: 'y1',
        data: roasData,
        borderColor: '#22C55E', backgroundColor: 'transparent',
        borderWidth: 2, pointRadius: 3, tension: 0.3, fill: false
      }
    ]
  },
  options: {
    scales: {
      y: { position: 'left', ticks: { callback: function(v) { return '$' + v; } } },
      y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { callback: function(v) { return v + 'x'; } } }
    }
  }
});
```

### Default Behavior Checklist

When building any new interactive report, include these by default:

- [ ] **Split-file format** for reports that will exceed ~500 lines (use source directory with numbered JS files)
- [ ] **Chart wrappers** — every `<canvas>` inside a `.chart-wrap` div with explicit height; `maintainAspectRatio: false` on every Chart.js instance
- [ ] **KPI scorecards** with sparklines (not plain `vl-metric` cards)
- [ ] **Sticky header** with title + date picker trigger + filter chips
- [ ] **Custom date picker** with presets and compare toggle (if date range filtering is needed)
- [ ] **Client-side filter chips** for key dimensions
- [ ] **No report-level loading overlay** — the framework skeleton loader handles loading UI
- [ ] **Formatting utilities** (`fmt`, `fmtCur`, `fmtPct`, `fmtDate`)
- [ ] **IIFE wrapper** with `_allRows`, `_filteredRows`, `_compareRows`, `_charts` state
- [ ] **Chart cleanup** via `destroyChart(id)` before re-rendering
- [ ] **BigQuery date normalization** in `VL.onData()` callbacks
- [ ] **Modal dialogs** for drill-down on table rows
- [ ] **Responsive breakpoints** at 1024px, 768px, 480px
- [ ] **Tabular-nums** on all number columns
- [ ] **Section cards** wrapping each logical group
- [ ] **Every query validated** with `validate_query` before syncing
- [ ] **Build + draft sync** after every edit: `npm run build && npm run sync -- --draft`
