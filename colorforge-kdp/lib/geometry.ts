/**
 * Vector geometry for the line-art editor. All coordinates are inches in
 * trim space (see lib/model.ts).
 */

import type { Rect } from "@/lib/kdp";
import type { EllipseShape, PolygonShape, RectShape, Shape } from "@/lib/model";
import { measureText } from "@/lib/text-metrics";

export type Point = readonly [x: number, y: number];

// ---------------------------------------------------------------------------
// Freehand paths
// ---------------------------------------------------------------------------

/**
 * Ramer–Douglas–Peucker simplification on a flat [x, y, x, y, ...] list.
 * Removes jitter from pointer input while keeping the stroke's shape.
 */
export function simplifyPoints(flat: readonly number[], tolerance = 0.004): number[] {
  const n = flat.length / 2;
  if (n <= 2) return [...flat];
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment([flat[i * 2]!, flat[i * 2 + 1]!], [flat[a * 2]!, flat[a * 2 + 1]!], [flat[b * 2]!, flat[b * 2 + 1]!]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > tolerance && index > 0) {
      keep[index] = 1;
      stack.push([a, index], [index, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(flat[i * 2]!, flat[i * 2 + 1]!);
  return out;
}

const fmt = (v: number) => Number(v.toFixed(4));

/**
 * SVG path data for a freehand stroke: quadratic curves through the
 * midpoints, so simplified strokes stay smooth instead of turning angular.
 */
export function pathData(flat: readonly number[]): string {
  const n = flat.length / 2;
  if (n === 0) return "";
  const x = (i: number) => fmt(flat[i * 2]!);
  const y = (i: number) => fmt(flat[i * 2 + 1]!);
  // A single tap becomes a dot (a zero-length line with round caps).
  if (n === 1) return `M${x(0)} ${y(0)}L${x(0)} ${y(0)}`;
  if (n === 2) return `M${x(0)} ${y(0)}L${x(1)} ${y(1)}`;
  let d = `M${x(0)} ${y(0)}`;
  for (let i = 1; i < n - 1; i++) {
    const mx = fmt((flat[i * 2]! + flat[(i + 1) * 2]!) / 2);
    const my = fmt((flat[i * 2 + 1]! + flat[(i + 1) * 2 + 1]!) / 2);
    d += `Q${x(i)} ${y(i)} ${mx} ${my}`;
  }
  return d + `L${x(n - 1)} ${y(n - 1)}`;
}

// ---------------------------------------------------------------------------
// Outlines, bounds and hit testing
// ---------------------------------------------------------------------------

const rotateAround = ([x, y]: Point, [cx, cy]: Point, angle: number): Point => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos];
};

export function polygonVertices(s: Pick<PolygonShape, "cx" | "cy" | "radius" | "sides" | "rotation">): Point[] {
  const sides = Math.max(3, Math.round(s.sides));
  return Array.from({ length: sides }, (_, k) => {
    const a = s.rotation + (2 * Math.PI * k) / sides;
    return [s.cx + s.radius * Math.cos(a), s.cy + s.radius * Math.sin(a)] as Point;
  });
}

export function rectCorners(s: RectShape): Point[] {
  const c: Point = [s.x + s.width / 2, s.y + s.height / 2];
  const pts: Point[] = [
    [s.x, s.y],
    [s.x + s.width, s.y],
    [s.x + s.width, s.y + s.height],
    [s.x, s.y + s.height],
  ];
  return s.rotation ? pts.map((p) => rotateAround(p, c, s.rotation!)) : pts;
}

function ellipseOutline(s: EllipseShape, steps = 72): Point[] {
  return Array.from({ length: steps }, (_, k) => {
    const a = (2 * Math.PI * k) / steps;
    const p: Point = [s.cx + s.rx * Math.cos(a), s.cy + s.ry * Math.sin(a)];
    return s.rotation ? rotateAround(p, [s.cx, s.cy], s.rotation) : p;
  });
}

export { APPROX_WIDTH_FACTOR as TEXT_WIDTH_FACTOR } from "@/lib/text-metrics";

/**
 * Points along the shape's centreline, and whether they form a closed loop.
 * Used for bounds and hit testing.
 */
export function outline(shape: Shape): { points: Point[]; closed: boolean } {
  switch (shape.type) {
    case "path": {
      const points: Point[] = [];
      for (let i = 0; i < shape.points.length; i += 2) points.push([shape.points[i]!, shape.points[i + 1]!]);
      return { points, closed: false };
    }
    case "ellipse":
      return { points: ellipseOutline(shape), closed: true };
    case "rect":
      return { points: rectCorners(shape), closed: true };
    case "polygon":
      return { points: polygonVertices(shape), closed: true };
    case "text": {
      const w = measureText(shape.text, shape.fontSize, shape.font, 400);
      const top = shape.y - shape.fontSize * 0.8;
      const bottom = shape.y + shape.fontSize * 0.2;
      return {
        points: [
          [shape.x, top],
          [shape.x + w, top],
          [shape.x + w, bottom],
          [shape.x, bottom],
        ],
        closed: true,
      };
    }
  }
}

/** Bounding box including the stroke. */
export function shapeBounds(shape: Shape): Rect {
  const { points } = outline(shape);
  const pad = shape.type === "text" ? 0 : shape.strokeWidth / 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (points.length === 0) return { xIn: 0, yIn: 0, widthIn: 0, heightIn: 0 };
  return { xIn: minX - pad, yIn: minY - pad, widthIn: maxX - minX + pad * 2, heightIn: maxY - minY + pad * 2 };
}

/** Union of the bounds of all inked (non-eraser) shapes, or null if there are none. */
export function artworkBounds(shapes: readonly Shape[]): Rect | null {
  const inked = shapes.filter((s) => !s.erase);
  if (inked.length === 0) return null;
  const boxes = inked.map(shapeBounds);
  const minX = Math.min(...boxes.map((b) => b.xIn));
  const minY = Math.min(...boxes.map((b) => b.yIn));
  const maxX = Math.max(...boxes.map((b) => b.xIn + b.widthIn));
  const maxY = Math.max(...boxes.map((b) => b.yIn + b.heightIn));
  return { xIn: minX, yIn: minY, widthIn: maxX - minX, heightIn: maxY - minY };
}

export function distToSegment([px, py]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** True if `point` touches the shape's stroke (within `tolerance` inches). */
export function hitTest(shape: Shape, point: Point, tolerance: number): boolean {
  const { points, closed } = outline(shape);
  if (shape.type === "text") return pointInPolygon(point, points);
  const reach = tolerance + shape.strokeWidth / 2;
  if (points.length === 1) return Math.hypot(point[0] - points[0]![0], point[1] - points[0]![1]) <= reach;
  const segments = closed ? points.length : points.length - 1;
  for (let i = 0; i < segments; i++) {
    if (distToSegment(point, points[i]!, points[(i + 1) % points.length]!) <= reach) return true;
  }
  return false;
}

function pointInPolygon([x, y]: Point, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Symmetry / mandala mode
// ---------------------------------------------------------------------------

export interface Symmetry {
  /** Number of rotational copies (1 = off). */
  segments: number;
  /** Also mirror each copy across the vertical axis through the centre. */
  mirror: boolean;
  center: Point;
}

type Transform = { angle: number; mirror: boolean };

function transformPoint(p: Point, center: Point, t: Transform): Point {
  const m: Point = t.mirror ? [2 * center[0] - p[0], p[1]] : p;
  return rotateAround(m, center, t.angle);
}

/** Mirror then rotate a shape about `center`. Text is never mirrored (it would read backwards). */
function transformShape(shape: Shape, center: Point, t: Transform, id: string): Shape {
  const tp = (p: Point) => transformPoint(p, center, t);
  // Mirroring flips an angle (θ -> π - θ for vertex angles, -θ for box
  // rotation); rotation then adds the copy's angle.
  switch (shape.type) {
    case "path": {
      const points: number[] = [];
      for (let i = 0; i < shape.points.length; i += 2) points.push(...tp([shape.points[i]!, shape.points[i + 1]!]));
      return { ...shape, id, points };
    }
    case "ellipse": {
      const [cx, cy] = tp([shape.cx, shape.cy]);
      const base = shape.rotation ?? 0;
      return { ...shape, id, cx, cy, rotation: (t.mirror ? -base : base) + t.angle };
    }
    case "rect": {
      const [cx, cy] = tp([shape.x + shape.width / 2, shape.y + shape.height / 2]);
      const base = shape.rotation ?? 0;
      return { ...shape, id, x: cx - shape.width / 2, y: cy - shape.height / 2, rotation: (t.mirror ? -base : base) + t.angle };
    }
    case "polygon": {
      const [cx, cy] = tp([shape.cx, shape.cy]);
      return { ...shape, id, cx, cy, rotation: (t.mirror ? Math.PI - shape.rotation : shape.rotation) + t.angle };
    }
    case "text":
      return { ...shape, id };
  }
}

/**
 * The shape plus all its symmetric copies. The original is always first and
 * keeps its id. Text is not repeated.
 */
export function symmetryCopies(shape: Shape, symmetry: Symmetry, makeId: () => string): Shape[] {
  const segments = Math.max(1, Math.round(symmetry.segments));
  if (shape.type === "text" || (segments === 1 && !symmetry.mirror)) return [shape];
  const out: Shape[] = [shape];
  for (let k = 0; k < segments; k++) {
    const angle = (2 * Math.PI * k) / segments;
    if (k > 0) out.push(transformShape(shape, symmetry.center, { angle, mirror: false }, makeId()));
    if (symmetry.mirror) out.push(transformShape(shape, symmetry.center, { angle, mirror: true }, makeId()));
  }
  return out;
}
