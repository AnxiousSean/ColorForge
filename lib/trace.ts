/**
 * Bitmap -> vector line art, entirely client-side and dependency-free.
 *
 *   RGBA -> grayscale -> (ink: threshold | outline: Sobel edges + thicken)
 *        -> marching-squares contours -> drop specks -> simplify -> smooth
 *        -> one even-odd filled SVG path
 *
 * The result is pure vector data: imported images never reach the PDF as
 * pixels, so they print crisply at any resolution.
 */

import { simplifyPoints, type Point } from "@/lib/geometry";

export interface Bitmap {
  width: number;
  height: number;
  /** RGBA, row-major (like ImageData.data). */
  data: Uint8ClampedArray | Uint8Array;
}

export type TraceMode = "ink" | "outline";

export interface TraceOptions {
  mode: TraceMode;
  /** 0–255. Ink: pixels darker than this become ink. Outline: edge strength needed. */
  threshold: number;
  /** Swap ink and paper (e.g. white lines on a dark background). */
  invert: boolean;
  /** Remove blobs and holes smaller than this many pixels. */
  despeckle: number;
  /** Outline mode: extra line thickness in pixels (0–4). */
  thickness: number;
  /** Simplification tolerance in pixels; higher = smoother, smaller output. */
  smoothing: number;
}

export const DEFAULT_TRACE: TraceOptions = { mode: "ink", threshold: 128, invert: false, despeckle: 12, thickness: 1, smoothing: 0.8 };

export interface TraceResult {
  pathData: string;
  width: number;
  height: number;
  /** Number of closed outlines (shapes + holes). */
  loops: number;
  /** Fraction of the image that is ink, 0–1. Very high means the threshold is wrong. */
  inkRatio: number;
}

// ---------------------------------------------------------------------------
// Pixel stages
// ---------------------------------------------------------------------------

/** Luminance (Rec. 601). Transparent pixels count as white paper. */
export function toGray(bmp: Bitmap): Uint8Array {
  const { width, height, data } = bmp;
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    const a = data[i + 3]! / 255;
    const lum = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
    out[p] = Math.round(lum * a + 255 * (1 - a));
  }
  return out;
}

/** 3×3 box blur: removes scanner noise and JPEG artefacts before thresholding. */
export function blur(gray: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(gray.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          sum += gray[yy * w + xx]!;
          n++;
        }
      }
      out[y * w + x] = Math.round(sum / n);
    }
  }
  return out;
}

/** Otsu's method: the threshold that best separates ink from paper. */
export function otsuThreshold(gray: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (const v of gray) hist[v]!++;
  const total = gray.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i]!;
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t]!;
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold + 1;
}

/** Sobel gradient magnitude, scaled to 0–255. */
export function sobel(gray: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(gray.length);
  const at = (x: number, y: number) => gray[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) + at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
      const gy = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      // Max magnitude is ~1442; scale so strong edges saturate.
      out[y * w + x] = Math.min(255, Math.round(Math.hypot(gx, gy) / 4));
    }
  }
  return out;
}

/**
 * Edge strength using the strongest of the R, G and B gradients, so shapes
 * that differ in colour but not in brightness (orange on blue) still get
 * outlines.
 */
export function edgeMagnitude(bmp: Bitmap): Uint8Array {
  const { width: w, height: h, data } = bmp;
  const out = new Uint8Array(w * h);
  for (let c = 0; c < 3; c++) {
    const channel = new Uint8Array(w * h);
    for (let p = 0, i = c; p < channel.length; p++, i += 4) {
      // Composite over white like toGray does, so transparency is paper.
      const a = data[i - c + 3]! / 255;
      channel[p] = Math.round(data[i]! * a + 255 * (1 - a));
    }
    const edges = sobel(blur(channel, w, h), w, h);
    for (let p = 0; p < out.length; p++) if (edges[p]! > out[p]!) out[p] = edges[p]!;
  }
  return out;
}

/** Outline-mode slider value that marks roughly the strongest `share` of pixels as lines. */
export function suggestEdgeThreshold(bmp: Bitmap, share = 0.08): number {
  const edges = edgeMagnitude(bmp);
  const hist = new Array<number>(256).fill(0);
  for (const v of edges) hist[v]!++;
  let count = 0;
  const target = edges.length * share;
  for (let v = 255; v > 0; v--) {
    count += hist[v]!;
    if (count >= target) return Math.min(254, Math.max(1, 255 - v));
  }
  return 254;
}

/** Grows ink by one pixel (4-neighbourhood), `times` times. */
export function dilate(bin: Uint8Array, w: number, h: number, times: number): Uint8Array {
  let cur = bin;
  for (let t = 0; t < times; t++) {
    const next = new Uint8Array(cur);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (cur[y * w + x]) continue;
        if ((x > 0 && cur[y * w + x - 1]) || (x < w - 1 && cur[y * w + x + 1]) || (y > 0 && cur[(y - 1) * w + x]) || (y < h - 1 && cur[(y + 1) * w + x])) {
          next[y * w + x] = 1;
        }
      }
    }
    cur = next;
  }
  return cur;
}

/** 1 = ink, 0 = paper. */
export function toBinary(bmp: Bitmap, opts: TraceOptions): Uint8Array {
  const { width: w, height: h } = bmp;
  const bin = new Uint8Array(w * h);
  if (opts.mode === "ink") {
    const gray = blur(toGray(bmp), w, h);
    for (let i = 0; i < bin.length; i++) bin[i] = (gray[i]! < opts.threshold) !== opts.invert ? 1 : 0;
    return bin;
  }
  const edges = edgeMagnitude(bmp);
  // In outline mode the slider means "edge sensitivity": higher finds fainter edges.
  const cutoff = 255 - opts.threshold;
  for (let i = 0; i < bin.length; i++) bin[i] = edges[i]! > cutoff ? 1 : 0;
  return dilate(bin, w, h, Math.max(0, Math.round(opts.thickness)));
}

