"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type LiveStateRow = {
  id: number;
  phase: "preview" | "draw" | string;
  selected_cat_ids: number[] | null;
  results: any; // jsonb
  updated_at: string | null;
};

type CatRow = {
  id: number;
  name: string;
  uid?: string | null; // 你現在貓名後面那串 (9000...) 如果不是 uid，下面會自動 fallback
  code?: string | null; // 有些人叫 code / serial
  image_url?: string | null;
};

type Winner = {
  rank: "正取" | "備取1" | "備取2";
  name?: string;
  township?: string;
  town?: string;
  area?: string;
};

type ResultItem = {
  catId: number;
  catName: string;
  catUid?: string;
  imageUrl?: string;
  winners: Winner[];
};

function toIntArray(x: any): number[] {
  if (!x) return [];
  if (Array.isArray(x)) return x.map((n) => Number(n)).filter((n) => Number.isFinite(n));
  return [];
}

function formatTs(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}`;
}

function pickTown(w?: any) {
  if (!w) return "";
  return (w.township || w.town || w.area || "") as string;
}

function formatWinner(w?: any) {
  if (!w || !w.name) return "—";
  const town = pickTown(w);
  return town ? `${town}  ${w.name}` : `${w.name}`;
}

function phaseLabel(phase: string | null | undefined) {
  if (!phase) return "讀取中";
  if (phase === "draw") return "結果出爐";
  if (phase === "preview") return "待抽籤（預覽）";
  return phase;
}

function phaseColorClass(phase: string | null | undefined) {
  if (!phase) return "bg-gray-600";
  if (phase === "draw") return "bg-green-600";
  if (phase === "preview") return "bg-yellow-500";
  return "bg-gray-600";
}

export default function DisplayPage() {
  const [cats, setCats] = useState<CatRow[]>([]);
  const [live, setLive] = useState<LiveStateRow | null>(null);
  const [err, setErr] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);

  const subscribedRef = useRef(false);

  async function loadCats() {
    setErr("");
    // 你 cats 表確定有 image_url
    const { data, error } = await supabase
      .from("cats")
      .select("id,name,uid,code,image_url,active")
      .eq("active", true)
      .order("id", { ascending: true });

    if (error) {
      setErr("讀取 cats 失敗：" + error.message);
      setCats([]);
      return;
    }
    setCats((data ?? []) as CatRow[]);
  }

  async function loadLive() {
    setErr("");
    const { data, error } = await supabase
      .from("live_state")
      .select("id,phase,selected_cat_ids,results,updated_at")
      .eq("id", 1)
      .single();

    if (error) {
      setErr("讀取 live_state 失敗：" + error.message);
      setLive(null);
      return;
    }
    setLive(data as LiveStateRow);
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadCats(), loadLive()]);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (subscribedRef.current) return;
    subscribedRef.current = true;

    const channel = supabase
      .channel("live_state_watch")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_state", filter: "id=eq.1" },
        async () => {
          await loadLive();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const catMap = useMemo(() => {
    const m = new Map<number, CatRow>();
    for (const c of cats) m.set(Number(c.id), c);
    return m;
  }, [cats]);

  const items: ResultItem[] = useMemo(() => {
    if (!live) return [];
    const selectedIds = toIntArray(live.selected_cat_ids).slice().sort((a, b) => a - b);

    // draw：results 是 array 就用它
    if (live.phase === "draw" && Array.isArray(live.results)) {
      return (live.results as any[])
        .map((it) => {
          const catId = Number(it.catId ?? it.cat_id ?? it.id);
          const cat = catMap.get(catId);

          const catName = (it.catName ?? it.cat_name ?? cat?.name ?? `貓${catId}`) as string;

          const catUid =
            (it.catUid ??
              it.cat_uid ??
              cat?.uid ??
              cat?.code ??
              "") as string;

          const imageUrl =
            (it.imageUrl ??
              it.image_url ??
              cat?.image_url ??
              "") as string;

          const winners = Array.isArray(it.winners) ? (it.winners as Winner[]) : [];
          return { catId, catName, catUid, imageUrl, winners };
        })
        .sort((a, b) => a.catId - b.catId);
    }

    // preview：用 selected_cat_ids 產卡片（沒有結果 → winners 顯示 —）
    return selectedIds.map((catId) => {
      const cat = catMap.get(catId);
      return {
        catId,
        catName: cat?.name ?? `貓${catId}`,
        catUid: (cat?.uid ?? cat?.code ?? "") as string,
        imageUrl: (cat?.image_url ?? "") as string,
        winners: [{ rank: "正取" }, { rank: "備取1" }, { rank: "備取2" }],
      };
    });
  }, [live, catMap]);

  const bg = "#f6f1e6"; // 米白底（你要更黃/更白我再調）
  const titleRed = "#c40000";

  return (
    <main
      className="min-h-screen"
      style={{
        background: bg,
        color: "#000", // 強制真黑，避免夜間模式影響
      }}
    >
      {/* 裝飾：全部走 /decor/ */}
      <div className="pointer-events-none select-none" style={{ position: "fixed", inset: 0, zIndex: 1 }}>
        {/* 左上：梅花（放大並往左上藏邊界） */}
        <img
          src="/decor/plum.png"
          alt=""
          style={{
            position: "absolute",
            left: -120,
            top: -80,
            width: 620,
            opacity: 0.95,
          }}
        />

        {/* 右上：鞭炮（跟標題同高度，右方） */}
        <img
          src="/decor/firecracker.png"
          alt=""
          style={{
            position: "absolute",
            right: -10,
            top: 55,
            width: 260,
            opacity: 0.95,
          }}
        />

        {/* 左下：flower1 往下移避免重疊 */}
        <img
          src="/decor/flower1.png"
          alt=""
          style={{
            position: "absolute",
            left: 30,
            bottom: 10,
            width: 280,
            opacity: 0.95,
          }}
        />

        {/* 右下：flower2 往下移 */}
        <img
          src="/decor/flower2.png"
          alt=""
          style={{
            position: "absolute",
            right: 30,
            bottom: 20,
            width: 280,
            opacity: 0.95,
          }}
        />
      </div>

      <div className="relative mx-auto max-w-[1500px] px-10 py-8" style={{ zIndex: 2 }}>
        {/* Header */}
        <header className="text-center space-y-3">
          <div className="flex items-center justify-center gap-4">
            {/* 左：福 spring2 */}
            <img src="/decor/spring2.png" alt="" className="h-[70px] w-auto" />
            <h1
              className="font-extrabold"
              style={{
                color: titleRed,
                fontSize: 64,
                lineHeight: 1.05,
                letterSpacing: "0.02em",
              }}
            >
              喵星人命定活動
            </h1>
            {/* 右：春 spring */}
            <img src="/decor/spring.png" alt="" className="h-[70px] w-auto" />
          </div>

          <div className="flex items-center justify-center gap-4">
            <span
              className={[
                "inline-flex items-center rounded-full px-6 py-3 font-bold text-white",
                phaseColorClass(live?.phase),
              ].join(" ")}
              style={{ fontSize: 22 }}
            >
              狀態：{phaseLabel(live?.phase)}
            </span>

            <span style={{ fontSize: 22, fontWeight: 700, color: "#111" }}>
              更新時間：{formatTs(live?.updated_at)}
            </span>
          </div>

          {err ? (
            <div
              className="mx-auto max-w-[980px] rounded-2xl border px-6 py-4 text-left"
              style={{
                borderColor: "#fca5a5",
                background: "#fff",
                color: "#b91c1c",
                fontSize: 18,
                fontWeight: 700,
              }}
            >
              {err}
            </div>
          ) : null}
        </header>

        {/* Body */}
        <section className="mt-12">
          {loading ? (
            <div className="text-center" style={{ fontSize: 26, fontWeight: 800, color: "#222" }}>
              讀取中…
            </div>
          ) : items.length === 0 ? (
            <div className="text-center" style={{ fontSize: 26, fontWeight: 800, color: "#222" }}>
              目前沒有資料
            </div>
          ) : (
            <div className="mx-auto w-full max-w-[1220px] space-y-12">
              {items.map((item, idx) => {
                const title = `${item.catId}號貓咪｜${item.catName}`;
                const uid = item.catUid?.trim() ? item.catUid!.trim() : "";
                const imgUrl = item.imageUrl?.trim() ? item.imageUrl!.trim() : "";

                const w0 = item.winners?.find((w: any) => w.rank === "正取");
                const w1 = item.winners?.find((w: any) => w.rank === "備取1");
                const w2 = item.winners?.find((w: any) => w.rank === "備取2");

                return (
                  <section
                    key={`${item.catId}-${idx}`}
                    style={{
                      border: "6px solid #b80000",
                      borderRadius: 34,
                      background: "#fff",
                      padding: "44px 54px",
                      boxShadow: "0 1px 0 rgba(0,0,0,0.06)",
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 340px",
                        alignItems: "center",
                        gap: 50,
                      }}
                    >
                      {/* 左：文字（放大版，取消電話） */}
                      <div style={{ color: "#000" }}>
                        <div
                          style={{
                            fontSize: 44,
                            fontWeight: 900,
                            color: "#b80000",
                            lineHeight: 1.2,
                            marginBottom: 10,
                          }}
                        >
                          {title}
                        </div>

                        {uid ? (
                          <div style={{ fontSize: 30, fontWeight: 800, color: "#000", marginBottom: 18 }}>
                            （{uid}）
                          </div>
                        ) : (
                          <div style={{ height: 12 }} />
                        )}

                        <div style={{ display: "grid", gap: 18, fontSize: 38, fontWeight: 900 }}>
                          <div style={{ display: "flex", gap: 18 }}>
                            <div style={{ minWidth: 120 }}>正 取：</div>
                            <div style={{ fontWeight: 800 }}>{formatWinner(w0)}</div>
                          </div>

                          <div style={{ display: "flex", gap: 18 }}>
                            <div style={{ minWidth: 120 }}>備取1：</div>
                            <div style={{ fontWeight: 800 }}>{formatWinner(w1)}</div>
                          </div>

                          <div style={{ display: "flex", gap: 18 }}>
                            <div style={{ minWidth: 120 }}>備取2：</div>
                            <div style={{ fontWeight: 800 }}>{formatWinner(w2)}</div>
                          </div>
                        </div>
                      </div>

                      {/* 右：圖片（每隻貓都有） */}
                      <div style={{ display: "flex", justifyContent: "center" }}>
                        <div
                          style={{
                            width: 300,
                            height: 300,
                            borderRadius: 18,
                            overflow: "hidden",
                            background: "#f0b24a", // 圖片載入前的底色（你截圖的橘色）
                          }}
                        >
                          {imgUrl ? (
                            <img
                              src={imgUrl}
                              alt={title}
                              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              onError={(e) => {
                                // 如果網址錯，至少不會破版：保留橘色底
                                (e.currentTarget as HTMLImageElement).style.display = "none";
                              }}
                            />
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
