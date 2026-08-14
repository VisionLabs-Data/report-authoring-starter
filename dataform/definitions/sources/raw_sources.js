// Declare the raw tables Airbyte writes, so models can ${ref()} them by name. Declaring a
// source (rather than hardcoding the table string) means a rename or a missing table breaks
// LOUDLY at compile time instead of silently returning zero rows at read time.
//
// Airbyte OWNS these tables — never model INTO a raw_* table; the next sync overwrites it.
// Swap these two examples for whatever connectors this client actually syncs; the raw table
// names come from the Airbyte stream names (check them in BigQuery, they vary by connector).

const RAW_DATASET = "example_client"; // = defaultDataset / the client's dataset_slug

[
  "raw_meta_ads_ads_insights",
  "raw_google_ads_campaign_stats",
].forEach((name) => declare({ schema: RAW_DATASET, name }));
