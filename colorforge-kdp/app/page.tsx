import { TRIM_SIZES, getPageDimensions } from "@/lib/kdp";

// Placeholder home page for Step 1. The project dashboard replaces it in Step 2.
export default function Home() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-3xl font-semibold">ColorForge KDP</h1>
      <p className="mt-2 text-neutral-600">Print-ready coloring book interiors, built in your browser.</p>
      <ul className="mt-6 space-y-1 text-sm">
        {Object.values(TRIM_SIZES).map((t) => {
          const bleed = getPageDimensions(t.id, true);
          return (
            <li key={t.id}>
              {t.label}: PDF page with bleed {bleed.widthIn}&quot; × {bleed.heightIn}&quot;
            </li>
          );
        })}
      </ul>
    </main>
  );
}
