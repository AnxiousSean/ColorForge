import * as React from "react";
import { BOOK_FONTS, type Project, type Shape } from "@/lib/model";
import { cssFontStack, textToPathData } from "@/lib/fonts";
import { pathData, polygonVertices } from "@/lib/geometry";
import {
  FRAME_RATIO,
  cellCenter,
  getPageContext,
  layoutAnswerKey,
  layoutCopyrightPage,
  layoutPuzzlePage,
  layoutTitlePage,
  type GridLayout,
  type PageContext,
  type TextBox,
} from "@/lib/layout";
import type { ResolvedPage } from "@/lib/pages";
import type { SearchPuzzle } from "@/lib/puzzles/search-grid";

/**
 * Renders one physical page as SVG in PDF-page inches (viewBox units are
 * inches). The same markup drives the editor, thumbnails, and the PDF
 * export, so the preview is exactly what prints. Everything outside the
 * `data-print="false"` overlay group is print content.
 */

const INK = "#000";
const PUZZLE_FONT = cssFontStack("sans");

/**
 * Print mode: every glyph is drawn as a vector path instead of <text>, so
 * the PDF contains no fonts at all.
 */
export const OutlineContext = React.createContext(false);

const deg = (rad: number | undefined) => ((rad ?? 0) * 180) / Math.PI;
const n = (v: number) => Number(v.toFixed(4));

