"use client";

import * as React from "react";
import { PageSvg, type PageSvgProps } from "@/components/render/PageSvg";
import type { ResolvedPage } from "@/lib/pages";

type Props = PageSvgProps & { aspect: number };

function samePage(a: ResolvedPage, b: ResolvedPage): boolean {
  if (a.kind !== b.kind || a.slot.pageNumber !== b.slot.pageNumber) return false;
  if ((a.kind === "design" || a.kind === "puzzle") && (b.kind === "design" || b.kind === "puzzle")) {
    return a.item === b.item && a.index === b.index;
  }
  if (a.kind === "answer-key" && b.kind === "answer-key") {
    return a.puzzles.length === b.puzzles.length && a.puzzles.every((p, i) => p.item === b.puzzles[i]!.item && p.index === b.puzzles[i]!.index);
  }
  return true;
}

/** Re-render only when something this page draws has changed. */
function propsEqual(a: Props, b: Props): boolean {
  const pa = a.project;
  const pb = b.project;
  return (
    a.aspect === b.aspect &&
    a.pageCount === b.pageCount &&
    a.showOverlay === b.showOverlay &&
    pa.trimSize === pb.trimSize &&
    pa.hasBleed === pb.hasBleed &&
    pa.type === pb.type &&
    pa.title === pb.title &&
    pa.subtitle === pb.subtitle &&
    pa.author === pb.author &&
    samePage(a.page, b.page)
  );
}

/**
 * Renders a page only once it scrolls near the viewport. A 100-puzzle book
 * has ~30,000 SVG text nodes, so thumbnails must not all mount at once.
 */
export const LazyPage = React.memo(function LazyPage(props: Props) {
  const { aspect, ...pageProps } = props;
  const ref = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  return (
    <div ref={ref} className="w-full bg-white" style={{ aspectRatio: aspect }}>
      {visible && <PageSvg {...pageProps} width="100%" height="100%" className="block" />}
    </div>
  );
}, propsEqual);
