# Dataform pipeline (per client, in this repo)

Each client's Dataform project lives at **`clients/<slug>/dataform/`** in this repo, next to their
reports — this folder is the **template you copy** for a new client. Reports render HTML; this
turns the client's raw ad data into the clean, pipeline-attributed tables those reports query. It
ships a **real, runnable ad semantic layer** modelled on a live client — swap the sources for the
ones this client syncs and it builds. The modelling conventions (layers, grain-in-the-description,
rates-at-read-time) are in the **`dataform-pipeline`** skill — read it first.

One wrinkle makes the layout possible: **GCP Dataform can only read a repo whose
`workflow_settings.yaml` sits at the ROOT** — it cannot point at a subdirectory. So each client
gets a generated **`dataform/<slug>` branch** holding just their folder's contents at the root,
and their GCP Dataform repository links to this repo pinned to that branch. You never touch those
branches by hand:

```bash
# edit clients/<slug>/dataform/ on main, commit, then:
npm run dataform:sync -- <slug>     # or --all after a merge touching several clients
```

The script builds the branch commit **directly from the committed folder's git tree**
(`git commit-tree`) — no checkout, no copying, nothing to drift: the branch cannot differ from
the folder because it *is* the folder's tree object. Re-running is a no-op when nothing changed.
It refuses to run with uncommitted changes under the folder (that would publish a stale snapshot),
and editing the generated branch directly just gets overwritten on the next sync — fix on `main`.

```
clients/<slug>/dataform/
  workflow_settings.yaml                  # project / client dataset / location / core version
  definitions/
    sources/raw_sources.js                # declare the Airbyte raw tables (Meta + Google)
    seeds/campaign_pipeline_mapping.sqlx   # dimension: campaign name → pipeline (you maintain this)
    staging/
      staging_meta_ads_daily.sqlx         # → staging_meta_ads_daily : one row per Meta ad per day
      staging_google_ads_daily.sqlx       # → staging_google_ads_daily : one row per Google campaign/day
    main/
      ads_daily_grain.sqlx                # → main_ads_daily_grain ⭐ combined, pipeline-attributed, per day
      daily_summary.sqlx                  # → main_daily_summary : account/day, Meta vs Google + blended
      meta_ad_creatives.sqlx              # → main_meta_ad_creatives : the creative behind each ad
      meta_tracking_audit.sqlx            # → main_meta_tracking_audit : untagged / macro'd ads by spend
```

## The layers — ONE dataset per client

All three layers live in the client's **single** dataset (its `dataset_slug` from the portal), told
apart by table **prefix** — not by separate `raw`/`staging`/`main` datasets. The client dataset is
the tenant boundary: an agency's clients share one GCP project, so a layer-named dataset would pool
every client's tables together and the portal's dataset-level access control couldn't tell them
apart. Set the dataset once in `workflow_settings.yaml` (`defaultDataset`); every model inherits it,
so no model needs a `schema:` override.

| Layer | Table prefix | Who writes it |
|---|---|---|
| Raw | `raw_<provider>_*` | **Airbyte** — never model into these, a sync overwrites them |
| Staging | `staging_*` | you — typed, cleaned, one concept per table, no cross-concept joins |
| Main | `main_*` | you — joined + attributed to a stated grain; reports query these directly |

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
- **`main_ads_daily_grain`** ⭐ — the two unioned and tagged with the **pipeline/funnel** each
  campaign belongs to, via `main_campaign_pipeline_mapping`. The table most reports read. `ctr`/`cpc` are
  computed here as ratios of the row's totals; higher-level rates are recomputed from sums, never
  averaged.
- **`daily_summary`** — the whole account per day, Meta and Google in their own columns plus a
  blended total, so a scorecard shows "Meta vs Google spend" from one table.
- **`main_meta_ad_creatives`** — the headline/body/CTA/destination/image behind each Meta `ad_id`,
  so a report can put creative next to performance (join on `ad_id`).
- **`main_meta_tracking_audit`** — every Meta ad whose destination can't be attributed (no UTMs, or an
  unexpanded `{{macro}}`), ranked by the last-28-day spend flying blind.

### Two things baked in that are easy to get wrong

