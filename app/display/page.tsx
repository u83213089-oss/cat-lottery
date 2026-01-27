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
  results: any;
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

  const displayItems: ResultItem[] = useMemo(() => {
    if (!state) return [];

    const raw = Array.isArray(state.results) ? state.results : [];

    if (state.phase === "draw" && raw.length > 0) {
      return raw.map((r: any) => {
        const catId = Number(r.catId);
        const catName = r.catName ?? catMap.get(catId)?.name ?? `貓${catId}`;
        const winners: Winner[] = Array.isArray(r.winners) ? r.winners : [];
        return { note: r.note, catId, catName, winners };
      });
    }

    const ids = Array.isArray(state.selected_cat_ids) ? state.selected_cat_ids : [];
    return ids.map((id) => ({
      note: "尚未開獎",
      catId: id,
      catName: catMap.get(id)?.name ?? `貓${id}`,
      winners: [
        { rank: "正取", name: "—" },
        { rank: "備取1", name: "—" },
        { rank: "備取2", name: "—" },
      ],
    }));
  }, [state, catMap]);

  const phaseLabel = state?.phase === "draw" ? "結果出爐" : "待抽籤（預覽）";

  return (
    <main
      className="min-h-screen w-full"
      style={{
        // ✅ 米白底（你要的）
        backgroundColor: "#f6f1e6",
        // 如果你想要紙紋理就保留這行；沒有圖也不會壞（只是 network 404）
        backgroundImage: `url(/decor/bg-paper.png)`,
        backgroundBlendMode: "multiply",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* ✅ 裝飾層（全部用 fixed + transform 控位置，避免互相打架） */}
      <div className="pointer-events-none fixed inset-0">
        {/* 左側梅花：更靠左、更大，故意讓邊界被裁切 */}
        <img
          src="/decor/plum.png"
          className="absolute left-[-140px] top-[-40px] w-[520px] opacity-95"
          alt=""
        />
          {/* 鞭炮：移到主標題右方，跟梅花同一高度（平行） */}
         <img
           src="/decor/firecracker.png"
           alt=""
           className="absolute left-1/2 top-[25px] translate-x-[540px] w-[360px] opacity-95"
        />
        {/* 春( spring.png )：靠主標題右側，但不要跟鞭炮重疊 */}
        <img
           src="/decor/spring.png"
           alt=""
           className="absolute left-1/2 top-[26px] translate-x-[260px] w-[78px] opacity-95"
        />
        {/* 福( spring2.png )：靠主標題左側 */}
        <img
          src="/decor/spring2.png"
          alt=""
          className="absolute left-1/2 top-[26px] translate-x-[-340px] w-[78px] opacity-95"
        />
        {/* flower 系列往下移，避免跟梅花重疊 */}
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
        {/* ✅ 主標題：純紅色 */}
        <header className="text-center">
          <div className="inline-flex items-center justify-center gap-6">
            <h1 className="text-5xl font-black tracking-wide text-red-700">
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
            <span className="opacity-80">更新時間：{fmtTW(state?.updated_at)}</span>
          </div>

          {err ? <div className="mt-2 text-sm text-red-700">{err}</div> : null}
        </header>

        {/* ✅ 你說的「貓咪黑白第一行」要刪掉：所以這整塊不再顯示 */}
        {/* <section className="..."> ... </section> */}

        {/* 結果清單 */}
        <section className="mt-8 space-y-6">
          {displayItems.map((item) => {
            const cat = catMap.get(item.catId);
            const title = `${item.catId}號貓咪｜${item.catName}`;

            return (
              <div
                key={item.catId}
                className="rounded-[28px] border-4 border-red-700 bg-white/95 px-6 py-6 shadow-sm"
              >
                <div className="flex gap-4">
                  {/* 貓照片（有就顯示，沒就略過） */}
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
            <div className="rounded-xl border bg-white/80 p-6 text-center text-lg">
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
    <div className="flex gap-3">
      <div className="w-24 shrink-0 font-black">{label}：</div>
      <div className="font-semibold">{tail || "—"}</div>
    </div>
  );
}
