"use client";

import { useEffect } from "react";
import { useApp } from "@/lib/store";
import { useSyncLoop } from "@/lib/sync";
import { ToastViewport } from "./toast";

export function Providers({ children }: { children: React.ReactNode }) {
  const hydrate = useApp((s) => s.hydrate);
  const setOnline = useApp((s) => s.setOnline);
  const hydrated = useApp((s) => s.hydrated);

  useEffect(() => {
    void hydrate();
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [hydrate, setOnline]);

  useSyncLoop();

  if (!hydrated) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-mist">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
          <p className="text-sm font-medium">Loading ICU TaskLog…</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {children}
      <ToastViewport />
    </>
  );
}
