"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, ClipboardCheck, Info, Loader2, RotateCcw, Send, WifiOff } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { InlineAlert } from "@/components/ui";
import { scoreRawTLX, scoreSUS } from "@/domain";
import { postSurvey } from "@/lib/api";
import { db } from "@/lib/db";
import { cn } from "@/lib/format";
import { useApp } from "@/lib/store";
import { scheduleSync, syncNow } from "@/lib/sync";

const SUS_QUESTIONS = [
  "I think that I would like to use this system frequently.",
  "I found the system unnecessarily complex.",
  "I thought the system was easy to use.",
  "I think that I would need the support of a technical person to be able to use this system.",
  "I found the various functions in this system were well integrated.",
  "I thought there was too much inconsistency in this system.",
  "I would imagine that most people would learn to use this system very quickly.",
  "I found the system very cumbersome to use.",
  "I felt very confident using the system.",
  "I needed to learn a lot of things before I could get going with this system.",
];

const TLX_SCALES = [
  { key: "mental", title: "Mental demand", left: "Low", right: "High" },
  { key: "physical", title: "Physical demand", left: "Low", right: "High" },
  { key: "temporal", title: "Temporal demand", left: "Low", right: "High" },
  { key: "performance", title: "Performance", left: "Good", right: "Poor" },
  { key: "effort", title: "Effort", left: "Low", right: "High" },
  { key: "frustration", title: "Frustration", left: "Low", right: "High" },
];

type Instrument = "SUS" | "TLX";

