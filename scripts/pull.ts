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

/**
 * Fold a pulled report.json's title/description into <id>.report.json, preserving
 * every other key and the file's own formatting conventions. Returns false when
 * nothing changed, so an unchanged pull doesn't report a write it didn't make.
 */
async function mergeReportMeta(reportsDir: string, id: string, pulled: string): Promise<boolean> {
  const file = join(reportsDir, `${id}.report.json`);
  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(await readFile(file, "utf-8"));
  } catch {
    console.error(`[warn] ${id}: no ${id}.report.json to merge title/description into — skipped`);
    return false;
  }
  const { title, description } = JSON.parse(pulled) as { title?: string; description?: string };
  if (meta.title === title && meta.description === description) return false;
  if (title !== undefined) meta.title = title;
  if (description !== undefined) meta.description = description;
  await writeFile(file, `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const only = args.filter((a) => !a.startsWith("--"));

  const config: PortalConfig = JSON.parse(await readFile(join(ROOT, "portal.config.json"), "utf-8"));
  const apiKey = process.env[config.apiKeyEnv || "REPORTING_SUITE_API_KEY"];
  if (!apiKey) {
    // Same template-state rule as sync.ts: no key AND no real binding → nothing could have
    // been edited in a Studio we can't reach, so --check has nothing to guard. Exit 0 to keep
    // the starter repo's own CI green; one real binding makes a missing key a loud failure.
    const anyReal = Object.values(config.clients ?? {}).some(
      (b) => b?.portalClientId && !b.portalClientId.startsWith("REPLACE-"),
    );
    if (!anyReal) {
      console.log(
        `No ${config.apiKeyEnv || "REPORTING_SUITE_API_KEY"} and no client is bound in portal.config.json — nothing to pull (template state).`,
      );
      process.exit(0);
    }
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
      // Report what was WRITTEN, not what was offered. report.json is merged into
      // <slug>.report.json and merges to nothing when the title and description
      // already match — so printing four names above "Wrote 3 file(s)" read as one
      // having silently failed, when the pull was entirely correct.
      const wrote: string[] = [];
      const unchanged: string[] = [];
      for (const name of names) {
        // report.json is the report's title + description, which in THIS repo live in
        // <slug>.report.json beside the source directory, not in it. Merge the two
        // fields rather than writing the file: the rest of that spec (queries,
        // source_tables, portal settings) is the repo's, and the portal never sees it.
        if (name === "report.json") {
          const written = await mergeReportMeta(join(CLIENTS_BASE, slug, "reports"), r.slug, r.files[name]);
          if (written) { wroteTotal++; wrote.push(`${r.slug}.report.json (title/description)`); }
          else unchanged.push("report.json");
          continue;
        }
        await writeFile(join(dir, name), r.files[name], "utf-8");
        wroteTotal++;
        wrote.push(name);
      }
      console.log(
        `[pull] ${slug}/${r.slug}: ${wrote.length ? wrote.join(", ") : "nothing changed"}` +
        (unchanged.length ? ` — already current: ${unchanged.join(", ")}` : ""),
      );
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
