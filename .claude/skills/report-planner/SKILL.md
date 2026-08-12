# Report Planner

Plan actionable, insight-driven client reports by exploring the client's data, identifying meaningful metrics, finding correlations, and designing report layouts before any code is written. Use this skill whenever the user wants to create a new report, asks "what can we build from this data", mentions a table or dataset they want to turn into a dashboard, or says anything about planning/scoping a report. This skill should run BEFORE report-builder — it produces the blueprint that report-builder executes. Even if the user jumps straight to "build me a report from table X", start with this planning phase first.

## Why This Skill Exists

The difference between a good report and a forgettable one is whether someone can take action after reading it. A report that just displays numbers is a spreadsheet with extra steps. Every metric, chart, and page in a report should answer one question: **"What action can I take with this data?"**

This skill forces that thinking upfront — before any HTML or queries are written — so reports are designed around decisions, not just data availability.

## The Planning Process

### Phase 1: Understand the Context

Before touching any data, establish the decision-making context:

1. **Read the client config** (`clients/{slug}/client.config.json`) to get the client `name`, `gcp_project_id`, `datasets` (the logical→physical dataset map), and `branding.company_name`. The `clients/{slug}` folder maps to a portal client via `portal.config.json`'s clients map — the sync script sends that mapping to the portal.
2. **Select the client over MCP.** If your API key is agency-scoped, call `list_clients` then `select_client` so subsequent schema and validation calls are scoped correctly. (Skip if the key is already client-scoped.)
3. **Pull the client's existing definitions first.** Before inventing metrics, call `list_metrics` (+ `get_metric` for the ones you'll feature) and `get_glossary` over MCP. These are the client's already-agreed definitions, targets, and terminology. Also skim `list_alerts` to see what they're already watching. Any metric you put on the dashboard should match a defined metric's formula and name, and any KPI with a target should show it as the goal line / delta-vs-target. If you need a metric that isn't defined yet, name it exactly as the glossary would and flag it — don't silently coin a competing definition. This is the same "recall before you build" reflex as memories/documents (see CLAUDE.md "Shared knowledge"); grounding numbers in the shared definitions is how a report agrees with the rest of the portal.
4. **Clarify the audience.** Who will read this report? (exec, ops manager, marketing team, the client themselves). This determines the level of detail and which metrics matter.
5. **Clarify the goal.** What decision or action should this report enable? If the user says "build a report from table X," ask: "What should someone be able to decide or do after seeing this report?"

**Data source note:** reports query **BigQuery only** — every query in a report is a `sql` query against tables the client is authorized for. The single source of truth for what's queryable is the portal's `get_client_schema` MCP tool. Never plan around tables it doesn't return.

**Prefer the modelled layer.** The client's dataset holds three layers, told apart by table prefix: `raw_<provider>_*` (straight from Airbyte), `staging_*` (cleaned, intermediate), `main_*` (modelled, reporting-ready). Plan on `main_*`. Dropping to `raw_*` means re-deriving something the pipeline already computed, and your answer will differ from every other report that used the modelled table — that is how two dashboards end up disagreeing about the same number. If what you need only exists in `raw_*`, treat it as a pipeline gap and flag it under Future Enhancements rather than quietly rebuilding the logic in report SQL. (Older clients may instead have a dataset per layer — `<client>_raw` / `<client>_staging` / `<client>_main`. Same rule: plan on the modelled one.)

If the request is open-ended ("what reports can we build for this client?"):
- Call `get_client_schema` to list the client's authorized tables and columns
- Summarize what each table appears to contain
- Then let the user pick a focus area

### Phase 2: Explore the Data

This is a structured discovery process.

#### Step 1: Schema & Metadata

```
get_client_schema → the client's authorized BigQuery tables, columns, and types
```

Flag any columns that look like they could be dimensions (string/enum types) vs. measures (numeric types) vs. time axes (timestamp/date types). Note anything that hints at table size — large tables need careful query planning.

#### Step 2: Shape of the Data