export default function SurveysPage() {
  const router = useRouter();
  const user = useApp((s) => s.user);
  const token = useApp((s) => s.token);
  const notify = useApp((s) => s.notify);
  const [instrument, setInstrument] = useState<Instrument>("SUS");
  const [phase, setPhase] = useState<"paper" | "app">("app");
  const [sus, setSus] = useState<number[]>(Array(10).fill(0));
  const [tlx, setTlx] = useState<number[]>(Array(6).fill(50));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ score: number; queued: boolean; instrument: Instrument } | null>(null);

  useEffect(() => {
    if (!user) router.replace("/login");
  }, [user, router]);

  if (!user) {
    return null;
  }

  const susReady = sus.every((value) => value >= 1 && value <= 5);
  const score = instrument === "SUS" ? (susReady ? scoreSUS(sus) : 0) : scoreRawTLX(tlx);

  async function submit() {
    if (instrument === "SUS" && !susReady) return;
    setBusy(true);
    const id = crypto.randomUUID();
    const body = {
      id,
      instrument,
      phase,
      answers: instrument === "SUS" ? sus : tlx,
      takenAt: Date.now(),
    };
    try {
      if (!token) throw new Error("No session token");
      await postSurvey(token, body);
      setResult({ score: instrument === "SUS" ? scoreSUS(sus) : scoreRawTLX(tlx), queued: false, instrument });
      notify("Survey submitted. Thank you.", "success");
    } catch (error) {
      await db().outbox.put({
        id,
        kind: "survey",
        payload: body,
        createdAt: Date.now(),
      });
      scheduleSync();
      setResult({ score: instrument === "SUS" ? scoreSUS(sus) : scoreRawTLX(tlx), queued: true, instrument });
      notify("Survey saved on this device and will sync when a session is available.", "warning");
    } finally {
      setBusy(false);
    }
  }

  async function submitQueued() {
    await syncNow();
  }

  return (
    <AppShell
      title="Evaluation surveys"
      subtitle="SUS and raw NASA-TLX · anonymous participant code only"
      backHref="/me"
    >
      {result ? (
        <div className="mx-auto max-w-xl">
          <div className="card p-6 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-teal-50 text-teal-700">
              <CheckCircle2 className="h-7 w-7" />
            </span>
            <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-ink">
              {result.instrument === "SUS" ? "SUS" : "Raw NASA-TLX"} recorded
            </h1>
            <p className="mt-2 text-5xl font-extrabold tabular-nums text-teal-700">{result.score.toFixed(1)}</p>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
              {result.instrument === "SUS" ? "System Usability Scale · 0–100" : "Unweighted mean · 0–100"}
            </p>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-slate-500">
              {result.instrument === "SUS"
                ? "SUS is reported as a single number from the ten standard items. Higher is easier to use. It is not a nurse performance score."
                : "Raw TLX is the unweighted mean of the six scales. Higher means more workload. The weighted TLX is out of scope."}
            </p>
            {result.queued ? (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="flex items-center justify-center gap-1.5 font-semibold"><WifiOff className="h-3.5 w-3.5" /> Waiting to sync</p>
                <p className="mt-1">Saved locally. It will upload with the next valid session.</p>
                <button className="btn-secondary mt-2 min-h-9 text-xs" onClick={() => void submitQueued()}>Try sync now</button>
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-400">Participant {user.participantCode} · {phase} phase</p>
            )}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <button className="btn-primary" onClick={() => { setResult(null); setSus(Array(10).fill(0)); setTlx(Array(6).fill(50)); }}>
                <RotateCcw className="h-4 w-4" /> Submit another
              </button>
              <Link className="btn-secondary" href="/me">Back to me</Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="mx-auto max-w-3xl space-y-4">
          <InlineAlert tone="info" title="Use the standard wording">
            <p>
              Answer for the app you just used. Do not write patient identifiers. Your participant code is{" "}
              <strong className="font-mono">{user.participantCode}</strong>. Both roles may submit SUS; raw TLX is
              shown for workload.
            </p>
          </InlineAlert>

          <section className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-ink">Instrument</h2>
              <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1">
                {(["SUS", "TLX"] as Instrument[]).map((item) => (
                  <button
                    key={item}
                    onClick={() => setInstrument(item)}
                    className={cn(
                      "min-h-9 rounded-lg px-3 text-xs font-bold",
                      instrument === item ? "bg-white text-ink shadow-sm" : "text-slate-500",
                    )}
                  >
                    {item === "SUS" ? "SUS · usability" : "Raw TLX · workload"}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">Phase</span>
              {(["paper", "app"] as const).map((item) => (
                <button
                  key={item}
                  onClick={() => setPhase(item)}
                  className={cn(
                    "min-h-9 rounded-full border px-3 text-xs font-semibold capitalize",
                    phase === item ? "border-teal-500 bg-teal-50 text-teal-800" : "border-slate-200 bg-white text-slate-500",
                  )}
                >
                  {item === "paper" ? "Paper baseline" : "App"}
                </button>
              ))}
            </div>
          </section>

          {instrument === "SUS" ? (
            <section className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-sm font-bold text-ink">10 standard SUS items</h2>
                <span className="text-xs font-semibold text-slate-500">{sus.filter(Boolean).length}/10</span>
              </div>
              {SUS_QUESTIONS.map((question, index) => (
                <div key={question} className="card p-4">
                  <p className="text-sm font-medium leading-snug text-slate-800">
                    <span className="mr-2 font-bold text-slate-400">{index + 1}.</span>
                    {question}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="hidden w-24 text-right text-[10px] font-semibold uppercase text-slate-400 sm:block">Strongly disagree</span>
                    <div className="grid flex-1 grid-cols-5 gap-1.5">
                      {[1, 2, 3, 4, 5].map((value) => (
                        <button
                          key={value}
                          onClick={() => setSus((prev) => prev.map((v, i) => (i === index ? value : v)))}
                          className={cn(
                            "min-h-11 rounded-xl border text-sm font-bold",
                            sus[index] === value
                              ? "border-teal-600 bg-teal-600 text-white"
                              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                          )}
                          aria-label={`${value} for item ${index + 1}`}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                    <span className="hidden w-24 text-[10px] font-semibold uppercase text-slate-400 sm:block">Strongly agree</span>
                  </div>
                </div>
              ))}
            </section>
          ) : (
            <section className="card space-y-5 p-5">
              <div>
                <h2 className="text-sm font-bold text-ink">Raw NASA-TLX</h2>
                <p className="text-xs text-slate-500">Six unweighted 0–100 scales. No pairwise weighting in this study.</p>
              </div>
              {TLX_SCALES.map((scale, index) => (
                <div key={scale.key}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label htmlFor={`tlx-${scale.key}`} className="text-sm font-semibold text-slate-700">{scale.title}</label>
                    <span className="rounded-lg bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold text-slate-700">{tlx[index]}</span>
                  </div>
                  <input
                    id={`tlx-${scale.key}`}
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={tlx[index]}
                    onChange={(e) => setTlx((prev) => prev.map((v, i) => (i === index ? Number(e.target.value) : v)))}
                    className="h-8 w-full accent-teal-600"
                  />
                  <div className="flex justify-between text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    <span>{scale.left}</span>
                    <span>{scale.right}</span>
                  </div>
                </div>
              ))}
            </section>
          )}

          <div className="sticky bottom-28 z-10 lg:bottom-4">
            <div className="card flex items-center gap-3 p-3 shadow-lg">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Current score</p>
                <p className="text-xl font-extrabold tabular-nums text-ink">
                  {instrument === "SUS" ? (susReady ? score.toFixed(1) : "—") : score.toFixed(1)}
                </p>
              </div>
              <button className="btn-primary" disabled={busy || (instrument === "SUS" && !susReady)} onClick={() => void submit()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Submit survey
              </button>
            </div>
          </div>

          <p className="flex items-start gap-2 pb-4 text-[11px] leading-relaxed text-slate-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Scores are computed with the standard SUS and raw-TLX formulas in the shared domain package. They are
            not used to rate or rank nurses.
          </p>
        </div>
      )}
    </AppShell>
  );
}
