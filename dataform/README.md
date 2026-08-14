# Dataform pipeline (template)

This folder is a **ready-to-copy template for ONE client's Dataform repo** — the BigQuery
data-modelling half of the pipeline. It is deliberately separate from the reports in
`clients/`: reports render HTML, this turns a client's raw ad data into the clean tables those
reports query. The conventions here (one dataset per client, `raw_`/`staging_`/`main_` layers,
grain-in-the-description, rates-at-read-time) are explained in the **`dataform-pipeline`**
skill — read it first.

```
dataform/
  workflow_settings.yaml              # defaultProject / defaultDataset / location / core version
  definitions/
    sources/raw_sources.js            # declare the Airbyte raw_ tables so models can ref() them
    staging/staging_ad_spend.sqlx     # typed, cleaned, one concept per table
    main/main_channel_performance.sqlx# reporting-ready, joined/aggregated to a stated grain
```

## The layers, in one line each

| Layer | Prefix | Who writes it |
|---|---|---|
| Raw | `raw_<provider>_*` | **Airbyte** — never model into these, a sync overwrites them |
| Staging | `staging_*` | you — typed, cleaned, deduped, one concept per table, no cross-concept joins |
| Main | `main_*` | you — joined + aggregated to a stated grain; reports query these directly |

## Stand it up (once per client)

1. **Make it the client's own repo.** One Dataform repo per client is simplest — then
   `defaultDataset` does all the work with no per-model `schema:` overrides. Copy this `dataform/`
   folder to the ROOT of a new git repo (or a `clients/<slug>/dataform` repo — your call), so
   `workflow_settings.yaml` sits at the repo root where Dataform expects it.
2. **Point it at the client's dataset.** In `workflow_settings.yaml` set `defaultProject` to your
   agency GCP project and `defaultDataset` / `defaultAssertionDataset` to the client's
   **`dataset_slug`** (from the portal when the client was created — fixed forever). Set
   `defaultLocation` to match your BigQuery datasets' region.
3. **Wire the real sources.** Edit `definitions/sources/raw_sources.js` to declare the raw tables
   this client actually syncs (the names are the Airbyte stream names — check them in BigQuery),
   and rewrite the staging model against them. The two examples are Meta + Google Ads.
4. **Connect the repo in GCP.** BigQuery → **Dataform** → Create repository → link this git repo
   (deploy key or GitHub connection). Dataform compiles `workflow_settings.yaml` + `definitions/`.

## The bit everyone misses: a **release config** AND a **workflow config**

The portal orchestrates runs by invoking a **workflow config**, which executes a compiled
**release config**. If the repo has no workflow config, every orchestrated run fails at the
Dataform step with *"No workflowConfig"* — this is the single most common setup mistake.

In the Dataform repository (GCP console → your repo):

1. **Release configuration** → Create. Give it a name (e.g. `production`), branch `main`. This
   compiles the repo into a `compilationResult`. A compile frequency is fine; the portal
   recompiles the release before each run anyway, so it always runs current code.
2. **Workflow configuration** → Create. Reference the release config you just made, and select
   the tags/targets to run (leave empty for everything). **Leave the schedule off** — the portal
   owns the timing and will clear this cron. Its presence is what the orchestrator looks for.

## Then hand the schedule to the portal — don't run it yourself

Once the client connects a data source, the portal runs the pipeline end to end: it triggers the
Airbyte syncs, waits for them to finish, **then** invokes this workflow config — so models never
run against half-loaded tables. Because it owns the timing, on first setup it:

- switches each Airbyte connection's cron to **manual** (originals stashed, restored if you turn
  orchestration off), and
- **clears the workflow config's cron** (leaving it would run Dataform twice: once orchestrated,
  once on its own against whatever had landed by then).

Set the run time in the portal at **`/admin/pipeline`** (client-local, 1am by default), which also
shows the client's scope, schedule and last run. A brand-new client with no Dataform repo yet is
fine — orchestration runs the syncs and reports there's nothing to model; add this repo when ready
and it starts running.
