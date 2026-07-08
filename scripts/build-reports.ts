/**
 * Build script for split-file reports (thin CLI wrapper).
 *
 * Scans for report source directories: clients/{client}/reports/{report-id}/
 * and assembles them into single .report.html files. The assembly logic lives
 * in scripts/lib/report-builder.ts; this file is only the CLI: argument
 * parsing, file writing, and console output.
 *
 * Source directory structure:
 *   styles.css      → wrapped in <style>...</style>
 *   template.html   → inserted as-is (the HTML body)
 *   *.js            → concatenated (sorted by filename), wrapped in <script>...</script>
 *
 * Output: clients/{client}/reports/{report-id}.report.html
 *
 * Usage:
 *   npm run build                                  # build all
 *   npm run build -- acme-co                       # build one client
 *   npm run build -- acme-co revenue-overview      # build one report
 */

import { readdir, writeFile, stat } from "fs/promises";
import { join } from "path";
import { buildReportFromDir, type BuildResult } from "./lib/report-builder";

const CLIENTS_BASE = join(import.meta.dirname!, "..", "clients");

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Build one report and write its .report.html, returning the build result. */
async function buildAndWrite(
  clientSlug: string,
  reportId: string
): Promise<BuildResult | null> {
  const result = await buildReportFromDir(clientSlug, reportId, CLIENTS_BASE);
  if (!result) return null;

  const outputPath = join(
    CLIENTS_BASE,
    clientSlug,
    "reports",
    `${reportId}.report.html`
  );
  await writeFile(outputPath, result.output, "utf-8");
  return result;
}

async function main() {
  const [clientFilter, reportFilter] = process.argv.slice(2);

  const clientDirs = clientFilter
    ? [clientFilter]
    : (await readdir(CLIENTS_BASE, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name);

  const results: BuildResult[] = [];

  for (const clientSlug of clientDirs) {
    const reportsDir = join(CLIENTS_BASE, clientSlug, "reports");
    if (!(await exists(reportsDir))) continue;

    const entries = await readdir(reportsDir, { withFileTypes: true });
    const reportDirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    for (const reportId of reportDirs) {
      if (reportFilter && reportId !== reportFilter) continue;
      const result = await buildAndWrite(clientSlug, reportId);
      if (result) results.push(result);
    }
  }

  if (results.length === 0) {
    console.log("No split reports found to build.");
    return;
  }

  for (const r of results) {
    const sizeKb = (r.outputSize / 1024).toFixed(1);
    console.log(
      `[build] ${r.client}/${r.report}: ${r.sourceFiles} source files → ${sizeKb}KB`
    );
  }

  console.log(`\nBuilt ${results.length} report(s).`);
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
