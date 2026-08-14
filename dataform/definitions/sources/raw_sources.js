// Declare the Airbyte raw tables so models ${ref()} them by name — a rename or a missing table
// then breaks LOUDLY at compile time instead of silently returning zero rows at read time.
//
// Airbyte OWNS these tables. Never model INTO a raw table; the next sync overwrites it.
//
// The names below are the canonical Airbyte stream names for the Meta (facebook-marketing) and
// Google Ads connectors. Connector VERSIONS and per-connection table prefixes vary, so confirm
// the real names with get_client_schema / the BigQuery console and rename here to match — this
// declaration is the ONE place the raw names live, so a swap here reroutes every model.

const RAW = "raw"; // the client's raw layer (Airbyte's landing dataset)

[
  // ── Meta / Facebook (facebook-marketing connector) ────────────────────────────────
  "ads_insights",              // one row per ad per day — spend, impressions, clicks, inline_link_clicks
  "ads_insights_action_type",  // one row per ad per day PER action_type — spend REPEATS across rows
  "ads",                       // ad → creative link (creative is JSON with the creative id)
  "ad_creatives_from_ads",     // creative fields: title, body, object_story_spec, url_tags, image_url…

  // ── Google Ads (google-ads connector) ─────────────────────────────────────────────
  "campaign_stats",            // one row per campaign per day — metrics_cost_micros, metrics_impressions…
].forEach((name) => declare({ schema: RAW, name }));
