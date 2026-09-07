import { describe, expect, it } from "vitest";
import {
  createCenteredLetterboxTransform,
  mapModelBoxesToOriginalNormalized,
  modelPixelBoxToOriginalNormalized,
  validateCropLetterboxTransform,
} from "@/lib/imaging/localizationTransform";

function expectBox(actual: ReturnType<typeof modelPixelBoxToOriginalNormalized>, expected: { x: number; y: number; w: number; h: number }) {
  expect(actual).not.toBeNull();
  expect(actual!.x).toBeCloseTo(expected.x, 8);
  expect(actual!.y).toBeCloseTo(expected.y, 8);
  expect(actual!.w).toBeCloseTo(expected.w, 8);
  expect(actual!.h).toBeCloseTo(expected.h, 8);
}

describe("fundus crop/letterbox localization mapping", () => {
  it("maps a landscape content rectangle back to the full original image", () => {
    const t = createCenteredLetterboxTransform({ original: { width: 1600, height: 800 }, model: { width: 1024, height: 1024 } });
    expect(t.padding).toEqual({ left: 0, top: 256, right: 0, bottom: 256 });
    expectBox(modelPixelBoxToOriginalNormalized({ x: 0, y: 256, w: 1024, h: 512 }, t), { x: 0, y: 0, w: 1, h: 1 });
  });

  it("maps a portrait content rectangle back to the full original image", () => {
    const t = createCenteredLetterboxTransform({ original: { width: 800, height: 1600 }, model: { width: 1024, height: 1024 } });
    expect(t.padding).toEqual({ left: 256, top: 0, right: 256, bottom: 0 });
    expectBox(modelPixelBoxToOriginalNormalized({ x: 256, y: 0, w: 512, h: 1024 }, t), { x: 0, y: 0, w: 1, h: 1 });
  });

  it("preserves square-image geometry", () => {
    const t = createCenteredLetterboxTransform({ original: { width: 1000, height: 1000 }, model: { width: 1024, height: 1024 } });
    expectBox(modelPixelBoxToOriginalNormalized({ x: 256, y: 128, w: 512, h: 256 }, t), { x: 0.25, y: 0.125, w: 0.5, h: 0.25 });
  });

  it("restores the detected fundus crop offset instead of treating crop coordinates as original coordinates", () => {
    const t = createCenteredLetterboxTransform({
      original: { width: 2000, height: 1000 }, model: { width: 1024, height: 1024 },
      crop: { x: 200, y: 100, w: 1600, h: 800 },
    });
    expectBox(modelPixelBoxToOriginalNormalized({ x: 0, y: 256, w: 1024, h: 512 }, t), { x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  });

  it("clips edge-touching geometry to the real image content and rejects padding-only geometry", () => {
    const t = createCenteredLetterboxTransform({ original: { width: 1600, height: 800 }, model: { width: 1024, height: 1024 } });
    expect(modelPixelBoxToOriginalNormalized({ x: 100, y: 10, w: 50, h: 50 }, t)).toBeNull();
    expectBox(modelPixelBoxToOriginalNormalized({ x: -20, y: 246, w: 120, h: 110 }, t), { x: 0, y: 0, w: 100 / 1024, h: 100 / 512 });
  });

  it("returns no box for zero-area or non-finite model geometry", () => {
    const t = createCenteredLetterboxTransform({ original: { width: 1000, height: 1000 }, model: { width: 1024, height: 1024 } });
    expect(modelPixelBoxToOriginalNormalized({ x: 0, y: 0, w: 0, h: 10 }, t)).toBeNull();
    expect(modelPixelBoxToOriginalNormalized({ x: Number.NaN, y: 0, w: 10, h: 10 }, t)).toBeNull();
  });

  it("maps a full model mask only to source content, never to letterbox padding", () => {
    const t = createCenteredLetterboxTransform({ original: { width: 1600, height: 800 }, model: { width: 1024, height: 1024 } });
    expectBox(modelPixelBoxToOriginalNormalized({ x: 0, y: 0, w: 1024, h: 1024 }, t), { x: 0, y: 0, w: 1, h: 1 });
  });

  it("maps multiple regions independently and removes padding-only regions", () => {
    const t = createCenteredLetterboxTransform({ original: { width: 1600, height: 800 }, model: { width: 1024, height: 1024 } });
    const mapped = mapModelBoxesToOriginalNormalized([
      { x: 0, y: 0, w: 20, h: 20 },
      { x: 0, y: 256, w: 100, h: 100 },
      { x: 512, y: 512, w: 100, h: 100 },
    ], t);
    expect(mapped).toHaveLength(2);
    expect(mapped.every((box) => box.x >= 0 && box.y >= 0 && box.x + box.w <= 1 && box.y + box.h <= 1)).toBe(true);
  });

  it("rejects internally inconsistent transform metadata", () => {
    const t = createCenteredLetterboxTransform({ original: { width: 1600, height: 800 }, model: { width: 1024, height: 1024 } });
    expect(validateCropLetterboxTransform({ ...t, padding: { ...t.padding, right: 1 } })).toContain("horizontal transform dimensions do not sum to model width");
    expect(() => validateCropLetterboxTransform({} as never)).not.toThrow();
    expect(validateCropLetterboxTransform({} as never).length).toBeGreaterThan(0);
    expect(validateCropLetterboxTransform({ ...t, resized: { width: 900, height: 512 }, padding: { left: 62, right: 62, top: 256, bottom: 256 } })).toContain("resized dimensions do not preserve the crop aspect ratio at the declared letterbox scale");
  });
});
