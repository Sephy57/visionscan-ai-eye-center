/**
 * Overlay geometry for the scan viewer.
 *
 * Boxes are fractions (0..1) of the ORIGINAL image.  The viewer draws them
 * inside a wrapper whose size equals the displayed <img>, so a percentage box
 * stays attached to the same anatomy at every viewport size and zoom level.
 * Nothing here moves, resizes or invents a region: a locator ring is a
 * separate, labelled aid for regions too small to see, and the true extent is
 * still drawn.
 */

export interface NormalizedBox { x: number; y: number; w: number; h: number }

/**
 * Producers round-trip floats through a crop/letterbox transform, so a box can
 * overshoot 1 by rounding noise.  This matches the raw-output contract's own
 * tolerance (lib/models/outputContract.ts) and is far below one display pixel.
 */
export const BOX_EPSILON = 1e-4;

export function isBoundedBox(box: NormalizedBox | null | undefined): box is NormalizedBox {
  return !!box
    && [box.x, box.y, box.w, box.h].every(Number.isFinite)
    // x/y must start inside the image so clipping can never leave an empty box
    && box.x >= 0 && box.y >= 0 && box.x < 1 && box.y < 1 && box.w > 0 && box.h > 0
    && box.x + box.w <= 1 + BOX_EPSILON && box.y + box.h <= 1 + BOX_EPSILON;
}

/** Clip rounding-noise overshoot so a bounded box never leaves the image. */
export function clipToUnit(box: NormalizedBox): NormalizedBox {
  return { x: box.x, y: box.y, w: Math.min(box.w, 1 - box.x), h: Math.min(box.h, 1 - box.y) };
}

/** Same geometry, compared exactly: both sides come from one persisted value. */
export function sameBox(a: NormalizedBox | null | undefined, b: NormalizedBox | null | undefined): boolean {
  return !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/**
 * Same stored region, however it was clipped on the way: a finding keeps the
 * model's box while the fundus localization is clipped to the image, so the
 * two differ only by rounding noise at the edge.
 */
export function sameRegion(a: NormalizedBox | null | undefined, b: NormalizedBox | null | undefined): boolean {
  return isBoundedBox(a) && isBoundedBox(b) && sameBox(clipToUnit(a), clipToUnit(b));
}

export function boxToPercentStyle(box: NormalizedBox): { left: string; top: string; width: string; height: string } {
  return { left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` };
}

export function boxCenter(box: NormalizedBox): { x: number; y: number } {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/** On-screen size of a box in CSS pixels at the current fit size and zoom. */
export function displaySizePx(box: NormalizedBox, fitted: { w: number; h: number }, zoom: number): { w: number; h: number } {
  return { w: box.w * fitted.w * zoom, h: box.h * fitted.h * zoom };
}

/** A region smaller than this on screen is hard to see; it gets a locator ring. */
export const MIN_VISIBLE_PX = 14;

export function needsLocator(box: NormalizedBox, fitted: { w: number; h: number }, zoom: number, minPx = MIN_VISIBLE_PX): boolean {
  if (fitted.w <= 0 || fitted.h <= 0 || zoom <= 0) return false;
  const size = displaySizePx(box, fitted, zoom);
  return Math.max(size.w, size.h) < minPx;
}

// Label sizing.  LABEL_MAX_PX and LOCATOR_LABEL_OFFSET_PX are mirrored in
// app/globals.css (.viewer-label max-width, .has-locator label offset).
export const LABEL_MAX_PX = 220;
export const LABEL_MIN_PX = 60;
export const LABEL_COMFORT_PX = 140;
export const LABEL_GUTTER_PX = 8;
export const LOCATOR_LABEL_OFFSET_PX = 14;

/**
 * A label grows sideways from its box.  Choose the side with room and cap the
 * width to that room (screen px), so a label is never cut off by the pane
 * edge, however narrow the pane, wherever the image is panned, at any zoom.
 * `end` = the label grows leftwards from the box's right edge.
 */
export function labelPlacement(input: {
  box: NormalizedBox; paneWidth: number; fitted: { w: number; h: number }; zoom: number; offsetX: number; ringed: boolean;
}): { end: boolean; room: number } {
  const { box, paneWidth, fitted, zoom, offsetX, ringed } = input;
  const preferEnd = boxCenter(box).x > 0.5;
  if (!paneWidth || !fitted.w) return { end: preferEnd, room: LABEL_MAX_PX };
  const centerX = paneWidth / 2 + offsetX;
  const boxLeft = centerX + (box.x - 0.5) * fitted.w * zoom;
  const boxRight = centerX + (box.x + box.w - 0.5) * fitted.w * zoom;
  const gutter = LABEL_GUTTER_PX + (ringed ? LOCATOR_LABEL_OFFSET_PX : 0);
  const roomRight = paneWidth - boxLeft - gutter;   // grows right from the box's left edge
  const roomLeft = boxRight - gutter;               // grows left from the box's right edge
  const roomPreferred = preferEnd ? roomLeft : roomRight;
  const roomOther = preferEnd ? roomRight : roomLeft;
  const end = roomPreferred >= LABEL_COMFORT_PX || roomPreferred >= roomOther ? preferEnd : !preferEnd;
  return { end, room: Math.max(LABEL_MIN_PX, Math.min(LABEL_MAX_PX, end ? roomLeft : roomRight)) };
}
