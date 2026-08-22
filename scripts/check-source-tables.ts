/**
 * Self-check: every `source_tables` entry is fully qualified.
 *
 * `source_tables` is the report's BigQuery ACCESS GRANT, not lineage documentation.
 * The report server matches each table the SQL touches against this list by
 * `project.dataset` prefix, so a two-part `dataset.table` entry can never match
 * anything — the report fails to render with "unauthorized table" even though the
 * table exists and the SQL is right.
 *
 * This is cheap to assert and expensive to resolve later: a client's data can span
 * several projects (pipeline output in the agency's, connector datasets in the
 * client's own), so the project cannot be recovered from config after the fact —
 * only from the query that was written beside it. Chained into `npm run build`, so
 * a two-part entry never reaches a sync.
 *
 *   npx tsx scripts/check-source-tables.ts
 */
import { readdir } from "fs/promises";
import { readFile } from "fs/promises";
import { join } from "path";

const bad: string[] = [];
let checked = 0;

for (const slug of await readdir("clients", { withFileTypes: true })) {
    if (!slug.isDirectory()) continue;
    const dir = join("clients", slug.name, "reports");
    let entries: string[];
    try {
        entries = await readdir(dir);
    } catch {
        continue; // a client with no reports yet
    }
    for (const f of entries) {
        if (!f.endsWith(".report.json")) continue;
        let spec: { source_tables?: unknown };
        try {
            spec = JSON.parse(await readFile(join(dir, f), "utf8"));
        } catch (e) {
            bad.push(`${join(dir, f)} — not parseable JSON: ${(e as Error).message}`);
            continue;
        }
        checked++;
        for (const ref of (spec.source_tables ?? []) as string[]) {
            const t = String(ref).replace(/`/g, "").trim();
            // Only dotted entries are judged: this field is dual-purpose and holds PostHog
            // DASHBOARD IDS (e.g. "1290925") for a posthog report, which are not table refs.
            if (t.includes(".") && t.split(".").length !== 3) bad.push(`${join(dir, f)} — "${t}"`);
        }
    }
}

if (bad.length > 0) {
    console.error(`\n${bad.length} source_tables entr(ies) are not project.dataset.table:\n`);
    for (const b of bad) console.error(`  ✗ ${b}`);
    console.error(
        "\nUse the same fully-qualified ref your query's FROM clause uses. Do NOT assume\n" +
        "the client's configured project prefixes every dataset — connector datasets\n" +
        "(ads, GA4, CRM) commonly live in a different project than the Dataform output.\n"
    );
    process.exit(1);
}

if (checked === 0) {
    console.error("no reports found — the walk is broken, not the corpus");
    process.exit(1);
}
console.log(`ALL PASS — every dotted source_tables entry in ${checked} reports is project.dataset.table`);
process.exit(0);
