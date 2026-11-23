import { describe, expect, it } from "vitest";
import {
  artworkBounds,
  hitTest,
  outline,
  pathData,
  shapeBounds,
  simplifyPoints,
  symmetryCopies,
  type Symmetry,
} from "@/lib/geometry";
import type { PathShape, PolygonShape, RectShape, Shape } from "@/lib/model";
import { useEditor } from "@/store/editor";

const path = (points: number[], strokeWidth = 0.02): PathShape => ({ type: "path", id: "p", points, strokeWidth });

describe("freehand paths", () => {
  it("simplification drops collinear jitter but keeps corners", () => {
    const pts = [0, 0, 1, 0.0005, 2, -0.0004, 3, 0, 3, 1, 3, 2];
    expect(simplifyPoints(pts, 0.004)).toEqual([0, 0, 3, 0, 3, 2]);
  });

  it("renders dots, lines and smooth curves", () => {
    expect(pathData([1, 1])).toBe("M1 1L1 1");
    expect(pathData([0, 0, 1, 1])).toBe("M0 0L1 1");
    expect(pathData([0, 0, 1, 1, 2, 0])).toBe("M0 0Q1 1 1.5 0.5L2 0");
  });
});

describe("bounds and hit testing", () => {
  it("includes half the stroke width in bounds", () => {
    expect(shapeBounds(path([1, 1, 2, 1], 0.2))).toEqual({ xIn: 0.9, yIn: 0.9, widthIn: 1.2, heightIn: 0.2 });
  });

  it("accounts for rectangle rotation", () => {
    const r: RectShape = { type: "rect", id: "r", x: 0, y: 0, width: 2, height: 2, strokeWidth: 0, rotation: Math.PI / 4 };
    const b = shapeBounds(r);
    expect(b.widthIn).toBeCloseTo(2 * Math.SQRT2);
  });

  it("ignores eraser strokes in artwork bounds", () => {
    const shapes: Shape[] = [path([1, 1, 2, 2], 0), { ...path([0, 0, 8, 10], 0), erase: true }];
    expect(artworkBounds(shapes)).toEqual({ xIn: 1, yIn: 1, widthIn: 1, heightIn: 1 });
    expect(artworkBounds([])).toBeNull();
  });

  it("hits strokes within tolerance only", () => {
    const line = path([0, 0, 2, 0], 0.02);
    expect(hitTest(line, [1, 0.05], 0.05)).toBe(true);
    expect(hitTest(line, [1, 0.2], 0.05)).toBe(false);
    const poly: PolygonShape = { type: "polygon", id: "g", cx: 0, cy: 0, radius: 1, sides: 4, rotation: 0, strokeWidth: 0.02 };
    expect(hitTest(poly, [0, 0], 0.05)).toBe(false); // centre of an outline is empty
    expect(hitTest(poly, [1, 0], 0.05)).toBe(true);
  });
});

describe("symmetry", () => {
  const center = [4, 5] as const;
  const sym = (segments: number, mirror: boolean): Symmetry => ({ segments, mirror, center });
  let n = 0;
  const id = () => `c${n++}`;

  it("returns just the original when off", () => {
    const s = path([4, 3, 4, 4]);
    expect(symmetryCopies(s, sym(1, false), id)).toEqual([s]);
  });

  it("makes N rotated copies, and 2N with mirroring", () => {
    const s = path([5, 3, 6, 4]);
    expect(symmetryCopies(s, sym(6, false), id)).toHaveLength(6);
    expect(symmetryCopies(s, sym(6, true), id)).toHaveLength(12);
    expect(new Set(symmetryCopies(s, sym(6, true), id).map((c) => c.id)).size).toBe(12);
  });

  it("rotates points about the centre", () => {
    const [, half] = symmetryCopies(path([4, 3]), sym(2, false), id) as PathShape[];
    expect(half!.points[0]).toBeCloseTo(4);
    expect(half!.points[1]).toBeCloseTo(7);
  });

  it("mirrors across the vertical axis", () => {
    const copies = symmetryCopies(path([5, 3]), sym(1, true), id) as PathShape[];
    expect(copies[1]!.points[0]).toBeCloseTo(3);
    expect(copies[1]!.points[1]).toBeCloseTo(3);
  });

  it("mirrors polygons to the exact reflected vertices", () => {
    const poly: PolygonShape = { type: "polygon", id: "g", cx: 6, cy: 5, radius: 1, sides: 5, rotation: 0.3, strokeWidth: 0.02 };
    const [, mirrored] = symmetryCopies(poly, sym(1, true), id);
    const expected = outline(poly).points.map(([x, y]) => [8 - x, y]);
    const actual = outline(mirrored!).points;
    for (const [ex, ey] of expected) {
      expect(actual.some(([x, y]) => Math.abs(x - ex!) < 1e-9 && Math.abs(y - ey!) < 1e-9)).toBe(true);
    }
  });

  it("never repeats text", () => {
    const t: Shape = { type: "text", id: "t", x: 1, y: 1, text: "Hi", fontSize: 0.5, font: "sans", strokeWidth: 0 };
    expect(symmetryCopies(t, sym(8, true), id)).toHaveLength(1);
  });
});

describe("editor history", () => {
  it("supports undo, redo, and drops redo after a new action", () => {
    const e = useEditor.getState();
    e.load("book:d1", []);
    const a = [path([0, 0])];
    const b = [...a, path([1, 1])];
    useEditor.getState().commit(a);
    useEditor.getState().commit(b);
    expect(useEditor.getState().undo()).toEqual(a);
    expect(useEditor.getState().undo()).toEqual([]);
    expect(useEditor.getState().undo()).toBeNull();
    expect(useEditor.getState().redo()).toEqual(a);
    useEditor.getState().commit([path([2, 2])]);
    expect(useEditor.getState().redo()).toBeNull();
  });

  it("records a continuous gesture as one step, and nothing if unchanged", () => {
    useEditor.setState({ designId: null });
    useEditor.getState().load("book:d2", [path([0, 0])]);
    const before = useEditor.getState().present;
    useEditor.getState().endGesture(before);
    expect(useEditor.getState().past).toHaveLength(0);
    useEditor.getState().replacePresent([]);
    useEditor.getState().replacePresent([]);
    useEditor.getState().endGesture(before);
    expect(useEditor.getState().past).toHaveLength(1);
    expect(useEditor.getState().undo()).toBe(before);
  });

  it("keeps history separate per book even when design ids match", () => {
    useEditor.getState().load("bookA:d1", [path([0, 0])]);
    useEditor.getState().load("bookB:d1", []);
    expect(useEditor.getState().present).toEqual([]);
  });
});
