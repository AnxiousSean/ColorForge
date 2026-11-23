"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Circle,
  Eraser,
  Eye,
  EyeOff,
  Hexagon,
  ImagePlus,
  Minus,
  PenLine,
  Redo2,
  Scissors,
  Square,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import { GLOSSARY, KdpTerm } from "@/components/KdpTerm";
import { SaveIndicator } from "@/components/book/BookView";
import { ImportImageDialog } from "@/components/editor/ImportImageDialog";
import { PageSvg, ShapeSvg } from "@/components/render/PageSvg";
import { artworkBounds, hitTest, simplifyPoints, symmetryCopies, type Point, type Symmetry } from "@/lib/geometry";
import { getPageContext } from "@/lib/layout";
import { isRectInside, type Rect } from "@/lib/kdp";
import { BOOK_FONTS, newId, type BookFont, type DesignItem, type Project, type Shape } from "@/lib/model";
import type { ResolvedPage } from "@/lib/pages";
import { cn } from "@/lib/utils";
import { useEditor, type Tool } from "@/store/editor";
import { useProjects } from "@/store/projects";

const TOOLS: Array<{ tool: Tool; icon: React.ElementType; label: string; key: string }> = [
  { tool: "pen", icon: PenLine, label: "Pen", key: "p" },
  { tool: "line", icon: Minus, label: "Line (Shift snaps to 45°)", key: "l" },
  { tool: "rect", icon: Square, label: "Rectangle (Shift for square)", key: "r" },
  { tool: "ellipse", icon: Circle, label: "Ellipse (Shift for circle)", key: "o" },
  { tool: "polygon", icon: Hexagon, label: "Polygon: drag from the centre", key: "g" },
  { tool: "text", icon: Type, label: "Text: type in the panel, then click the page", key: "t" },
  { tool: "eraser", icon: Eraser, label: "Eraser: paints white over lines", key: "e" },
  { tool: "object-eraser", icon: Scissors, label: "Delete shapes: removes whole strokes you touch", key: "x" },
];

/** 0.75 pt is the thinnest line KDP reliably prints. */
const MIN_STROKE_IN = 0.75 / 72;
const ptLabel = (inches: number) => `${(inches * 72).toFixed(1)} pt`;

type DesignPage = Extract<ResolvedPage, { kind: "design" }>;

