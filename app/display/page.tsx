"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type LiveStateRow = {
  id: number;
  phase: "preview" | "draw";
  selected_cat_ids: number[]; // int4[]
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
};

type ResultItem = {
  note?: string;
  catId: number;
  catName: string;
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

export default function DisplayPage() {
  const [live, setLive] = useState<LiveStateRow | null>(null);
  const [cats, setCats] = useState<CatRow[]>([]);
  const [err, setErr] = useState<string>("");

  async function loadCats() {
    // ✅ 這裡不要選 uid（你表裡沒有）
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

    // 每 2 秒輪詢一次（你現在用這個最直覺）
    const t = setInterval(() => {
      loadLive();
    }, 2000);
    return () => clearInterval(t);
  }, []);

  const catMap = useMemo(() => {
    const m = new Map<number, CatRow>();
    for (const c of cats) m.set(c.id, c);
    return m;
  }, [cats]);

  const selectedIds = useMemo(() => {
    const ids = (live?.selected_cat_ids ?? []).map((x) => Number(x));
    // 保證正序
    return Array.from(new Set(ids)).sort((a, b) => a - b);
  }, [live?.selected_cat_ids]);

  const phaseText = live?.phase === "draw" ? "結果出爐" : "待抽籤（預覽）";

  const results: ResultItem[] = useMemo(() => {
    if (Array.isArray(live?.results)) return live!.results as ResultItem[];

    // preview 但 results 不是 array → 自動組一個空結果給 UI 顯示
    return selectedIds.map((id) => ({
      note: "尚未開獎",
      catId: id,
      catName: catMap.get(id)?.name ?? `貓${id}`,
      winners: [],
    }));
  }, [live?.results, selectedIds, catMap]);

  return (
    <main
      className="min-h-screen"
      style={{
        background: "#efe3cf", // 米白
      }}
    >
      {/* 背景紙張（如果你有 bg-paper.png） */}
      {/* <img src="/decor/bg-paper.png" alt="" className="fixed inset-0 w-full h-full object-cover opacity-20 pointer-events-none" /> */}

      {/* 裝飾：全部用 public/decor */}
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
          {/* 福 / 春 */}
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
            style={{ color: "#c40000" }} // 純紅
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

            <div
              className="text-[18px] font-semibold"
              style={{ color: "#000" }} // 真黑
            >
              更新時間：{fmtTime(live?.updated_at)}
            </div>
          </div>
        </header>

        {/* 錯誤條 */}
        {err ? (
          <div className="mt-6 rounded-xl border border-red-200 bg-white/70 p-4 text-red-700 font-semibold">
            {err}
          </div>
        ) : null}

        {/* 主內容 */}
        <section className="mt-10 space-y-8">
          {selectedIds.length === 0 ? (
            <div
              className="rounded-2xl border bg-white/70 p-8 text-center text-xl font-bold"
              style={{ color: "#000" }}
            >
              目前尚未推送任何貓咪到直播頁（請在 /admin 按「預覽」或「抽籤」）
            </div>
          ) : null}

          {results.map((item) => {
            const cat = catMap.get(item.catId);
            const title = `${item.catId}號貓咪｜${cat?.name ?? item.catName}`;

            // winners 空就顯示 —
            const getName = (rank: Winner["rank"]) => {
              const w = (item.winners ?? []).find((x) => x.rank === rank);
              return w?.name ? w.name : "—";
            };

            // ✅ 圖片來源：優先用 cats.image_url
            // 若你某些還沒填 image_url，也可以用 bucket 規則 fallback
            const imgSrc =
              (cat?.image_url && cat.image_url.trim()) ||
              `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/cat%20image/cat${item.catId}.png`;

            return (
              <article
                key={item.catId}
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
                      <div
                        className="text-[40px] font-black"
                        style={{ color: "#c40000" }}
                      >
                        {title}
                      </div>
                      {/* 你說：不需要每張卡的「未開獎」字，所以這裡不放 */}
                    </div>

                    {/* 圖片區塊（會跟卡片一起上下滑動，因為它在卡片內） */}
                    <div className="shrink-0">
                      <div
                        className="overflow-hidden rounded-[18px]"
                        style={{
                          width: 280,
                          height: 280,
                          background: "#f2b24a",
                        }}
                      >
                        <img
                          src={imgSrc}
                          alt={`cat${item.catId}`}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            // 圖片壞掉就退回橘色底
                            (e.currentTarget as HTMLImageElement).style.display =
                              "none";
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* 下排：正備取 */}
                  <div className="mt-6">
                    <div className="flex flex-col space-y-6">
                      <Row label="正 取：" value={getName("正取")} />
                      <Row label="備取1：" value={getName("備取1")} />
                      <Row label="備取2：" value={getName("備取2")} />
                    </div>
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-4">
      <div
        className="text-[30px] font-black whitespace-nowrap"
        style={{ color: "#000" }} // ✅ 真黑，且不吃夜間模式
      >
        {label}
      </div>
      <div
        className="text-[30px] font-black truncate"
        style={{ color: "#000" }}
      >
        {value}
      </div>
    </div>
  );
}
