"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CoverEditor } from "@/components/cover/CoverEditor";

function CoverRoute() {
  return <CoverEditor id={useSearchParams().get("id")} />;
}

export default function CoverPage() {
  return (
    <Suspense>
      <CoverRoute />
    </Suspense>
  );
}
