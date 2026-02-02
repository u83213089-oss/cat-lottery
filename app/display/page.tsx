"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type LiveStateRow = {
  id: number;
  phase: "preview" | "draw";
  selected_cat_ids: number[];
  results: any; // jsonb (array)
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
  note?: string;
  catId: number;
  catName: string;
  image_url?: string | null;
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
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(
    d.getDate()
  )} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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

    const t = setInterval(() => {
      loadLive();
    }, 1200); // 直播用：刷新更快一點
    return () => clearInterval(t);
  }, []);

  const catMap = useMemo(() => {
    const m = new Map<number, CatRow>();
    for (const c of cats) m.set(c.id, c);
    return m;
  }, [cats]);

  const selectedIds = useMemo(() => {
    const ids = (live?.selected_cat_ids ?? []).map((x) => Number(x));
    return Array.from(new Set(ids)).sort((a, b) => a - b);
  }, [live?.selected_cat_ids]);

  const phaseText = live?.phase === "draw" ? "結果出爐" : "待抽籤（預覽）";

  // ⚠️ 你說你先不修「殘留貓」bug：那我們 display 就照 live_state.results 顯示
  // 但我們仍會用 selectedIds 做優先排序：被選到的放前面，其他放後面（方便截圖）
  const results: ResultItem[] = useMemo(() => {
    const raw = Array.isArray(live?.results) ? (live!.results as any[]) : [];

    const normalized: ResultItem[] = raw.map((x: any) => ({
      note: x.note,
      catId: Number(x.catId),
      catName: x.catName ?? catMap.get(Number(x.catId))?.name ?? `貓${x.catId}`,
      image_url: x.image_url ?? catMap.get(Number(x.catId))?.image_url ?? null,
      winners: Array.isArray(x.winners) ? x.winners : [],
    }));

    // 排序：selectedIds 優先，其餘照 catId
    const selSet = new Set(selectedIds);
    normalized.sort((a, b) => {
      const aSel = selSet.has(a.catId) ? 0 : 1;
      const bSel = selSet.has(b.catId) ? 0 : 1;
      if (aSel !== bSel) return aSel - bSel;
      return a.catId - b.catId;
    });

    // 如果完全沒 results，就用 selectedIds 組預覽空卡
    if (normalized.length === 0) {
      return selectedIds.map((id) => ({
        note: "尚未開獎",
        catId: id,
        catName: catMap.get(id)?.name ?? `貓${id}`,
        image_url: catMap.get(id)?.image_url ?? null,
        winners: [],
      }));
    }

    return normalized;
  }, [live?.results, selectedIds, catMap]);

  return (
    <main
      className="min-h-screen"
      style={{
        background: "#efe3cf", // 米白
        color: "#000", // 真黑
      }}
    >
      {/* 裝飾：public/decor */}
      <img
        src="/decor/plum.png"
        alt=""
        className="pointer-events-none select-none fixed left-0 top-0 w-[620px] -translate-x-[190px] -translate-y-[70px] opacity-95"
      />
      <img
        src="/decor/firecracker.png"
        alt=""
        className="pointer-events-none select-none fixed right-0 top-[140px] w-[260px] -translate-x-[40px] opacity-95"
      />
      <img
        src="/decor/flower1.png"
        alt=""
        className="pointer-events-none select-none fixed left-[40px] bottom-[60px] w-[240px] opacity-95"
      />
      <img
        src="/decor/flower2.png"
        alt=""
        className="pointer-events-none select-none fixed right-[40px] bottom-[60px] w-[240px] opacity-95"
      />

      <div className="max-w-6xl mx-auto px-8 py-10">
        {/* 標題 */}
        <header className="relative text-center">
          <img
            src="/decor/spring2.png"
            alt=""
            className="pointer-events-none select-none absolute left-1/2 top-0 -translate-x-[420px] w-[86px]"
          />
          <img
            src="/decor/spring.png"
            alt=""
            className="pointer-events-none select-none absolute left-1/2 top-0 translate-x-[350px] w-[86px]"
          />

          <h1
            className="font-black tracking-wide text-[64px] leading-tight"
            style={{ color: "#c40000" }}
          >
            喵星人命定活動
          </h1>

          <div className="mt-4 flex items-center justify-center gap-4">
            <span
              className="inline-flex items-center rounded-full px-6 py-2 text-[20px] font-black"
              style={{ background: "#f0b100", color: "#fff" }}
            >
              狀態：{phaseText}
            </span>

            <div className="text-[20px] font-black" style={{ color: "#000" }}>
              更新時間：{fmtTime(live?.updated_at)}
            </div>
          </div>
        </header>

        {/* 錯誤 */}
        {err ? (
          <div className="mt-6 rounded-2xl border border-red-200 bg-white/70 p-5 text-red-700 text-[18px] font-black">
            {err}
          </div>
        ) : null}

        {/* 內容 */}
        <section className="mt-10 space-y-10">
          {results.length === 0 ? (
            <div className="rounded-3xl border bg-white/70 p-10 text-center text-[24px] font-black">
              目前尚未推送任何貓咪到直播頁（請在 /admin 按「預覽」或「抽籤」）
            </div>
          ) : null}

          {results.map((item) => {
            const cat = catMap.get(item.catId);
            const title = `${item.catId}號貓咪｜${cat?.name ?? item.catName}`;

            const getW = (rank: Winner["rank"]) =>
              (item.winners ?? []).find((x) => x.rank === rank);

            const imgSrc =
              (item.image_url && String(item.image_url).trim()) ||
              (cat?.image_url && String(cat.image_url).trim()) ||
              "";

            return (
              <article
                key={item.catId}
                className="relative rounded-[34px] bg-white border-[6px]"
                style={{
                  borderColor: "#c40000",
                  boxShadow: "0 10px 30px rgba(0,0,0,0.10)",
                }}
              >
                <div className="p-12">
                  {/* 上排：標題 + 圖 */}
                  <div className="flex items-start justify-between gap-12">
                    <div className="min-w-0">
                      <div
                        className="text-[46px] font-black"
                        style={{ color: "#c40000" }}
                      >
                        {title}
                      </div>

                      {/* 只留「本卡」狀態一句（不再顯示「未開獎」重複字） */}
                      {live?.phase !== "draw" ? (
                        <div className="mt-2 text-[22px] font-black opacity-80">
                          （等待抽籤中）
                        </div>
                      ) : null}
                    </div>

                    {/* 貓圖：大方塊、跟著卡一起滑 */}
                    <div className="shrink-0">
                      <div
                        className="overflow-hidden rounded-[22px]"
                        style={{
                          width: 360,
                          height: 360,
                          background: "#f2b24a",
                        }}
                      >
                        {imgSrc ? (
                          <img
                            src={imgSrc}
                            alt={`cat${item.catId}`}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display =
                                "none";
                            }}
                          />
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {/* 下排：正取/備取（垂直在左側一欄） */}
                  <div className="h-4">
                    <WinnerRow
                      label="正取"
                      winner={getW("正取")}
                      big
                    />
                    <div className="h-4" />
                    <WinnerRow
                      label="備取1"
                      winner={getW("備取1")}
                    />
                    <div className="h-4" />
                    <WinnerRow
                      label="備取2"
                      winner={getW("備取2")}
                    />
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

function WinnerRow({
  label,
  winner,
  big,
}: {
  label: string;
  winner?: Winner;
  big?: boolean;
}) {
  const name = winner?.name ? winner.name : "—";
  const township = winner?.township ? winner.township : "";

  return (
    <div className="flex items-baseline gap-6">
      <div
        className="whitespace-nowrap font-black"
        style={{
          color: "#000",
          fontSize: big ? 38 : 34,
        }}
      >
        {label}：
      </div>

      <div className="min-w-0">
        <div
          className="font-black truncate"
          style={{
            color: "#000",
            fontSize: big ? 38 : 34,
            lineHeight: 1.1,
          }}
        >
          {name}
        </div>

        {/* township：比名字小一點，避免擠爆 */}
        {township ? (
          <div
            className="font-black opacity-80"
            style={{
              color: "#000",
              fontSize: big ? 38 : 34,
              marginTop: 4,
              lineHeight: 1.1
            }}
          >
            {township}
          </div>
        ) : null}
      </div>
    </div>
  );
}