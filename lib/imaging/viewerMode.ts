/**
 * Which view the scan viewer shows.
 *
 * The user's explicit choice (Original / Overlay / Side-by-side) is remembered
 * only for the selection it was made under, so choosing a region ("View on
 * scan") shows it again.  The effective mode is derived from what can
 * actually be drawn, so the viewer never sits in an "overlay" view with
 * nothing to overlay.
 */
export type ViewMode = "original" | "overlay" | "side_by_side";

export interface ViewChoice { mode: ViewMode; key: string | null }

/**
 * Identifies the current selection.  `nonce` changes on every explicit
 * request to show a region, so asking again for the SAME region still counts
 * as a new selection and clears an earlier "Original" choice.
 */
export function selectionKeyFor(highlightedId: string | null | undefined, region: { x: number; y: number; w: number; h: number } | null | undefined, nonce = 0): string | null {
  const base = highlightedId ?? (region ? `${region.x},${region.y},${region.w},${region.h}` : null);
  return base === null ? null : `${base}#${nonce}`;
}

export function resolveViewMode(hasAnyOverlay: boolean, choice: ViewChoice | null, selectionKey: string | null): ViewMode {
  if (!hasAnyOverlay) return "original";
  const preferred = choice && choice.key === selectionKey ? choice.mode : null;
  return preferred ?? "overlay";
}
