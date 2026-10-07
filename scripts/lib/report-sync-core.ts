/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ VENDORED FILE — DO NOT EDIT BY HAND.                                       │
 * │ Copied verbatim from the platform package `report-sync-core`              │
 * │ (vision-labs-reporting-suite/packages/report-sync-core/src/index.ts).     │
 * │                                                                           │
 * │ `specHash` MUST stay byte-identical to the platform's copy: the portal's  │
 * │ /v1/report-authoring/sync conflict detection compares this hash against   │
 * │ the server's. If they drift, every sync is misread as a conflict (or an   │
 * │ edit is silently clobbered). When the platform package changes, re-vendor │
 * │ this whole file — do not patch it locally.                                │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Report bi-directional sync: content fingerprinting + conflict detection.
 *
 * The single source of truth for both sides that reconcile reports into Postgres:
 * this repo's api-gateway webhook (shared/src/services/report-sync.ts re-exports
 * this package) and the monorepo's scripts/sync-reports.ts (installed as a pinned
 * git dependency, since it can't pull in the rest of vision-labs-shared). Reports
 * can be authored from the Studio (portal) or the monorepo terminal and reconcile
 * through the monorepo; these pure helpers decide, on an inbound monorepo→portal
 * sync, whether to apply, skip, or flag a conflict, WITHOUT ever silently
 * clobbering edits made on the other side. `specHash` is the shared content
 * fingerprint both sides agree on.
 */

import { createHash } from "crypto";

/** Deterministic JSON: object keys sorted recursively so logically-equal specs hash equal. */
export function canonicalJson(value: unknown): string {
    return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(value as Record<string, unknown>).sort()) {
            out[key] = sortKeys((value as Record<string, unknown>)[key]);
        }
        return out;
    }
    return value;
}

/** SHA-256 of a report spec's canonical JSON — the content fingerprint stored as specHash. */
export function specHash(spec: unknown): string {
    return createHash("sha256").update(canonicalJson(spec)).digest("hex");
}

/**
 * SHA-256 of a report's rendered content — the fingerprint stored as
 * `reports.last_synced_content_hash`, i.e. "the content the sync itself last wrote".
 *
 * `specHash` can't serve this purpose: it fingerprints the INCOMING spec, and an
 * HTML-only report has content the spec never covers. This is the other side of the
 * question — what is on the row right now versus what we put there.
 */
export function contentHash(html: string | null | undefined, reportQueries?: string | null): string {
    // Both columns, because both are ours to overwrite and either can move without the
    // other: a Studio save writes html_content and report_queries together, and a query
    // edit that changes no markup leaves the HTML byte-identical. Hashing only the HTML
    // would read that edit as "portal untouched" and quietly overwrite it — the one
    // thing the old, over-eager timestamp guard did get right. NUL-separated so
    // ("ab", "c") and ("a", "bc") can't collide. Both are TEXT columns, so they
    // round-trip byte-for-byte; the jsonb ones (report_meta, source_files) do NOT —
    // Postgres re-serializes them, and hashing what we sent would never match what
    // comes back.
    return createHash("sha256").update(`${html ?? ""}\u0000${reportQueries ?? ""}`).digest("hex");
}

/**
 * Lift a promoted report's ReportSpec to the key the editors actually read.
 *
 * The two sides disagree on where the spec lives, and nothing reconciled them:
 *   - the portal composes `report_meta.report_spec` (authoring.ts, and every reader
 *     — re-edit PATCH, promote-source, the in-report chat's component summary —
 *     looks there);
 *   - the promoted `.report.json` committed to the monorepo puts it at
 *     `authoring.spec` (buildPromotedReportJson).
 * So a report promoted to the repo and then synced back down landed with its spec
 * in a place no editor looks: it read as spec-less, `save_report` would author a
 * fresh spec over it, and a re-promote couldn't find one at all. The round trip
 * worked exactly once, in one direction.
 *
 * Idempotent, and never overwrites an existing `report_spec` — the portal's own
 * value is the more specific one. Reports genuinely written by hand in the repo
 * have no spec on either key and are returned untouched: they aren't
 * spec-authored, and pretending otherwise is what would destroy them.
 */
export function normalizeReportMeta<T>(meta: T): T {
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) return meta;
    const m = meta as Record<string, unknown>;
    if (m.report_spec !== undefined && m.report_spec !== null) return meta;

    const authoring = m.authoring;
    if (!authoring || typeof authoring !== "object" || Array.isArray(authoring)) return meta;
    const spec = (authoring as Record<string, unknown>).spec;
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) return meta;

    return { ...m, report_spec: spec } as T;
}

/** As {@link normalizeReportMeta}, for the JSON-string form the sync passes around.
 *  Unparseable input is returned as-is — a malformed meta is the caller's problem to
 *  surface, not something to swallow by emitting `null`. */
export function normalizeReportMetaJson(json: string | null | undefined): string | null | undefined {
    if (typeof json !== "string" || json.length === 0) return json;
    try {
        const parsed = JSON.parse(json);
        const normalized = normalizeReportMeta(parsed);
        return normalized === parsed ? json : JSON.stringify(normalized);
    } catch {
        return json;
    }
}

