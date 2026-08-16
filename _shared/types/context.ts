/**
 * Context-line anchor model — single source of truth shared by backend and
 * frontend so the displayed handle position and the effective context boundary
 * always agree.
 *
 * An anchor is either:
 *   - a live turn number N (integer)      → context = live turns >= N
 *   - a summary block anchor E + 0.5      → context = live turns >= E + 1
 *     (E = the summary range's endTurn; the block sits between live turn E and
 *     E+1 in the timeline, so a half-step keeps it distinct from the live turn
 *     carrying the same number).
 */

/** Minimal summary-range shape used for boundary snapping (subset of the DB row). */
export interface SummaryRangeRef {
  startTurn: number;
  endTurn: number;
}

/** Half-step offset used to disambiguate summary blocks from live turns. */
export const SUMMARY_HALF_STEP = 0.5;

/** True when the value is a summary-block anchor (fractional, e.g. 7.5). */
export function isSummaryAnchor(n: number | null | undefined): boolean {
  return n != null && !Number.isInteger(n);
}

/**
 * Convert an anchor into the effective first-turn filter for live-turn
 * context selection. Integer anchors pass through; summary anchors
 * (X.5, summary ends at X) resolve to X + 1 (the first live turn after the
 * summarized block).
 */
export function effectiveFirstTurnFromAnchor(anchor: number | null | undefined): number | null {
  if (anchor == null) return null;
  if (Number.isInteger(anchor)) return anchor;
  return Math.floor(anchor) + 1;
}

/**
 * Snap a boundary anchor so it never lands INSIDE a summarized range:
 * an integer boundary within [range.startTurn .. range.endTurn] becomes the
 * range's summary-block anchor (endTurn + 0.5). Summary anchors and
 * boundaries outside every range are returned unchanged. null (all turns)
 * is unchanged.
 */
export function snapBoundaryToRanges(
  anchor: number | null | undefined,
  ranges: SummaryRangeRef[],
): number | null {
  if (anchor == null) return null;
  if (!Number.isInteger(anchor)) return anchor;
  for (const r of ranges) {
    if (anchor >= r.startTurn && anchor <= r.endTurn) {
      return r.endTurn + SUMMARY_HALF_STEP;
    }
  }
  return anchor;
}