Run lightweight exploratory queries to understand what's actually in the table. If you have direct BigQuery access (the `bq` CLI, the BigQuery console, or a BigQuery MCP server configured in this workspace), run them there against the client's `gcp_project_id`. If you don't, at minimum dry-run each candidate query with the portal's `validate_query` tool (it validates structure and authorization without executing), and confirm real values later via a draft preview of the report.

- **Distinct values for key dimensions** — `SELECT col, COUNT(*) FROM table GROUP BY 1 ORDER BY 2 DESC LIMIT 20`. This reveals the cardinality and distribution. High-cardinality string columns (like email, ID) are filters, not chart axes. Low-cardinality columns (like status, type, channel) are natural grouping dimensions.
- **Date range** — `SELECT MIN(date_col), MAX(date_col)`. Determines the time window available and whether trends are viable.
- **Sample rows** — `SELECT * FROM table LIMIT 20` (use specific columns for large tables to control cost). Read actual values to understand what the data represents in the real world, not just what the schema says.
- **Null density** — For columns that look important, check how sparse they are. A column that's 90% null isn't a good primary metric.

#### Step 3: Metric Discovery

This is where critical thinking begins. **Start from the client's defined metrics** (`list_metrics`/`get_metric` from Phase 1) — those already have agreed names, formulas, and targets; reuse them verbatim. Only invent a metric when the definitions don't cover it. For each metric:

1. **Name it clearly, matching the glossary.** Use the defined metric's name and the glossary's term ("Monthly churn rate," not "unsub_count / sub_count") so the report reads the same as everything else the client sees. If it has a target, the KPI shows it (goal line, or delta-vs-target instead of just period delta).
2. **Classify it:**
   - **Volume metric** — raw count or sum (sends, subscribers, revenue). Useful for scale context.
   - **Rate metric** — ratio of two volumes (CTR, churn rate, conversion rate). Where the real insight lives.
   - **Trend metric** — any metric tracked over time. Shows direction.
   - **Segmentation metric** — any metric broken down by a dimension (channel, creative, persona). Shows where to focus.
3. **Ask the action question:** If this metric goes up 20%, what would someone do differently? If the answer is "nothing" or "I don't know," the metric probably isn't worth featuring prominently. It might still be useful as supporting context, but it shouldn't be a headline KPI.

#### Step 4: Find Relationships & Correlations

The most valuable insights come from connecting metrics to each other. Actively look for:

- **Inverse correlations** — When X goes up, Y goes down. Example from an SMS marketing report: send volume scaled 10x but CTR dropped from 7.6% to 2.1%. This inverse relationship reveals diminishing returns — actionable because it suggests an optimal send frequency.
- **Leading indicators** — Does one metric predict another? Example: subscriber growth in month N might predict revenue in month N+1.
- **Segment disparities** — The same metric tells different stories across segments. Example: automated messages had a 36% CTR vs. 2% for campaigns. That's a signal to shift strategy.
- **Timing effects** — Performance varies by time dimension (hour, day, month, season). Example: CTR was 38% at 2am ET but 1.6% at peak send hours. Actionable: shift send timing.
- **Composition shifts** — The mix of components changes over time. Example: campaigns went from 35% to 75% of send volume, correlating with the CTR decline.

Run queries to test these hypotheses. Not every hunch will pan out — that's fine. The ones that do become the key findings that make the report valuable.

#### Step 5: Check Adjacent Tables

A single table rarely tells the whole story. Check whether `get_client_schema` returns related tables that could enrich the analysis:

- Revenue or order tables (connect marketing activity to business outcomes)
- Customer/user tables (add demographic or lifecycle dimensions)
- Other channel tables (compare performance across channels)

Don't force joins that don't exist, but flag opportunities. **If the data you'd need isn't in any table `get_client_schema` returns, do not guess table names or try to work around it — tell the user their data pipeline needs the table added**, and record it under Future Enhancements in the plan.

### Phase 3: Design the Report

Now synthesize everything into a concrete plan.

#### Fixed vs. Interactive

