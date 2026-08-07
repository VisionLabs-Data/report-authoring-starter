/**
 * Sync built reports to the portal.
 *
 * For each client folder (clients/{slug}/), reads client.config.json and every
 * reports/*.report.json with portal.sync === true, pairs each with its built
 * {id}.report.html, and POSTs the batch to the portal's authenticated sync
 * endpoint. The portal owns rendering, conflict detection (portal-side edits
 * are flagged, never clobbered), and AI context extraction.
 *
 * Usage:
 *   npm run sync                       # sync all clients (publish)
 *   npm run sync -- --draft            # sync as DRAFTS (returns preview URLs)
 *   npm run sync -- acme-co            # one client
 *   npm run sync -- acme-co --draft
 *
 * Requires .env: REPORTING_SUITE_API_KEY (agency API key with reports:read + reports:write).
 * Client mapping + portal URL live in portal.config.json.
 */

import { readFile, readdir, stat } from "fs/promises";
import { join } from "path";
import { specHash } from "./lib/report-sync-core";
import "dotenv/config";

/**
 * A report's editable source, keyed by bare filename — the same names the portal's
 * write_report_file accepts (template.html, styles.css, *.js). Absent directory or no
 * matching files → undefined, which the portal reads as "this report has no split
 * source" rather than "its source is empty".
 */
async function readSourceFiles(dir: string, meta: ReportMeta): Promise<Record<string, string> | undefined> {
  const KEEP = /^(template\.html|styles\.css|[a-z0-9][a-z0-9._-]{0,80}\.js)$/;
  let names: string[];
  try { names = await readdir(dir); } catch { return undefined; }
  const out: Record<string, string> = {};
  for (const name of names.sort()) {
    if (!KEEP.test(name)) continue;
    out[name] = await readFile(join(dir, name), "utf-8");
  }
  if (Object.keys(out).length === 0) return undefined;
  // The report's title and description, as an editable file. They render at the top
  // of the report but live in <id>.report.json, not in template.html — so without
  // this an agent asked to change that text cannot find it and reports it already
  // gone. Sent DERIVED so the portal's baseline matches the repo, which is what
  // makes an edit coming back through `npm run pull` a real diff.
  out["report.json"] = `${JSON.stringify({ title: meta.title ?? "", description: meta.description ?? "" }, null, 2)}\n`;
  return out;
}

const ROOT = join(import.meta.dirname!, "..");
const CLIENTS_BASE = join(ROOT, "clients");

interface PortalConfig {
  portalApiUrl: string;
  apiKeyEnv?: string;
  /** repo client slug → portal client binding */
  clients: Record<string, { portalClientId: string }>;
}

interface ReportMeta {
  id: string;
  title: string;
  description?: string;
  source_tables?: string[];
  html_source?: string;
  queries?: Record<string, { sql: string; cache_ttl?: string }>;
  portal?: { sync?: boolean; category?: string; status?: "draft" | "published" } | null;
  [k: string]: unknown;
}

async function exists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

