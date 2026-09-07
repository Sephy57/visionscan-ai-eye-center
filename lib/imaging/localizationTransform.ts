/**
 * Geometry contract for mapping a model-space mask/box back to the untouched
 * source image after a crop + aspect-preserving resize + centered letterbox.
 *
 * Pixel boxes use half-open edges: [x, x + w) and [y, y + h). Returning null
 * means the geometry was empty or fell entirely inside preprocessing padding.
 */

export interface PixelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

export interface CropLetterboxTransform {
  coordinate_space: "MODEL_PIXELS_TO_ORIGINAL_IMAGE";
  original: ImageSize;
  crop: PixelBox;
  model: ImageSize;
  resized: ImageSize;
  padding: { left: number; top: number; right: number; bottom: number };
}

export interface NormalizedBox extends PixelBox {}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function validateCropLetterboxTransform(value: CropLetterboxTransform): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== "object") return ["transform must be an object"];
  const t = value as Partial<CropLetterboxTransform>;
  const original = t.original ?? { width: Number.NaN, height: Number.NaN };
  const model = t.model ?? { width: Number.NaN, height: Number.NaN };
  const resized = t.resized ?? { width: Number.NaN, height: Number.NaN };
  const crop = t.crop ?? { x: Number.NaN, y: Number.NaN, w: Number.NaN, h: Number.NaN };
  const p = t.padding ?? { left: Number.NaN, top: Number.NaN, right: Number.NaN, bottom: Number.NaN };
  if (t.coordinate_space !== "MODEL_PIXELS_TO_ORIGINAL_IMAGE") errors.push("coordinate space must map model pixels to the original image");
  const sizes = [original.width, original.height, model.width, model.height, resized.width, resized.height];
  if (!sizes.every((n) => Number.isInteger(n) && n > 0)) errors.push("image dimensions must be positive integers");
  if (![crop.x, crop.y, crop.w, crop.h].every(Number.isFinite) || !finitePositive(crop.w) || !finitePositive(crop.h)) {
    errors.push("crop must be finite and non-empty");
  }
  if (![crop.x, crop.y, crop.w, crop.h].every(Number.isInteger)) errors.push("crop must use integer source-pixel edges");
  if (crop.x < 0 || crop.y < 0 || crop.x + crop.w > original.width || crop.y + crop.h > original.height) {
    errors.push("crop must remain inside the original image");
  }
  if (![p.left, p.top, p.right, p.bottom].every((n) => Number.isInteger(n) && n >= 0)) errors.push("padding must be non-negative integers");
  if (p.left + resized.width + p.right !== model.width) errors.push("horizontal transform dimensions do not sum to model width");
  if (p.top + resized.height + p.bottom !== model.height) errors.push("vertical transform dimensions do not sum to model height");
  if (sizes.every((n) => Number.isFinite(n) && n > 0) && finitePositive(crop.w) && finitePositive(crop.h)) {
    const scale = Math.min(model.width / crop.w, model.height / crop.h);
    if (Math.abs(resized.width - crop.w * scale) > 1 || Math.abs(resized.height - crop.h * scale) > 1) {
      errors.push("resized dimensions do not preserve the crop aspect ratio at the declared letterbox scale");
    }
    if (resized.width !== model.width && resized.height !== model.height) errors.push("letterboxed content must fill at least one model dimension");
  }
  return errors;
}

export function createCenteredLetterboxTransform(input: {
  original: ImageSize;
  model: ImageSize;
  crop?: PixelBox;
}): CropLetterboxTransform {
  const crop = input.crop ?? { x: 0, y: 0, w: input.original.width, h: input.original.height };
  if (![input.original.width, input.original.height, input.model.width, input.model.height, crop.x, crop.y, crop.w, crop.h].every(Number.isFinite)) {
    throw new Error("localization transform dimensions must be finite");
  }
  const scale = Math.min(input.model.width / crop.w, input.model.height / crop.h);
  const resized = {
    width: Math.max(1, Math.round(crop.w * scale)),
    height: Math.max(1, Math.round(crop.h * scale)),
  };
  const remainingX = input.model.width - resized.width;
  const remainingY = input.model.height - resized.height;
  const padding = {
    left: Math.floor(remainingX / 2),
    top: Math.floor(remainingY / 2),
    right: remainingX - Math.floor(remainingX / 2),
    bottom: remainingY - Math.floor(remainingY / 2),
  };
  const transform: CropLetterboxTransform = {
    coordinate_space: "MODEL_PIXELS_TO_ORIGINAL_IMAGE",
    original: input.original,
    crop,
    model: input.model,
    resized,
    padding,
  };
  const errors = validateCropLetterboxTransform(transform);
  if (errors.length) throw new Error(errors.join("; "));
  return transform;
}

export function modelPixelBoxToOriginalNormalized(
  box: PixelBox,
  transform: CropLetterboxTransform,
): NormalizedBox | null {
  if (validateCropLetterboxTransform(transform).length) return null;
  if (![box.x, box.y, box.w, box.h].every(Number.isFinite) || box.w <= 0 || box.h <= 0) return null;

  const contentLeft = transform.padding.left;
  const contentTop = transform.padding.top;
  const contentRight = contentLeft + transform.resized.width;
  const contentBottom = contentTop + transform.resized.height;
  const x0 = Math.max(contentLeft, box.x);
  const y0 = Math.max(contentTop, box.y);
  const x1 = Math.min(contentRight, box.x + box.w);
  const y1 = Math.min(contentBottom, box.y + box.h);
  if (x1 <= x0 || y1 <= y0) return null;

  const originalX0 = transform.crop.x + ((x0 - contentLeft) / transform.resized.width) * transform.crop.w;
  const originalY0 = transform.crop.y + ((y0 - contentTop) / transform.resized.height) * transform.crop.h;
  const originalX1 = transform.crop.x + ((x1 - contentLeft) / transform.resized.width) * transform.crop.w;
  const originalY1 = transform.crop.y + ((y1 - contentTop) / transform.resized.height) * transform.crop.h;

  const nx0 = Math.max(0, Math.min(1, originalX0 / transform.original.width));
  const ny0 = Math.max(0, Math.min(1, originalY0 / transform.original.height));
  const nx1 = Math.max(0, Math.min(1, originalX1 / transform.original.width));
  const ny1 = Math.max(0, Math.min(1, originalY1 / transform.original.height));
  if (nx1 <= nx0 || ny1 <= ny0) return null;
  return { x: nx0, y: ny0, w: nx1 - nx0, h: ny1 - ny0 };
}

export function mapModelBoxesToOriginalNormalized(
  boxes: readonly PixelBox[],
  transform: CropLetterboxTransform,
): NormalizedBox[] {
  return boxes.map((box) => modelPixelBoxToOriginalNormalized(box, transform)).filter((box): box is NormalizedBox => box !== null);
}
