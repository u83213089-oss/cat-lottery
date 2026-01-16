"use client";

import { useEffect, useState } from "react";
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

const EMPTY: LiveState = {
  id: 1,
  phase: "preview",
  selected_cat_ids: [],
  results: {},
  updated_at: new Date(0).toISOString(),
};

function catLabel(n: number) {
  return `貓 ${String(n).padStart(2, "0")}`;
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

export default function DisplayPage() {
  const [state, setState] = useState<LiveState>(EMPTY);
  const [status, setStatus] = useState<string>("init");

  useEffect(() => {
    let alive = true;

    async function safeFetch(tag: string) {
      try {
        const s = await fetchLiveState();
        if (!alive) return;
        setState(s);
        setStatus(`fetch ok (${tag})`);
        console.log("[display] fetched:", s);
      } catch (e) {
        console.error("[display] fetch failed:", e);
        setStatus("fetch failed (see console)");
      }
    }

    // 先抓一次
    safeFetch("initial");

    // Realtime 訂閱（有就用）
    const channel = supabase
      .channel("live_state_watch")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_state" },
        (payload) => {
          const row = payload.new as any;
          if (row?.id === 1) {
            setState(row as LiveState);
            setStatus("realtime update");
            console.log("[display] realtime payload:", payload);
          }
        }
      )
      .subscribe((s) => {
        console.log("[display] realtime status:", s);
        setStatus(`realtime status: ${s}`);
      });

    // 保險絲：每秒輪詢一次（Realtime 壞了也會更新）
    const timer = window.setInterval(() => safeFetch("poll"), 1000);

    return () => {
      alive = false;
      window.clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, []);

  const cats = state.selected_cat_ids ?? [];

  return (
    <main className="min-h-screen p-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-4xl font-bold">嘉義縣品種貓認領養抽籤</h1>
            <div className="mt-2 text-lg opacity-70">
              狀態：{state.phase === "preview" ? "待抽籤（預覽）" : "已抽籤（結果）"}
            </div>
            <div className="mt-1 text-sm opacity-60">
              系統狀態：{status}｜更新時間：
              <span suppressHydrationWarning>
                {" "}
                {new Date(state.updated_at).toLocaleString("zh-TW", { hour12: false })}
              </span>
            </div>
          </div>

          <button
            className="rounded-xl border px-4 py-2"
            onClick={async () => {
              try {
                const s = await fetchLiveState();
                setState(s);
                setStatus("manual refresh ok");
              } catch (e) {
                console.error(e);
                setStatus("manual refresh failed");
              }
            }}
          >
            手動刷新
          </button>
        </div>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          {cats.length === 0 ? (
            <div className="rounded-2xl border p-10 text-center text-2xl opacity-70">
              尚未選擇任何貓隻
            </div>
          ) : (
            cats.map((catNo) => {
              const key = String(catNo);
              const winners = state.results?.[key] ?? [];

              return (
                <div key={catNo} className="rounded-2xl border p-6">
                  <div className="text-3xl font-bold">{catLabel(catNo)}</div>

                  {state.phase === "preview" ? (
                    <div className="mt-6 text-2xl opacity-70">（待抽籤）</div>
                  ) : (
                    <div className="mt-6 space-y-3">
                      {["正取", "備取1", "備取2"].map((r) => {
                        const row = winners.find((w) => w.rank === r);
                        return (
                          <div key={r} className="flex items-center justify-between rounded-xl bg-black/5 px-4 py-3">
                            <div className="text-xl font-semibold">{r}</div>
                            <div className="text-xl">
                              {row ? `${row.name}（${row.uid}）` : "—"}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </main>
  );
}