/**
 * A report's SOURCE as stored in `reports.source_files`: a flat filename→contents
 * map. Split-file reports carry `template.html` / `styles.css` / `NN-*.js`; a
 * monolithic report carries one `<slug>.report.html`; headless reports carry none.
 */
export type ReportSourceFiles = Record<string, string>;

/**
 * Assemble a report's HTML from its source files.
 *
 * This is the SAME rule as the monorepo build (`scripts/build-reports.ts` →
 * `buildReportFromDir` → `assembleReportHtml`) and the report server's copy of
 * `assembleReportHtml`, restated over a filename map instead of a directory:
 *
 *   styles.css    → wrapped in <style>
 *   template.html → inserted as-is
 *   *.js          → sorted by filename, concatenated inside one <script>
 *
 * blocks joined by a blank line, absent parts skipped. It lives HERE, in the
 * package both repos already share, because the alternative is a fourth copy of
 * an assembly rule that must stay byte-identical across two repositories — the
 * portal would render a report differently from production and nothing would say
 * so. `assembleReportHtml` in each repo keeps its directory-reading callers; this
 * is the map-shaped entry point the portal uses.
 *
 * A map with no recognized source (e.g. a monolithic `<slug>.report.html`, which
 * IS the built artifact and needs no assembly) returns null — the caller should
 * use the single file's contents verbatim.
 */
export function assembleFromFiles(files: ReportSourceFiles | null | undefined): string | null {
    if (!files) return null;
    const blocks: string[] = [];

    const css = files["styles.css"];
    if (css) blocks.push(`<style>\n${css}</style>`);

    const templateHtml = files["template.html"];
    if (templateHtml) blocks.push(templateHtml);

    // Sorted by filename: the build's glob order, i.e. the composed NN-prefixed
    // component order. Sorting the map's own keys reproduces it exactly.
    const js = Object.keys(files).filter((f) => f.endsWith(".js")).sort().map((f) => files[f]);
    if (js.length > 0) blocks.push(`<script>\n${js.join("\n")}\n</script>`);

    return blocks.length > 0 ? blocks.join("\n\n") : null;
}

export type ReportOrigin = "monorepo" | "portal" | "promoted";

/** The existing portal report row, as far as conflict detection cares. */
export interface ExistingReportSyncState {
    origin: ReportOrigin;
    specHash: string | null;
    lastSyncedAt: Date | null;
    updatedAt: Date | null;
    /**
     * Rendered HTML currently stored on the row (split-file monorepo reports keep
     * this outside the hashed .report.json spec). Only compared when the caller
     * also passes `incomingHtmlContent` — omit both to get the old spec-only
     * behavior for callers that don't track HTML on this row at all.
     */
    htmlContent?: string | null;
    /**
     * When the portal last STAGED this report's source FOR the repo (a Studio edit
     * handed over via the repoOnly sync). Distinct from an ordinary portal edit: it
     * is an edit made to be sent to the repo, and this inbound sync is it coming home.
     *
     * Without it the return leg deadlocks. The staging write sets `updated_at = now()`
     * alongside `source_files_updated_at`, which makes `updatedAt > lastSyncedAt` true
     * forever — and `lastSyncedAt` only advances on a successful sync, which the
     * resulting conflict prevents. The agency pulls the edit, commits it, syncs, is
     * told to "resolve in the portal admin" where there is nothing to resolve, and the
     * report can never be published from the repo again. Hit end-to-end by the first
     * agency to run the full round trip (2026-08-07).
     */
    sourceFilesUpdatedAt?: Date | null;
    /**
     * `contentHash` of the HTML the last successful sync WROTE to this row. Lets the
     * conflict check ask whether the portal's content actually diverged, instead of
     * inferring it from `updatedAt` — which moves for writes that change no content
     * at all: opening a report in the Studio and saving it, toggling its category,
     * display order or portal visibility. Every one of those permanently blocked all
     * subsequent monorepo pushes to that report, and said so only in a CI log line.
     *
     * Null on rows last synced before this column existed (and on rows the portal has
     * written since), in which case the timestamp guard below decides as it always has.
     */
    lastSyncedContentHash?: string | null;
    /** `report_queries` as stored on the row — hashed with the HTML. See {@link contentHash}. */
    reportQueries?: string | null;
}

export interface InboundReportSyncInput {
    /** Fingerprint of the incoming monorepo spec. */
    incomingSpecHash: string;
    /** The portal row this monorepo report maps to, or null if it doesn't exist yet. */
    existing: ExistingReportSyncState | null;
    /**
     * Rendered HTML the incoming monorepo version would apply. A spec-only hash
     * can't see an HTML-only edit (template.html/styles.css/*.js changed,
     * .report.json didn't) — when provided, it must also match the stored
     * `existing.htmlContent` for the row to count as already-in-sync.
     */
    incomingHtmlContent?: string | null;
}

export type InboundReportDecision =
    | { action: "create" }
    | { action: "apply" }
    | { action: "skip"; reason: "portal-native" | "already-in-sync" }
    | { action: "conflict" };

