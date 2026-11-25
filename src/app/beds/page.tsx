"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * The bed board was removed when the app moved to the agreed shift-level task
 * lists. Keep this route as a redirect for old links and bookmarks.
 */
export default function BedsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/tasks");
  }, [router]);

  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <p className="text-lg font-extrabold tracking-tight text-ink">TaskLog</p>
        <p className="mt-1 text-sm text-slate-500">The bed board was removed. Opening your task queue…</p>
        <div className="mx-auto mt-4 h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
      </div>
    </main>
  );
}
