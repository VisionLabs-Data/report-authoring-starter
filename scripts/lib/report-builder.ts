/**
 * Report builder library.
 *
 * The assembly logic that turns a split-file report source directory
 * (styles.css + template.html + numbered *.js) into a single .report.html
 * string, extracted from scripts/build-reports.ts so it can be reused by both
 * the CLI wrapper and the in-memory composer (scripts/lib/report-composer.ts).
 *
 * Source directory structure (unchanged from the original build script):
 *   styles.css      → wrapped in <style>...</style>, preceded by the client's
 *                     ../_design-system.css when that file exists
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
 * Resolve a report's effective stylesheet: the client's shared design system
 * (`clients/<slug>/reports/_design-system.css`) prepended to the report's own
 * `styles.css`, when that shared file exists.
 *
 * ONE definition of the rule, deliberately. The build reads it here, and so does
 * `readSourceDir` in report-composer.ts when it builds the source map the portal
 * stores. When the build resolved it privately and the map didn't, the map could
 * never reproduce the build — every split-file report of a client with a design
 * system failed the `checkSourceFiles` gate and blocked that client's whole sync.
 *
 * Returns "" when there is neither a design system nor a styles.css, so callers
 * can treat empty as "no CSS block".
 */
export async function resolveReportCss(
  sourceDir: string,
  ownCss: string | null
): Promise<string> {
  const designSystemPath = join(sourceDir, "..", "_design-system.css");
  const designSystem = (await exists(designSystemPath))
    ? await readFile(designSystemPath, "utf-8")
    : null;

  if (!designSystem) return ownCss ?? "";
  if (!ownCss) return designSystem;
  return `${designSystem}\n\n${ownCss}`;
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

  // 1. CSS. A client may keep a design system one level up, in
  // clients/<slug>/reports/_design-system.css. When it is there it is prepended
  // to every report's own stylesheet, so tokens and shared component rules live
  // in one file instead of being copy-pasted into each report and drifting.
  // Opt-in: clients without the file build exactly as before. The prepend rule
  // itself lives in resolveReportCss, shared with the source map.
  const ownCss = files.includes("styles.css")
    ? await readFile(join(sourceDir, "styles.css"), "utf-8")
    : null;
  if (ownCss !== null) sourceCount++;

  const css = await resolveReportCss(sourceDir, ownCss);
  if (css) parts.css = css;

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
