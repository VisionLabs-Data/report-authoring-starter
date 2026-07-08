/**
 * Report builder library.
 *
 * The assembly logic that turns a split-file report source directory
 * (styles.css + template.html + numbered *.js) into a single .report.html
 * string, extracted from scripts/build-reports.ts so it can be reused by both
 * the CLI wrapper and the in-memory composer (scripts/lib/report-composer.ts).
 *
 * Source directory structure (unchanged from the original build script):
 *   styles.css      → wrapped in <style>...</style>
 *   template.html   → inserted as-is (the HTML body)
 *   *.js            → concatenated (sorted by filename), wrapped in <script>...</script>
 */

import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";

export interface BuildResult {
  client: string;
  report: string;
  sourceFiles: number;
  output: string;
  outputSize: number;
}

/** The three concatenable pieces of a report, before they are joined. */
export interface ReportParts {
  /** Raw CSS (will be wrapped in <style>). Omit/empty to skip. */
  css?: string;
  /** Raw HTML body (inserted as-is). Omit/empty to skip. */
  templateHtml?: string;
  /**
   * JS sources, already ordered. Each entry is one file's contents; they are
   * concatenated (newline-joined) inside a single <script> block, matching the
   * original build behavior.
   */
  js?: string[];
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Assemble the final .report.html string from its parts.
 *
 * Mirrors build-reports.ts exactly: CSS first (wrapped in <style>), then the
 * HTML template as-is, then all JS concatenated inside one <script>; blocks are
 * joined with a blank line. Empty/absent parts are skipped so the output is
 * byte-identical to the original for any given source set.
 */
export function assembleReportHtml(parts: ReportParts): string {
  const blocks: string[] = [];

  if (parts.css && parts.css.length > 0) {
    blocks.push(`<style>\n${parts.css}</style>`);
  }

  if (parts.templateHtml && parts.templateHtml.length > 0) {
    blocks.push(parts.templateHtml);
  }

  const js = parts.js ?? [];
  if (js.length > 0) {
    blocks.push(`<script>\n${js.join("\n")}\n</script>`);
  }

  return blocks.join("\n\n");
}

/**
 * Build one report from its split-file source directory and return the
 * assembled HTML (the caller decides whether/where to persist it).
 *
 * Returns null when the directory isn't a valid split report (mirrors the
 * original buildReport's null returns), so the CLI can skip it.
 */
export async function buildReportFromDir(
  clientSlug: string,
  reportId: string,
  clientsBase: string
): Promise<BuildResult | null> {
  const sourceDir = join(clientsBase, clientSlug, "reports", reportId);

  if (!(await exists(sourceDir))) return null;

  const dirStat = await stat(sourceDir);
  if (!dirStat.isDirectory()) return null;

  const files = await readdir(sourceDir);

  // Must have at least one source file to be a valid split report.
  const hasSource =
    files.includes("styles.css") ||
    files.includes("template.html") ||
    files.some((f) => f.endsWith(".js"));
  if (!hasSource) return null;

  let sourceCount = 0;
  const parts: ReportParts = {};

  // 1. CSS
  if (files.includes("styles.css")) {
    parts.css = await readFile(join(sourceDir, "styles.css"), "utf-8");
    sourceCount++;
  }

  // 2. HTML template
  if (files.includes("template.html")) {
    parts.templateHtml = await readFile(join(sourceDir, "template.html"), "utf-8");
    sourceCount++;
  }

  // 3. JS files → sorted by name, concatenated
  const jsFiles = files.filter((f) => f.endsWith(".js")).sort();
  if (jsFiles.length > 0) {
    const jsContents: string[] = [];
    for (const jsFile of jsFiles) {
      jsContents.push(await readFile(join(sourceDir, jsFile), "utf-8"));
    }
    parts.js = jsContents;
    sourceCount += jsFiles.length;
  }

  const output = assembleReportHtml(parts);

  return {
    client: clientSlug,
    report: reportId,
    sourceFiles: sourceCount,
    output,
    outputSize: output.length,
  };
}
