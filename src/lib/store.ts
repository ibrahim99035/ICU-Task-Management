"use client";

import { create } from "zustand";
import { clearAuth, db, getAuth, setAuth, type AuthRecord, type SessionUser } from "./db";
import { loginRequest, registerRequest } from "./api";

type Toast = { id: number; message: string; tone: "info" | "success" | "warning" | "error" };

type AppState = {
  user: SessionUser | null;
  token: string | null;
  hydrated: boolean;
  online: boolean;
  syncing: boolean;
  pending: number;
  lastSync: number | null;
  syncError: string | null;
  sessionExpired: boolean;
  toast: Toast | null;
  hydrate: () => Promise<void>;
  login: (username: string, pin: string) => Promise<void>;
  register: (username: string, displayName: string, pin: string) => Promise<void>;
  resumeOffline: () => Promise<boolean>;
  logout: () => Promise<void>;
  setOnline: (online: boolean) => void;
  setSync: (partial: Partial<Pick<AppState, "syncing" | "pending" | "lastSync" | "syncError">>) => void;
  setSessionExpired: (value: boolean) => void;
  notify: (message: string, tone?: Toast["tone"]) => void;
  clearToast: () => void;
};

function storeToken(token: string) {
  try {
    localStorage.setItem("icu_token", token);
  } catch {
    /* native adapter replaces this later */
  }
}
function removeToken() {
  try {
    localStorage.removeItem("icu_token");
  } catch {
    /* ignore */
  }
}

export const useApp = create<AppState>((set, get) => ({
  user: null,
  token: null,
  hydrated: false,
  online: typeof navigator !== "undefined" ? navigator.onLine : true,
  syncing: false,
  pending: 0,
  lastSync: null,
  syncError: null,
  sessionExpired: false,
  toast: null,

  hydrate: async () => {
    const auth = await getAuth();
    const online = typeof navigator !== "undefined" ? navigator.onLine : true;
    set({ user: auth?.user ?? null, token: auth?.token ?? null, hydrated: true, online });
    if (auth) {
      storeToken(auth.token);
      const pending = await db().outbox.count();
      set({ pending });
    }
  },

  login: async (username, pin) => {
    const response = await loginRequest(username, pin);
    const previous = await getAuth();
    if (previous && previous.user.id !== response.user.id) {
      await db().events.clear();
      await db().tasks.clear();
      await db().outbox.clear();
      await db().reviews.clear();
      await db().handovers.clear();
      await db().shifts.clear();
      await db().beds.clear();
    }
    const record: AuthRecord = { user: response.user, token: response.token, savedAt: Date.now() };
    await setAuth(record);
    storeToken(response.token);
    set({ user: response.user, token: response.token, sessionExpired: false, syncError: null });
  },

  register: async (username, displayName, pin) => {
    const response = await registerRequest(username, displayName, pin);
    const previous = await getAuth();
    if (previous && previous.user.id !== response.user.id) {
      await db().events.clear();
      await db().tasks.clear();
      await db().outbox.clear();
      await db().reviews.clear();
      await db().handovers.clear();
      await db().shifts.clear();
      await db().beds.clear();
    }
    const record: AuthRecord = { user: response.user, token: response.token, savedAt: Date.now() };
    await setAuth(record);
    storeToken(response.token);
    set({ user: response.user, token: response.token, sessionExpired: false, syncError: null });
  },

  resumeOffline: async () => {
    const auth = await getAuth();
    if (!auth) return false;
    set({ user: auth.user, token: auth.token, hydrated: true });
    return true;
  },

  logout: async () => {
    await clearAuth();
    removeToken();
    set({ user: null, token: null, pending: 0, lastSync: null, syncError: null, sessionExpired: false });
  },

  setOnline: (online) => set({ online }),
  setSync: (partial) => set(partial),
  setSessionExpired: (value) => set({ sessionExpired: value }),
  notify: (message, tone = "info") => {
    const id = Date.now();
    set({ toast: { id, message, tone } });
    window.setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, 3800);
  },
  clearToast: () => set({ toast: null }),
}));
