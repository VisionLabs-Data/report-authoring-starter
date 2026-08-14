---
name: dataform-pipeline
description: >-
  How a client's BigQuery data is laid out and modelled — the one-dataset-per-client rule, the
  raw_/staging_/main_ layers, and the Dataform settings and model config that put tables in the
  right place. Use this when setting up a new client's Dataform project, adding or editing a
  .sqlx model, deciding which layer a table belongs in, or answering "where should this table
  live", "why is my table in the wrong dataset", "what should defaultDataset be".
---

# Dataform pipeline

> **Scaffold:** `dataform/` in this repo is a copy-me template for one client's Dataform repo — a
> real, runnable ad semantic layer, ONE dataset per client (raw_/staging_/main_ prefixes): Meta +
> Google daily staging → `main_ads_daily_grain` (pipeline-attributed) + `main_daily_summary` +
> `main_meta_ad_creatives` + `main_meta_tracking_audit`, plus the `main_campaign_pipeline_mapping`
> dimension. `dataform/README.md` has the layer walkthrough and the one-time GCP setup (connect the
> repo, create the release + workflow configs). Start there, then use this skill for the modelling
> decisions.

## One dataset per client

Every client gets exactly one BigQuery dataset, named after the client, in your agency's GCP
project. The three layers live in it side by side, told apart by **table prefix**:

```
acme_dental.raw_meta_ads_ads            ← Airbyte writes these
acme_dental.raw_google_ads_campaign
acme_dental.staging_ad_spend            ← you write these
acme_dental.main_channel_performance
```

The dataset name is the client's `dataset_slug` in the portal. It is set once when the client
is created and **never changes**, so a model written today keeps resolving.

Why one dataset rather than one per layer: an agency's clients share a GCP project, so a
layer-named dataset (`raw`, `staging`, `main`) would put every client's tables together — and
the portal's access control is dataset-level, so it could not tell two clients apart. The
client dataset *is* the tenant boundary. Never write one client's tables into another's
dataset, and never create a shared `staging` dataset "just for intermediates".

## Dataform settings

`workflow_settings.yaml` at the repo root:

```yaml
defaultProject: your-agency-gcp-project
defaultDataset: acme_dental            # the client's dataset_slug
defaultAssertionDataset: acme_dental   # assertions live with the data, not in a side dataset
dataformCoreVersion: 3.0.37
```

One Dataform repo per client is the simplest arrangement, and `defaultDataset` then does the
work with no per-model overrides. If you run several clients from one repo, every model must
set `schema:` explicitly — a missed one silently lands in the default client's dataset.

## Model config

The layer is in the **name**, not the schema. This example is **complete on purpose** — it carries
every block a model must ship with (below). Copy the shape, don't strip it back:

```js
config {
  type: "table",
  schema: "acme_dental",          // the client dataset — or omit to inherit defaultDataset
  name: "main_channel_performance",
  description: "One row per channel per day. Spend/impressions/clicks are additive; ctr is a ratio — recompute from totals, never average.",
  tags: ["main", "marketing"],
  bigquery: {
    partitionBy: "report_date",                       // every time-series table: partition by its date column
    clusterBy: ["channel"]                            // cluster by the columns reports filter on
  },
  assertions: {
    uniqueKey: ["report_date", "channel"],            // THE primary key — the run FAILS on a duplicate
    nonNull: ["report_date", "channel", "spend"],     // the key + the money columns
    rowConditions: ["spend >= 0", "ctr IS NULL OR ctr BETWEEN 0 AND 1"]  // ranges / enums
  },
  columns: {                                          // ONE line per output column — Dataform pushes
    report_date: "The day (partition key).",           //   these into the BigQuery schema, which is
    channel: "Marketing channel, e.g. meta / google.", //   exactly what the portal AI reads to write
    spend: "Amount spent. Additive.",                  //   correct SQL
    ctr: "clicks / impressions for this row. A ratio — recompute from sums, never average."
  }
}
```

| Layer | Prefix | What belongs here |
|---|---|---|
| Raw | `raw_<provider>_*` | Airbyte's output. **Never write these yourself** — the connector owns them, and a sync will overwrite anything you put there |
| Staging | `staging_*` | One concept per table: typed, cleaned, deduped, renamed to business terms. No joins across concepts |
| Main | `main_*` | Reporting-ready. Joined, aggregated to a stated grain, safe for a report to query directly |