export function DesignEditor({ project, page, pageCount }: { project: Project; page: DesignPage; pageCount: number }) {
  const item = page.item;
  const editor = useEditor();
  const setDesignShapes = useProjects((s) => s.setDesignShapes);
  const renameItem = useProjects((s) => s.renameItem);
  const ctx = getPageContext(project.trimSize, project.hasBleed, pageCount, page.slot.pageNumber);

  const svgRef = React.useRef<SVGSVGElement>(null);
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const [draft, setDraft] = React.useState<Shape | null>(null);
  const [text, setText] = React.useState("");
  const [zoom, setZoom] = React.useState(1);
  const [importing, setImporting] = React.useState(false);
  const [fit, setFit] = React.useState({ width: 0, height: 0 });
  const gesture = React.useRef<{ start: Point; points: number[]; erasing: boolean; before: Shape[] } | null>(null);
  const historyKey = `${project.id}:${item.id}`;

  React.useEffect(() => editor.load(historyKey, item.shapes), [historyKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fit the page to the available space; zoom multiplies that.
  React.useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const pad = 32;
      const scale = Math.min((el.clientWidth - pad) / ctx.page.widthIn, (el.clientHeight - pad) / ctx.page.heightIn);
      setFit({ width: ctx.page.widthIn * scale, height: ctx.page.heightIn * scale });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ctx.page.widthIn, ctx.page.heightIn]);

  const shapes = editor.designId === historyKey ? editor.present : item.shapes;
  const center: Point = [ctx.trim.widthIn / 2, ctx.trim.heightIn / 2];
  const symmetry: Symmetry = { segments: editor.symmetrySegments, mirror: editor.symmetryMirror, center };

  const apply = (next: Shape[]) => setDesignShapes(item.id, editor.commit(next));
  const undo = () => {
    const prev = editor.undo();
    if (prev) setDesignShapes(item.id, prev);
  };
  const redo = () => {
    const next = editor.redo();
    if (next) setDesignShapes(item.id, next);
  };

  // Keyboard shortcuts.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (!mod && !e.altKey) {
        const t = TOOLS.find((t) => t.key === e.key.toLowerCase());
        if (t) editor.setTool(t.tool);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /** Pointer position in trim-space inches. */
  const toTrim = (e: React.PointerEvent): Point => {
    const svg = svgRef.current!;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM()!.inverse());
    return [p.x - ctx.trim.xIn, p.y - ctx.trim.yIn];
  };

  const makeShape = (start: Point, end: Point, shift: boolean, points: number[]): Shape | null => {
    const base = { id: newId("s"), strokeWidth: editor.strokeWidth };
    let [dx, dy] = [end[0] - start[0], end[1] - start[1]];
    switch (editor.tool) {
      case "pen":
        return { ...base, type: "path", points };
      case "eraser":
        return { ...base, type: "path", points, strokeWidth: editor.eraserWidth, erase: true };
      case "line": {
        if (shift) {
          const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
          const len = Math.hypot(dx, dy);
          [dx, dy] = [Math.cos(angle) * len, Math.sin(angle) * len];
        }
        return { ...base, type: "path", points: [start[0], start[1], start[0] + dx, start[1] + dy] };
      }
      case "rect":
      case "ellipse": {
        if (shift) {
          const side = Math.max(Math.abs(dx), Math.abs(dy));
          [dx, dy] = [Math.sign(dx || 1) * side, Math.sign(dy || 1) * side];
        }
        const x = Math.min(start[0], start[0] + dx);
        const y = Math.min(start[1], start[1] + dy);
        const w = Math.abs(dx);
        const h = Math.abs(dy);
        if (w < 0.02 && h < 0.02) return null;
        return editor.tool === "rect"
          ? { ...base, type: "rect", x, y, width: w, height: h }
          : { ...base, type: "ellipse", cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2 };
      }
      case "polygon": {
        const radius = Math.hypot(dx, dy);
        if (radius < 0.02) return null;
        return { ...base, type: "polygon", cx: start[0], cy: start[1], radius, sides: editor.polygonSides, rotation: Math.atan2(dy, dx) };
      }
      default:
        return null;
    }
  };

  const eraseAt = (p: Point) => {
    const current = useEditor.getState().present;
    const tolerance = 0.06 / zoom;
    const next = current.filter((s) => !hitTest(s, p, tolerance));
    if (next.length !== current.length) {
      useEditor.getState().replacePresent(next);
      setDesignShapes(item.id, next);
    }
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const p = toTrim(e);
    if (editor.tool === "text") {
      if (!text.trim()) return;
      const shape: Shape = { type: "text", id: newId("s"), x: p[0], y: p[1], text: text.trim(), fontSize: editor.fontSize, font: editor.font, strokeWidth: 0 };
      apply([...shapes, shape]);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { start: p, points: [p[0], p[1]], erasing: editor.tool === "object-eraser", before: shapes };
    if (editor.tool === "object-eraser") eraseAt(p);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g) return;
    const p = toTrim(e);
    if (g.erasing) {
      eraseAt(p);
      return;
    }
    if (editor.tool === "pen" || editor.tool === "eraser") {
      // Use coalesced events where available for smoother fast strokes.
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
      if (events.length > 1) {
        const svg = svgRef.current!;
        const m = svg.getScreenCTM()!.inverse();
        for (const ev of events) {
          const q = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m);
          g.points.push(q.x - ctx.trim.xIn, q.y - ctx.trim.yIn);
        }
      } else {
        g.points.push(p[0], p[1]);
      }
    }
    setDraft(makeShape(g.start, p, e.shiftKey, g.points));
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    gesture.current = null;
    setDraft(null);
    if (!g) return;
    if (g.erasing) {
      editor.endGesture(g.before); // the whole erase drag is one undo step
      return;
    }
    const end = toTrim(e);
    const points = editor.tool === "pen" || editor.tool === "eraser" ? simplifyPoints(g.points) : g.points;
    const shape = makeShape(g.start, end, e.shiftKey, points);
    if (!shape) return;
    apply([...shapes, ...symmetryCopies(shape, symmetry, () => newId("s"))]);
  };

  const draftCopies = draft ? symmetryCopies(draft, symmetry, () => "draft") : [];
  const marginStatus = checkMargins(shapes, ctx.trim, ctx.kdpSafe, ctx.recommended);

  return (
    <div className="flex h-dvh flex-col bg-neutral-100">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-neutral-200 bg-white px-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back to pages">
          <Link href={`/book?id=${encodeURIComponent(project.id)}`}>
            <ArrowLeft />
          </Link>
        </Button>
        <Input className="h-8 max-w-56" value={item.name} onChange={(e) => renameItem(item.id, e.target.value)} aria-label="Design name" />
        <span className="hidden text-xs text-neutral-500 sm:inline">
          Page {page.slot.pageNumber} ({ctx.side === "recto" ? "right" : "left"})
        </span>
        <div className="ml-auto flex items-center gap-1">
          <SaveIndicator />
          <Tooltip content="Undo (Ctrl/⌘+Z)">
            <Button variant="ghost" size="icon" onClick={undo} disabled={editor.past.length === 0} aria-label="Undo">
              <Undo2 />
            </Button>
          </Tooltip>
          <Tooltip content="Redo (Ctrl/⌘+Shift+Z)">
            <Button variant="ghost" size="icon" onClick={redo} disabled={editor.future.length === 0} aria-label="Redo">
              <Redo2 />
            </Button>
          </Tooltip>
          <Tooltip content={editor.showOverlay ? "Hide margin guides" : "Show margin guides"}>
            <Button variant="ghost" size="icon" onClick={() => editor.setOptions({ showOverlay: !editor.showOverlay })} aria-label="Toggle guides">
              {editor.showOverlay ? <Eye /> : <EyeOff />}
            </Button>
          </Tooltip>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-neutral-200 bg-white p-2 md:flex-col md:border-b-0 md:border-r" aria-label="Tools">
          {TOOLS.map(({ tool, icon: Icon, label, key }) => (
            <Tooltip key={tool} content={`${label} (${key.toUpperCase()})`} side="right">
              <button
                onClick={() => editor.setTool(tool)}
                aria-pressed={editor.tool === tool}
                aria-label={label}
                className={cn(
                  "rounded-md p-2",
                  editor.tool === tool ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100",
                )}
              >
                <Icon className="size-5" />
              </button>
            </Tooltip>
          ))}
          <div className="mx-1 w-px bg-neutral-200 md:mx-0 md:my-1 md:h-px md:w-auto" />
          <Tooltip content="Import image as line art" side="right">
            <button onClick={() => setImporting(true)} aria-label="Import image" className="rounded-md p-2 text-neutral-600 hover:bg-neutral-100">
              <ImagePlus className="size-5" />
            </button>
          </Tooltip>
        </nav>
        <ImportImageDialog
          open={importing}
          onOpenChange={setImporting}
          area={{ ...ctx.recommended, xIn: ctx.recommended.xIn - ctx.trim.xIn, yIn: ctx.recommended.yIn - ctx.trim.yIn }}
          onPlace={(shape) => apply([...shapes, shape])}
        />

        <div ref={viewportRef} className="relative min-h-[50vh] flex-1 overflow-auto">
          <div className="flex min-h-full min-w-full items-center justify-center p-4" style={{ width: fit.width * zoom + 32, height: fit.height * zoom + 32 }}>
            <PageSvg
              ref={svgRef}
              project={project}
              page={{ ...page, item: { ...item, shapes } as DesignItem }}
              pageCount={pageCount}
              showOverlay={editor.showOverlay}
              width={fit.width * zoom}
              height={fit.height * zoom}
              className={cn("shadow-lg", editor.tool === "text" ? "cursor-text" : "cursor-crosshair")}
              style={{ touchAction: "none" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => {
                if (gesture.current?.erasing) editor.endGesture(gesture.current.before);
                gesture.current = null;
                setDraft(null);
              }}
            >
              {editor.showOverlay && symmetry.segments > 1 && <SymmetryGuides symmetry={symmetry} radius={Math.max(ctx.trim.widthIn, ctx.trim.heightIn)} />}
              <g opacity={0.6}>
                {draftCopies.map((s, i) => (
                  <ShapeSvg key={i} shape={s} />
                ))}
              </g>
            </PageSvg>
          </div>
          <div className="absolute bottom-3 right-3 flex gap-1 rounded-md bg-white p-1 shadow">
            <Button variant="ghost" size="icon" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z / 1.25))}>
              <ZoomOut />
            </Button>
            <button className="px-1 text-xs tabular-nums text-neutral-600" onClick={() => setZoom(1)}>
              {Math.round(zoom * 100)}%
            </button>
            <Button variant="ghost" size="icon" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(6, z * 1.25))}>
              <ZoomIn />
            </Button>
          </div>
        </div>

        <aside className="w-full shrink-0 space-y-5 overflow-y-auto border-t border-neutral-200 bg-white p-4 md:w-72 md:border-l md:border-t-0">
          {marginStatus && (
            <div className={cn("flex gap-2 rounded-md p-3 text-xs", marginStatus.level === "error" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900")}>
              <AlertTriangle className="size-4 shrink-0" />
              <span>{marginStatus.message}</span>
            </div>
          )}

          <section className="space-y-2">
            <Label className="flex justify-between text-xs">
              Line weight <span className="font-mono text-neutral-500">{ptLabel(editor.strokeWidth)}</span>
            </Label>
            <input
              type="range"
              className="w-full"
              min={MIN_STROKE_IN}
              max={0.1}
              step={0.001}
              value={editor.strokeWidth}
              onChange={(e) => editor.setOptions({ strokeWidth: Number(e.target.value) })}
              aria-label="Line weight"
            />
            <div className="flex gap-1">
              {[
                ["Fine", 0.0125],
                ["Medium", 0.025],
                ["Bold", 0.04],
                ["Heavy", 0.065],
              ].map(([label, w]) => (
                <Button key={label} size="sm" variant={editor.strokeWidth === w ? "default" : "outline"} className="flex-1 px-1" onClick={() => editor.setOptions({ strokeWidth: w as number })}>
                  {label}
                </Button>
              ))}
            </div>
            <p className="text-[11px] text-neutral-500">Bold lines (2 pt or more) are easiest to color, especially for kids&apos; books.</p>
          </section>

          {editor.tool === "eraser" && (
            <section className="space-y-2">
              <Label className="flex justify-between text-xs">
                Eraser size <span className="font-mono text-neutral-500">{ptLabel(editor.eraserWidth)}</span>
              </Label>
              <input type="range" className="w-full" min={0.03} max={0.5} step={0.01} value={editor.eraserWidth} onChange={(e) => editor.setOptions({ eraserWidth: Number(e.target.value) })} aria-label="Eraser size" />
            </section>
          )}

          {editor.tool === "polygon" && (
            <section className="space-y-2">
              <Label className="text-xs">Sides: {editor.polygonSides}</Label>
              <input type="range" className="w-full" min={3} max={12} step={1} value={editor.polygonSides} onChange={(e) => editor.setOptions({ polygonSides: Number(e.target.value) })} aria-label="Polygon sides" />
            </section>
          )}

          {editor.tool === "text" && (
            <section className="space-y-2">
              <Label className="text-xs" htmlFor="text-value">
                Text, then click the page to place it
              </Label>
              <Input id="text-value" value={text} onChange={(e) => setText(e.target.value)} placeholder="Color me!" />
              <div className="flex gap-2">
                <Select value={editor.font} onChange={(e) => editor.setOptions({ font: e.target.value as BookFont })} aria-label="Font">
                  {Object.entries(BOOK_FONTS).map(([k, f]) => (
                    <option key={k} value={k}>
                      {f.label}
                    </option>
                  ))}
                </Select>
                <Select value={editor.fontSize} onChange={(e) => editor.setOptions({ fontSize: Number(e.target.value) })} aria-label="Font size">
                  {[0.25, 0.375, 0.5, 0.75, 1, 1.5].map((s) => (
                    <option key={s} value={s}>
                      {Math.round(s * 72)} pt
                    </option>
                  ))}
                </Select>
              </div>
              <p className="text-[11px] text-neutral-500">Text is converted to outlines on export, so KDP never sees a missing font.</p>
            </section>
          )}

          <section className="space-y-3 rounded-md border border-neutral-200 p-3">
            <h3 className="text-sm font-semibold">Symmetry / mandala</h3>
            <Label className="flex justify-between text-xs">
              Segments <span className="text-neutral-500">{editor.symmetrySegments === 1 ? "off" : editor.symmetrySegments}</span>
            </Label>
            <input type="range" className="w-full" min={1} max={24} step={1} value={editor.symmetrySegments} onChange={(e) => editor.setOptions({ symmetrySegments: Number(e.target.value) })} aria-label="Symmetry segments" />
            <label className="flex items-center justify-between text-xs">
              Mirror each segment
              <Switch checked={editor.symmetryMirror} onCheckedChange={(v) => editor.setOptions({ symmetryMirror: v })} />
            </label>
            <div className="flex flex-wrap gap-1">
              {[
                ["Off", 1, false],
                ["Mirror", 1, true],
                ["6", 6, true],
                ["8", 8, true],
                ["12", 12, true],
              ].map(([label, seg, mirror]) => (
                <Button key={label as string} size="sm" variant="outline" className="px-2" onClick={() => editor.setOptions({ symmetrySegments: seg as number, symmetryMirror: mirror as boolean })}>
                  {label}
                </Button>
              ))}
            </div>
            <p className="text-[11px] text-neutral-500">Copies rotate around the centre of the page.</p>
          </section>

          <section className="space-y-2 text-xs text-neutral-600">
            <h3 className="text-sm font-semibold text-neutral-900">Guides</h3>
            <p className="flex items-center gap-2"><span className="inline-block h-0 w-5 border-t border-sky-500" /> <KdpTerm term="trim">Trim (cut) line</KdpTerm></p>
            <p className="flex items-center gap-2"><span className="inline-block h-0 w-5 border-t border-dashed border-red-500" /> <KdpTerm term="safe">KDP minimum margin</KdpTerm></p>
            <p className="flex items-center gap-2"><span className="inline-block h-0 w-5 border-t border-dotted border-green-500" /> Recommended margin</p>
            {project.hasBleed && <p className="flex items-center gap-2"><span className="inline-block h-3 w-5 bg-red-500/15" /> <KdpTerm term="bleed">Bleed (trimmed off)</KdpTerm></p>}
            <Tooltip content={GLOSSARY.gutter}>
              <p className="cursor-help">The gutter side is labelled on the page.</p>
            </Tooltip>
          </section>

          <Button
            variant="outline"
            className="w-full text-red-600 hover:bg-red-50"
            disabled={shapes.length === 0}
            onClick={() => confirm("Clear everything on this page? You can undo this.") && apply([])}
          >
            <Trash2 /> Clear page
          </Button>
        </aside>
      </div>
    </div>
  );
}

