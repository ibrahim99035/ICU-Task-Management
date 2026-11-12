"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  CloudOff,
  Download,
  LayoutGrid,
  ListChecks,
  RefreshCw,
  UserRound,
} from "lucide-react";
import { activeShift } from "@/lib/db";
import { cn, formatElapsed, initials } from "@/lib/format";
import { useLive, useNow } from "@/lib/hooks";
import { useApp } from "@/lib/store";
import { syncNow } from "@/lib/sync";
import { Logo } from "./ui";

const NURSE_NAV = [
  { href: "/beds", label: "Beds", Icon: LayoutGrid },
  { href: "/tasks", label: "Tasks", Icon: ListChecks },
  { href: "/handover", label: "Handover", Icon: ClipboardCheck },
  { href: "/me", label: "Me", Icon: UserRound },
];
const HEAD_NAV = [
  { href: "/head", label: "Dashboard", Icon: BarChart3 },
  { href: "/head/shifts", label: "Shifts", Icon: CalendarDays },
  { href: "/head/export", label: "Export", Icon: Download },
  { href: "/me", label: "Me", Icon: UserRound },
];

function navFor(role: string | undefined) {
  return role === "head_nurse" ? HEAD_NAV : NURSE_NAV;
}

function isActive(pathname: string, href: string) {
  if (href === "/head") return pathname === "/head" || pathname === "/head/";
  if (href === "/head/shifts") return pathname.startsWith("/head/shift");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SyncChip() {
  const online = useApp((s) => s.online);
  const pending = useApp((s) => s.pending);
  const syncing = useApp((s) => s.syncing);
  const expired = useApp((s) => s.sessionExpired);
  const user = useApp((s) => s.user);
  const label = expired
    ? "Sign in to sync"
    : !online
      ? "Offline"
      : syncing
        ? "Syncing…"
        : pending > 0
          ? `${pending} pending`
          : "Synced";
  const Icon = expired || !online ? CloudOff : syncing ? RefreshCw : pending > 0 ? CloudOff : CheckCircle2;
  return (
    <button
      onClick={() => void syncNow()}
      disabled={!user || user.role !== "nurse" || syncing}
      className={cn(
        "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold",
        !online || pending > 0
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : expired
            ? "border-danger-200 bg-danger-50 text-danger-700"
            : "border-teal-200 bg-teal-50 text-teal-800",
      )}
      title="Sync status. Tap to sync now."
    >
      <Icon className={cn("h-3.5 w-3.5", syncing && "animate-spin")} aria-hidden />
      {label}
    </button>
  );
}

export function AppShell({
  title,
  subtitle,
  children,
  actions,
  backHref,
  activeOverride,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  backHref?: string;
  activeOverride?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useApp((s) => s.user);
  const hydrated = useApp((s) => s.hydrated);
  const now = useNow(1000);
  const shift = useLive(
    () => (user ? activeShift(user.id) : Promise.resolve(undefined)),
    [user?.id],
  );
  const nav = navFor(user?.role);

  useEffect(() => {
    if (hydrated && !user) router.replace("/login");
  }, [hydrated, user, router]);

  if (!hydrated || !user) return null;

  return (
    <div className="min-h-dvh">
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white/95 px-4 py-5 lg:flex">
        <Link href={user.role === "head_nurse" ? "/head" : "/beds"} className="flex items-center gap-3 px-2">
          <Logo size={40} />
          <div>
            <p className="text-[15px] font-extrabold tracking-tight text-ink">ICU TaskLog</p>
            <p className="text-[11px] font-medium text-slate-500">Planning &amp; handover aid</p>
          </div>
        </Link>
        <nav className="mt-8 flex flex-col gap-1">
          {nav.map((item) => {
            const active = isActive(pathname, item.href) || activeOverride === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex min-h-touch items-center gap-3 rounded-xl px-3 text-sm font-semibold transition",
                  active ? "bg-teal-50 text-teal-800" : "text-slate-600 hover:bg-slate-100",
                )}
              >
                <item.Icon className="h-[18px] w-[18px]" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Shift clock</p>
            <p className="mt-1 font-mono text-lg font-bold text-ink">
              {shift ? formatElapsed(now - shift.startedAt) : "No active shift"}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {shift ? `${shift.type} shift · started ${new Date(shift.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Start a shift from Beds"}
            </p>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-900">
            <strong className="font-bold">Planning aid only.</strong> Not a bedside monitor, alarm or official
            order system. Practice data only.
          </div>
          <div className="flex items-center gap-2 px-1 text-xs text-slate-500">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-ink text-[11px] font-bold text-white">
              {initials(user.displayName)}
            </span>
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-700">{user.displayName}</p>
              <p className="capitalize">{user.role.replace("_", " ")}</p>
            </div>
          </div>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="no-print safe-top sticky top-0 z-20 border-b border-slate-200/80 bg-mist/90 px-4 pb-3 pt-3 backdrop-blur-md sm:px-6">
          <div className="mx-auto flex max-w-6xl items-center gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {backHref ? (
                <Link
                  href={backHref}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-600 hover:bg-white"
                  aria-label="Go back"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Link>
              ) : (
                <span className="lg:hidden">
                  <Logo size={38} />
                </span>
              )}
              <div className="min-w-0">
                <h1 className="truncate text-xl font-extrabold tracking-tight text-ink sm:text-2xl">{title}</h1>
                {subtitle ? <p className="truncate text-xs text-slate-500 sm:text-sm">{subtitle}</p> : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {actions}
              <SyncChip />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 pb-32 pt-4 sm:px-6 lg:pb-12">
          {children}
          <div className="mt-8 hidden rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-center text-[11px] leading-relaxed text-slate-500 lg:block">
            ICU TaskLog is a planning and logging aid. It does not replace bedside monitors, alarms or official
            orders. Every rating is written manually by the head nurse; the app does not rank staff.
          </div>
        </main>
      </div>

      <nav className="no-print safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-2 pt-1.5 backdrop-blur-md lg:hidden">
        <div className="mx-auto flex max-w-md items-stretch gap-1">
          {nav.map((item) => {
            const active = isActive(pathname, item.href) || activeOverride === item.href;
            return (
              <Link key={item.href} href={item.href} className={cn("tab-item", active && "tab-item-active")}>
                <item.Icon className="h-5 w-5" aria-hidden />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
        <p className="mx-auto max-w-md pb-1.5 pt-1 text-center text-[9px] font-medium leading-tight text-slate-400">
          Planning aid only · not a monitor, alarm or order system
        </p>
      </nav>
    </div>
  );
}