async function main() {
  const args = process.argv.slice(2);
  const draft = args.includes("--draft");
  const clientFilter = args.find((a) => !a.startsWith("--"));

  const portalCfg = JSON.parse(await readFile(join(ROOT, "portal.config.json"), "utf-8")) as PortalConfig;
  const apiKey = process.env[portalCfg.apiKeyEnv || "REPORTING_SUITE_API_KEY"];
  if (!apiKey) {
    console.error(`Missing ${portalCfg.apiKeyEnv || "REPORTING_SUITE_API_KEY"} — set it in .env (agency API key with reports:write).`);
    process.exit(1);
  }
  const base = portalCfg.portalApiUrl.replace(/\/+$/, "");

  const clientDirs = clientFilter
    ? [clientFilter]
    : (await readdir(CLIENTS_BASE, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);

  let hadError = false;

  for (const slug of clientDirs) {
    const binding = portalCfg.clients[slug];
    if (!binding?.portalClientId) {
      console.log(`[skip] ${slug}: no portalClientId in portal.config.json — add it under clients.${slug}`);
      continue;
    }

    const clientDir = join(CLIENTS_BASE, slug);
    let clientConfig: Record<string, unknown> = {};
    try {
      clientConfig = JSON.parse(await readFile(join(clientDir, "client.config.json"), "utf-8"));
    } catch {
      console.log(`[warn] ${slug}: no client.config.json (syncing reports only)`);
    }

    const reportsDir = join(clientDir, "reports");
    if (!(await exists(reportsDir))) { console.log(`[skip] ${slug}: no reports/`); continue; }

    const reports: Array<Record<string, unknown>> = [];
    for (const f of await readdir(reportsDir)) {
      if (!f.endsWith(".report.json")) continue;
      const meta = JSON.parse(await readFile(join(reportsDir, f), "utf-8")) as ReportMeta;
      if (meta.portal?.sync !== true) { console.log(`[skip] ${slug}/${meta.id}: portal.sync is not true`); continue; }
      if (meta.id !== f.replace(/\.report\.json$/, "")) {
        console.error(`[error] ${slug}/${f}: "id" must equal the filename`);
        hadError = true;
        continue;
      }

      // Built HTML: {id}.report.html (from npm run build), or an explicit html_source file.
      const htmlFile = meta.html_source || `${meta.id}.report.html`;
      let html: string | null = null;
      try { html = await readFile(join(reportsDir, htmlFile), "utf-8"); }
      catch { console.log(`[warn] ${slug}/${meta.id}: no built HTML (${htmlFile}) — run \`npm run build\` first; syncing metadata only`); }

      reports.push({
        slug: meta.id,
        name: meta.title?.trim() || meta.id,
        description: meta.description ?? null,
        category: meta.portal?.category ?? null,
        // Per-report publish state: the report's own `portal.status` governs
        // (default "published"), unless the run forces drafts globally (--draft,
        // e.g. CI on a PR). So a report you're not ready to ship sets
        // `portal.status: "draft"` and stays a draft even on a publish run.
        status: draft ? "draft" : (meta.portal?.status ?? "published"),
        report_type: "other",
        bigquery_tables: meta.source_tables ?? [],
        report_meta: meta,
        html_content: html,
        // The report's SOURCE, alongside the build output. Without it the portal holds
        // only built HTML, so Studio's file editor has nothing to open ("this report has
        // no editable source files") and `npm run pull` can never have anything to
        // return — the repo-as-arbiter loop stays open at this end.
        source_files: await readSourceFiles(join(reportsDir, meta.id), meta),
        // Hash of the whole parsed .report.json — the portal uses this for
        // conflict detection (identical algorithm on both sides).
        spec_hash: specHash(meta),
      });
    }

    if (reports.length === 0) { console.log(`[skip] ${slug}: nothing to sync`); continue; }

    const res = await fetch(`${base}/v1/report-authoring/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Client-Id": binding.portalClientId,
      },
      body: JSON.stringify({ client: slug, client_config: clientConfig, reports }),
    });

    const body = (await res.json().catch(() => ({}))) as {
      results?: Array<{ slug: string; action: string; previewUrl?: string; reason?: string; error?: string }>;
      error?: string;
    };
    if (!res.ok) {
      console.error(`[error] ${slug}: sync failed (${res.status}): ${body?.error ?? "unknown"}`);
      hadError = true;
      continue;
    }

    for (const r of body.results ?? []) {
      const extra = r.previewUrl ? `\n         preview: ${r.previewUrl}` : r.reason ? ` (${r.reason})` : r.error ? ` — ${r.error}` : "";
      console.log(`[${r.action}] ${slug}/${r.slug}${extra}`);
      if (r.action === "error") hadError = true;
      if (r.action === "conflict") console.log(`         portal-side edits detected — resolve in the portal admin before re-syncing`);
    }
  }

  if (hadError) process.exit(1);
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
