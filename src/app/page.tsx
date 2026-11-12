"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/store";

export default function HomePage() {
  const router = useRouter();
  const user = useApp((s) => s.user);
  const hydrated = useApp((s) => s.hydrated);

  useEffect(() => {
    if (!hydrated) return;
    if (!user) router.replace("/login");
    else router.replace(user.role === "head_nurse" ? "/head" : "/beds");
  }, [hydrated, user, router]);

  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <p className="text-lg font-extrabold tracking-tight text-ink">ICU TaskLog</p>
        <p className="mt-1 text-sm text-slate-500">Planning and handover aid for practice data.</p>
        <div className="mx-auto mt-4 h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
      </div>
    </main>
  );
}
