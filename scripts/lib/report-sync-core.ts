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
 * - Content differs and the portal row was edited since the last reconcile
 *   (updatedAt > lastSyncedAt) → conflict; both versions are preserved, a human picks.
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
    if (portalEditedSinceSync) return { action: "conflict" };
    return { action: "apply" };
}
