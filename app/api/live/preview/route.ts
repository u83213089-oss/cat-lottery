import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !service) {
    throw new Error("Server missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, service, {
    auth: { persistSession: false },
  });
}

export async function POST(req: Request) {
  try {
    const guard = mustAdmin(req);
    if (guard) return guard;

    const supabase = getAdminSupabase();

    // 1) 讀 live_state 取 selected_cat_ids
    const { data: live, error: liveErr } = await supabase
      .from("live_state")
      .select("id, selected_cat_ids")
      .eq("id", 1)
      .single();

    if (liveErr) throw new Error(liveErr.message);

    const selectedIds: number[] = (live?.selected_cat_ids ?? [])
      .map((x: any) => Number(x))
      .filter((x: number) => Number.isFinite(x))
      .sort((a, b) => a - b);

    if (selectedIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "沒有選貓，無法預覽" },
        { status: 400 }
      );
    }

    // 2) cats 名稱（顯示用）
    const { data: cats, error: catsErr } = await supabase
      .from("cats")
      .select("id,name")
      .in("id", selectedIds);

    if (catsErr) throw new Error(catsErr.message);

    const catNameMap = new Map<number, string>();
    for (const c of cats ?? []) catNameMap.set(c.id, c.name);

    // 3) 組 preview 的 results（winner 先空）
    const resultItems = selectedIds.map((id) => ({
      note: "尚未開獎",
      catId: id,
      catName: catNameMap.get(id) ?? `貓${id}`,
      winners: [],
    }));

    // 4) 寫回 live_state（phase=preview）
    const { error: upErr } = await supabase
      .from("live_state")
      .update({
        phase: "preview",
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
