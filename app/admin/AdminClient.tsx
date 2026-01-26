"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type CatRow = {
  id: number;
  name: string;
  is_popular: boolean;
  active: boolean;
  image_url?: string | null; // 如果你之後 cats 表加圖片欄位可以用
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function toIntArray(input: any[]): number[] {
  return input
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n > 0);
}

export default function AdminClient() {
  const [cats, setCats] = useState<CatRow[]>([]);
  const [loadingCats, setLoadingCats] = useState(false);

  // 人氣貓：單選
  const [popularSelected, setPopularSelected] = useState<number | null>(null);
  // 其他貓：多選
  const [otherSelected, setOtherSelected] = useState<number[]>([]);
  const [msg, setMsg] = useState("");

  // 讀 cats
  async function loadCats() {
    setLoadingCats(true);
    setMsg("");
    const { data, error } = await supabase
      .from("cats")
      .select("id,name,is_popular,active,image_url")
      .eq("active", true)
      .order("id", { ascending: true });

    setLoadingCats(false);

    if (error) {
      console.error(error);
      setMsg("讀取 cats 失敗：" + error.message);
      return;
    }
    setCats((data ?? []) as CatRow[]);
  }

  useEffect(() => {
    loadCats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const popularCats = useMemo(
    () => cats.filter((c) => c.is_popular),
    [cats]
  );
  const otherCats = useMemo(
    () => cats.filter((c) => !c.is_popular),
    [cats]
  );

  const selectedCatIds = useMemo(() => {
    const ids = new Set<number>();
    if (popularSelected != null) ids.add(popularSelected);
    for (const id of otherSelected) ids.add(id);
    return Array.from(ids);
  }, [popularSelected, otherSelected]);

  function toggleOther(id: number) {
    setOtherSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function clearSelection() {
    setPopularSelected(null);
    setOtherSelected([]);
    setMsg("");
  }

  async function pushPreview() {
  setMsg("");
  const ids = selectedCatIds;
  if (ids.length === 0) return setMsg("請先選擇至少 1 隻貓");

  const placeholderWinners = [
    { rank: "正取", name: "—", uid: "—" },
    { rank: "備取1", name: "—", uid: "—" },
    { rank: "備取2", name: "—", uid: "—" },
  ] as const;

  const previewItems = ids.map((id) => {
    const catName = (cats ?? []).find((c) => c.id === id)?.name ?? `貓${id}`;
    return {
      note: "待抽籤（預覽）",
      catId: id,
      catName,
      winners: placeholderWinners, // ✅ 這裡讓 /display 有東西可以畫
    };
  });

  const { error } = await supabase
    .from("live_state")
    .update({
      phase: "preview",
      selected_cat_ids: ids,
      results: previewItems as any, // ✅ 不再是 []
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  if (error) return setMsg("預覽失敗：" + error.message);
  setMsg("✅ 已推送預覽到 /display（尚未出結果）");
}


  async function doDraw() {
    setMsg("");
    const ids = toIntArray(selectedCatIds);
    if (ids.length === 0) return setMsg("請先選擇至少 1 隻貓");

    // 這裡改走 API，比前端直寫 supabase 穩（不會被 RLS / CORS / 型別搞）
    const res = await fetch("/api/live/draw", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": process.env.NEXT_PUBLIC_ADMIN_KEY!,
      },
      body: JSON.stringify({ selectedCatIds: ids }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("draw failed", res.status, json);
      return setMsg(`抽籤失敗：${res.status} ${json?.error ?? ""}`);
    }

    setMsg("🎉 已產生本輪結果並推送到 /display");
  }

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold">抽籤管理端</h1>
          <div className="text-sm opacity-70">
            人氣貓可單點指定；其他貓可複選。先「預覽」再「抽籤」。
          </div>
          {msg ? (
            <div className="text-sm rounded-lg border p-3 bg-white">
              {msg}
            </div>
          ) : null}
        </header>

        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="text-xl font-semibold">人氣貓（單點指定）</div>
            {loadingCats ? <div className="text-sm opacity-60">讀取中…</div> : null}
            <button
              onClick={loadCats}
              className="ml-auto text-sm underline opacity-70 hover:opacity-100"
            >
              重新讀取貓咪清單
            </button>
          </div>

          <div className="flex flex-wrap gap-3">
            {popularCats.length === 0 ? (
              <div className="text-sm opacity-70">（目前沒有設定人氣貓）</div>
            ) : (
              popularCats.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setPopularSelected(c.id)}
                  className={[
                    "rounded-xl border px-4 py-3 text-lg",
                    popularSelected === c.id ? "bg-black text-white" : "bg-white",
                  ].join(" ")}
                >
                  {c.id}號 {c.name}
                </button>
              ))
            )}
          </div>
        </section>

        <section className="space-y-3">
          <div className="text-xl font-semibold">其他貓（可複選）</div>
          <div className="flex flex-wrap gap-3">
            {otherCats.length === 0 ? (
              <div className="text-sm opacity-70">（目前沒有其他貓）</div>
            ) : (
              otherCats.map((c) => (
                <button
                  key={c.id}
                  onClick={() => toggleOther(c.id)}
                  className={[
                    "rounded-xl border px-4 py-3 text-lg",
                    otherSelected.includes(c.id)
                      ? "bg-black text-white"
                      : "bg-white",
                  ].join(" ")}
                >
                  {c.id}號 {c.name}
                </button>
              ))
            )}
          </div>
        </section>

        <section className="rounded-2xl border p-5 bg-white space-y-4">
          <div className="text-lg font-semibold">
            目前選取：{" "}
            {selectedCatIds.length ? selectedCatIds.join(", ") : "—"}
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={pushPreview}
              className="rounded-xl border px-5 py-3 text-lg bg-white"
            >
              預覽（推到直播頁，未出結果）
            </button>
            <button
              onClick={doDraw}
              className="rounded-xl border px-5 py-3 text-lg bg-black text-white"
            >
              抽籤（產生正取/備取）
            </button>
            <button
              onClick={clearSelection}
              className="rounded-xl border px-5 py-3 text-lg opacity-80 hover:opacity-100"
            >
              清空選取
            </button>
          </div>

          <div className="text-xs opacity-60">
            小提醒：如果你現在還沒放 applications 報名名單，抽籤結果可能會是空（這正常）。
          </div>
        </section>
      </div>
    </main>
  );
}
