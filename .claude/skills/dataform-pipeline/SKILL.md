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

The layer is in the **name**, not the schema:

```js
config {
  type: "table",
  schema: "acme_dental",          // the client dataset — or omit to inherit defaultDataset
  name: "main_channel_performance",
  description: "One row per channel per day. Spend reconciled to platform totals.",
  tags: ["main", "marketing"],
}
```

| Layer | Prefix | What belongs here |
|---|---|---|
| Raw | `raw_<provider>_*` | Airbyte's output. **Never write these yourself** — the connector owns them, and a sync will overwrite anything you put there |
| Staging | `staging_*` | One concept per table: typed, cleaned, deduped, renamed to business terms. No joins across concepts |
| Main | `main_*` | Reporting-ready. Joined, aggregated to a stated grain, safe for a report to query directly |

`description` is not decoration — the portal's AI reads it when answering questions about the
client's data. State the **grain** ("one row per campaign per day") and any measure that
cannot be summed. A rate column with no warning is how a report ends up averaging an average.

## Rules that prevent the expensive mistakes

- **Reports query `main_*`.** If a report needs something only `raw_*` has, that's a gap in
  this pipeline — add the model. A report that re-derives a metric in its own SQL will
  disagree with every other report that used the modelled table, and nobody notices until two
  dashboards are asked the same question.
- **State the grain in every model's description**, and never mix grains in one table.
- **Rates are computed at read time**, as ratio-of-totals. Store the numerator and denominator
  as additive columns; a stored per-row rate will eventually be summed by something.
- **Assertions on the boundaries** — uniqueness on the grain, not-null on join keys. A silent
  fan-out from a duplicated dimension row is the single most common way a number doubles.

## Orchestration

You do **not** need to schedule anything. When a client connects a data source in the portal,
the platform puts that connection into the client's orchestrated pipeline automatically: it
runs the Airbyte syncs, waits for them to finish, then triggers Dataform — so models never run
against half-loaded tables. Per-connection Airbyte crons are switched to manual and stashed
when this happens; that's expected, and disabling orchestration in the portal hands them back.

What the platform needs from your repo: a **workflowConfig** with a **releaseConfig** for it to
compile from. Without one, every run fails at the Dataform step. Check
`/admin/pipeline` in the portal to see a client's scope, schedule, and last run.

Older clients (pre-Aug 2026) use a dataset per layer instead — `<client>_raw`,
`<client>_staging`, `<client>_main`. Same three layers, same rules about what goes in each.
Leave them as they are; the layouts coexist fine because those clients own their own project.
