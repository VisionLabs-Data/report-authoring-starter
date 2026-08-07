/**
 * Pull Studio edits back into this repo — the return leg of `npm run sync`.
 *
 * The repo is the arbiter. Someone editing a report in the portal's AI Studio does NOT
 * publish it: the portal stages the edited source and marks the report ahead. This
 * fetches those files, writes them into clients/<slug>/reports/<report>/, and stops.
 * You then review the diff, commit, and let CI build + sync — which is when it goes live.
 *
 *   npm run pull                 # every bound client
 *   npm run pull -- acme-co      # one client
 *   npm run pull -- --check      # exit 1 if anything is pending, write nothing (CI)
 *
 * There is no ack to send: the next `npm run sync` stamps last_synced_at and the report
 * drops off the pending list by itself. So a failed run here is safe to just re-run.
 */
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import "dotenv/config";

const ROOT = join(import.meta.dirname!, "..");
const CLIENTS_BASE = join(ROOT, "clients");

interface PortalConfig {
  portalApiUrl: string;
  apiKeyEnv?: string;
  clients: Record<string, { portalClientId: string }>;
}

interface PendingReport {
  slug: string;
  name: string;
  status: string;
  updated_at: string | null;
  files: Record<string, string>;
}

async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const only = args.filter((a) => !a.startsWith("--"));

  const config: PortalConfig = JSON.parse(await readFile(join(ROOT, "portal.config.json"), "utf-8"));
  const apiKey = process.env[config.apiKeyEnv || "REPORTING_SUITE_API_KEY"];
  if (!apiKey) {
    console.error(`Missing ${config.apiKeyEnv || "REPORTING_SUITE_API_KEY"} — see .env.example.`);
    process.exit(1);
  }
  const base = config.portalApiUrl.replace(/\/+$/, "");

  const slugs = only.length > 0 ? only : Object.keys(config.clients);
  let pendingTotal = 0;
  let wroteTotal = 0;

  for (const slug of slugs) {
    const binding = config.clients[slug];
    if (!binding?.portalClientId || binding.portalClientId.startsWith("REPLACE")) {
      console.log(`[skip] ${slug}: no portalClientId in portal.config.json`);
      continue;
    }

    const res = await fetch(`${base}/v1/report-authoring/pull`, {
      headers: { Authorization: `Bearer ${apiKey}`, "X-Client-Id": binding.portalClientId },
    });
    const body = (await res.json().catch(() => ({}))) as { reports?: PendingReport[]; error?: string };
    if (!res.ok) {
      console.error(`[error] ${slug}: ${body.error || res.status}`);
      process.exitCode = 1;
      continue;
    }

    const reports = body.reports ?? [];
    if (reports.length === 0) { console.log(`[ok]   ${slug}: nothing pending`); continue; }
    pendingTotal += reports.length;

    for (const r of reports) {
      const names = Object.keys(r.files).sort();
      if (checkOnly) {
        console.log(`[pending] ${slug}/${r.slug}: ${names.join(", ")} (edited ${r.updated_at ?? "?"})`);
        continue;
      }
      const dir = join(CLIENTS_BASE, slug, "reports", r.slug);
      await mkdir(dir, { recursive: true });
      for (const name of names) {
        await writeFile(join(dir, name), r.files[name], "utf-8");
        wroteTotal++;
      }
      console.log(`[pull] ${slug}/${r.slug}: ${names.join(", ")}`);
    }
  }

  if (checkOnly) {
    if (pendingTotal > 0) {
      console.error(`\n${pendingTotal} report(s) edited in the Studio are not in this repo. Run \`npm run pull\`.`);
      process.exit(1);
    }
    console.log("\nNothing pending.");
    return;
  }

  if (wroteTotal === 0) { console.log("\nNothing to pull."); return; }
  console.log(
    `\nWrote ${wroteTotal} file(s) from ${pendingTotal} report(s).\n` +
    `Review the diff, commit, then \`npm run build\` + \`npm run sync\` to publish them.`,
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
