import type { Cat } from "./lotteryEngine";

export type LotterySession = {
  queue: Cat[];
  index: number;
  wonUids: string[];
  log: {
    at: string;
    catId: string;
    catLabel: string;
    winners: { rank: "正取" | "備取1" | "備取2"; name: string; uid: string }[];
  }[];
};

const KEY = "cat_lottery_session_v1";

export function loadSession(): LotterySession | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LotterySession;
  } catch {
    return null;
  }
}

export function saveSession(s: LotterySession) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(s));
}

export function clearSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}
