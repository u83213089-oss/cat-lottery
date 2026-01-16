"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type CatRow = {
  id: number;
  name: string;
  is_popular: boolean;
  sort_order: number;
  active: boolean;
};

export default function AdminClient() {
  // ======= 管理密碼鎖（前端）=======
  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(false);
  const [authErr, setAuthErr] = useState("");

  async function checkPassword() {
    const res = await fetch("/api/admin-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      setAuthed(true);
      setAuthErr("");
    } else {
      setAuthErr("密碼錯誤");
    }
  }

  // ======= cats 清單 + 選取 =======
  const [cats, setCats] = useState<CatRow[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");

  const popular = useMemo(() => cats.filter((c) => c.is_popular), [cats]);
  const normal = useMemo(() => cats.filter((c) => !c.is_popular), [cats]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr("");
      const { data, error } = await supabase
        .from("cats")
        .select("id,name,is_popular,sort_order,active")
        .eq("active", true)
        .order("sort_order", { ascending: true });

      if (error) setErr(error.message);
      setCats(data ?? []);
      setLoading(false);
    })();
  }, []);

  function toggleCat(id: number) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }
  function selectSingle(id: number) {
    setSelected([id]);
  }

  // ======= 預覽 / 抽籤 =======
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function preview() {
    if (!password) return setMsg("請先輸入管理密碼");
    if (selected.length === 0) return setMsg("請先選擇要抽的貓");
    setBusy(true);
    setMsg("");

    const res = await fetch("/api/live/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, selectedCatIds: selected }),
    });

    setBusy(false);
    if (!res.ok) return setMsg("預覽失敗（請確認密碼與環境變數）");
    setMsg("✅ 已推送到直播頁（預覽：未出結果）");
  }

  async function draw() {
    if (!password) return setMsg("請先輸入管理密碼");
    if (selected.length === 0) return setMsg("請先選擇要抽的貓");
    setBusy(true);
    setMsg("");

    const res = await fetch("/api/live/draw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, selectedCatIds: selected }),
    });

    setBusy(false);
    if (!res.ok) return setMsg("抽籤失敗（可能是 service role key 未設定或資料不足）");
    setMsg("🎉 抽籤完成，直播頁已更新結果");
  }

  // ======= 未登入畫面 =======
  if (!authed) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-4">
          <h1 className="text-2xl font-bold text-center">管理端登入</h1>

          <input
            type="password"
            className="w-full border rounded px-4 py-3"
            placeholder="請輸入管理密碼"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {authErr && <div className="text-red-600 text-sm text-center">{authErr}</div>}

          <button
            onClick={checkPassword}
            className="w-full bg-black text-white py-3 rounded"
          >
            進入管理端
          </button>
        </div>
      </main>
    );
  }

  // ======= 登入後管理畫面 =======
  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">抽籤管理端（Supabase 抽籤版）</h1>

      {loading && <div>讀取貓名單中…</div>}
      {err && <div className="text-red-600">錯誤：{err}</div>}

      {!loading && !err && (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">人氣貓（單點指定）</h2>
            <div className="flex flex-wrap gap-2">
              {popular.map((c) => (
                <button
                  key={c.id}
                  onClick={() => selectSingle(c.id)}
                  className={`rounded px-3 py-2 border ${
                    selected.length === 1 && selected[0] === c.id ? "bg-black text-white" : ""
                  }`}
                >
                  {c.id}號 {c.name}
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">其他貓（可複選）</h2>
            <div className="flex flex-wrap gap-2">
              {normal.map((c) => (
                <button
                  key={c.id}
                  onClick={() => toggleCat(c.id)}
                  className={`rounded px-3 py-2 border ${
                    selected.includes(c.id) ? "bg-black text-white" : ""
                  }`}
                >
                  {c.id}號 {c.name}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded border p-4 space-y-3">
            <div className="font-semibold">目前選取：</div>
            <div className="opacity-80">{selected.length ? selected.join(", ") : "尚未選取"}</div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={preview}
                disabled={busy}
                className="rounded px-4 py-2 border"
              >
                預覽（推到直播頁，未出結果）
              </button>
              <button
                onClick={draw}
                disabled={busy}
                className="rounded px-4 py-2 bg-black text-white"
              >
                抽籤（產生正取/備取）
              </button>
            </div>

            {msg && <div className="text-sm opacity-80">{msg}</div>}
          </section>
        </>
      )}
    </main>
  );
}
