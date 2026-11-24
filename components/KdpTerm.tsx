"use client";

import { Info } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";

/** Plain-language explanations of KDP jargon, shown as tooltips. */
export const GLOSSARY = {
  bleed:
    "Bleed: artwork that runs past the edge of the page. The printer trims it off so ink goes right to the edge. KDP adds 0.125\" on the top, bottom and outside edge. Coloring and puzzle books rarely need it, so it is off by default.",
  gutter:
    "Gutter: the inside margin next to the spine. Thicker books need a wider gutter because more of the page disappears into the binding.",
  trim: "Trim size: the final size of the printed book after cutting, e.g. 8.5\" × 11\".",
  safe: "Safe area: keep all lines and text inside this box. The red line is KDP's hard limit; the green line is the recommended margin that gives extra room.",
  backing:
    "Blank backing page: an empty page printed behind each design so markers that soak through don't ruin the next picture. Standard for coloring books.",
  answerKey: "Answer key: solution pages at the back of puzzle books, starting on a right-hand page.",
  pageCount: "KDP needs at least 24 pages and an even total. Blank pages are added for you, within KDP's limit on blank pages in a row.",
} as const;

export function KdpTerm({ term, children }: { term: keyof typeof GLOSSARY; children?: React.ReactNode }) {
  return (
    <Tooltip content={GLOSSARY[term]}>
      <span className="inline-flex cursor-help items-center gap-1 underline decoration-dotted underline-offset-2">
        {children}
        <Info className="size-3.5 text-neutral-400" aria-hidden />
      </span>
    </Tooltip>
  );
}
