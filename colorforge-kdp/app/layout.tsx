import type { Metadata, Viewport } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FontGate } from "@/components/FontGate";
import "./globals.css";

export const metadata: Metadata = {
  title: "ColorForge KDP",
  description: "Create KDP-compliant, print-ready coloring and puzzle book interiors in your browser.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        <TooltipProvider>
          <FontGate>{children}</FontGate>
        </TooltipProvider>
      </body>
    </html>
  );
}
