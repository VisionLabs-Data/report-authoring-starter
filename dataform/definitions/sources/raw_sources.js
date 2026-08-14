// Declare the Airbyte raw tables so models ${ref()} them by name — a rename or a missing table
// then breaks LOUDLY at compile time instead of silently returning zero rows at read time.
//
// ONE DATASET PER CLIENT: raw, staging and main all live in the client's single dataset, told
// apart by table PREFIX. Airbyte lands here with a `raw_<provider>_` stream prefix, so the raw
// tables are e.g. `raw_meta_ads_ads_insights`. Airbyte OWNS them — never model INTO a raw table;
// the next sync overwrites it.
//
// Connector VERSIONS and the exact stream prefix vary per connection, so confirm the real names
// with get_client_schema / the BigQuery console and rename here to match — this declaration is the
// ONE place the raw names live, so a swap here reroutes every model.

// All three layers share the client's one dataset, so the raw tables are declared there too. Keep
// this EQUAL to `defaultDataset` in workflow_settings.yaml — if they drift, ${ref()} points at a
// table that isn't there and the repo fails to compile (loudly, which is the point).
const CLIENT_DATASET = "example_client";

[
  // ── Meta / Facebook (facebook-marketing connector) ────────────────────────────────
  "raw_meta_ads_ads_insights",              // one row per ad per day — spend, impressions, clicks, inline_link_clicks
  "raw_meta_ads_ads_insights_action_type",  // one row per ad per day PER action_type — spend REPEATS across rows
  "raw_meta_ads_ads",                       // ad → creative link (creative is JSON with the creative id)
  "raw_meta_ads_ad_creatives_from_ads",     // creative fields: title, body, object_story_spec, url_tags, image_url…

  // ── Google Ads (google-ads connector) ─────────────────────────────────────────────
  "raw_google_ads_campaign_stats",          // one row per campaign per day — metrics_cost_micros, metrics_impressions…
].forEach((name) => declare({ schema: CLIENT_DATASET, name }));
