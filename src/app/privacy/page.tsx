"use client";

import { AppShell } from "@/components/app-shell";
import { InlineAlert } from "@/components/ui";
import { Database, Eye, LockKeyhole, ShieldCheck, Smartphone, Trash2, UserRound } from "lucide-react";

const ROWS = [
  {
    icon: <UserRound className="h-4 w-4" />,
    title: "Account",
    local: "Username, display name, role, participant code and a 30-minute session token.",
    server: "Username, bcrypt PIN hash, display name, role and participant code.",
  },
  {
    icon: <Database className="h-4 w-4" />,
    title: "Shift activity",
    local: "Every event is written to IndexedDB (Dexie) first: task start, pause, resume, completion, deferral, emergency, interruption, handover and shift end.",
    server: "Events are appended after sync with the original device timestamp and a server receipt time. The head nurse can see finished shift events.",
  },
  {
    icon: <Smartphone className="h-4 w-4" />,
    title: "Beds",
    local: "Bed number and a short nickname you type. No name, MRN, date of birth, photo or hospital ID.",
    server: "Bed label and nickname only. The nickname is free text, so the UI warns you not to type identifiers.",
  },
  {
    icon: <Eye className="h-4 w-4" />,
    title: "Head-nurse reviews",
    local: "Reviews for your own shifts, synced from the server.",
    server: "Five manual 1–5 ratings, a comment and a support flag. No computed score, ranking or leaderboard.",
  },
  {
    icon: <Trash2 className="h-4 w-4" />,
    title: "Deletion",
    local: "Signing out clears local events, tasks, handovers, shifts, beds and the session from this browser.",
    server: "Server records remain for the thesis analysis. There is no self-service server deletion in this demo.",
  },
];

export default function PrivacyPage() {
  return (
    <AppShell title="Privacy & data" subtitle="What this prototype stores, and what it does not" backHref="/me">
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-3">
          <InlineAlert tone="warning" title="No patient identifiers">
            <p>
              Do not type patient names, MRNs, hospital numbers, dates of birth, phone numbers or photos. Beds are a
              number plus a short nickname only. A free-text nickname cannot be reliably checked by rule-based code;
              this remains a human-input risk.
            </p>
          </InlineAlert>

          {ROWS.map((row) => (
            <section key={row.title} className="card p-4">
              <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-500">{row.icon}</span>
                {row.title}
              </h2>
              <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="font-bold uppercase tracking-wide text-slate-400">On this device</p>
                  <p className="mt-1 leading-relaxed text-slate-600">{row.local}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="font-bold uppercase tracking-wide text-slate-400">On the server</p>
                  <p className="mt-1 leading-relaxed text-slate-600">{row.server}</p>
                </div>
              </div>
            </section>
          ))}
        </div>

        <div className="space-y-3">
          <section className="card p-5">
            <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
              <LockKeyhole className="h-4 w-4" /> Access and security
            </h2>
            <ul className="mt-3 space-y-2 text-xs leading-relaxed text-slate-600">
              <li>• PINs are hashed with bcrypt on the server. The PIN itself is never stored.</li>
              <li>• Sessions use a signed JWT that expires after 30 minutes.</li>
              <li>• A nurse can only push events to their own shift; the API rejects another nurse's shift ID.</li>
              <li>• Head-nurse endpoints require the head-nurse role.</li>
              <li>• Offline actions stay on the device until a valid session can sync them.</li>
              <li>• This demo runs over HTTPS. It does not use biometric or OAuth login.</li>
            </ul>
          </section>

          <section className="card p-5">
            <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
              <ShieldCheck className="h-4 w-4" /> Who sees what
            </h2>
            <ul className="mt-3 space-y-2 text-xs leading-relaxed text-slate-600">
              <li>• <strong>Nurse:</strong> own beds, tasks, event log, handovers, summaries, surveys and own manual reviews.</li>
              <li>• <strong>Head nurse:</strong> finished shifts, event logs, timestamp summaries, handover snapshots and manual review screen.</li>
              <li>• <strong>No one:</strong> patient identifiers, a computed nurse score or a leaderboard — those are out of scope.</li>
            </ul>
          </section>

          <section className="card border-amber-200 bg-amber-50/50 p-4 text-xs leading-relaxed text-amber-900">
            <p className="flex items-center gap-2 font-bold"><ShieldCheck className="h-4 w-4" /> Not a medical device</p>
            <p className="mt-1.5">
              ICU TaskLog plans and logs practice tasks. It does not read monitors or alarms, does not replace
              official orders or the medical record, and must not be used for real patient care.
            </p>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
