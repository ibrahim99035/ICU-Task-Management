"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, KeyRound, Loader2, ShieldCheck, UserRound, WifiOff } from "lucide-react";
import { getAuth } from "@/lib/db";
import { useApp } from "@/lib/store";
import { Logo } from "@/components/ui";

const DEMO_ACCOUNTS = [
  { username: "amina", pin: "1111", name: "Amina", role: "Nurse" },
  { username: "yara", pin: "2222", name: "Yara", role: "Nurse" },
  { username: "omar", pin: "3333", name: "Omar", role: "Nurse" },
  { username: "head", pin: "9999", name: "Layla", role: "Head nurse" },
];

export default function LoginPage() {
  const router = useRouter();
  const user = useApp((s) => s.user);
  const hydrated = useApp((s) => s.hydrated);
  const login = useApp((s) => s.login);
  const resumeOffline = useApp((s) => s.resumeOffline);
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (hydrated && user) router.replace(user.role === "head_nurse" ? "/head" : "/beds");
  }, [hydrated, user, router]);

  useEffect(() => {
    void getAuth().then((auth) => setSaved(Boolean(auth)));
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(username.trim().toLowerCase(), pin);
      const next = useApp.getState().user;
      router.replace(next?.role === "head_nurse" ? "/head" : "/beds");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  }

  async function continueOffline() {
    setBusy(true);
    setError("");
    try {
      if (await resumeOffline()) {
        const next = useApp.getState().user;
        router.replace(next?.role === "head_nurse" ? "/head" : "/beds");
      } else {
        setError("No saved session on this device.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[1.05fr_1fr]">
      <section className="relative overflow-hidden bg-ink px-6 py-8 text-white sm:px-10 lg:flex lg:flex-col lg:justify-between lg:py-12">
        <div className="grain absolute inset-0 opacity-40" aria-hidden />
        <div className="relative flex items-center gap-3">
          <Logo size={44} light />
          <div>
            <p className="text-lg font-extrabold tracking-tight">ICU TaskLog</p>
            <p className="text-xs font-medium text-white/60">Planning, timing &amp; handover aid</p>
          </div>
        </div>

        <div className="relative mt-10 max-w-lg lg:mt-0">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-teal-200">
            Thesis demo · practice data only
          </p>
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
            Keep the critical work visible when the shift gets interrupted.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-white/70 sm:text-base">
            Plan ICU tasks by priority, time care from timestamps, protect tier 1–2 work during emergencies,
            and build a shift handover from what actually happened.
          </p>
          <div className="mt-7 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="text-xl font-bold text-teal-200">T1–T2</p>
              <p className="mt-0.5 text-xs text-white/60">Never auto-deferred</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="text-xl font-bold text-teal-200">Offline</p>
              <p className="mt-0.5 text-xs text-white/60">Saved on device first</p>
            </div>
          </div>
        </div>

        <div className="relative mt-10 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-xs leading-relaxed text-amber-100 lg:mt-0">
          <strong className="font-bold">Not a medical device.</strong> This app is a planning and logging aid. It
          does not replace bedside monitors, alarms or official orders. Do not enter patient names or identifiers.
        </div>
      </section>

      <section className="flex items-center justify-center px-4 py-8 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-6 lg:hidden">
            <p className="text-[11px] font-bold uppercase tracking-wider text-teal-700">ICU TaskLog</p>
            <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-ink">Welcome back</h2>
          </div>
          <div className="card p-5 sm:p-7">
            <div className="hidden lg:block">
              <h2 className="text-2xl font-extrabold tracking-tight text-ink">Sign in</h2>
              <p className="mt-1 text-sm text-slate-500">Use your demo nurse or head-nurse account.</p>
            </div>
            <form onSubmit={submit} className="mt-5 space-y-4">
              <div>
                <label htmlFor="username" className="label">
                  Username
                </label>
                <div className="relative">
                  <UserRound className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-slate-400" />
                  <input
                    id="username"
                    className="input pl-11"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    placeholder="amina"
                    required
                  />
                </div>
              </div>
              <div>
                <label htmlFor="pin" className="label">
                  PIN
                </label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-slate-400" />
                  <input
                    id="pin"
                    className="input pl-11 tracking-[0.35em]"
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="current-password"
                    placeholder="••••"
                    required
                  />
                </div>
              </div>
              {error ? (
                <div className="flex items-start gap-2 rounded-xl border border-danger-200 bg-danger-50 p-3 text-sm text-danger-800">
                  <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}
              <button type="submit" className="btn-primary w-full" disabled={busy || !username || !pin}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {busy ? "Signing in…" : "Sign in"}
                {!busy ? <ArrowRight className="h-4 w-4" /> : null}
              </button>
            </form>

            {saved ? (
              <button onClick={continueOffline} className="btn-secondary mt-3 w-full" disabled={busy}>
                <WifiOff className="h-4 w-4" />
                Continue with saved session
              </button>
            ) : null}

            <div className="mt-6 border-t border-slate-100 pt-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Demo accounts</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {DEMO_ACCOUNTS.map((account) => (
                  <button
                    key={account.username}
                    type="button"
                    onClick={() => {
                      setUsername(account.username);
                      setPin(account.pin);
                      setError("");
                    }}
                    className="flex min-h-12 items-center justify-between rounded-xl border border-slate-200 bg-white px-3 text-left text-xs hover:border-teal-300 hover:bg-teal-50/40"
                  >
                    <span>
                      <span className="block font-semibold text-slate-800">{account.name}</span>
                      <span className="text-[10px] uppercase tracking-wide text-slate-400">{account.role}</span>
                    </span>
                    <span className="font-mono text-[10px] text-slate-400">{account.pin}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className="mt-5 text-center text-[11px] leading-relaxed text-slate-400">
            By signing in you acknowledge this is a thesis prototype for practice data. It is not a medical device.
          </p>
        </div>
      </section>
    </div>
  );
}
