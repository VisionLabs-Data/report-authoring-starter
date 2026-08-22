/**
 * Metric drift audit: find numbers that several reports claim to show and compute differently.
 *
 * WHY THIS EXISTS
 * ---------------
 * On a real client, review found -- by eye, a week after shipping -- "Revenue" meaning
 * three different things on three pages ($57,619 / $51,089 / $0), and ad spend reading
 * $15,435.66 against the governed $18,042.27 because an INNER JOIN silently dropped
 * unmapped campaigns (and inflated ROAS 17%). A per-client CI gate that resolves the
 * portal's approved metric (get_metric_value) and judges every report against it now
 * catches those there -- but it needs a live deployment and an API key to say anything.
 *
 * This is the cheap upstream half: read the report JSON on disk, group every aggregate
 * output column by (client, name), and print the ones where one NAME has more than one
 * EXPRESSION across more than one report. No network, no key, no per-client config.
 *
 * NOT A GATE, on purpose. Plenty of these are legitimate -- `clicks` can be SMS link
 * clicks in one report and Search Console clicks in another, and they should differ. The
 * output is a review list: the ranked places where a governed metric would settle an
 * argument the reports are currently having with each other. That review is what seeds
 * `metrics.query`, and only once a client HAS governed metrics does the enforcing check
 * (report field declares its metric; CI compares rendered output to get_metric_value)
 * have anything to enforce.
 * ponytail: alias+expression only. It cannot see a name whose drift is in the FROM rather
 * than the SELECT, so the query's table refs are printed beside each variant for the human.
 *
 *   npx tsx scripts/metric-drift-audit.ts [--client <slug>] [--min-reports 2] [--markdown|--json]
 *   npx tsx scripts/metric-drift-audit.ts --selftest
 */
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import assert from "node:assert";

const CLIENTS_DIR = new URL("../clients/", import.meta.url).pathname;