function SymmetryGuides({ symmetry, radius }: { symmetry: Symmetry; radius: number }) {
  const [cx, cy] = symmetry.center;
  const lines = Array.from({ length: symmetry.segments }, (_, k) => {
    const a = (2 * Math.PI * k) / symmetry.segments - Math.PI / 2;
    return [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius] as const;
  });
  return (
    <g data-print="false" pointerEvents="none" stroke="#38bdf8" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="4 4">
      {lines.map(([x, y], i) => (
        <line key={i} x1={cx} y1={cy} x2={x} y2={y} vectorEffect="non-scaling-stroke" />
      ))}
      <circle cx={cx} cy={cy} r={0.04} fill="#38bdf8" stroke="none" />
    </g>
  );
}

function checkMargins(shapes: readonly Shape[], trim: Rect, kdpSafe: Rect, recommended: Rect): { level: "error" | "warning"; message: string } | null {
  const b = artworkBounds(shapes);
  if (!b) return null;
  const onPage: Rect = { ...b, xIn: b.xIn + trim.xIn, yIn: b.yIn + trim.yIn };
  if (!isRectInside(onPage, kdpSafe)) {
    return { level: "error", message: "Some lines are outside KDP's minimum margin (red dashed line). KDP will reject the file until they are moved or erased." };
  }
  if (!isRectInside(onPage, recommended)) {
    return { level: "warning", message: "Some lines are between the recommended and minimum margins. This is allowed, but they could end up very close to the edge or spine." };
  }
  return null;
}
