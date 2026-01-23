"use client";

import { useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type Winner = {
  rank: "正取" | "備取1" | "備取2";
  name: string;
  uid?: string;
};

type ResultItem = {
  note?: string;
  catId: number;
  catName: string;
  winners: Winner[];
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    global: {
      headers: {
        // 你前面已經把 RLS update 綁這個 header 了
        "x-admin-key": process.env.NEXT_PUBLIC_ADMIN_KEY!,
      },
    },
  }
);

// 先用你目前 cats 表的資料：假設你有 cats(id, name, is_popular, active)
// 如果欄位不同，跟我說一下你 cats 表欄位，我再幫你對齊。
type CatRow = {
  id: number;
  name: string;
  is_popular: boolean;
  active: boolean;
};

export default function AdminClient() {
  const [cats, setCats] = useState<CatRow[] | null>(null);
  const [popularSelected, setPopularSelected] = useState<number | null>(null);
  const [otherSelected, setOtherSelected] = useState<number[]>([]);
  const [msg, setMsg] = useState<string>("");

  async function loadCats() {
    setMsg("");
    const { data, error } = await supabase
      .from("cats")
      .select("id,name,is_popular,active")
      .eq("active", true)
      .order("id", { ascending: true });

    if (error) return setMsg("讀取 cats 失敗：" + error.message);
    setCats((data ?? []) as CatRow[]);
  }

  // 進頁面先抓一次 cats
  useMemo(() => {
    if (!cats) loadCats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cats]);

  const popularCats = (cats ?? []).filter((c) => c.is_popular);
  const otherCats = (cats ?? []).filter((c) => !c.is_popular);

  const selectedCatIds = useMemo(() => {
    const ids = new Set<number>();
    if (popularSelected) ids.add(popularSelected);
    for (const id of otherSelected) ids.add(id);
    return Array.from(ids);
  }, [popularSelected, otherSelected]);

  async function pushPreview() {
    setMsg("");
    const ids = selectedCatIds;
    if (ids.length === 0) return setMsg("請先選擇至少 1 隻貓");

    const { error } = await supabase
      .from("live_state")
      .update({
        phase: "preview",
        selected_cat_ids: ids,
        results: [] as any, // preview 階段先清空
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);

    if (error) return setMsg("預覽失敗：" + error.message);
    setMsg("✅ 已推送預覽到 /display（尚未出結果）");
  }

  async function doDraw() {
    setMsg("");
    const ids = selectedCatIds;
    if (ids.length === 0) return setMsg("請先選擇至少 1 隻貓");

    // 目前你還沒放 applications 報名名單，所以先做「沒有報名 → winners 空」的結果
    // 等你把報名資料放進 applications，我們再把這段替換成真的抽籤邏輯。
    const resultItems: ResultItem[] = ids.map((id) => {
      const catName =
        (cats ?? []).find((c) => c.id === id)?.name ?? `貓${id}`;
      return {
        note: "目前無人報名",
        catId: id,
        catName,
        winners: [],
      };
    });

    const { error } = await supabase
      .from("live_state")
      .update({
        phase: "draw",
        selected_cat_ids: ids,
        results: resultItems as any,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);

    if (error) return setMsg("抽籤失敗：" + error.message);
    setMsg("🎉 已產生本輪結果並推送到 /display");
  }

  function toggleOther(id: number) {
    setOtherSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  return (
    <main className="min-h-screen p-10">
      <div className="max-w-5xl mx-auto space-y-8">
        <h1 className="text-3xl font-bold">抽籤管理端（Supabase 抽籤版）</h1>

        {msg ? <div className="text-sm opacity-80">{msg}</div> : null}

        <section className="space-y-3">
          <div className="text-xl font-semibold">人氣貓（單點指定）</div>
          <div className="flex flex-wrap gap-3">
            {popularCats.map((c) => (
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
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <div className="text-xl font-semibold">其他貓（可複選）</div>
          <div className="flex flex-wrap gap-3">
            {otherCats.map((c) => (
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
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <div className="text-xl font-semibold">
            目前選取：{selectedCatIds.length ? selectedCatIds.join(", ") : "—"}
          </div>
          <div className="flex gap-3">
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
          </div>
        </section>
      </div>
    </main>
  );
}