/**
 * Decide what an inbound monorepo→portal sync should do for one report.
 *
 * - No existing row → create it (origin monorepo).
 * - origin === "portal" → skip; portal-native rows are never overwritten by sync.
 * - Content already matches (specHash equal, and htmlContent equal when tracked)
 *   → skip; nothing to do (caller may still refresh commitSha/lastSyncedAt bookkeeping).
 * - Content differs and the portal row was really edited since the last reconcile
 *   (updatedAt > lastSyncedAt, AND its content no longer matches what we last wrote)
 *   → conflict; both versions are preserved, a human picks.
 * - Otherwise → apply the monorepo version.
 */
export function decideInboundReportSync(input: InboundReportSyncInput): InboundReportDecision {
    const { incomingSpecHash, existing, incomingHtmlContent } = input;
    if (!existing) return { action: "create" };
    if (existing.origin === "portal") return { action: "skip", reason: "portal-native" };
    if (existing.specHash && existing.specHash === incomingSpecHash) {
        const htmlTracked = incomingHtmlContent !== undefined;
        const htmlMatches = !htmlTracked || (existing.htmlContent ?? null) === (incomingHtmlContent ?? null);
        if (htmlMatches) return { action: "skip", reason: "already-in-sync" };
        // Spec matches but the tracked HTML diverged — fall through to the
        // timestamp guard below instead of silently calling this in-sync.
    }
    const portalEditedSinceSync =
        existing.lastSyncedAt != null &&
        existing.updatedAt != null &&
        existing.updatedAt.getTime() > existing.lastSyncedAt.getTime();
    // ...unless that edit IS the handoff to this repo. The staging write touches
    // updated_at and source_files_updated_at in one statement, so they are equal
    // until something ELSE edits the row; `updatedAt <= sourceFilesUpdatedAt` therefore
    // means nothing has happened to the portal row since it was staged, and the
    // incoming sync is that same work returning built. A genuine portal edit made
    // afterwards moves updated_at past it and still conflicts.
    //
    // Deliberately not content-based: comparing hashes would call this in-sync only
    // when the repo round-tripped byte-for-byte, and the repo is supposed to be able
    // to change what it received. See sourceFilesUpdatedAt.
    const isStagedHandoff =
        existing.sourceFilesUpdatedAt != null &&
        existing.updatedAt != null &&
        existing.updatedAt.getTime() <= existing.sourceFilesUpdatedAt.getTime();
    // ...and unless the portal row's CONTENT is still byte-for-byte what this sync last
    // wrote. Then there is nothing to conflict WITH, whatever moved updated_at, and the
    // monorepo version applies. Not in tension with the deliberately-timestamp-based
    // handoff check above: that one compares the incoming repo build against staged
    // portal work (which the repo is allowed to change), this one compares the portal
    // row against our own last write (which only the portal can change).
    const portalContentUntouched =
        existing.lastSyncedContentHash != null &&
        existing.lastSyncedContentHash === contentHash(existing.htmlContent, existing.reportQueries);
    if (portalEditedSinceSync && !isStagedHandoff && !portalContentUntouched) return { action: "conflict" };
    return { action: "apply" };
}

/**
 * The OUTBOUND counterpart of decideInboundReportSync: may this draft stage its
 * source onto the live report, or would that bury someone else's work?
 *
 * Every Studio chat gets its own draft, seeded from the live report's source. A
 * stage writes the draft's WHOLE file set onto the live row, so two chats on one
 * report meant the second silently replaced the first — including files it never
 * touched, because it was seeded before the first existed. Not hypothetical: one
 * report had four live drafts on 2026-08-07, and the common shape is one person
 * with several chats open, not two people typing at once.
 *
 * The home agency has a git-level equivalent (detectRepoDrift reads the monorepo).
 * For every other agency we cannot read their repo, so the LIVE ROW's source is the
 * proxy — it moves when another chat stages, and when their CI syncs a build back.
 * Both are cases where staging this draft whole would revert work already in
 * flight, and `npm run pull` would carry that reversion out as an ordinary edit.
 *
 * `seededHash` is re-stamped to what a chat stages after each successful stage, so
 * the baseline means "the last state I agreed with" rather than "what I was born
 * from" — otherwise a chat's own second sync conflicts with its own first.
 */
export interface StageConflictInput {
    /** Hash of the source this draft was seeded from. Null for drafts predating the stamp. */
    seededHash: string | null | undefined;
    /** Hash of the live report's source right now. */
    liveHash: string | null | undefined;
    /** The human chose to overwrite anyway. */
    force?: boolean;
}

export function decideStageConflict(input: StageConflictInput): { action: "stage" | "conflict" } {
    const { seededHash, liveHash, force } = input;
    if (force) return { action: "stage" };
    // No baseline → no evidence of a conflict. A draft seeded before this stamp
    // existed must not be held hostage by a 409 it has no way to clear; it gets the
    // behaviour it has always had. Fails OPEN deliberately, and only here.
    if (!seededHash) return { action: "stage" };
    return seededHash === liveHash ? { action: "stage" } : { action: "conflict" };
}
