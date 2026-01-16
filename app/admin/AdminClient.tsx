"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type Phase = "preview" | "result";
type WinnerRow = { rank: "正取" | "備取1" | "備取2"; name: string; uid: string };

type LiveState = {
  id: number;
  phase: Phase;
  selected_cat_ids: number[];
  results: Record<string, WinnerRow[]>;
  updated_at: string;
};

const TOTAL_CATS = 31;

/** 你的規則：每隻貓 正取1、備取2 */
const RANKS: WinnerRow["rank"][] = ["正取", "備取1", "備取2"];

function catLabel(n: number) {
  return `貓 ${String(n).padStart(2, "0")}`;
}

// 先遮一下 uid（你未來可換成電話/身分證後四碼等）
function maskUid(uid: string) {
  if (uid.length <= 4) return uid;
  return `${uid.slice(0, 2)}****${uid.slice(-2)}`;
}

/**
 * 目前還沒報名名單 → 用假名單讓流程先跑通
 * 之後要改成真名單時：
 * - 把 getApplicantsForCat(...) 改成從 Supabase / 上傳檔案拿資料
 */
function getApplicantsForCat(catNo: number) {
  // 每隻貓 8~25 人報名的假資料
  const count = 8 + ((catNo * 7) % 18); // 8..25
  const people: { name: string; uid: string }[] = [];
  for (let i = 0; i < count; i++) {
    const base = catNo * 1000 + i * 17;
    people.push({
      name: `民眾${String(base).padStart(4, "0")}`,
      uid: `U${base}`, // uid 之後換成 phone-last4 或你們的報名序號
    });
  }
  return people;
}

/** Fisher-Yates shuffle */
function shuffle<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 抽一隻貓：從 applicants 中抽出 1+2
 * 並避開 alreadyWonUids
 */
function drawForOneCat(catNo: number, alreadyWonUids: Set<string>) {
  const applicants = getApplicantsForCat(catNo);

  // 過濾掉已中籤者（重複中籤只認第一次）
  const pool = applicants.filter((p) => !alreadyWonUids.has(p.uid));
  const randomized = shuffle(pool);

  const winners: WinnerRow[] = [];

  for (let i = 0; i < RANKS.length; i++) {
    const p = randomized[i];
    if (!p) {
      winners.push({ rank: RANKS[i], name: "名單不足", uid: "—" });
    } else {
      winners.push({ rank: RANKS[i], name: p.name, uid: maskUid(p.uid) });
      alreadyWonUids.add(p.uid);
    }
  }

  return winners;
}

async function fetchLiveState(): Promise<LiveState> {
  const { data, error } = await supabase
    .from("live_state")
    .select("*")
    .eq("id", 1)
    .single();

  if (error) throw error;
  return data as LiveState;
}

async function updateLiveState(patch: Partial<LiveState>) {
  const { error } = await supabase.from("live_state").update({
    ...patch,
    updated_at: new Date().toISOString(),
  }).eq("id", 1);

  if (error) throw error;
}

