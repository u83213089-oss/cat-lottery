"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type Winner = {
  rank: "正取" | "備取1" | "備取2";
  name: string;
  phone?: string;
  township?: string;
};

type ResultItem = {
  note?: string;
  catId: number;
  catName: string;
  winners: Winner[];
};

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
  image_url?: string | null;
  active?: boolean;
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function maskPhone(p?: string) {
  if (!p) return "";
  const s = p.replace(/\s/g, "");
  if (s.length <= 4) return s;
  return s.slice(0, 4) + "****" + s.slice(-2);
}

function fmtTW(dtIso?: string) {
  if (!dtIso) return "—";
  const d = new Date(dtIso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-TW", { hour12: false });
}

export default function DisplayPage() {
  const [cats, setCats] = useState<CatRow[]>([]);
  const [state, setState] = useState<LiveStateRow | null>(null);
  const [err, setErr] = useState<string>("");

  // 讀 cats（包含 image_url）
  useEffect(() => {
    (async () => {
      setErr("");
      const { data, error } = await supabase
        .from("cats")
        .select("id,name,image_url,active")
        .eq("active", true)
        .order("id", { ascending: true });

      if (error) setErr("讀取 cats 失敗：" + error.message);
      else setCats((data ?? []) as CatRow[]);
    })();
  }, []);

  // 讀 live_state 初始
  useEffect(() => {
    (async () => {
      setErr("");
      const { data, error } = await supabase
        .from("live_state")
        .select("id,phase,selected_cat_ids,results,updated_at")
        .eq("id", 1)
        .single();

      if (error) setErr("讀取 live_state 失敗：" + error.message);
      else setState(data as LiveStateRow);
    })();
  }, []);

  // Realtime 訂閱 live_state 更新
  useEffect(() => {
    const channel = supabase
      .channel("display-live_state")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_state", filter: "id=eq.1" },
        (payload) => {
          const next = payload.new as any;
          setState({
            id: next.id,
            phase: next.phase,
            selected_cat_ids: next.selected_cat_ids ?? [],
            results: next.results ?? [],
            updated_at: next.updated_at,
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // catsById：每隻貓快速查找
  const catsById = useMemo(() => {
    const m = new Map<number, CatRow>();
    for (const c of cats) m.set(c.id, c);
    return m;
  }, [cats]);

  // 產出要顯示的結果清單（preview：顯示貓但 winners 先是 —）
  const displayItems: ResultItem[] = useMemo(() => {
    if (!state) return [];

    const raw = Array.isArray(state.results) ? state.results : [];

    if (state.phase === "draw" && raw.length > 0) {
      return raw.map((r: any) => {
        const catId = Number(r.catId);
        const catName = r.catName ?? catsById.get(catId)?.name ?? `貓${catId}`;
        const winners: Winner[] = Array.isArray(r.winners) ? r.winners : [];
        return { note: r.note, catId, catName, winners };
      });
    }

    const ids = Array.isArray(state.selected_cat_ids) ? state.selected_cat_ids : [];
    return ids.map((id) => ({
      note: "尚未開獎",
      catId: id,
      catName: catsById.get(id)?.name ?? `貓${id}`,
      winners: [
        { rank: "正取", name: "—" },
        { rank: "備取1", name: "—" },
        { rank: "備取2", name: "—" },
      ],
    }));
  }, [state, catsById]);

  const phaseLabel = state?.phase === "draw" ? "結果出爐" : "待抽籤（預覽）";

  return (
    <main
      className="min-h-screen w-full"
      style={{
        backgroundColor: "#f6f1e6", // 米白
        backgroundImage: `url(/decor/bg-paper.png)`,
        backgroundBlendMode: "multiply",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* 裝飾層 */}
      <div className="pointer-events-none fixed inset-0">
        {/* 梅花：更靠左、更大，故意裁切 */}
        <img
          src="/decor/plum.png"
          alt=""
          className="absolute left-[-140px] top-[-40px] w-[520px] opacity-95"
        />

        {/* 鞭炮：主標題右方 */}
        <img
          src="/decor/firecracker.png"
          alt=""
          className="absolute left-1/2 top-[25px] translate-x-[540px] w-[400px] opacity-95"
        />

        {/* 春：靠主標題右側（不要跟鞭炮重疊） */}
        <img
          src="/decor/spring.png"
          alt=""
          className="absolute left-1/2 top-[26px] translate-x-[300px] w-[78px] opacity-95"
        />

        {/* 福：靠主標題左側 */}
        <img
          src="/decor/spring2.png"
          alt=""
          className="absolute left-1/2 top-[26px] translate-x-[-380px] w-[78px] opacity-95"
        />

        {/* 左右花：往下移，避免跟梅花重疊 */}
        <img
          src="/decor/flower1.png"
          alt=""
          className="absolute left-0 top-[85%] -translate-y-1/2 w-[260px] opacity-95"
        />
        <img
          src="/decor/flower2.png"
          alt=""
          className="absolute right-0 top-[85%] -translate-y-1/2 w-[260px] opacity-95"
        />
      </div>

      <div className="relative mx-auto max-w-5xl px-6 py-8">
        {/* 主標題：純紅 */}
        <header className="text-center">
          <h1 className="text-6xl font-black tracking-wide text-red-700">
            喵星人命定配對活動
          </h1>

          <div className="mt-3 flex items-center justify-center gap-3 text-sm text-black dark:text-black">
            <span
              className={[
                "rounded-full px-3 py-1 font-semibold",
                state?.phase === "draw"
                  ? "bg-green-700 text-white"
                  : "bg-yellow-500 text-black",
              ].join(" ")}
            >
              狀態：{phaseLabel}
            </span>
            <span className="opacity-80">更新時間：{fmtTW(state?.updated_at)}</span>
          </div>

          {err ? <div className="mt-2 text-sm text-red-700">{err}</div> : null}
        </header>

        {/* 卡片清單 */}
        <section className="mt-8 space-y-6">
          {displayItems.map((item) => {
            const cat = catsById.get(item.catId);
            const title = `${item.catId}號貓咪｜${item.catName}`;
            const imgUrl = cat?.image_url?.trim() || "";

            return (
              <div
                key={item.catId}
                className="rounded-[28px] border-4 border-red-700 bg-white/95 px-6 py-6 shadow-sm"
              >
                <div className="flex gap-5 items-start">
                  {/* ✅ 每隻貓的圖片區（紅色方塊的位置） */}
                  <div className="w-[120px] h-[120px] flex-shrink-0 rounded-md overflow-hidden border-2 border-red-700 bg-red-700/15">
                    {imgUrl ? (
                      <img
                        src={imgUrl}
                        alt={`${item.catId}號貓`}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          // 圖片失效：隱藏 img，露出底色 placeholder
                          (e.currentTarget as HTMLImageElement).style.display =
                            "none";
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-sm text-black/70 dark:text-black/70">
                        尚無圖片
                      </div>
                    )}
                  </div>

                  {/* ✅ 右側資訊（強制真黑，夜間模式也不變白） */}
                  <div className="min-w-0 flex-1 text-black dark:text-black">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div className="text-2xl font-black text-red-700">
                        {title}
                      </div>
                      {item.note ? (
                        <div className="text-sm opacity-70">{item.note}</div>
                      ) : null}
                    </div>

                    <div className="mt-4 space-y-3 text-2xl leading-relaxed">
                      <RowLine
                        label="正　取"
                        winner={item.winners.find((w) => w.rank === "正取")}
                      />

                      <div className="flex flex-col gap-3 md:flex-row md:gap-10">
                        <div className="flex-1">
                          <RowLine
                            label="備取1"
                            winner={item.winners.find((w) => w.rank === "備取1")}
                          />
                        </div>
                        <div className="flex-1">
                          <RowLine
                            label="備取2"
                            winner={item.winners.find((w) => w.rank === "備取2")}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {displayItems.length === 0 ? (
            <div className="rounded-xl border bg-white/80 p-6 text-center text-lg text-black dark:text-black">
              尚未收到預覽/抽籤資料
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function RowLine({ label, winner }: { label: string; winner?: Winner }) {
  const name = winner?.name ?? "—";
  const township = winner?.township ? `${winner.township} ` : "";
  const phone = winner?.phone ? maskPhone(winner.phone) : "";
  const tail = [township, name, phone].filter(Boolean).join(" ");

  return (
    <div className="flex gap-3 text-black dark:text-black">
      <div className="w-24 shrink-0 font-black">{label}：</div>
      <div className="font-semibold">{tail || "—"}</div>
    </div>
  );
}