// ---------------------------------------------------------------------------
// Contours
// ---------------------------------------------------------------------------

/**
 * Marching squares over pixel centres. Returns closed loops in pixel
 * coordinates; with even-odd filling, nested loops become holes.
 * Diagonal-only contact counts as separate shapes (4-connectivity).
 */
export function traceContours(bin: Uint8Array, w: number, h: number): Point[][] {
  // Pad with paper so every contour closes.
  const W = w + 2;
  const H = h + 2;
  const s = (x: number, y: number) => (x <= 0 || y <= 0 || x > w || y > h ? 0 : bin[(y - 1) * w + (x - 1)]!);

  // Edge ids: horizontal edge (x,y)-(x+1,y) = 2*(y*W+x); vertical (x,y)-(x,y+1) = +1.
  const hEdge = (x: number, y: number) => 2 * (y * W + x);
  const vEdge = (x: number, y: number) => 2 * (y * W + x) + 1;
  const links = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    (links.get(a) ?? links.set(a, []).get(a)!).push(b);
    (links.get(b) ?? links.set(b, []).get(b)!).push(a);
  };

  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const c = (s(x, y) << 3) | (s(x + 1, y) << 2) | (s(x + 1, y + 1) << 1) | s(x, y + 1);
      if (c === 0 || c === 15) continue;
      const T = hEdge(x, y);
      const R = vEdge(x + 1, y);
      const B = hEdge(x, y + 1);
      const L = vEdge(x, y);
      switch (c) {
        case 1: link(L, B); break;
        case 2: link(B, R); break;
        case 3: link(L, R); break;
        case 4: link(T, R); break;
        case 5: link(L, B); link(T, R); break; // saddle: keep corners apart
        case 6: link(T, B); break;
        case 7: link(L, T); break;
        case 8: link(L, T); break;
        case 9: link(T, B); break;
        case 10: link(L, T); link(B, R); break; // saddle
        case 11: link(T, R); break;
        case 12: link(L, R); break;
        case 13: link(B, R); break;
        case 14: link(L, B); break;
      }
    }
  }

  const point = (id: number): Point => {
    const cell = id >> 1;
    const x = cell % W;
    const y = Math.floor(cell / W);
    // Midpoint of the edge, shifted from padded sample space to pixel space.
    return id & 1 ? [x - 0.5, y] : [x, y - 0.5];
  };

  const loops: Point[][] = [];
  const seen = new Set<number>();
  for (const start of links.keys()) {
    if (seen.has(start)) continue;
    const loop: Point[] = [];
    let prev = -1;
    let cur = start;
    while (!seen.has(cur)) {
      seen.add(cur);
      loop.push(point(cur));
      const [a, b] = links.get(cur)!;
      const next = a !== prev ? a! : b!;
      prev = cur;
      cur = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

export function polygonArea(loop: readonly Point[]): number {
  let a = 0;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) a += (loop[j]![0] + loop[i]![0]) * (loop[j]![1] - loop[i]![1]);
  return Math.abs(a / 2);
}

/** RDP for a closed loop: split at the point farthest from the start. */
function simplifyLoop(loop: readonly Point[], tolerance: number): Point[] {
  if (loop.length < 8 || tolerance <= 0) return [...loop];
  let far = 0;
  let best = -1;
  for (let i = 1; i < loop.length; i++) {
    const d = (loop[i]![0] - loop[0]![0]) ** 2 + (loop[i]![1] - loop[0]![1]) ** 2;
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const flat = (pts: readonly Point[]) => pts.flatMap(([x, y]) => [x, y]);
  const first = simplifyPoints(flat([...loop.slice(0, far + 1)]), tolerance);
  const second = simplifyPoints(flat([...loop.slice(far), loop[0]!]), tolerance);
  const merged = [...first, ...second.slice(2, -2)];
  const out: Point[] = [];
  for (let i = 0; i < merged.length; i += 2) out.push([merged[i]!, merged[i + 1]!]);
  return out.length >= 3 ? out : [...loop];
}

const f1 = (v: number) => {
  const r = Math.round(v * 10) / 10;
  return Object.is(r, -0) ? "0" : String(r);
};

/** Smooth closed path: quadratic curves through edge midpoints. */
export function loopToPath(loop: readonly Point[]): string {
  const n = loop.length;
  const mid = (i: number): Point => {
    const a = loop[i % n]!;
    const b = loop[(i + 1) % n]!;
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  };
  const start = mid(n - 1);
  let d = `M${f1(start[0])} ${f1(start[1])}`;
  for (let i = 0; i < n; i++) {
    const p = loop[i]!;
    const m = mid(i);
    d += `Q${f1(p[0])} ${f1(p[1])} ${f1(m[0])} ${f1(m[1])}`;
  }
  return d + "Z";
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function traceBitmap(bmp: Bitmap, options: Partial<TraceOptions> = {}): TraceResult {
  const opts = { ...DEFAULT_TRACE, ...options };
  const { width: w, height: h } = bmp;
  const bin = toBinary(bmp, opts);
  let ink = 0;
  for (const v of bin) ink += v;

  const loops = traceContours(bin, w, h)
    .filter((l) => polygonArea(l) >= opts.despeckle)
    .map((l) => simplifyLoop(l, opts.smoothing));

  return {
    pathData: loops.map(loopToPath).join(""),
    width: w,
    height: h,
    loops: loops.length,
    inkRatio: bin.length ? ink / bin.length : 0,
  };
}

/** Largest dimensions with the same aspect ratio that fit `maxSide`. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const k = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}