Use `"interactivity": "fixed"` when:
- The report covers a known, static time window (e.g., a one-time analysis)
- The audience doesn't need to explore different date ranges

Use `"interactivity": "interactive"` with date range filters when:
- The data spans a long time period and users may want to zoom into specific windows
- Stakeholders will revisit the report over time
- Different time ranges tell different stories (e.g., seasonal patterns, before/after comparisons)
- The audience includes operators who need to answer ad-hoc questions

**Default to interactive mode** unless there's a strong reason not to. Most reports are revisited over time.

When recommending interactive mode, include filter config in the plan. For reports that benefit from period-over-period comparison, plan for a **custom date picker with compare toggle** (overrides the renderer's built-in picker). Otherwise the renderer's auto-injected picker is sufficient.

```
**Filters:**
- Date Range: default last 30 days (`-30d` to `-1d`)
  - All queries parameterized with `@date_start` / `@date_end`
  - Custom date picker with compare toggle (period-over-period deltas)
- Client-side filter chips: [list key dimensions — e.g., Pipeline, Rep, Status]
```

Pick sensible defaults based on the data's date range — if data only goes back 6 months, don't default to `-2y`.

#### Single-Page vs. Multi-Page

Use a single page when:
- There are fewer than 6 visualizations
- The data tells one cohesive story
- The audience wants a quick snapshot

Use multiple pages when:
- There are distinct sub-topics (e.g., growth, acquisition, engagement)
- Different audiences care about different sections
- There are more than 6 visualizations

#### Mandatory: Trends Page

**Every multi-page report MUST include a "Trends" page.** This is a dedicated page that shows every important metric as a daily time-series chart with a linear trendline. It serves two purposes:

1. **Pattern detection** — see seasonality, week-over-week shifts, and inflection points that aggregate KPIs hide
2. **Debugging** — quickly spot data gaps, anomalies, or pipeline issues

**Trends page structure:**
- One row per metric: left side shows metric name, total value, and period delta; right side shows a line chart with a dashed linear regression trendline
- Include **all KPI metrics** from the overview page plus any additional metrics relevant to the report's domain
- For reports with ad spend data, also include: platform-level spend (Meta, Google), cost-per metrics (CPL, CPA, cost per conversion), and ROAS
- Derived/ratio metrics (cost-per, ROAS) are computed daily from their numerator/denominator fields and show the period aggregate as the headline value
- Cost metrics should invert delta coloring (down = green, up = red) since lower cost is better
- When compare mode is active, overlay the previous period as a dashed line aligned by position (day 1 vs day 1)
- Trendline uses the metric's color at full opacity, 2.5px dashed stroke, linear regression across all data points

**Implementation pattern:** define a `trendMetrics[]` config where each entry has `key`, `label`, `color`, and optional `currency`, `ratio`, or `derived` flags. A `renderTrends()` function builds daily value maps from the query rows, then renders one Chart.js line chart per metric with a trendline overlay. Metrics whose data loads asynchronously (e.g., from a second query) need a re-render callback once that data arrives.

#### Report Plan Structure

Present the plan in this format:

```
## Report Plan: [Title]

**Audience:** [Who reads this]
**Core question:** [What decision does this enable?]
**Data source(s):** [Table(s) used]
**Date range:** [Available window]
**Recommended cadence:** [How often should this be refreshed?]

### Metrics & Definitions (grounding)

List every headline metric and where its definition comes from — so the build matches
the portal's shared definitions (`list_metrics` / `get_glossary` from Phase 1):

| Metric (report label) | Defined metric / glossary term | Formula | Target | Source |
|---|---|---|---|---|
| [e.g. Qualified Leads] | [defined metric name, or "NEW"] | [the agreed formula] | [target + grain, or —] | `list_metrics` / `get_glossary` / new |

- Reuse the defined name and formula verbatim. Mark anything not yet defined as **NEW** and
  call it out for the user to confirm — don't silently coin a competing definition.
- Any metric with a target shows it on the dashboard (goal line / delta-vs-target, not just
  period delta).

### Interactive Features
- **Date picker:** Custom with compare toggle / Renderer built-in / None (fixed)
- **Compare:** Period-over-period deltas on KPIs and trend charts
- **Client-side filters:** [list dimension chips — e.g., Pipeline, Rep, Status]
- **Drill-down modals:** [which table rows open detail modals]
- **Search:** [which tables have search input]

### Page 1: [Page Name]

**Purpose:** [What this page helps the reader understand/decide]

**Header:** Sticky header with title, date picker trigger, filter chips

**KPI Scorecards (top row):**
- [Metric name] — [format: number/currency/percent] — sparkline field — [target, if any] — [why it matters]
- [Metric name] — ...
(All KPIs show period-over-period deltas when compare is active; KPIs with a defined target
also show progress vs. target — goal line on the sparkline or a delta-vs-target label)

**Visualizations:**
1. [Chart type]: [Title] — [what it shows and what action it enables]
   - Data: [which columns/aggregation]
   - Toggle chips: [if multiple metrics can be toggled on/off]
   - Insight: [the expected finding or pattern]

2. [Funnel / Table / Chart]: [Title] — [what it shows]
   - Detail panel / Modal: [what clicking a row/step reveals]
   ...

**Key Finding:** [The narrative insight this page surfaces]
**Action:** [What someone should do based on this page]

### Page 2: [Page Name]
...

### Queries Needed
- `query_name`: [description of the SQL, which columns, GROUP BY, etc.]
- `query_name`: ...

### Correlations to Highlight
- [Metric A] vs [Metric B]: [relationship and why it matters]
- ...

### Future Enhancements
- [Things that would make the report better but aren't available yet — including
  tables the client's data pipeline would need to add]
```

#### Visualization Selection Guide

Pick the right chart type based on what you're communicating. The **Pattern** column points at the ready-made pattern in the **report-builder** skill — use those instead of writing from scratch.

| What you're showing | Component | Pattern (report-builder) | When to use |
|---|---|---|---|
| Headline KPIs | **KPI scorecards with sparklines** | KPI Scorecards with Sparklines | Always — top of every page. Shows value, subtitle, period delta, 7-day sparkline |
| Trend over time | Line chart | Multi-Dataset Line Chart | Continuous metrics, rates, cumulative values. Supports grid layout, dual-axis, trendlines, comparison periods |
| Volume comparison over time | Bar chart (stacked or grouped) | Bar Chart with Two-Tone Gradients | Send counts, subscriber adds, revenue. Use toggle chips for multi-metric visibility |
| Part-of-whole | Doughnut/pie | declarative `vl-chart` | Channel mix, segment distribution (max 6 slices) |
| Ranking | Horizontal bar | Bar Chart with Two-Tone Gradients | Top N creatives, sources, campaigns |
| Two metrics with different scales | **Combo chart (bar + line, dual axis)** | Combo Charts | Volume bars with rate line overlay (e.g., Spend + ROAS) |
| Step-by-step conversion | **Funnel component** | Funnel Component | Pipeline stages, onboarding flows. Vertical list with clickable detail panel |
| Entity detail | **Modal dialog** | Modal Dialogs | Drill-down from table rows. Shows contact timeline, pipeline breakdown, etc. |
| Stage progression matrix | **Stage table** | Stage/Matrix Tables | Boolean journey stages per entity. Sticky left column, check/dash marks |
| Data breakdown | **Data table** (clickable rows) | Pipeline/Data Tables | Aggregate metrics per dimension. Heat mapping, sparklines, sorting |
| Growth decomposition | Diverging bar + line | Combo Charts | Subscribed vs unsubscribed with net growth line |
| Activity feed | **Timeline** | Patient/Contact Timeline Modal | Vertical timeline with status dots, expandable detail panels, date grouping |
| Section switching | **Tab bar / pages** | Multi-Page Reports | Switching between logical sections |
| All metrics over time | **Trends page** | Trends page pattern (above) | Mandatory on multi-page reports. One row per metric with line chart + linear trendline |

The portal also exposes a `list_components` MCP tool describing its vetted component library — useful for naming and consistency with reports built inside the portal, but in this repo you implement components with the report-builder patterns.

#### Writing Key Findings

Every page should have at least one key finding. Good key findings:

- **State a fact with a number.** "CTR dropped from 7.6% to 2.1%" not "CTR decreased."
- **Explain why it matters.** Connect the fact to a business consequence.
- **Suggest an action.** "Shifting send volume to morning hours could improve engagement" not just "morning hours have higher CTR."

Bad: "Send volume increased over time."
Good: "Send volume grew 10x since Jan 2024, but CTR dropped from 7.6% to 2.1%, suggesting diminishing returns. Consider capping weekly campaign sends or A/B testing frequency to find the optimal volume."

### Phase 4: Get Confirmation

Present the full report plan to the user. Ask:

1. Does this cover the right questions?
2. Any metrics or angles missing?
3. Is the page structure right, or should things be combined/split?
4. Ready to build? (Next step: hand off to report-builder skill)
5. If the report will be complex (multiple pages, custom JS modules, likely >500 lines), recommend the **split-file format** — a source directory with `styles.css`, `template.html`, and numbered JS files assembled by `npm run build`. This makes each file small and independently editable.

Do NOT proceed to building the report until the user confirms the plan. The whole point of this skill is to think before coding.

## Default Interactive Behaviors

Every new report plan should include these unless there's a specific reason to exclude them:

1. **KPI scorecards with sparklines** — not plain `vl-metric` cards. Show the headline number, contextual subtitle, 7-day sparkline, and period-over-period delta.
2. **Custom date picker with compare toggle** — enables period-over-period analysis. Plan for the compare data fetch pattern.
3. **Sticky header** — pin title, date picker trigger, and filter chips to viewport top.
4. **Client-side filter chips** — identify 2-5 key dimensions users will want to slice by (pipeline, rep, channel, status, etc.).
5. **Drill-down modals** — every data table should have clickable rows that open a detail modal (contact info, timeline, breakdown).
6. **Funnel component** — if the data has sequential stages (lead → qualified → consult → won), use the vertical funnel with clickable detail panel.
7. **Toggle chips** — for stacked/multi-metric charts, let users show/hide individual metrics.
8. **Loading states** — do NOT plan a report-level loading overlay; the report host provides a framework skeleton loader for all live reports. Only plan scoped inline loaders for sections that fetch outside the VL runtime.
9. **Search input** — for tables with >20 rows, add real-time search filtering.
10. **Trends page** — mandatory on multi-page reports. Shows every important metric as a daily line chart with a linear regression trendline. Include all KPIs, ad spend metrics (if applicable), and derived cost/efficiency metrics. See "Mandatory: Trends Page" section above.

When writing the plan, call out which of these apply and where they'll appear on each page.

## Anti-Patterns

These are common traps that produce bad reports. Avoid them:

- **Dashboard of everything.** Showing every available metric because you can. If a chart doesn't have a clear "so what," cut it.
- **Vanity metrics only.** Total sends, total subscribers — these always go up and rarely inform action. Pair volume metrics with rate metrics (CTR, churn rate) that reveal quality.
- **No narrative.** Charts without key findings are just pictures of data. Every visualization should connect to a story.
- **Ignoring segments.** An overall average hides the interesting stuff. Always look for the dimension that splits the data into meaningfully different groups.
- **Static snapshots.** If the report only makes sense for one point in time, it'll be stale tomorrow. Design for trends and ongoing monitoring.
- **Correlation without context.** "X and Y move together" is an observation. "X and Y move together because [mechanism], which means you should [action]" is an insight.
- **Planning around data that doesn't exist.** If `get_client_schema` doesn't return the table, the report can't query it. Flag the gap to the user (their data pipeline needs the table added) instead of guessing table names.
- **Redefining metrics the client already defined.** If `list_metrics`/`get_glossary` already define "Qualified Lead" or "MRR," don't coin a subtly different formula or name on the dashboard — the report will silently disagree with the rest of the portal. Reuse the definition, or flag the discrepancy.
