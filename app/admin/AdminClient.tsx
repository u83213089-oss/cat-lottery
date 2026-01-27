"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type CatRow = {
  id: number;
  name: string;
  is_popular: boolean;
  active: boolean;
  image_url?: string | null;
};

type ApiOk = { ok: true };
type ApiErr = { ok: false; error: string };

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function fetchJson<T>(url: string, body: any): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // 這個 key 會用來通過你的 API / RLS header 驗證
      "x-admin-key": process.env.NEXT_PUBLIC_ADMIN_KEY ?? "",
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
  return json as T;
}

export default function AdminClient() {
  const [cats, setCats] = useState<CatRow[]>([]);
  const [msg, setMsg] = useState<string>("");

  // 人氣：單選；其他：複選
  const [popularSelected, setPopularSelected] = useState<number | null>(null);
  const [otherSelected, setOtherSelected] = useState<number[]>([]);

  const popularCats = useMemo(() => cats.filter((c) => c.is_popular), [cats]);
  const otherCats = useMemo(() => cats.filter((c) => !c.is_popular), [cats]);

  const selectedCatIds = useMemo(() => {
    const ids = new Set<number>();
    if (popularSelected != null) ids.add(popularSelected);
    otherSelected.forEach((id) => ids.add(id));
    return Array.from(ids).sort((a, b) => a - b);
  }, [popularSelected, otherSelected]);

  function toggleOther(id: number) {
    setOtherSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function loadCats() {
    setMsg("");

    // 先嘗試讀 image_url（你若還沒加欄位，這裡會報錯）
    let { data, error } = await supabase
      .from("cats")
      .select("id,name,is_popular,active,image_url")
      .eq("active", true)
      .order("id", { ascending: true });

    // fallback：沒有 image_url 欄位就改用舊欄位
    if (error && String(error.message).includes("image_url")) {
      const retry = await supabase
        .from("cats")
        .select("id,name,is_popular,active")
        .eq("active", true)
        .order("id", { ascending: true });
      data = retry.data as any;
      error = retry.error;
    }

    if (error) {
      setMsg("讀取 cats 失敗：" + error.message);
      setCats([]);
      return;
    }

    setCats((data ?? []) as CatRow[]);
  }

  useEffect(() => {
    loadCats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pushPreview() {
    setMsg("");
    if (selectedCatIds.length === 0) return setMsg("請先選擇至少 1 隻貓");

    try {
      const r = await fetchJson<ApiOk | ApiErr>("/api/live/preview", {
        selectedCatIds,
      });
      if (!("ok" in r) || (r as any).ok !== true) throw new Error((r as any).error);
      setMsg("✅ 已推送預覽到 /display（尚未出結果）");
    } catch (e: any) {
      setMsg("預覽失敗：" + (e?.message ?? String(e)));
    }
  }

  async function doDraw() {
    setMsg("");
    if (selectedCatIds.length === 0) return setMsg("請先選擇至少 1 隻貓");

    try {
      const r = await fetchJson<ApiOk | ApiErr>("/api/live/draw", {
        selectedCatIds,
      });
      if (!("ok" in r) || (r as any).ok !== true) throw new Error((r as any).error);
      setMsg("🎉 已抽籤並推送結果到 /display");
    } catch (e: any) {
      setMsg("抽籤失敗：" + (e?.message ?? String(e)));
    }
  }

  function clearSelection() {
    setPopularSelected(null);
    setOtherSelected([]);
  }

  return (
    <main className="min-h-screen p-10">
      <div className="max-w-5xl mx-auto space-y-8">
        <h1 className="text-3xl font-bold">抽籤管理端</h1>
        <div className="text-sm opacity-70">
          人氣貓可單點指定；其他貓可複選。先「預覽」再「抽籤」。
        </div>

        {msg ? (
          <div className="rounded-xl border px-4 py-3 text-sm">{msg}</div>
        ) : null}

        <section className="space-y-3">
          <div className="text-xl font-semibold">人氣貓（單點指定）</div>
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

        <section className="space-y-3">
          <div className="text-xl font-semibold">
            目前選取：{selectedCatIds.length ? selectedCatIds.join(", ") : "—"}
          </div>

          <div className="rounded-2xl border p-6 flex flex-wrap gap-3 items-center">
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
              className="rounded-xl border px-5 py-3 text-lg bg-white"
            >
              清空選取
            </button>

            <div className="ml-auto">
              <button
                onClick={loadCats}
                className="text-sm underline opacity-70"
              >
                重新讀取貓咪清單
              </button>
            </div>
          </div>

          <div className="text-xs opacity-60">
            小提醒：如果你現在還沒放 applications 報名名單，抽籤結果可能會是空/—（正常）。
          </div>
        </section>
      </div>
    </main>
  );
}
