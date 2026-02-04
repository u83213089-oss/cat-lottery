import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// 強制走 Node（避免 Edge runtime 拿不到 env）
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mustAdmin(req: Request) {
  const key = req.headers.get("x-admin-key") ?? "";
  const expected = process.env.ADMIN_KEY ?? "";

  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "500 Server missing ADMIN_KEY" },
      { status: 500 }
    );
  }

  if (key !== expected) {
    return NextResponse.json(
      { ok: false, error: "401 Unauthorized: bad admin key" },
      { status: 401 }
    );
  }

  return null;
}

function getAdminSupabase() {
  // ✅ server env 優先；NEXT_PUBLIC 只當 fallback（本機有時方便）
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("Server missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)");
  if (!service) throw new Error("Server missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, service, { auth: { persistSession: false } });
}

function normalizeIds(input: unknown): number[] {
  const arr = Array.isArray(input) ? input : [];
  const ids = arr
    .map((x) => Number(x))
    .filter((x): x is number => Number.isFinite(x));

  // 去重 + 排序
  return Array.from(new Set(ids)).sort((a, b) => a - b);
}

export async function POST(req: Request) {
  try {
    const guard = mustAdmin(req);
    if (guard) return guard;

    const supabase = getAdminSupabase();

    // 1) 先吃 body：{ selectedCatIds: number[] }
    //    若沒 body / body 沒傳，就 fallback 用 DB 的 selected_cat_ids
    let body: any = null;
    try {
      body = await req.json();
    } catch {
      body = null;
    }

    let selectedIds = normalizeIds(body?.selectedCatIds);

    if (selectedIds.length === 0) {
      const { data: live, error: liveErr } = await supabase
        .from("live_state")
        .select("id, selected_cat_ids")
        .eq("id", 1)
        .single();

      if (liveErr) throw new Error(liveErr.message);
      selectedIds = normalizeIds(live?.selected_cat_ids);
    }

    if (selectedIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "沒有選貓，無法預覽" },
        { status: 400 }
      );
    }

    // 2) cats 資訊（顯示用）— 你要用哪些欄位就選哪些
    const { data: cats, error: catsErr } = await supabase
      .from("cats")
      .select("id,name,image_url")
      .in("id", selectedIds);

    if (catsErr) throw new Error(catsErr.message);

    const catMap = new Map<number, any>();
    for (const c of cats ?? []) catMap.set(c.id, c);

    // 3) 組 results（winner 先空）
    const resultItems = selectedIds.map((id) => {
      const c = catMap.get(id);
      return {
        note: "尚未開獎",
        catId: id,
        catName: c?.name ?? `貓${id}`,
        imageUrl: c?.image_url ?? null,
        winners: [],
      };
    });

    // 4) 寫回 live_state（phase=preview）
    const { error: upErr } = await supabase
      .from("live_state")
      .update({
        phase: "preview",
        selected_cat_ids: selectedIds, // ✅ 關鍵：把你選的也寫回 DB
        results: resultItems,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);

    if (upErr) throw new Error(upErr.message);

    return NextResponse.json({ ok: true, cats: selectedIds.length });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "unknown" },
      { status: 500 }
    );
  }
}