### Every model ships with these — no exceptions

These are DEFAULTS, not polish. A model missing any of them is incomplete; add them when you write
it, not "later" (later never comes, and the gap is invisible until a number is wrong):

1. **`description` with the grain** — "one row per campaign per day" — and a note on any measure
   that can't be summed. The portal AI reads this. A rate column with no warning is how a report
   ends up averaging an average.
2. **`columns:` — one line for EVERY output column.** Dataform writes these into the BigQuery
   column metadata, and that metadata is what the reporting agent reads to write correct SQL. Say
   the grain column, mark additive measures "Additive", and warn on ratios ("recompute from sums").
   This is the detail most often skipped and the one that pays back most.
3. **`assertions.uniqueKey` on the grain — this IS the primary key.** BigQuery enforces no keys; a
   Dataform assertion is a query that fails the run when violated, so the uniqueKey is the only
   thing standing between you and a silent fan-out that doubles a number.
4. **`assertions.nonNull`** on the key and the money columns.
5. **`assertions.rowConditions`** for value ranges and enums — `spend >= 0`, `ctr BETWEEN 0 AND 1`,
   `status IN ('ok','no_utm',…)`. Cheap, and they catch a broken upstream sync before a report does.
6. **`bigquery.partitionBy`** its date column for any time-series table, and **`clusterBy`** the
   columns reports filter on (pipeline, platform, channel). Skip BOTH only for a small
   dimension/seed table (a handful of rows — partitioning just adds overhead there).

## Rules that prevent the expensive mistakes

- **Reports query `main_*`.** If a report needs something only `raw_*` has, that's a gap in
  this pipeline — add the model. A report that re-derives a metric in its own SQL will
  disagree with every other report that used the modelled table, and nobody notices until two
  dashboards are asked the same question.
- **State the grain in every model's description**, and never mix grains in one table.
- **Rates are computed at read time**, as ratio-of-totals. Store the numerator and denominator
  as additive columns; a stored per-row rate will eventually be summed by something.
- **Assertions on the boundaries** — the full set above (uniqueKey = the primary key, nonNull on
  join keys + money, rowConditions for ranges). A silent fan-out from a duplicated dimension row is
  the single most common way a number doubles, and the uniqueKey is what turns it into a failed run
  instead of a wrong dashboard.
- **Column descriptions and partition/cluster are part of "done"**, not extras — see the mandatory
  list above. The scaffold's models are the worked example; match them.

## Orchestration

**Do not schedule anything yourself.** The portal orchestrates the client's pipeline: when they
connect their first data source it runs the Airbyte syncs, waits for them to finish, then
triggers Dataform — so models never run against half-loaded tables.

Because the portal owns the timing, it takes the schedules over when the pipeline is first set
up. Both of these are expected, not a misconfiguration:

- per-connection **Airbyte crons** are switched to `manual` (the originals are stashed and
  handed back if orchestration is disabled),
- the **Dataform workflowConfig's cron is cleared**. Leaving it would run Dataform twice a
  day: once orchestrated, once on its own against whatever had landed by then.

Set the run time in the portal (`/admin/pipeline`), not in GCP. It's client-local, 1am by
default.

What the platform needs from your repo: a **workflowConfig** with a **releaseConfig** for it to
compile from. Without one, every run fails at the Dataform step — that's the single most common
setup mistake. Create both in the Dataform repository (GCP console): a **release config** on
`main`, then a **workflow config** that references it with its schedule left off — `dataform/README.md`
has the click-by-click. `/admin/pipeline` shows a client's scope, schedule, and last run.

**A brand-new client with no Dataform repo yet is fine.** Orchestration runs the syncs and
reports that there's nothing to model; add the repo when you're ready and it starts running.

Older clients (pre-Aug 2026) use a dataset per layer instead — `<client>_raw`,
`<client>_staging`, `<client>_main`. Same three layers, same rules about what goes in each.
Leave them as they are; the layouts coexist fine because those clients own their own project.
