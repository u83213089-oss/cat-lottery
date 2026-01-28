"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

/** ===== Supabase Client ===== */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/** ===== Types ===== */
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
  uid?: string | null;
  image_url?: string | null;
  active?: boolean;
  is_popular?: boolean;
};

type Winner = {
  rank: "正取" | "備取1" | "備取2";
  name?: string;
  township?: string; // 你之後要加在 applicants 的鄉鎮，抽籤結果帶出來也會吃得到
  town?: string;
  area?: string;
  // phone 不用，也不顯示
};

type ResultItem = {
  note?: string;
  catId: number;
  catName: string;
  catUid?: string;
  imageUrl?: string;
  winners: Winner[];
};

/** ===== Helpers ===== */
function toIntArray(x: any): number[] {
  if (!x) return [];
  if (Array.isArray(x)) return x.map((n) => Number(n)).filter((n) => Number.isFinite(n));
  return [];
}

function formatTs(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  // 台灣常用顯示：YYYY/M/D HH:mm:ss
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
  // ✅ 不顯示 phone（也不遮罩）
  return town ? `${town}  ${w.name}` : `${w.name}`;
}

/** ===== Page ===== */
export default function DisplayPage() {
  const [cats, setCats] = useState<CatRow[]>([]);
  const [live, setLive] = useState<LiveStateRow | null>(null);
  const [err, setErr] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);

  // 防止重複訂閱
  const subscribedRef = useRef(false);

  /** 讀 cats：先嘗試含 image_url + uid；若欄位不存在就 fallback */
  async function loadCats() {
    setErr("");
    // 1) 先試含 image_url + uid（你現在已經加了 image_url）
    {
      const { data, error } = await supabase
        .from("cats")
        .select("id,name,uid,image_url,active,is_popular")
        .order("id", { ascending: true });

      if (!error && data) {
        setCats(data as CatRow[]);
        return;
      }
    }

    // 2) fallback：只抓最基本欄位，避免因欄位不存在整個壞掉
    {
      const { data, error } = await supabase
        .from("cats")
        .select("id,name,active,is_popular")
        .order("id", { ascending: true });

      if (error) {
        setErr("讀取 cats 失敗：" + error.message);
        setCats([]);
        return;
      }
      setCats((data ?? []) as CatRow[]);
    }
  }

  /** 讀 live_state(id=1) */
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

  /** 初始化 */
  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadCats(), loadLive()]);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Realtime 訂閱 live_state 的 UPDATE */
  useEffect(() => {
    if (subscribedRef.current) return;
    subscribedRef.current = true;

    const channel = supabase
      .channel("live_state_watch")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_state", filter: "id=eq.1" },
        async () => {
          // 有變更就重新抓一次（最穩）
          await loadLive();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 建立 cats map，方便拿 image_url / uid */
  const catMap = useMemo(() => {
    const m = new Map<number, CatRow>();
    for (const c of cats) m.set(Number(c.id), c);
    return m;
  }, [cats]);

  /** 將 live_state 轉成要顯示的 items（preview/draw 都吃同一套卡片） */
  const items: ResultItem[] = useMemo(() => {
    if (!live) return [];

    const selectedIds = toIntArray(live.selected_cat_ids).slice().sort((a, b) => a - b);

    // draw：如果 results 是 array，就用 results
    if (live.phase === "draw" && Array.isArray(live.results)) {
      const arr = live.results as any[];
      return arr
        .map((it) => {
          const catId = Number(it.catId ?? it.cat_id ?? it.id);
          const cat = catMap.get(catId);
          const catName = (it.catName ?? it.cat_name ?? cat?.name ?? `貓${catId}`) as string;
          const catUid = (it.catUid ?? it.cat_uid ?? cat?.uid ?? "") as string;
          const imageUrl = (it.imageUrl ?? it.image_url ?? cat?.image_url ?? "") as string;

          const winners = Array.isArray(it.winners) ? (it.winners as Winner[]) : [];

          return {
            note: it.note ?? "",
            catId,
            catName,
            catUid,
            imageUrl,
            winners,
          } as ResultItem;
        })
        .sort((a, b) => a.catId - b.catId);
    }

    // preview：用 selected_cat_ids 產生卡片，結果空，右上角顯示「尚未開獎」
    return selectedIds.map((catId) => {
      const cat = catMap.get(catId);
      return {
        note: "尚未開獎",
        catId,
        catName: cat?.name ?? `貓${catId}`,
        catUid: cat?.uid ?? "",
        imageUrl: cat?.image_url ?? "",
        winners: [
          { rank: "正取" },
          { rank: "備取1" },
          { rank: "備取2" },
        ],
      } as ResultItem;
    });
  }, [live, catMap]);

  const statusLabel = useMemo(() => {
    if (!live) return "讀取中";
    if (live.phase === "draw") return "結果出爐";
    if (live.phase === "preview") return "待抽籤（預覽）";
    return String(live.phase || "—");
  }, [live]);

  const statusClass = useMemo(() => {
    if (!live) return "bg-gray-500";
    if (live.phase === "draw") return "bg-green-600";
    if (live.phase === "preview") return "bg-yellow-500";
    return "bg-gray-600";
  }, [live]);

  return (
    <main
      className="min-h-screen"
      style={{
        background: "#e9ddc7", // ✅ 米白底（你目前就是這色系）
      }}
    >
      {/* === 裝飾（你如果檔名不同，改成你 public 裡的檔名）=== */}
      {/* 不想要任何裝飾，把這整段刪掉也不影響中間卡片 */}
      <div className="pointer-events-none select-none">
        {/* 左上梅花（放大、往左切邊） */}
        <img
          src="/plum.png"
          alt=""
          className="fixed left-[-60px] top-[-40px] w-[520px] opacity-95"
          style={{ zIndex: 1 }}
        />
        {/* 右上鞭炮（放大） */}
        <img
          src="/firecrackers.png"
          alt=""
          className="fixed right-[-10px] top-[40px] w-[240px] opacity-95"
          style={{ zIndex: 1 }}
        />
        {/* 左下花 */}
        <img
          src="/flower1.png"
          alt=""
          className="fixed left-[30px] bottom-[40px] w-[260px] opacity-95"
          style={{ zIndex: 1 }}
        />
        {/* 右下花 */}
        <img
          src="/flower2.png"
          alt=""
          className="fixed right-[30px] bottom-[60px] w-[260px] opacity-95"
          style={{ zIndex: 1 }}
        />
      </div>

      {/* === 主內容 === */}
      <div className="relative mx-auto max-w-[1400px] px-8 py-8" style={{ zIndex: 2 }}>
        {/* 標題列 */}
        <header className="text-center space-y-3">
          <div className="flex items-center justify-center gap-3">
            {/* 左春聯：福 */}
            <img src="/spring2.png" alt="" className="h-[64px] w-auto" />
            <h1 className="text-[56px] font-extrabold" style={{ color: "#c40000" }}>
              喵星人命定配對活動
            </h1>
            {/* 右春聯：春 */}
            <img src="/spring.png" alt="" className="h-[64px] w-auto" />
          </div>

          <div className="flex items-center justify-center gap-4">
            <span
              className={[
                "inline-flex items-center rounded-full px-5 py-2 text-[22px] font-bold text-white",
                statusClass,
              ].join(" ")}
            >
              狀態：{statusLabel}
            </span>
            <span className="text-[22px] font-semibold text-black/80">
              更新時間：{formatTs(live?.updated_at)}
            </span>
          </div>

          {err ? (
            <div className="mx-auto max-w-[900px] rounded-2xl border border-red-300 bg-white px-6 py-4 text-left text-[18px] text-red-700">
              {err}
            </div>
          ) : null}
        </header>

        {/* 中間卡片（2 倍大版本） */}
        <section className="mt-10">
          {loading ? (
            <div className="text-center text-[24px] font-bold text-black/70">讀取中…</div>
          ) : items.length === 0 ? (
            <div className="text-center text-[24px] font-bold text-black/70">目前沒有資料</div>
          ) : (
            <div className="mx-auto w-full max-w-[1200px] space-y-10">
              {items.map((item, idx) => {
                const title = `${item.catId}號貓咪｜${item.catName}`;
                const imgUrl = item.imageUrl || "";

                const w0 = item.winners?.find((w: any) => w.rank === "正取");
                const w1 = item.winners?.find((w: any) => w.rank === "備取1");
                const w2 = item.winners?.find((w: any) => w.rank === "備取2");

                return (
                  <section
                    key={`${item.catId}-${idx}`}
                    className="
                      relative
                      rounded-[32px]
                      border-[6px] border-red-700
                      bg-white
                      px-12 py-10
                      shadow-sm
                    "
                  >
                    <div className="grid grid-cols-[1fr_360px] items-center gap-12">
                      {/* 左：文字區（放大 + 真黑） */}
                      <div className="space-y-6">
                        <div className="text-[40px] font-extrabold text-red-700 leading-tight">
                          {title}
                        </div>

                        {/* UID（括號那串），有就顯示；沒有就不顯示 */}
                        {item.catUid ? (
                          <div className="text-[26px] font-semibold text-black">
                            （{item.catUid}）
                          </div>
                        ) : null}

                        <div className="space-y-4 text-[34px] font-extrabold text-black">
                          <div className="flex gap-6">
                            <div className="min-w-[110px]">正 取：</div>
                            <div className="font-semibold text-black">{formatWinner(w0)}</div>
                          </div>
                          <div className="flex gap-6">
                            <div className="min-w-[110px]">備取1：</div>
                            <div className="font-semibold text-black">{formatWinner(w1)}</div>
                          </div>
                          <div className="flex gap-6">
                            <div className="min-w-[110px]">備取2：</div>
                            <div className="font-semibold text-black">{formatWinner(w2)}</div>
                          </div>
                        </div>

                        {/* 右上角狀態小字 */}
                        <div className="absolute right-10 top-10 text-[22px] font-semibold text-black/70">
                          {item.note || ""}
                        </div>
                      </div>

                      {/* 右：貓圖（每張卡都有） */}
                      <div className="flex justify-center">
                        <div
                          className="
                            h-[300px] w-[300px]
                            rounded-[16px]
                            bg-[#f0b24a]
                            overflow-hidden
                          "
                        >
                          {imgUrl ? (
                            <img
                              src={imgUrl}
                              alt={title}
                              className="h-full w-full object-cover"
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              onError={(e) => {
                                // 圖壞掉就隱藏，保留橘色底
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
