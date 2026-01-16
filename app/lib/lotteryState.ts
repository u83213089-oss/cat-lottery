export type WinnerRow = {
  rank: "正取" | "備取1" | "備取2";
  name: string;
  uid: string;
};

export type DisplayState = {
  catLabel: string;
  winners: WinnerRow[];
  updatedAt: string; // ISO string
};

const KEY = "cat_lottery_display_state_v1";

export function getDisplayState(): DisplayState | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DisplayState;
  } catch {
    return null;
  }
}

export function setDisplayState(state: DisplayState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(state));
}
