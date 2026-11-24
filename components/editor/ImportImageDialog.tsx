"use client";

import * as React from "react";
import { AlertTriangle, ImagePlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { Rect } from "@/lib/kdp";
import { newId, type TraceShape } from "@/lib/model";
import { DEFAULT_TRACE, fitWithin, otsuThreshold, suggestEdgeThreshold, toGray, traceBitmap, type Bitmap, type TraceMode, type TraceOptions } from "@/lib/trace";
import { cn } from "@/lib/utils";

const PREVIEW_SIDE = 480;
const FINAL_SIDE = 1400;
const MAX_FILE_BYTES = 30 * 1024 * 1024;
/** Path data beyond this makes pages slow to edit and export. */
const HEAVY_PATH_CHARS = 2_500_000;

/** Decodes the file; the caller owns (and later revokes) the object URL. */
async function decode(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  try {
    await img.decode();
    return img;
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

function rasterize(img: HTMLImageElement, maxSide: number): Bitmap {
  const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight, maxSide);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, width, height);
  g.drawImage(img, 0, 0, width, height);
  const { data } = g.getImageData(0, 0, width, height);
  return { width, height, data };
}

export function ImportImageDialog({
  open,
  onOpenChange,
  area,
  onPlace,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Where to place the art, in trim-space inches. */
  area: Rect;
  onPlace: (shape: TraceShape) => void;
}) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [img, setImg] = React.useState<HTMLImageElement | null>(null);
  const [preview, setPreview] = React.useState<Bitmap | null>(null);
  const [opts, setOpts] = React.useState<TraceOptions>(DEFAULT_TRACE);
  const [scale, setScale] = React.useState(1);
  const [error, setError] = React.useState<string | null>(null);
  const [placing, setPlacing] = React.useState(false);
  const [deferred, setDeferred] = React.useState(opts);

  // Re-trace the preview shortly after the sliders stop moving.
  React.useEffect(() => {
    const t = setTimeout(() => setDeferred(opts), 120);
    return () => clearTimeout(t);
  }, [opts]);

  const result = React.useMemo(() => (preview ? traceBitmap(preview, deferred) : null), [preview, deferred]);

  // Release the previous image's object URL whenever it is replaced or the dialog closes.
  React.useEffect(() => () => {
    if (img) URL.revokeObjectURL(img.src);
  }, [img]);

  React.useEffect(() => {
    if (!open) {
      setImg(null);
      setPreview(null);
      setError(null);
    }
  }, [open]);

  async function choose(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!/^image\/(png|jpe?g|webp|gif|bmp)$/.test(file.type)) return setError("Choose a PNG, JPG, WebP, GIF or BMP image.");
    if (file.size > MAX_FILE_BYTES) return setError("That image is over 30 MB. Use a smaller copy.");
    try {
      const image = await decode(file);
      const bmp = rasterize(image, PREVIEW_SIDE);
      setImg(image);
      setPreview(bmp);
      // Start from the threshold that best separates ink from paper.
      setOpts((o) => ({ ...o, mode: "ink", threshold: otsuThreshold(toGray(bmp)) }));
    } catch {
      setError("This image could not be read.");
    }
  }

  async function place() {
    if (!img) return;
    setPlacing(true);
    await new Promise((r) => setTimeout(r, 30)); // let the spinner paint
    try {
      const full = rasterize(img, FINAL_SIDE);
      // Despeckle and smoothing are in pixels: scale them to the larger bitmap.
      const k = full.width / (preview?.width ?? full.width);
      const traced = traceBitmap(full, { ...opts, despeckle: opts.despeckle * k * k, smoothing: opts.smoothing * Math.max(1, k / 1.5), thickness: Math.round(opts.thickness * k) });
      const fit = Math.min(area.widthIn / traced.width, area.heightIn / traced.height) * scale;
      const width = traced.width * fit;
      const height = traced.height * fit;
      onPlace({
        type: "trace",
        id: newId("s"),
        strokeWidth: 0,
        x: area.xIn + (area.widthIn - width) / 2,
        y: area.yIn + (area.heightIn - height) / 2,
        width,
        height,
        srcWidth: traced.width,
        srcHeight: traced.height,
        pathData: traced.pathData,
      });
      onOpenChange(false);
    } finally {
      setPlacing(false);
    }
  }

  const set = (patch: Partial<TraceOptions>) => setOpts((o) => ({ ...o, ...patch }));
  const tooDark = result && result.inkRatio > 0.55;
  const heavy = result && result.pathData.length * ((FINAL_SIDE / PREVIEW_SIDE) ** 1.2) > HEAVY_PATH_CHARS;

  return (
    <Dialog open={open} onOpenChange={(o) => !placing && onOpenChange(o)}>
      <DialogContent className="max-w-3xl">
        <DialogTitle>Import image as line art</DialogTitle>
        <DialogDescription>
          The picture is traced into vector outlines, so it prints sharply and no pixels end up in your PDF.
        </DialogDescription>

        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" className="hidden" onChange={(e) => choose(e.target.files?.[0])} />

        {!preview ? (
          <button
            className="mt-4 flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-neutral-300 p-10 text-sm text-neutral-600 hover:border-neutral-500"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void choose(e.dataTransfer.files[0]);
            }}
          >
            <ImagePlus className="size-8 text-neutral-400" />
            Choose an image, or drop it here
            <span className="text-xs text-neutral-400">Line drawings and scans work best. Photos are turned into outlines.</span>
          </button>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-[1fr_240px]">
            <div className="grid grid-cols-2 gap-2">
              <figure className="rounded border border-neutral-200 bg-white p-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img!.src} alt="Original" className="aspect-square w-full object-contain" />
                <figcaption className="text-center text-[11px] text-neutral-500">Original</figcaption>
              </figure>
              <figure className="rounded border border-neutral-200 bg-white p-1">
                <svg viewBox={`0 0 ${preview.width} ${preview.height}`} className="aspect-square w-full" role="img" aria-label="Traced line art">
                  <path d={result?.pathData} fill="#000" fillRule="evenodd" />
                </svg>
                <figcaption className="text-center text-[11px] text-neutral-500">
                  Vector line art · {result?.loops ?? 0} outlines
                </figcaption>
              </figure>
            </div>

            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-1 rounded-md bg-neutral-100 p-1 text-xs" role="radiogroup" aria-label="Trace mode">
                {(
                  [
                    ["ink", "Line drawing"],
                    ["outline", "Photo → outlines"],
                  ] as Array<[TraceMode, string]>
                ).map(([m, label]) => (
                  <button
                    key={m}
                    role="radio"
                    aria-checked={opts.mode === m}
                    onClick={() => preview && set({ mode: m, threshold: m === "ink" ? otsuThreshold(toGray(preview)) : suggestEdgeThreshold(preview) })}
                    className={cn("rounded px-2 py-1.5", opts.mode === m ? "bg-white shadow-sm" : "text-neutral-600")}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <Slider label={opts.mode === "ink" ? "Threshold" : "Edge sensitivity"} value={opts.threshold} min={1} max={254} onChange={(v) => set({ threshold: v })} />
              {opts.mode === "outline" && <Slider label="Line thickness" value={opts.thickness} min={0} max={4} onChange={(v) => set({ thickness: v })} />}
              <Slider label="Remove specks" value={opts.despeckle} min={0} max={200} onChange={(v) => set({ despeckle: v })} />
              <Slider label="Smoothing" value={opts.smoothing} min={0} max={3} step={0.1} onChange={(v) => set({ smoothing: v })} />
              <label className="flex items-center justify-between text-xs">
                Invert (light lines on dark)
                <Switch checked={opts.invert} onCheckedChange={(v) => set({ invert: v })} />
              </label>
              <div>
                <Label className="text-xs">Size on page</Label>
                <div className="mt-1 flex gap-1">
                  {[1, 0.75, 0.5].map((s) => (
                    <Button key={s} size="sm" variant={scale === s ? "default" : "outline"} className="flex-1" onClick={() => setScale(s)}>
                      {s === 1 ? "Fill" : `${s * 100}%`}
                    </Button>
                  ))}
                </div>
              </div>
              {tooDark && (
                <p className="flex gap-1.5 text-xs text-amber-800">
                  <AlertTriangle className="size-4 shrink-0" /> Mostly black: lower the threshold, try Invert, or switch to Photo → outlines.
                </p>
              )}
              {heavy && (
                <p className="flex gap-1.5 text-xs text-amber-800">
                  <AlertTriangle className="size-4 shrink-0" /> Very detailed: raise Remove specks or Smoothing to keep the page fast.
                </p>
              )}
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex justify-between gap-2">
          {preview ? (
            <Button variant="ghost" onClick={() => fileRef.current?.click()}>
              Choose another
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={!preview || placing || !result?.loops} onClick={place}>
              {placing && <Loader2 className="animate-spin" />} Place on page
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Slider({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <label className="block text-xs">
      <span className="flex justify-between">
        {label} <span className="tabular-nums text-neutral-500">{value}</span>
      </span>
      <input type="range" className="mt-1 w-full" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
    </label>
  );
}
