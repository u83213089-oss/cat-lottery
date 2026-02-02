"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type LiveStateRow = {
  id: number;
  phase: "preview" | "draw";
  selected_cat_ids: number[];
  results: any; // jsonb
  updated_at: string;
};

type CatRow = {
  id: number;
  name: string;
  image_url: string | null;
  active: boolean;
  sort_order: number | null;
};

type Winner = {
  rank: "正取" | "備取1" | "備取2";
  name: string;
  township?: string;
};

type ResultItem = {
  catId: number;
  winners: Winner[];
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function fmtTime(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatWinnerText(w: Winner | undefined) {
  if (!w?.name || w.name === "—") return "—";
  const t = (w.township ?? "").trim();
  return t ? `${w.name}（${t}）` : w.name;
}

export default function DisplayPage() {
  const [live, setLive] = useState<LiveStateRow | null>(null);
  const [cats, setCats] = useState<CatRow[]>([]);
  const [err, setErr] = useState<string>("");

  async function loadCats() {
    const { data, error } = await supabase
      .from("cats")
      .select("id,name,image_url,active,sort_order")
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });

    if (error) {
      setErr(`讀取 cats 失敗：${error.message}`);
      return;
    }
    setCats((data ?? []) as CatRow[]);
  }

  async function loadLive() {
    const { data, error } = await supabase
      .from("live_state")
      .select("id,phase,selected_cat_ids,results,updated_at")
      .eq("id", 1)
      .single();

    if (error) {
      setErr(`讀取 live_state 失敗：${error.message}`);
      return;
    }
    setLive(data as LiveStateRow);
  }

  useEffect(() => {
    setErr("");
    loadCats();
    loadLive();
    const t = setInterval(() => loadLive(), 2000);
    return () => clearInterval(t);
  }, []);

  const catMap = useMemo(() => {
    const m = new Map<number, CatRow>();
    for (const c of cats) m.set(c.id, c);
    return m;
  }, [cats]);

  const selectedIds = useMemo(() => {
    const ids = (live?.selected_cat_ids ?? []).map((x) => Number(x));
    return Array.from(new Set(ids)).filter(Number.isFinite).sort((a, b) => a - b);
  }, [live?.selected_cat_ids]);

  const phaseText = live?.phase === "draw" ? "結果出爐" : "待抽籤（預覽）";

  const results: ResultItem[] = useMemo(() => {
    // draw 後 route.ts 會把 results 寫成 array
    if (Array.isArray(live?.results)) return live!.results as ResultItem[];

    // 沒結果就做空白
    return selectedIds.map((catId) => ({
      catId,
      winners: [],
    }));
  }, [live?.results, selectedIds]);

  return (
    <main className="min-h-screen" style={{ background: "#efe3cf" }}>
      {/* 背景裝飾（固定在視窗，不跟卡片跑） */}
      <img
        src="/decor/plum.png"
        alt=""
        className="pointer-events-none select-none fixed left-0 top-0 w-[520px] -translate-x-[140px] -translate-y-[40px] opacity-95"
      />
      <img
        src="/decor/firecracker.png"
        alt=""
        className="pointer-events-none select-none fixed right-0 top-[140px] w-[220px] -translate-x-[30px] opacity-95"
      />
      <img
        src="/decor/flower1.png"
        alt=""
        className="pointer-events-none select-none fixed left-[40px] bottom-[80px] w-[220px] opacity-95"
      />
      <img
        src="/decor/flower2.png"
        alt=""
        className="pointer-events-none select-none fixed right-[40px] bottom-[80px] w-[220px] opacity-95"
      />

      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* 標題列 */}
        <header className="relative text-center">
          <img
            src="/decor/spring2.png"
            alt=""
            className="pointer-events-none select-none absolute left-1/2 top-0 -translate-x-[360px] w-[70px]"
          />
          <img
            src="/decor/spring.png"
            alt=""
            className="pointer-events-none select-none absolute left-1/2 top-0 translate-x-[300px] w-[70px]"
          />

          <h1
            className="font-black tracking-wide text-[56px] leading-tight"
            style={{ color: "#c40000" }}
          >
            喵星人命定活動
          </h1>

          <div className="mt-4 flex items-center justify-center gap-4">
            <span
              className="inline-flex items-center rounded-full px-5 py-2 text-[18px] font-bold"
              style={{ background: "#f0b100", color: "#fff" }}
            >
              狀態：{phaseText}
            </span>

            <div className="text-[18px] font-semibold" style={{ color: "#000" }}>
              更新時間：{fmtTime(live?.updated_at)}
            </div>
          </div>
        </header>

        {err ? (
          <div className="mt-6 rounded-xl border border-red-200 bg-white/70 p-4 text-red-700 font-semibold">
            {err}
          </div>
        ) : null}

        <section className="mt-10 space-y-8">
          {selectedIds.length === 0 ? (
            <div
              className="rounded-2xl border bg-white/70 p-8 text-center text-xl font-bold"
              style={{ color: "#000" }}
            >
              目前尚未推送任何貓咪到直播頁（請在 /admin 按「預覽」或「抽籤」）
            </div>
          ) : null}

          {selectedIds.map((catId) => {
            const cat = catMap.get(catId);
            const title = `${catId}號貓咪｜${cat?.name ?? `貓${catId}`}`;

            const r = results.find((x) => x.catId === catId);
            const winners = r?.winners ?? [];

            const w0 = winners.find((x) => x.rank === "正取");
            const w1 = winners.find((x) => x.rank === "備取1");
            const w2 = winners.find((x) => x.rank === "備取2");

            const imgSrc = (cat?.image_url && cat.image_url.trim()) || "";

            return (
              <article
                key={catId}
                className="relative rounded-[28px] bg-white border-[5px]"
                style={{
                  borderColor: "#c40000",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
                }}
              >
                <div className="p-10">
                  {/* 上排：標題 + 圖片 */}
                  <div className="flex items-start justify-between gap-10">
                    <div className="min-w-0">
                      <div className="text-[40px] font-black" style={{ color: "#c40000" }}>
                        {title}
                      </div>
                    </div>

                    <div className="shrink-0">
                      <div
                        className="overflow-hidden rounded-[18px]"
                        style={{ width: 280, height: 280, background: "#f2b24a" }}
                      >
                        {imgSrc ? (
                          <img
                            src={imgSrc}
                            alt={`cat${catId}`}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = "none";
                            }}
                          />
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {/* 下排：正備取（排一直線，不留空白） */}
                  <div className="mt-6 flex flex-wrap gap-x-14 gap-y-6">
                    <RowInline label="正 取：" value={formatWinnerText(w0)} />
                    <RowInline label="備取1：" value={formatWinnerText(w1)} />
                    <RowInline label="備取2：" value={formatWinnerText(w2)} />
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}

function RowInline({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-4">
      <div className="text-[30px] font-black whitespace-nowrap" style={{ color: "#000" }}>
        {label}
      </div>
      <div className="text-[30px] font-black whitespace-nowrap" style={{ color: "#000" }}>
        {value}
      </div>
    </div>
  );
}