- **Pipeline attribution picks ONE match.** A campaign name can match several patterns in the
  mapping; a naive join then multiplies every metric by the match count — and the wrong total is a
  clean 2× that looks authoritative. `main_ads_daily_grain` ranks matches by `match_priority` and
  keeps one (`QUALIFY ROW_NUMBER() … = 1`). Keep the priorities distinct.
- **A new funnel not showing up** is almost always a missing/too-narrow row in
  `main_campaign_pipeline_mapping` — it's a hand-maintained seed. Add a row when a funnel launches;
  unmatched spend lands in a visible `Unattributed` bucket, not a silent NULL.

## Stand it up (once per client)

1. **Copy the template.** Copy this folder to `clients/<slug>/dataform/` for the new client (the
   example client ships with it in place).
2. **Point it at the project + dataset.** In `workflow_settings.yaml` set `defaultProject` to your
   agency GCP project, `defaultDataset` to this client's `dataset_slug` (one dataset — create it if
   it doesn't exist), and `defaultLocation` to its region.
3. **Wire the real sources.** Edit `definitions/sources/raw_sources.js` so the declared names match
   this client's actual Airbyte tables — they land in the same client dataset with a
   `raw_<provider>_` prefix, but the exact stream prefix and connector version vary, so confirm with
   `get_client_schema` / the BigQuery console — then sanity-check the column names the staging models
   read. The examples target the Meta `facebook-marketing` and `google-ads` connectors.
4. **Fill in the mapping.** Replace the example rows in `seeds/campaign_pipeline_mapping.sqlx` with
   this client's funnels.
5. **Publish the branch.** Commit the folder on `main`, then `npm run dataform:sync -- <slug>` —
   this creates and pushes the `dataform/<slug>` branch GCP will read.
6. **Connect it in GCP.** BigQuery → **Dataform** → Create repository → link **this** git repo,
   with **default branch `dataform/<slug>`**. One Dataform repository per client, all pointing at
   the same agency repo on different branches. (The GitHub token it asks for: see **Auth** below.)

## Auth — who is who

Nothing here authenticates with `gcloud` at run time. Three identities, each with one job — and
only the first is created per client; the other two are one-time, agency-project-wide:

1. **The portal acting on the client.** A service account **you create** in the agency GCP
   project. Grant it `roles/bigquery.jobUser`, read on the client's dataset, and
   `roles/dataform.editor`; download a JSON key and upload it on the client's **BigQuery
   integration card** in the portal admin. That one stored key is how the portal both runs the
   client's queries and invokes this pipeline's workflow config — the portal picks a credential
   by matching the key's `project_id` to the Dataform repo's project, so a key from a different
   project silently isn't eligible.

2. **Dataform reading GitHub.** GCP pulls the `dataform/<slug>` branch with a GitHub token, not a
   Google identity: create a fine-grained PAT (read-only **Contents** on this repo), store it as
   a **Secret Manager** secret in the agency project, reference that secret when linking each
   client's Dataform repository, and grant the Dataform **service agent** access to read it
   (`secretmanager.secretAccessor`). ONE token serves every client's repository — they all read
   the same repo.

3. **Dataform executing SQL.** Workflow runs execute as the project's built-in Dataform service
   agent (`service-<project_number>@gcp-sa-dataform.iam.gserviceaccount.com`), which exists as
   soon as the Dataform API is enabled. Grant it `roles/bigquery.jobUser` +
   `roles/bigquery.dataEditor` **once, project-level**, and every client's pipeline can build
   into its own dataset. **Do not set a service account on the repository itself** in this
   layout — that override exists for the cross-project case (repo in your project, raw data in
   the client's own project), and it drags in impersonation grants you don't otherwise need.
   With everything in one agency project, the default agent + one grant is the whole story.

## The bit everyone misses: a **release config** AND a **workflow config**

The portal orchestrates runs by invoking a **workflow config**, which executes a compiled **release
config**. No workflow config → every orchestrated run fails at the Dataform step with
*"No workflowConfig"*. This is the single most common setup mistake.

In the Dataform repository (GCP console → your repo):

1. **Release configuration** → Create. Name it (e.g. `production`), branch **`dataform/<slug>`**
   (the generated branch — not `main`, which has the folder nested where GCP can't compile it).
   Compiles the branch into a `compilationResult`.
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
