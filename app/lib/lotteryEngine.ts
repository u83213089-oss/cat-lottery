import type { DisplayState, WinnerRow } from "./lotteryState";

export type Applicant = {
  uid: string;   // 唯一識別（之後用 手機-後四碼）
  name: string;
};

export type Cat = {
  id: string;     // "cat-01"
  label: string;  // "貓 01｜小花"
  popular?: boolean; // 熱門逐隻抽
};

export type DrawResult = {
  cat: Cat;
  winners: WinnerRow[];
};

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function drawForCat(params: {
  cat: Cat;
  applicantsForCat: Applicant[]; // 報名這隻貓的人
  alreadyWonUids: Set<string>;   // 已中籤UID（任何貓）
}): DrawResult {
  const pool = params.applicantsForCat.filter((a) => !params.alreadyWonUids.has(a.uid));

  const winners: WinnerRow[] = [];
  const ranks: WinnerRow["rank"][] = ["正取", "備取1", "備取2"];

  // 抽 1+2；不夠就抽到哪算哪
  const remaining = [...pool];

  for (const rank of ranks) {
    if (remaining.length === 0) {
      winners.push({ rank, name: "—", uid: "名單不足" });
      continue;
    }
    const picked = pickRandom(remaining);
    // 從候選池移除，避免同一隻貓內重複
    const idx = remaining.findIndex((x) => x.uid === picked.uid);
    if (idx >= 0) remaining.splice(idx, 1);

    winners.push({ rank, name: picked.name, uid: picked.uid });
  }

  return { cat: params.cat, winners };
}

export function toDisplayState(result: DrawResult): DisplayState {
  return {
    catLabel: result.cat.label,
    winners: result.winners,
    updatedAt: new Date().toISOString(),
  };
}
