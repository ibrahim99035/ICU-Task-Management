"use client";

import { AlertCircle, CheckCircle2, Info, X, TriangleAlert } from "lucide-react";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/format";

export function ToastViewport() {
  const toast = useApp((s) => s.toast);
  const clear = useApp((s) => s.clearToast);
  if (!toast) return null;
  const Icon =
    toast.tone === "success"
      ? CheckCircle2
      : toast.tone === "error"
        ? AlertCircle
        : toast.tone === "warning"
          ? TriangleAlert
          : Info;
  return (
    <div className="no-print pointer-events-none fixed inset-x-0 bottom-24 z-[70] flex justify-center px-4 sm:bottom-8">
      <div
        role="status"
        className={cn(
          "pointer-events-auto flex max-w-md items-start gap-3 rounded-2xl border px-4 py-3 text-sm font-medium shadow-xl",
          toast.tone === "success" && "border-teal-200 bg-teal-50 text-teal-900",
          toast.tone === "error" && "border-danger-200 bg-danger-50 text-danger-800",
          toast.tone === "warning" && "border-amber-200 bg-amber-50 text-amber-900",
          toast.tone === "info" && "border-slate-200 bg-white text-slate-800",
        )}
      >
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>{toast.message}</span>
        <button
          onClick={clear}
          className="ml-2 grid h-6 w-6 shrink-0 place-items-center rounded-md hover:bg-black/5"
          aria-label="Dismiss message"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