/** SUM(...)/COUNT(...)/... AS alias, tolerating one level of nested parens. */
const AGG_RE = /\b((?:SUM|COUNT|COUNTIF|AVG|MAX|MIN|SAFE_DIVIDE)\s*\((?:[^()]|\([^()]*\))*\))\s+AS\s+([A-Za-z_]\w*)/gi;
const TABLE_RE = /\b(?:FROM|JOIN)\s+`?([A-Za-z0-9_-]+\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+)`?/gi;

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase().replace(/`/g, "");

export type Variant = { expr: string; reports: Set<string>; tables: Set<string> };
export type Finding = { client: string; name: string; reports: number; variants: Variant[] };

/** The whole rule, in one pure function so --selftest can exercise it without the filesystem. */
export function audit(
    queries: Array<{ client: string; report: string; sql: string }>,
    minReports = 2,
): Finding[] {
    const byName = new Map<string, Map<string, Variant>>();
    for (const { client, report, sql } of queries) {
        const tables = [...sql.matchAll(TABLE_RE)].map((m) => m[1]);
        for (const m of sql.matchAll(AGG_RE)) {
            const key = `${client} ${m[2].toLowerCase()}`;
            const variants = byName.get(key) ?? new Map<string, Variant>();
            const expr = norm(m[1]);
            const v = variants.get(expr) ?? { expr, reports: new Set<string>(), tables: new Set<string>() };
            v.reports.add(report);
            tables.forEach((t) => v.tables.add(t));
            variants.set(expr, v);
            byName.set(key, variants);
        }
    }
    const out: Finding[] = [];
    for (const [key, variants] of byName) {
        const [client, name] = key.split(" ");
        const reports = new Set<string>();
        for (const v of variants.values()) v.reports.forEach((r) => reports.add(r));
        // Two conditions, both required: the name is used by several REPORTS (a single
        // report's current/previous scorecard pair is not drift), and they disagree.
        if (reports.size < minReports || variants.size < 2) continue;
        out.push({
            client, name, reports: reports.size,
            variants: [...variants.values()].sort((a, b) => b.reports.size - a.reports.size),
        });
    }
    return out.sort((a, b) => b.variants.length - a.variants.length || b.reports - a.reports);
}

async function collect(only: string | null) {
    const rows: Array<{ client: string; report: string; sql: string }> = [];
    for (const client of await readdir(CLIENTS_DIR, { withFileTypes: true })) {
        if (!client.isDirectory() || (only && client.name !== only)) continue;
        const dir = join(CLIENTS_DIR, client.name, "reports");
        let files: string[];
        try { files = await readdir(dir); } catch { continue; }
        for (const f of files.filter((n) => n.endsWith(".report.json"))) {
            let spec: any;
            try { spec = JSON.parse(await readFile(join(dir, f), "utf8")); } catch { continue; }
            for (const q of Object.values(spec?.queries ?? {})) {
                const sql = typeof q === "string" ? q : (q as any)?.sql;
                if (typeof sql === "string" && sql.trim()) {
                    rows.push({ client: client.name, report: f.replace(/\.report\.json$/, ""), sql });
                }
            }
        }
    }
    return rows;
}

if (process.argv.includes("--selftest")) {
    const q = (client: string, report: string, sql: string) => ({ client, report, sql });
    // Two reports, two expressions for one name => a finding.
    let f = audit([
        q("c", "r1", "SELECT SUM(amount) AS revenue FROM `p.d.t`"),
        q("c", "r2", "SELECT SUM(x.amount) AS revenue FROM `p.d.t2` x"),
    ]);
    assert.strictEqual(f.length, 1, "disagreeing expressions in two reports is a finding");
    assert.strictEqual(f[0].variants.length, 2);
    assert.deepStrictEqual([...f[0].variants[0].tables], ["p.d.t"], "the query's tables ride along");
    // Agreement is not a finding, however many reports.
    assert.strictEqual(audit([
        q("c", "r1", "SELECT SUM(amount) AS revenue FROM `p.d.t`"),
        q("c", "r2", "SELECT  sum(AMOUNT)  AS revenue FROM `p.d.t`"),
    ]).length, 0, "the same expression, differently cased/spaced, must not be a finding");
    // One report disagreeing with itself is not cross-report drift (current/previous pairs).
    assert.strictEqual(audit([
        q("c", "r1", "SELECT SUM(a) AS leads, SUM(b) AS leads FROM `p.d.t`"),
    ]).length, 0, "a single report's own variants are not cross-report drift");
    // Clients never pool.
    assert.strictEqual(audit([
        q("c1", "r1", "SELECT SUM(a) AS leads FROM `p.d.t`"),
        q("c2", "r2", "SELECT SUM(b) AS leads FROM `p.d.t`"),
    ]).length, 0, "two clients are not each other's drift");
    // Nested parens inside the aggregate must not truncate the expression.
    f = audit([
        q("c", "r1", "SELECT SUM(IF(k='a', v, 0)) AS revenue FROM `p.d.t`"),
        q("c", "r2", "SELECT SUM(v) AS revenue FROM `p.d.t`"),
    ]);
    assert.ok(f[0].variants.some((v) => v.expr === "sum(if(k='a', v, 0))"), "nested parens survive");
    console.log("metric-drift-audit --selftest: ALL PASS");
    process.exit(0);
}

const arg = (flag: string) => {
    const i = process.argv.indexOf(flag);
    return i === -1 ? null : process.argv[i + 1] ?? null;
};
const md = process.argv.includes("--markdown");
const findings = audit(await collect(arg("--client")), Number(arg("--min-reports") ?? 2));

if (process.argv.includes("--json")) {
    console.log(JSON.stringify(findings.map((f) => ({
        ...f, variants: f.variants.map((v) => ({ ...v, reports: [...v.reports].sort(), tables: [...v.tables].sort() })),
    })), null, 2));
    process.exit(0);
}

const byClient = new Map<string, Finding[]>();
for (const f of findings) byClient.set(f.client, [...(byClient.get(f.client) ?? []), f]);

console.log(md
    ? `# Metric drift audit\n\n${findings.length} names are computed more than one way across reports.\n`
    : `${findings.length} names computed more than one way across 2+ reports\n`);
for (const [client, fs] of [...byClient].sort((a, b) => b[1].length - a[1].length)) {
    console.log(md ? `## ${client} (${fs.length})` : `${client} (${fs.length})`);
    for (const f of fs) {
        console.log(md
            ? `\n### \`${f.name}\` -- ${f.reports} reports, ${f.variants.length} definitions`
            : `\n  ${f.name}  (${f.reports} reports, ${f.variants.length} definitions)`);
        for (const v of f.variants) {
            const reps = [...v.reports].sort();
            const t = [...v.tables].sort();
            console.log(`${md ? "- " : "    "}${v.expr}`);
            console.log(`${md ? "  - " : "      "}in: ${reps.slice(0, 4).join(", ")}${reps.length > 4 ? ` (+${reps.length - 4})` : ""}`);
            if (t.length) console.log(`${md ? "  - " : "      "}tables: ${t.slice(0, 3).join(", ")}${t.length > 3 ? ` (+${t.length - 3})` : ""}`);
        }
    }
    console.log("");
}
process.exit(0);