export default function AdminClient() {
  const allCats = useMemo(() => Array.from({ length: TOTAL_CATS }, (_, i) => i + 1), []);
  const [selected, setSelected] = useState<number[]>([]);
  const [phase, setPhase] = useState<Phase>("preview");
  const [busy, setBusy] = useState(false);

  // 讀取目前 live_state（讓你重新整理後還知道現在選了哪些貓）
  useEffect(() => {
    (async () => {
      try {
        const s = await fetchLiveState();
        setSelected(s.selected_cat_ids ?? []);
        setPhase((s.phase as Phase) ?? "preview");
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  function toggleCat(n: number) {
    setSelected((prev) => {
      if (prev.includes(n)) return prev.filter((x) => x !== n);
      return [...prev, n].sort((a, b) => a - b);
    });
  }

  async function applyPreview() {
    if (selected.length === 0) return alert("請先勾選至少一隻貓");
    setBusy(true);
    try {
      await updateLiveState({
        phase: "preview",
        selected_cat_ids: selected,
        results: {}, // 預覽階段不顯示結果
      });
      setPhase("preview");
      alert("已套用預覽：直播頁會顯示『待抽籤』但不顯示結果");
    } catch (e: any) {
      console.error(e);
      alert(`套用預覽失敗：${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }

  async function runDraw() {
    if (selected.length === 0) return alert("請先勾選至少一隻貓（可單選/複選）");
    if (!confirm("確定開始抽籤並顯示結果？")) return;

    setBusy(true);
    try {
      // 先抓一次 live_state，保險：避免你和直播端狀態不同步
      const live = await fetchLiveState();

      const catsToDraw = (live.selected_cat_ids?.length ? live.selected_cat_ids : selected)
        .slice()
        .sort((a, b) => a - b);

      // 重要：避免重複中籤 → 我們用一個 set 累積已中籤 uid
      // 目前沒有真名單，所以我們用本次抽籤結果中的 uid（未遮罩前）追蹤
      // 這裡先用「從既有 results 反推已中籤」的方式（如果你之前抽過）
      const alreadyWon = new Set<string>();

      // 如果之前已經有 results，就先把裡面的 uid（遮罩後）略過（示範用）
      // 真上線會用「真 uid」才能完美避重，之後名單上線時我會幫你改。
      // 先讓流程跑通。
      Object.values(live.results ?? {}).forEach((rows) => {
        rows.forEach((r) => {
          // 遮罩後無法還原真 uid，示範階段就不回填
          void r;
        });
      });

      const results: Record<string, WinnerRow[]> = {};

      for (const catNo of catsToDraw) {
        // 這裡用假名單 uid 追蹤避重
        results[String(catNo)] = drawForOneCat(catNo, alreadyWon);
      }

      await updateLiveState({
        phase: "result",
        selected_cat_ids: catsToDraw,
        results,
      });

      setPhase("result");
      alert("抽籤完成：直播頁已顯示結果");
    } catch (e: any) {
      console.error(e);
      alert(`抽籤失敗：${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }

  async function clearAll() {
    if (!confirm("確定清空直播狀態？（直播頁會回到未選擇）")) return;
    setBusy(true);
    try {
      await updateLiveState({
        phase: "preview",
        selected_cat_ids: [],
        results: {},
      });
      setSelected([]);
      setPhase("preview");
      alert("已清空");
    } catch (e: any) {
      console.error(e);
      alert(`清空失敗：${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen p-10">
      <div className="max-w-6xl">
        <div className="flex items-end justify-between flex-wrap gap-6">
          <div>
            <h1 className="text-3xl font-bold">管理端（縣長平板操作）</h1>
            <p className="mt-2 opacity-80">
              流程：先勾選 → 「套用預覽」(直播顯示待抽) → 「開始抽籤」(直播顯示結果)
            </p>
          </div>

          <div className="flex gap-3 flex-wrap">
            <a className="rounded-xl border px-4 py-2" href="/display" target="_blank">
              開啟直播頁（/display）
            </a>
            <span className="rounded-xl border px-4 py-2">
              目前狀態：{phase === "preview" ? "預覽（待抽）" : "結果（已抽）"}
            </span>
          </div>
        </div>

        <div className="mt-8 rounded-2xl border p-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="text-xl font-semibold">選擇要抽的貓（可複選）</div>
              <div className="mt-2 opacity-70">
                已選 {selected.length} 隻：{selected.length ? selected.map((n) => catLabel(n)).join("、") : "（尚未選擇）"}
              </div>
            </div>

            <div className="flex gap-3 flex-wrap">
              <button
                className="rounded-2xl border px-6 py-4 text-lg"
                onClick={() => setSelected([])}
                disabled={busy}
              >
                清空勾選
              </button>

              <button
                className="rounded-2xl bg-amber-500 px-6 py-4 text-lg font-semibold"
                onClick={applyPreview}
                disabled={busy}
              >
                套用選擇（預覽）
              </button>

              <button
                className="rounded-2xl bg-black text-white px-6 py-4 text-lg font-semibold"
                onClick={runDraw}
                disabled={busy}
              >
                開始抽籤（顯示結果）
              </button>

              <button
                className="rounded-2xl border px-6 py-4 text-lg"
                onClick={clearAll}
                disabled={busy}
              >
                清空直播狀態
              </button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7 gap-3">
            {allCats.map((n) => {
              const checked = selected.includes(n);
              return (
                <label
                  key={n}
                  className={`cursor-pointer rounded-xl border p-3 text-center select-none ${
                    checked ? "bg-black text-white" : "bg-white"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mr-2"
                    checked={checked}
                    onChange={() => toggleCat(n)}
                  />
                  {String(n).padStart(2, "0")}
                </label>
              );
            })}
          </div>

          <div className="mt-6 text-sm opacity-70">
            小提醒：你可以先選 5 → 套用預覽 → 抽籤；再選 11 → 套用預覽 → 抽籤；最後可一次勾多隻做批次抽。
          </div>
        </div>
      </div>
    </main>
  );
}
