"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  KeyRound,
  Loader2,
  ShieldCheck,
  UserPlus,
  UserRound,
  WifiOff,
} from "lucide-react";
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
  const register = useApp((s) => s.register);
  const resumeOffline = useApp((s) => s.resumeOffline);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (hydrated && user) {
      router.replace(
        mode === "register" ? "/shift-start" : user.role === "head_nurse" ? "/head" : "/beds",
      );
    }
  }, [hydrated, user, router, mode]);

  useEffect(() => {
    void getAuth().then((auth) => setSaved(Boolean(auth)));
  }, []);

  function switchMode(next: "login" | "register") {
    if (next === mode) return;
    setMode(next);
    setError("");
    setPin("");
    setConfirmPin("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (mode === "register" && pin !== confirmPin) {
      setError("The PINs do not match.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "register") {
        await register(username.trim().toLowerCase(), displayName.trim(), pin);
        router.replace("/shift-start");
      } else {
        await login(username.trim().toLowerCase(), pin);
        const next = useApp.getState().user;
        router.replace(next?.role === "head_nurse" ? "/head" : "/beds");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not continue");
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
            <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-ink">
              {mode === "login" ? "Welcome back" : "Create account"}
            </h2>
          </div>
          <div className="card p-5 sm:p-7">
            <div
              role="tablist"
              aria-label="Account access"
              className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === "login"}
                onClick={() => switchMode("login")}
                className={
                  mode === "login"
                    ? "min-h-12 rounded-lg bg-white px-3 text-sm font-semibold text-ink shadow-sm"
                    : "min-h-12 rounded-lg px-3 text-sm font-semibold text-slate-500 hover:text-ink"
                }
              >
                Sign in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "register"}
                onClick={() => switchMode("register")}
                className={
                  mode === "register"
                    ? "min-h-12 rounded-lg bg-white px-3 text-sm font-semibold text-ink shadow-sm"
                    : "min-h-12 rounded-lg px-3 text-sm font-semibold text-slate-500 hover:text-ink"
                }
              >
                Create account
              </button>
            </div>

            <div className="mt-5 hidden lg:block">
              <h2 className="text-2xl font-extrabold tracking-tight text-ink">
                {mode === "login" ? "Sign in" : "Create account"}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {mode === "login"
                  ? "Use your demo nurse or head-nurse account."
                  : "Create a nurse account. Head-nurse accounts are provisioned by the study team."}
              </p>
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
                    autoCapitalize="none"
                    spellCheck={false}
                    minLength={3}
                    maxLength={40}
                    placeholder={mode === "login" ? "amina" : "nurse01"}
                    required
                  />
                </div>
              </div>

              {mode === "register" ? (
                <div>
                  <label htmlFor="display-name" className="label">
                    Display name or initials
                  </label>
                  <div className="relative">
                    <UserRound className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-slate-400" />
                    <input
                      id="display-name"
                      className="input pl-11"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      autoComplete="name"
                      maxLength={40}
                      placeholder="Nurse A."
                      required
                    />
                  </div>
                </div>
              ) : null}

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
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                    inputMode="numeric"
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    minLength={4}
                    maxLength={8}
                    placeholder="••••"
                    required
                  />
                </div>
              </div>

              {mode === "register" ? (
                <>
                  <div>
                    <label htmlFor="confirm-pin" className="label">
                      Confirm PIN
                    </label>
                    <div className="relative">
                      <KeyRound className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-slate-400" />
                      <input
                        id="confirm-pin"
                        className="input pl-11 tracking-[0.35em]"
                        value={confirmPin}
                        onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                        inputMode="numeric"
                        autoComplete="new-password"
                        minLength={4}
                        maxLength={8}
                        placeholder="Repeat PIN"
                        required
                      />
                    </div>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-500">
                    Use 4–8 digits. There is no email recovery. Use initials or an alias if you prefer; never
                    enter patient identifiers.
                  </p>
                </>
              ) : null}

              {error ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-xl border border-danger-200 bg-danger-50 p-3 text-sm text-danger-800"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}

              <button
                type="submit"
                className="btn-primary w-full"
                disabled={
                  busy ||
                  !username ||
                  !pin ||
                  (mode === "register" && (!displayName || confirmPin.length < 4))
                }
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : mode === "login" ? (
                  <ShieldCheck className="h-4 w-4" />
                ) : (
                  <UserPlus className="h-4 w-4" />
                )}
                {busy
                  ? mode === "login"
                    ? "Signing in…"
                    : "Creating account…"
                  : mode === "login"
                    ? "Sign in"
                    : "Create nurse account"}
                {!busy && mode === "login" ? <ArrowRight className="h-4 w-4" /> : null}
              </button>
            </form>

            {mode === "login" && saved ? (
              <button onClick={continueOffline} className="btn-secondary mt-3 w-full" disabled={busy}>
                <WifiOff className="h-4 w-4" />
                Continue with saved session
              </button>
            ) : null}

            {mode === "login" ? (
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
            ) : null}
          </div>
          <p className="mt-5 text-center text-[11px] leading-relaxed text-slate-400">
            By continuing you acknowledge this is a thesis prototype for practice data. It is not a medical
            device.
          </p>
        </div>
      </section>
    </div>
  );
}
