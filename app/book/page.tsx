"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { BookView } from "@/components/book/BookView";

function BookRoute() {
  return <BookView id={useSearchParams().get("id")} />;
}

export default function BookPage() {
  return (
    <Suspense>
      <BookRoute />
    </Suspense>
  );
}
