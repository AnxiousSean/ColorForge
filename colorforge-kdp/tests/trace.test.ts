import { describe, expect, it } from "vitest";
import { fitWithin, otsuThreshold, suggestEdgeThreshold, polygonArea, toGray, traceBitmap, traceContours, type Bitmap } from "@/lib/trace";

/** Builds an RGBA bitmap where `ink(x, y)` pixels are black. */
function bitmap(w: number, h: number, ink: (x: number, y: number) => boolean, gray = 0): Bitmap {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = ink(x, y) ? gray : 255;
      data.set([v, v, v, 255], (y * w + x) * 4);
    }
  }
  return { width: w, height: h, data };
}

const binary = (w: number, h: number, ink: (x: number, y: number) => boolean) =>
  Uint8Array.from({ length: w * h }, (_, i) => (ink(i % w, Math.floor(i / w)) ? 1 : 0));

describe("contours", () => {
  it("traces a filled square as one loop of the right area", () => {
    const loops = traceContours(binary(20, 20, (x, y) => x >= 5 && x < 15 && y >= 5 && y < 15), 20, 20);
    expect(loops).toHaveLength(1);
    // Contour runs through pixel-edge midpoints, so the area is slightly under 100.
    expect(polygonArea(loops[0]!)).toBeGreaterThan(85);
    expect(polygonArea(loops[0]!)).toBeLessThanOrEqual(100);
  });

  it("traces a ring as an outer loop and a hole", () => {
    const ring = (x: number, y: number) => x >= 2 && x < 18 && y >= 2 && y < 18 && !(x >= 6 && x < 14 && y >= 6 && y < 14);
    const loops = traceContours(binary(20, 20, ring), 20, 20);
    expect(loops).toHaveLength(2);
  });

  it("closes shapes touching the image edge", () => {
    const loops = traceContours(binary(10, 10, (x) => x < 3), 10, 10);
    expect(loops).toHaveLength(1);
  });

  it("keeps diagonally touching pixels as separate shapes", () => {
    const loops = traceContours(binary(4, 4, (x, y) => (x === 1 && y === 1) || (x === 2 && y === 2)), 4, 4);
    expect(loops).toHaveLength(2);
  });
});

describe("traceBitmap", () => {
  it("turns a drawing into a single filled vector path", () => {
    const r = traceBitmap(bitmap(60, 60, (x, y) => Math.hypot(x - 30, y - 30) < 20 && Math.hypot(x - 30, y - 30) > 15));
    expect(r.loops).toBe(2); // outer edge + hole of the circle outline
    expect(r.pathData).toMatch(/^M[\d.]+ [\d.]+Q/);
    expect(r.pathData).toMatch(/^[MQZ0-9.\s-]+$/);
    expect(r.pathData.split("Z")).toHaveLength(3);
    expect(r.inkRatio).toBeGreaterThan(0.05);
  });

  it("removes specks smaller than the despeckle size", () => {
    // A 3×3 speck survives the noise blur; 1-pixel specks never get this far.
    const art = (x: number, y: number) => (x >= 10 && x < 40 && y >= 10 && y < 40) || (x >= 49 && x <= 51 && y >= 49 && y <= 51);
    expect(traceBitmap(bitmap(60, 60, art), { despeckle: 0 }).loops).toBe(2);
    expect(traceBitmap(bitmap(60, 60, art), { despeckle: 12 }).loops).toBe(1);
    expect(traceBitmap(bitmap(60, 60, (x, y) => x === 5 && y === 5), { despeckle: 0 }).loops).toBe(0);
  });

  it("honours the threshold and invert", () => {
    const mid = bitmap(30, 30, (x) => x < 15, 150); // mid-gray ink
    expect(traceBitmap(mid, { threshold: 128 }).loops).toBe(0);
    expect(traceBitmap(mid, { threshold: 200 }).loops).toBe(1);
    const inverted = traceBitmap(bitmap(30, 30, (x) => x < 15), { invert: true });
    expect(inverted.inkRatio).toBeGreaterThan(0.4);
  });

  it("outline mode traces the edges of a solid shape, not the shape itself", () => {
    const disk = bitmap(80, 80, (x, y) => Math.hypot(x - 40, y - 40) < 25);
    const ink = traceBitmap(disk, { mode: "ink" });
    const outline = traceBitmap(disk, { mode: "outline", threshold: 128, thickness: 1 });
    expect(ink.loops).toBe(1);
    expect(outline.loops).toBe(2); // a ring: outer and inner edge
    expect(outline.inkRatio).toBeLessThan(ink.inkRatio);
  });

  it("finds edges between colours of similar brightness", () => {
    // Orange disc on a blue background: luminance differs by only ~10%.
    const w = 80;
    const data = new Uint8ClampedArray(w * w * 4);
    for (let y = 0; y < w; y++)
      for (let x = 0; x < w; x++) {
        const inside = Math.hypot(x - 40, y - 40) < 25;
        data.set(inside ? [230, 140, 40, 255] : [110, 150, 210, 255], (y * w + x) * 4);
      }
    const bmp = { width: w, height: w, data };
    const threshold = suggestEdgeThreshold(bmp);
    const r = traceBitmap(bmp, { mode: "outline", threshold, thickness: 1 });
    expect(r.loops).toBe(2);
  });

  it("treats transparent pixels as paper", () => {
    const data = new Uint8ClampedArray(4 * 4 * 4); // all transparent black
    expect(toGray({ width: 4, height: 4, data }).every((v) => v === 255)).toBe(true);
  });

  it("simplification shrinks output without losing the shape", () => {
    const blob = bitmap(120, 120, (x, y) => Math.hypot(x - 60, y - 60) < 45);
    const fine = traceBitmap(blob, { smoothing: 0 });
    const smooth = traceBitmap(blob, { smoothing: 1.5 });
    expect(smooth.pathData.length).toBeLessThan(fine.pathData.length / 2);
    expect(smooth.loops).toBe(1);
  });
});

describe("helpers", () => {
  it("finds a threshold between two tones", () => {
    const gray = Uint8Array.from({ length: 1000 }, (_, i) => (i % 2 ? 40 : 220));
    const t = otsuThreshold(gray);
    expect(t).toBeGreaterThan(40);
    expect(t).toBeLessThanOrEqual(220);
  });

  it("fits images within a maximum side", () => {
    expect(fitWithin(4000, 3000, 1200)).toEqual({ width: 1200, height: 900 });
    expect(fitWithin(300, 200, 1200)).toEqual({ width: 300, height: 200 });
  });
});
