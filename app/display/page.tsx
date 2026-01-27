"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type Winner = {
  rank: "正取" | "備取1" | "備取2";
  name: string;
  phone?: string;
  township?: string; // 鄉鎮/市
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
  selected_cat_ids: number[]; // int4[]
  results: any; // jsonb
  updated_at: string;
};

type CatRow = {
  id: number;
  name: string;
  image_url?: string | null;
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

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

  // 讀 cats（拿 catName / image_url）
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("cats")
        .select("id,name,image_url")
        .order("id", { ascending: true });
      if (error) setErr("讀取 cats 失敗：" + error.message);
      else setCats((data ?? []) as CatRow[]);
    })();
  }, []);

  // 讀 live_state 初始
  useEffect(() => {
    (async () => {
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

  const catMap = useMemo(() => {
    const m = new Map<number, CatRow>();
    for (const c of cats) m.set(c.id, c);
    return m;
  }, [cats]);

  // 產出要顯示的結果清單
  const displayItems: ResultItem[] = useMemo(() => {
    if (!state) return [];

    // draw：直接用 results（你目前就是放這裡）
    const raw = Array.isArray(state.results) ? state.results : [];

    if (state.phase === "draw" && raw.length > 0) {
      return raw.map((r: any) => {
        const catId = Number(r.catId);
        const catName =
          r.catName ??
          catMap.get(catId)?.name ??
          `貓${pad2(catId)}`;
        const winners: Winner[] = Array.isArray(r.winners) ? r.winners : [];
        return { note: r.note, catId, catName, winners };
      });
    }

    // preview：用 selected_cat_ids 生成「尚未出結果」
    const ids = Array.isArray(state.selected_cat_ids) ? state.selected_cat_ids : [];
    return ids.map((id) => ({
      note: "目前無人報名 / 尚未開獎",
      catId: id,
      catName: catMap.get(id)?.name ?? `貓${pad2(id)}`,
      winners: [
        { rank: "正取", name: "—" },
        { rank: "備取1", name: "—" },
        { rank: "備取2", name: "—" },
      ],
    }));
  }, [state, catMap]);

  const phaseLabel =
    state?.phase === "draw" ? "結果出爐" : "待抽籤（預覽）";

  return (
    <main
      className="min-h-screen w-full"
      style={{
        backgroundImage: `url(/decor/bg-paper.png)`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* 裝飾層 */}
      <div className="pointer-events-none fixed inset-0">
        <img
          src="/decor/fireworks.png"
          className="absolute left-6 top-4 w-40 opacity-90"
          alt=""
        />
        <img
          src="/decor/firecracker.png"
          className="absolute right-4 top-2 w-40 opacity-90"
          alt=""
        />
        <img
          src="/decor/spring.png"
          className="absolute right-40 top-10 w-16 opacity-95"
          alt=""
        />
        <img
          src="/decor/plum.png"
          className="absolute left-0 top-48 w-48 opacity-95"
          alt=""
        />
      </div>

      <div className="relative mx-auto max-w-5xl px-6 py-8">
        {/* 大標題 */}
        <header className="text-center">
          <div className="inline-block rounded-full border-4 border-black bg-white/80 px-8 py-3 shadow-sm">
            <h1
              className="text-4xl font-black tracking-wide"
              style={{
                color: "#d10000",
                WebkitTextStroke: "4px #fff",
                textShadow:
                  "0 2px 0 #000, 2px 0 0 #000, -2px 0 0 #000, 0 -2px 0 #000",
              }}
            >
              喵星人命定配對活動
            </h1>
          </div>

          <div className="mt-3 flex items-center justify-center gap-3 text-sm">
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
            <span className="opacity-80">
              更新時間：{fmtTW(state?.updated_at)}
            </span>
          </div>

          {err ? (
            <div className="mt-2 text-sm text-red-700">{err}</div>
          ) : null}
        </header>

        {/* 目前貓資訊框（你圖上那個白框） */}
        <section className="mt-6 rounded-xl border bg-white/90 px-6 py-4 shadow-sm">
          <div className="text-lg font-bold">
            {displayItems[0]
              ? `${displayItems[0].catId}號貓咪｜${displayItems[0].catName}`
              : "尚未選擇貓咪"}
          </div>
          <div className="mt-1 text-sm opacity-80">目前無人報名</div>
        </section>

        {/* 結果清單 */}
        <section className="mt-6 space-y-5">
          {displayItems.map((item) => {
            const cat = catMap.get(item.catId);
            const title = `${item.catId}號貓咪｜${item.catName}`;
            return (
              <div
                key={item.catId}
                className="rounded-[28px] border-4 border-red-700 bg-white/95 px-6 py-5 shadow-sm"
              >
                <div className="flex gap-4">
                  {/* 可選：貓照片 */}
                  {cat?.image_url ? (
                    <div className="hidden sm:block">
                      <img
                        src={cat.image_url}
                        alt=""
                        className="h-24 w-24 rounded-2xl object-cover border"
                      />
                    </div>
                  ) : null}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div className="text-xl font-black text-red-700">
                        {title}
                      </div>
                      {item.note ? (
                        <div className="text-sm opacity-70">{item.note}</div>
                      ) : null}
                    </div>

                    <div className="mt-3 space-y-2 text-xl leading-relaxed">
                      {/* 正取 */}
                      <RowLine
                        label="正　取"
                        winner={item.winners.find((w) => w.rank === "正取")}
                      />
                      {/* 備取 1 & 2 同行 */}
                      <div className="flex flex-col gap-2 md:flex-row md:gap-6">
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
            <div className="rounded-xl border bg-white/80 p-6 text-center text-lg">
              尚未收到預覽/抽籤資料
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function RowLine({
  label,
  winner,
}: {
  label: string;
  winner?: Winner;
}) {
  const name = winner?.name ?? "—";
  const township = winner?.township ? `${winner.township} ` : "";
  const phone = winner?.phone ? maskPhone(winner.phone) : "";
  const tail = [township, name, phone].filter(Boolean).join(" ");

  return (
    <div className="flex gap-3">
      <div className="w-20 shrink-0 font-black">{label}：</div>
      <div className="font-semibold">{tail || "—"}</div>
    </div>
  );
}

function maskPhone(p: string) {
  const s = p.replace(/\s/g, "");
  if (s.length <= 4) return s;
  return s.slice(0, 4) + "****" + s.slice(-2);
}
