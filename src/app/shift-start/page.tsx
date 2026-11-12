"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BedDouble, Clock3, Loader2, Moon, Play, Sun, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { InlineAlert } from "@/components/ui";
import { activeShift } from "@/lib/db";
import { DEMO_BEDS } from "@/lib/demo-data";
import { cn } from "@/lib/format";
import { useLive } from "@/lib/hooks";
import { endShift, startShift } from "@/lib/actions";
import { useApp } from "@/lib/store";

export default function ShiftStartPage() {
  const router = useRouter();
  const user = useApp((s) => s.user);
  const notify = useApp((s) => s.notify);
  const existing = useLive(
    async () => (user ? ((await activeShift(user.id)) ?? null) : undefined),
    [user?.id],
  );
  const [type, setType] = useState<"day" | "night" | "custom">("day");
  const [selected, setSelected] = useState<string[]>(DEMO_BEDS.map((b) => b.id));
  const [backdate, setBackdate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (user.role === "head_nurse") router.replace("/head");
  }, [user, router]);

  const selectedBeds = useMemo(
    () => DEMO_BEDS.filter((b) => selected.includes(b.id)),
    [selected],
  );
  const taskCount = selectedBeds.reduce((sum, bed) => sum + bed.templateIds.length, 0);

  async function begin() {
    if (!user) return;
    setBusy(true);
    try {
      await startShift(
        user,
        type,
        selectedBeds.map((b) => ({ id: b.id, label: b.label, alias: b.alias, templateIds: b.templateIds })),
        { backdateMin: backdate ? 120 : 0 },
      );
      notify(
        backdate
          ? "Demo shift started 2 hours ago so overdue and priority states are visible."
          : "Shift started. Tasks are loaded from demo orders.",
        "success",
      );
      router.push("/beds");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not start shift", "error");
    } finally {
      setBusy(false);
    }
  }

  async function finishExisting() {
    if (!existing) return;
    setEnding(true);
    try {
      await endShift(existing.id, "Ended from shift-start screen");
      router.push(`/summary?shift=${existing.id}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not end shift", "error");
    } finally {
      setEnding(false);
    }
  }

  return (
    <AppShell title="Start a shift" subtitle="Choose shift type and beds. Demo orders replace EHR sync." backHref="/beds">
      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-4">
          {existing ? (
            <InlineAlert tone="warning" title="A shift is already active">
              <p>
                You started a {existing.type} shift at{" "}
                {new Date(existing.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn-primary" onClick={() => router.push("/beds")}>
                  Continue shift <ArrowRight className="h-4 w-4" />
                </button>
                <button className="btn-secondary" onClick={finishExisting} disabled={ending}>
                  {ending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  End shift
                </button>
              </div>
            </InlineAlert>
          ) : null}

          <section className="card p-5">
            <h2 className="text-base font-bold text-ink">Shift type</h2>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                { value: "day" as const, label: "Day", Icon: Sun },
                { value: "night" as const, label: "Night", Icon: Moon },
                { value: "custom" as const, label: "Custom", Icon: Clock3 },
              ].map((item) => (
                <button
                  key={item.value}
                  onClick={() => setType(item.value)}
                  className={cn(
                    "flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-xl border text-sm font-semibold",
                    type === item.value
                      ? "border-teal-500 bg-teal-50 text-teal-800 ring-1 ring-teal-500/20"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                  )}
                >
                  <item.Icon className="h-5 w-5" aria-hidden />
                  {item.label}
                </button>
              ))}
            </div>
          </section>

          <section className="card p-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-ink">Beds</h2>
                <p className="text-xs text-slate-500">Demo bed nicknames. No patient names or identifiers.</p>
              </div>
              <button
                className="btn-ghost h-9 px-2 text-xs"
                onClick={() =>
                  setSelected(selected.length === DEMO_BEDS.length ? [] : DEMO_BEDS.map((b) => b.id))
                }
              >
                {selected.length === DEMO_BEDS.length ? "Clear" : "Select all"}
              </button>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {DEMO_BEDS.map((bed) => {
                const checked = selected.includes(bed.id);
                return (
                  <button
                    key={bed.id}
                    onClick={() =>
                      setSelected((prev) => (checked ? prev.filter((id) => id !== bed.id) : [...prev, bed.id]))
                    }
                    className={cn(
                      "flex min-h-[58px] items-center gap-3 rounded-xl border px-3 text-left",
                      checked ? "border-teal-400 bg-teal-50/60" : "border-slate-200 bg-white hover:bg-slate-50",
                    )}
                  >
                    <span
                      className={cn(
                        "grid h-5 w-5 place-items-center rounded-md border text-white",
                        checked ? "border-teal-600 bg-teal-600" : "border-slate-300 bg-white",
                      )}
                      aria-hidden
                    >
                      {checked ? "✓" : ""}
                    </span>
                    <BedDouble className={cn("h-4 w-4", checked ? "text-teal-600" : "text-slate-400")} aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-800">{bed.alias}</span>
                      <span className="text-[11px] text-slate-500">{bed.templateIds.length} demo tasks</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <label className="card flex cursor-pointer items-start gap-3 p-4">
            <input
              type="checkbox"
              checked={backdate}
              onChange={(e) => setBackdate(e.target.checked)}
              className="mt-0.5 h-5 w-5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            <span>
              <span className="block text-sm font-semibold text-slate-800">Demo: start 2 hours ago</span>
              <span className="block text-xs text-slate-500">
                Makes overdue tasks, tier ordering and handover data visible immediately. Turn off for a live
                shift.
              </span>
            </span>
          </label>

          <button
            className="btn-primary w-full text-base"
            onClick={begin}
            disabled={busy || existing !== null || selectedBeds.length === 0}
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
            {existing === undefined
              ? "Checking active shift…"
              : `Start ${type} shift · ${selectedBeds.length} beds · ${taskCount} tasks`}
          </button>
        </div>

        <div className="space-y-4">
          <InlineAlert tone="warning" title="Demo content needs clinical review">
            Task names, intervals, expected minutes and priority tiers are illustrative. An ICU nurse must
            review them before this is used in teaching or simulation.
          </InlineAlert>
          <div className="card p-5">
            <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">How this demo works</h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>• Tasks enter the queue at their due time from demo orders.</li>
              <li>• Tier 1–2 are never auto-deferred. Tier 3–4 can be deferred by an emergency.</li>
              <li>• Every tap is stored on this device first. The sync chip shows pending work.</li>
              <li>• Ratings are written by the head nurse; the app never computes a nurse score.</li>
            </ul>
          </div>
          <div className="card border-danger-100 bg-danger-50/40 p-5">
            <p className="flex items-center gap-2 text-sm font-bold text-danger-800">
              <TriangleAlert className="h-4 w-4" /> Safety boundary
            </p>
            <p className="mt-2 text-xs leading-relaxed text-danger-800/80">
              This prototype is not a medical device. It does not read monitors, alarms or physician orders.
              Always follow unit policy and the official record.
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
