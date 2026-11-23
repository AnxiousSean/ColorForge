"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { fontsLoaded, loadFonts } from "@/lib/fonts";

/**
 * Loads the bundled fonts before any page renders, so layout always uses
 * the real glyph widths. Fonts are small local files, so this is brief.
 */
export function FontGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<"loading" | "ready" | "error">(() => (fontsLoaded() ? "ready" : "loading"));

  React.useEffect(() => {
    if (state !== "loading") return;
    loadFonts().then(
      () => setState("ready"),
      () => setState("error"),
    );
  }, [state]);

  if (state === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center text-neutral-400">
        <Loader2 className="animate-spin" />
      </div>
    );
  }
  return (
    <>
      {state === "error" && (
        <div className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
          The print fonts could not be loaded, so previews are approximate and PDF export is unavailable.{" "}
          <button className="underline" onClick={() => setState("loading")}>
            Try again
          </button>
        </div>
      )}
      {children}
    </>
  );
}
