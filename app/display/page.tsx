"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type Winner = {
  rank: "正取" | "備取1" | "備取2";
  name?: string;
  phoneMasked?: string;
  district?: string;
  township?: string;
};

type ResultItem = {
  catId: number;
  catName?: string;
  note?: string | null;
  winners: Winner[];
};

type LiveStateRow = {
  id: number;
  phase: "preview" | "drawn";
  selected_cat_ids: number[];
  results: ResultItem[];
  updated_at: string;
};

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function formatCatTitle(catId: number, catName?: string) {
  // 你想怎麼顯示都在這改
  // return `貓 ${String(catId).padStart(2, "0")}`;
  return `${catId}號貓咪 ${catName ? "｜" + catName : ""}`;
}

export default function DisplayPage() {
  const [state, setState] = useState<LiveStateRow | null>(null);

  async function fetchState() {
    const { data, error } = await sb
      .from("live_state")
      .select("*")
      .eq("id", 1)
      .single();
    if (!error) setState(data as any);
  }

  useEffect(() => {
    fetchState();

    const ch = sb
      .channel("live_state_watch")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_state" },
        () => fetchState()
      )
      .subscribe();

    return () => {
      sb.removeChannel(ch);
    };
  }, []);

  const results = state?.results ?? [];
  const phase = state?.phase ?? "preview";

  return (
    <main className="min-h-screen p-10">
      <div className="mb-6">
        <div className="text-5xl font-black">嘉義縣品種貓認領養抽籤</div>
        <div className="mt-2 text-xl opacity-70">
          狀態：{phase === "preview" ? "待抽籤（預覽）" : "已抽籤（結果公布）"}
        </div>
      </div>

      <div className="grid gap-8">
        {results.map((r) => (
          <section key={r.catId} className="rounded-3xl border p-8">
            <div className="text-4xl font-extrabold">
              {formatCatTitle(r.catId, r.catName)}
            </div>

            {phase === "preview" ? (
              <div className="mt-6 text-2xl opacity-70">
                （已選定，尚未抽出結果）
              </div>
            ) : r.note ? (
              <div className="mt-6 text-2xl opacity-70">{r.note}</div>
            ) : (
              <div className="mt-6 grid gap-4">
                {(["正取", "備取1", "備取2"] as const).map((rank) => {
                  const w = r.winners.find((x) => x.rank === rank);
                  return (
                    <div key={rank} className="rounded-2xl bg-black/5 p-5 flex justify-between items-center">
                      <div className="text-3xl font-bold">{rank}</div>
                      <div className="text-3xl">
                        {w?.name ?? "—"}
                        {w?.phoneMasked ? `　${w.phoneMasked}` : ""}
                        {w?.township || w?.district ? `　${w.district ?? ""}${w.township ?? ""}` : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
