import * as React from "react";
import { Grid, OutlineContext, ShapeSvg, Text } from "@/components/render/PageSvg";
import { layoutCover, spineRotation, type CoverLayoutResult } from "@/lib/cover";
import { getTrimSize, type Rect } from "@/lib/kdp";
import type { Project } from "@/lib/model";

/**
 * The full paperback cover wrap as SVG in cover inches. Shared by the cover
 * editor preview, the cover PDF and the front-cover PNG.
 */

const n = (v: number) => Number(v.toFixed(4));

function CoverArt({ project, panel }: { project: Project; panel: Rect }) {
  const item = project.items.find((i) => i.id === project.cover.artItemId);
  if (!item) return null;
  const pad = 0.2;
  const box = { x: panel.xIn + pad, y: panel.yIn + pad, w: panel.widthIn - 2 * pad, h: panel.heightIn - 2 * pad };

  if (item.kind === "design") {
    const trim = getTrimSize(project.trimSize);
    const k = Math.min(box.w / trim.widthIn, box.h / trim.heightIn);
    const ox = box.x + (box.w - trim.widthIn * k) / 2;
    const oy = box.y + (box.h - trim.heightIn * k) / 2;
    return (
      <g transform={`translate(${n(ox)} ${n(oy)}) scale(${n(k)})`}>
        {item.shapes.map((s) => (
          <ShapeSvg key={s.id} shape={s} />
        ))}
      </g>
    );
  }

  const puzzle = item.puzzle;
  if (!puzzle) return null;
  const cell = Math.min(box.w / (puzzle.cols + 0.4), box.h / (puzzle.rows + 0.4));
  const gw = cell * puzzle.cols;
  const gh = cell * puzzle.rows;
  return (
    <Grid
      grid={{ x: box.x + (box.w - gw) / 2, y: box.y + (box.h - gh) / 2, cell, rows: puzzle.rows, cols: puzzle.cols, letterSize: cell * 0.58 }}
      puzzle={puzzle}
      solution
    />
  );
}

function Guides({ layout }: { layout: CoverLayoutResult }) {
  const g = layout.geometry;
  const thin = { vectorEffect: "non-scaling-stroke" as const, fill: "none", strokeWidth: 1 };
  const rect = (r: Rect, stroke: string, dash?: string) => (
    <rect x={r.xIn} y={r.yIn} width={r.widthIn} height={r.heightIn} stroke={stroke} strokeDasharray={dash} {...thin} />
  );
  return (
    <g data-print="false" pointerEvents="none">
      <path
        d={`M0 0H${g.widthIn}V${g.heightIn}H0Z M${g.trim.xIn} ${g.trim.yIn}v${g.trim.heightIn}h${g.trim.widthIn}v${-g.trim.heightIn}Z`}
        fill="rgba(239,68,68,0.22)"
        fillRule="evenodd"
      />
      {rect(g.trim, "#0ea5e9")}
      {rect(g.spine, "#0ea5e9", "4 3")}
      {rect(g.frontSafe, "#22c55e", "2 3")}
      {rect(g.backSafe, "#22c55e", "2 3")}
      {g.spineSafe.widthIn > 0 && rect(g.spineSafe, "#22c55e", "2 3")}
      <rect x={g.barcode.xIn} y={g.barcode.yIn} width={g.barcode.widthIn} height={g.barcode.heightIn} stroke="#f59e0b" {...thin} fill="#ffffff" />
      <text x={g.barcode.xIn + g.barcode.widthIn / 2} y={g.barcode.yIn + g.barcode.heightIn / 2 + 0.05} fontSize={0.14} textAnchor="middle" fill="#b45309" fontFamily="sans-serif">
        Barcode area
      </text>
    </g>
  );
}

export interface CoverSvgProps extends Omit<React.SVGProps<SVGSVGElement>, "children"> {
  project: Project;
  pageCount: number;
  showGuides?: boolean;
  outlineText?: boolean;
  /** Crop to the front cover's trim box (for the PNG). */
  frontOnly?: boolean;
}

export const CoverSvg = React.forwardRef<SVGSVGElement, CoverSvgProps>(function CoverSvg(
  { project, pageCount, showGuides = false, outlineText = false, frontOnly = false, ...rest },
  ref,
) {
  const layout = layoutCover(project, pageCount);
  const g = layout.geometry;
  const c = project.cover;
  const view = frontOnly ? g.front : { xIn: 0, yIn: 0, widthIn: g.widthIn, heightIn: g.heightIn };
  const panel = layout.artPanel;

  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`${n(view.xIn)} ${n(view.yIn)} ${n(view.widthIn)} ${n(view.heightIn)}`}
      width={`${n(view.widthIn)}in`}
      height={`${n(view.heightIn)}in`}
      {...rest}
    >
      <OutlineContext.Provider value={outlineText}>
        <rect width={g.widthIn} height={g.heightIn} fill={c.background} />

        {/* Front */}
        {layout.title.map((b, i) => (
          <Text key={`t${i}`} box={b} fill={c.textColor} />
        ))}
        {layout.subtitle.map((b, i) => (
          <Text key={`s${i}`} box={b} fill={c.textColor} />
        ))}
        <rect x={n(panel.xIn)} y={n(panel.yIn)} width={n(panel.widthIn)} height={n(panel.heightIn)} rx={0.15} fill={c.panelColor} />
        <CoverArt project={project} panel={panel} />
        {layout.author && <Text box={layout.author} fill={c.textColor} />}

        {/* Spine */}
        {layout.spine && <Text box={layout.spine} fill={c.textColor} transform={spineRotation(layout.spine)} />}

        {/* Back */}
        {layout.backTitle && <Text box={layout.backTitle} fill={c.textColor} />}
        {layout.blurb.map((b, i) => (
          <Text key={`b${i}`} box={b} fill={c.textColor} />
        ))}
      </OutlineContext.Provider>
      {showGuides && <Guides layout={layout} />}
    </svg>
  );
});
