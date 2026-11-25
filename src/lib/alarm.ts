const ENABLED_KEY = "tasklog:alarmEnabled";
const PLAYED_PREFIX = "tasklog:alarm:";

let audioContext: AudioContext | null = null;

function storage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function alarmEnabled(): boolean {
  return storage()?.getItem(ENABLED_KEY) !== "false";
}

export function setAlarmEnabled(enabled: boolean): void {
  try {
    storage()?.setItem(ENABLED_KEY, enabled ? "true" : "false");
  } catch {
    /* ignore storage errors */
  }
}

export function unlockAlarm(): void {
  if (typeof window === "undefined") return;
  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return;
  audioContext ??= new AudioContextCtor();
  if (audioContext.state === "suspended") void audioContext.resume();
}

export function playAlarm(): boolean {
  if (!alarmEnabled()) return false;
  unlockAlarm();
  if (!audioContext) return false;
  const ctx = audioContext;
  const start = ctx.currentTime;
  const tones = [
    { at: 0, frequency: 740 },
    { at: 0.26, frequency: 740 },
    { at: 0.52, frequency: 980 },
  ];
  for (const tone of tones) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = tone.frequency;
    gain.gain.setValueAtTime(0.0001, start + tone.at);
    gain.gain.exponentialRampToValueAtTime(0.28, start + tone.at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.at + 0.2);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(start + tone.at);
    oscillator.stop(start + tone.at + 0.22);
  }
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate([180, 80, 180, 80, 260]);
  }
  return true;
}

export function alarmPlayedKey(taskId: string, plannedTo: number): string {
  return `${taskId}:${plannedTo}`;
}

export function hasAlarmPlayed(key: string): boolean {
  try {
    return storage()?.getItem(`${PLAYED_PREFIX}${key}`) === "1";
  } catch {
    return false;
  }
}

export function markAlarmPlayed(key: string): void {
  try {
    storage()?.setItem(`${PLAYED_PREFIX}${key}`, "1");
  } catch {
    /* ignore storage errors */
  }
}

export function clearAlarmMarks(): void {
  const store = storage();
  if (!store) return;
  const keys: string[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key?.startsWith(PLAYED_PREFIX)) keys.push(key);
  }
  for (const key of keys) store.removeItem(key);
}
