import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * 這支 API：Admin 點「預覽」用
 * - phase -> "preview"
 * - selected_cat_ids -> number[]
 * - results -> 預覽卡片資料（winners 空陣列）
 *
 * 回傳一定是 200 + JSON（不要 204）
 */

// 用 Service Role key 才能穩定寫入（避免被 RLS 擋）
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

type PreviewBody = {
  selectedCatIds?: Array<number | string>;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PreviewBody;

    // 1) 強制轉 number[]，並過濾 NaN
    const selectedIds = (body.selectedCatIds ?? [])
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n));

    if (selectedIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "selectedCatIds is empty" },
        { status: 400 }
      );
    }

    // 2) 撈 cats（用來組 results 的 catName）
    const { data: cats, error: catErr } = await supabase
      .from("cats")
      .select("id,name")
      .in("id", selectedIds);

    if (catErr) {
      console.error("[preview] load cats error:", catErr);
      return NextResponse.json(
        { ok: false, error: catErr.message },
        { status: 500 }
      );
    }

    const catMap = new Map<number, string>();
    (cats ?? []).forEach((c) => catMap.set(c.id, c.name));

    // 3) 組 results：照你選的順序
    const results = selectedIds.map((id) => ({
      catId: id,
      catName: catMap.get(id) ?? `貓 ${String(id).padStart(2, "0")}`,
      note: "尚未抽籤",
      winners: [],
    }));

    // 4) 寫入 live_state (固定 id=1)
    const payload = {
      phase: "preview",
      selected_cat_ids: selectedIds, // int4[] 一定要 number[]
      results: results, // jsonb
      updated_at: new Date().toISOString(),
    };

    const { data: updated, error: upErr } = await supabase
      .from("live_state")
      .update(payload)
      .eq("id", 1)
      .select("id, phase, selected_cat_ids, results, updated_at")
      .single();

    if (upErr) {
      console.error("[preview] update live_state error:", upErr);
      return NextResponse.json(
        { ok: false, error: upErr.message },
        { status: 500 }
      );
    }

    // 5) 一律回 200 + JSON（不要 204）
    return NextResponse.json({
      ok: true,
      message: "preview updated",
      state: updated,
    });
  } catch (e: any) {
    console.error("[preview] unexpected error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}

// 你如果不小心用 GET 打到它，會看到 405（正常）
export function GET() {
  return NextResponse.json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
}