export function ShapeSvg({ shape }: { shape: Shape }) {
  const outlined = React.useContext(OutlineContext);
  const stroke = shape.erase ? "#fff" : INK;
  const common = {
    stroke,
    strokeWidth: shape.strokeWidth,
    fill: "none",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (shape.type) {
    case "path":
      return <path d={pathData(shape.points)} {...common} />;
    case "ellipse":
      return (
        <ellipse
          cx={n(shape.cx)}
          cy={n(shape.cy)}
          rx={n(shape.rx)}
          ry={n(shape.ry)}
          transform={shape.rotation ? `rotate(${n(deg(shape.rotation))} ${n(shape.cx)} ${n(shape.cy)})` : undefined}
          {...common}
        />
      );
    case "rect": {
      const cx = shape.x + shape.width / 2;
      const cy = shape.y + shape.height / 2;
      return (
        <rect
          x={n(shape.x)}
          y={n(shape.y)}
          width={n(shape.width)}
          height={n(shape.height)}
          transform={shape.rotation ? `rotate(${n(deg(shape.rotation))} ${n(cx)} ${n(cy)})` : undefined}
          {...common}
        />
      );
    }
    case "polygon":
      return <polygon points={polygonVertices(shape).map(([x, y]) => `${n(x)},${n(y)}`).join(" ")} {...common} />;
    case "trace": {
      const k = shape.width / shape.srcWidth;
      return (
        <path
          d={shape.pathData}
          fill={stroke}
          fillRule="evenodd"
          transform={`translate(${n(shape.x)} ${n(shape.y)}) scale(${Number(k.toPrecision(6))})`}
        />
      );
    }
    case "text":
      if (outlined) return <path d={textToPathData(shape.text, shape.x, shape.y, shape.fontSize, shape.font, 400)} fill={stroke} />;
      return (
        <text x={n(shape.x)} y={n(shape.y)} fontSize={shape.fontSize} fontFamily={BOOK_FONTS[shape.font].css} fill={stroke}>
          {shape.text}
        </text>
      );
  }
}

export function Text({ box, family = PUZZLE_FONT, fill = INK, transform }: { box: TextBox; family?: string; fill?: string; transform?: string }) {
  const outlined = React.useContext(OutlineContext);
  if (outlined) {
    return <path d={textToPathData(box.text, box.x, box.y, box.size, "sans", box.weight === "bold" ? 700 : 400, box.anchor)} fill={fill} transform={transform} />;
  }
  return (
    <text
      x={n(box.x)}
      y={n(box.y)}
      fontSize={n(box.size)}
      fontFamily={family}
      fontWeight={box.weight === "bold" ? 700 : 400}
      textAnchor={box.anchor}
      fill={fill}
      transform={transform}
    >
      {box.text}
    </text>
  );
}

export function Grid({ grid, puzzle, solution }: { grid: GridLayout; puzzle: SearchPuzzle; solution?: boolean }) {
  const outlined = React.useContext(OutlineContext);
  const frame = FRAME_RATIO * grid.cell;
  return (
    <g>
      {solution &&
        puzzle.placements.map((p, i) => {
          const [x1, y1] = cellCenter(grid, p.cells[0]![0], p.cells[0]![1]);
          const last = p.cells[p.cells.length - 1]!;
          const [x2, y2] = cellCenter(grid, last[0], last[1]);
          return (
            <line
              key={i}
              x1={n(x1)}
              y1={n(y1)}
              x2={n(x2)}
              y2={n(y2)}
              stroke="#d4d4d4"
              strokeWidth={n(grid.cell * 0.72)}
              strokeLinecap="round"
            />
          );
        })}
      <rect
        x={n(grid.x - frame)}
        y={n(grid.y - frame)}
        width={n(grid.cell * grid.cols + frame * 2)}
        height={n(grid.cell * grid.rows + frame * 2)}
        rx={n(frame)}
        fill="none"
        stroke={INK}
        strokeWidth={solution ? 0.01 : 0.02}
      />
      {outlined ? (
        // One path for the whole grid: hundreds of glyphs, one PDF object.
        <path
          d={puzzle.grid
            .flatMap((row, r) =>
              row.map((ch, c) => {
                const [x, y] = cellCenter(grid, r, c);
                return textToPathData(ch, x, y + grid.letterSize * 0.36, grid.letterSize, "sans", 400, "middle");
              }),
            )
            .join("")}
          fill={INK}
        />
      ) : (
        puzzle.grid.map((row, r) =>
          row.map((ch, c) => {
            const [x, y] = cellCenter(grid, r, c);
            return (
              <text
                key={`${r}-${c}`}
                x={n(x)}
                y={n(y + grid.letterSize * 0.36)}
                fontSize={n(grid.letterSize)}
                fontFamily={PUZZLE_FONT}
                textAnchor="middle"
                fill={INK}
              >
                {ch}
              </text>
            );
          }),
        )
      )}
    </g>
  );
}

function Content({ page, project, ctx }: { page: ResolvedPage; project: Project; ctx: PageContext }) {
  const area = ctx.recommended;
  switch (page.kind) {
    case "blank":
      return null;
    case "title":
      return (
        <g>
          {layoutTitlePage(project.title, project.subtitle, project.author, area).map((b, i) => (
            <Text key={i} box={b} />
          ))}
        </g>
      );
    case "copyright":
      return (
        <g>
          {layoutCopyrightPage(project.title, project.author, new Date(project.createdAt).getFullYear(), area).map((b, i) => (
            <Text key={i} box={b} />
          ))}
        </g>
      );
    case "design":
      return (
        <g transform={`translate(${ctx.trim.xIn} ${ctx.trim.yIn})`}>
          {page.item.shapes.map((s) => (
            <ShapeSvg key={s.id} shape={s} />
          ))}
        </g>
      );
    case "puzzle": {
      const puzzle = page.item.puzzle;
      if (!puzzle) return null;
      // Large-print convention: the word list is in capitals, like the grid.
      const layout = layoutPuzzlePage(puzzle, puzzle.placements.map((p) => p.display.toUpperCase()), page.heading, area);
      return (
        <g>
          <Text box={layout.title} />
          <Grid grid={layout.grid} puzzle={puzzle} />
          {layout.words.map((w, i) => (
            <Text key={i} box={w} />
          ))}
        </g>
      );
    }
    case "answer-key": {
      const solved = page.puzzles.filter((p) => p.item.puzzle);
      const layout = layoutAnswerKey(
        solved.map((p) => ({ rows: p.item.puzzle!.rows, cols: p.item.puzzle!.cols, label: p.heading })),
        page.perPage,
        area,
      );
      return (
        <g>
          <Text box={layout.heading} />
          {layout.slots.map((slot, i) => (
            <g key={i}>
              <Text box={slot.label} />
              <Grid grid={slot.grid} puzzle={solved[i]!.item.puzzle!} solution />
            </g>
          ))}
        </g>
      );
    }
  }
}

/** Trim, bleed, and margin guides. Never printed. */
export function Overlay({ ctx }: { ctx: PageContext }) {
  const { page, trim, kdpSafe, recommended } = ctx;
  const thin = { vectorEffect: "non-scaling-stroke" as const, fill: "none" };
  const gutterOnLeft = ctx.side === "recto";
  // Sit the label halfway into the gutter margin, clear of the page edge.
  const labelX = gutterOnLeft ? trim.xIn + 0.16 : trim.xIn + trim.widthIn - 0.16;
  return (
    <g data-print="false" pointerEvents="none">
      {ctx.hasBleed && (
        <path
          d={`M0 0H${page.widthIn}V${page.heightIn}H0Z M${trim.xIn} ${trim.yIn}v${trim.heightIn}h${trim.widthIn}v${-trim.heightIn}Z`}
          fill="rgba(239,68,68,0.12)"
          fillRule="evenodd"
        />
      )}
      <rect x={trim.xIn} y={trim.yIn} width={trim.widthIn} height={trim.heightIn} stroke="#0ea5e9" strokeWidth={1} {...thin} />
      <rect x={kdpSafe.xIn} y={kdpSafe.yIn} width={kdpSafe.widthIn} height={kdpSafe.heightIn} stroke="#ef4444" strokeWidth={1} strokeDasharray="6 4" {...thin} />
      <rect
        x={recommended.xIn}
        y={recommended.yIn}
        width={recommended.widthIn}
        height={recommended.heightIn}
        stroke="#22c55e"
        strokeWidth={1}
        strokeDasharray="2 3"
        {...thin}
      />
      <text
        x={labelX}
        y={trim.yIn + trim.heightIn / 2}
        fontSize={0.11}
        fill="#0ea5e9"
        fontFamily={PUZZLE_FONT}
        textAnchor="middle"
        transform={`rotate(${gutterOnLeft ? -90 : 90} ${labelX} ${trim.yIn + trim.heightIn / 2})`}
      >
        SPINE / GUTTER
      </text>
    </g>
  );
}

export interface PageSvgProps extends Omit<React.SVGProps<SVGSVGElement>, "children"> {
  project: Project;
  page: ResolvedPage;
  pageCount: number;
  showOverlay?: boolean;
  /** Draw text as vector outlines (print/PDF). Requires fonts to be loaded. */
  outlineText?: boolean;
  /** Extra layers drawn in trim space above the artwork (e.g. a live stroke). */
  children?: React.ReactNode;
}

export const PageSvg = React.forwardRef<SVGSVGElement, PageSvgProps>(function PageSvg(
  { project, page, pageCount, showOverlay = false, outlineText = false, children, ...rest },
  ref,
) {
  const ctx = getPageContext(project.trimSize, project.hasBleed, pageCount, page.slot.pageNumber);
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${ctx.page.widthIn} ${ctx.page.heightIn}`}
      width={`${ctx.page.widthIn}in`}
      height={`${ctx.page.heightIn}in`}
      {...rest}
    >
      <rect width={ctx.page.widthIn} height={ctx.page.heightIn} fill="#fff" />
      <OutlineContext.Provider value={outlineText}>
        <Content page={page} project={project} ctx={ctx} />
      </OutlineContext.Provider>
      {children && <g transform={`translate(${ctx.trim.xIn} ${ctx.trim.yIn})`}>{children}</g>}
      {showOverlay && <Overlay ctx={ctx} />}
    </svg>
  );
});
