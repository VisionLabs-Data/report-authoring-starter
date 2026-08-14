# Dataform pipeline (template)

A **ready-to-copy template for ONE client's Dataform repo** — the BigQuery data-modelling half of
the pipeline, separate from the reports in `clients/`. Reports render HTML; this turns a client's
raw ad data into the clean, pipeline-attributed tables those reports query. It ships a **real,
runnable ad semantic layer** modelled on a live client — swap the sources for the ones this client
syncs and it builds. The modelling conventions (layers, grain-in-the-description, rates-at-read-
time) are in the **`dataform-pipeline`** skill — read it first.

```
dataform/
  workflow_settings.yaml                  # project / datasets / location / core version
  definitions/
    sources/raw_sources.js                # declare the Airbyte raw tables (Meta + Google)
    seeds/campaign_pipeline_mapping.sqlx   # dimension: campaign name → pipeline (you maintain this)
    staging/
      staging_meta_ads_daily.sqlx         # one row per Meta ad per day, typed + cleaned
      staging_google_ads_daily.sqlx       # one row per Google campaign per day (cost from micros)
    main/
      ads_daily_grain.sqlx                # ⭐ combined Meta+Google, pipeline-attributed, per day
      daily_summary.sqlx                  # account/day rollup, Meta vs Google split + blended
      meta_ad_creatives.sqlx              # the creative behind each ad (headline/body/CTA/dest/img)
      meta_tracking_audit.sqlx            # untagged / macro'd ads, ranked by spend at risk
```

## The layers

| Layer | Dataset | Who writes it |
|---|---|---|
| Raw | `raw` | **Airbyte** — never model into these, a sync overwrites them |
| Staging | `staging` | you — typed, cleaned, one concept per table, no cross-concept joins |
| Main | `main` | you — joined + attributed to a stated grain; reports query these directly |

Every model self-documents: a table `description` with the grain, a **`columns:`** description per
field (Dataform pushes these into the BigQuery schema, where the reporting agent reads them), and
assertions that stand in for constraints BigQuery doesn't enforce — a **`uniqueKey`** (the primary
key: the run fails on a duplicate), **`nonNull`** on the key + money columns, and **`rowConditions`**
for ranges (`spend >= 0`, `ctr BETWEEN 0 AND 1`, the tracking `issue` enum). Keep that up when you
add a model — it's what makes the layer safe to copy.

## The semantic layer, end to end

The two ad platforms come in as separate raw streams and leave as one attributed table:

- **`staging_meta_ads_daily`** / **`staging_google_ads_daily`** — each platform typed to a common
  shape (date, campaign/adset/ad, spend, impressions, clicks, link_clicks, lp_views). Meta reports
  per **ad**; Google per **campaign** — that asymmetry is real and carried through, not hidden.
- **`ads_daily_grain`** ⭐ — the two unioned and tagged with the **pipeline/funnel** each campaign
  belongs to, via `campaign_pipeline_mapping`. This is the table most reports read. `ctr`/`cpc` are
  computed here as ratios of the row's totals; higher-level rates are recomputed from sums, never
  averaged.
- **`daily_summary`** — the whole account per day, Meta and Google in their own columns plus a
  blended total, so a scorecard shows "Meta vs Google spend" from one table.
- **`meta_ad_creatives`** — the headline/body/CTA/destination/image behind each Meta `ad_id`, so a
  report can put creative next to performance (join on `ad_id`).
- **`meta_tracking_audit`** — every Meta ad whose destination can't be attributed (no UTMs, or an
  unexpanded `{{macro}}`), ranked by the last-28-day spend flying blind.

### Two things baked in that are easy to get wrong

- **Pipeline attribution picks ONE match.** A campaign name can match several patterns in the
  mapping; a naive join then multiplies every metric by the match count — and the wrong total is a
  clean 2× that looks authoritative. `ads_daily_grain` ranks matches by `match_priority` and keeps
  one (`QUALIFY ROW_NUMBER() … = 1`). Keep the priorities distinct.
- **A new funnel not showing up** is almost always a missing/too-narrow row in
  `campaign_pipeline_mapping` — it's a hand-maintained seed. Add a row when a funnel launches;
  unmatched spend lands in a visible `Unattributed` bucket, not a silent NULL.

## Stand it up (once per client)

1. **Make it the client's own repo.** Copy this `dataform/` folder to the ROOT of a new git repo so
   `workflow_settings.yaml` sits at the repo root.
2. **Point it at the project + datasets.** In `workflow_settings.yaml` set `defaultProject` to your
   agency GCP project and `defaultLocation` to your datasets' region. The layer datasets are `raw` /
   `staging` / `main` (create them, or repoint — see the comment in the file if this client uses one
   dataset with table prefixes instead).
3. **Wire the real sources.** Edit `definitions/sources/raw_sources.js` so the declared names match
   this client's actual Airbyte tables (confirm with `get_client_schema` / the BigQuery console —
   connector versions and prefixes vary), then sanity-check the column names the staging models
   read. The examples target the Meta `facebook-marketing` and `google-ads` connectors.
4. **Fill in the mapping.** Replace the example rows in `seeds/campaign_pipeline_mapping.sqlx` with
   this client's funnels.
5. **Connect the repo in GCP.** BigQuery → **Dataform** → Create repository → link this git repo.

## The bit everyone misses: a **release config** AND a **workflow config**

The portal orchestrates runs by invoking a **workflow config**, which executes a compiled **release
config**. No workflow config → every orchestrated run fails at the Dataform step with
*"No workflowConfig"*. This is the single most common setup mistake.

In the Dataform repository (GCP console → your repo):

1. **Release configuration** → Create. Name it (e.g. `production`), branch `main`. Compiles the repo
   into a `compilationResult`.
2. **Workflow configuration** → Create. Reference that release config, select tags/targets (empty =
   everything). **Leave the schedule off** — the portal owns timing and will clear this cron. Its
   presence is what the orchestrator looks for.

## Then hand the schedule to the portal

Once the client connects a data source, the portal runs the pipeline end to end: it triggers the
Airbyte syncs, waits for them to finish, **then** invokes this workflow config — so models never run
against half-loaded tables. Because it owns the timing, on first setup it switches each Airbyte
connection's cron to **manual** (originals stashed, restored if you turn orchestration off) and
**clears the workflow config's cron** (leaving it would run Dataform twice). Set the run time in the
portal at **`/admin/pipeline`** (client-local, 1am by default), which also shows the client's scope,
schedule and last run.
