import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mustAdmin(req: Request) {
  const key = req.headers.get("x-admin-key") ?? "";
  const expected = process.env.ADMIN_KEY ?? process.env.NEXT_PUBLIC_ADMIN_KEY ?? "";
  if (!expected) {
    return NextResponse.json({ ok: false, error: "500 Server missing ADMIN_KEY" }, { status: 500 });
  }
  if (key !== expected) {
    return NextResponse.json({ ok: false, error: "401 Unauthorized: bad admin key" }, { status: 401 });
  }
  return null;
}

function srv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("Server missing SUPABASE_URL");
  if (!service) throw new Error("Server missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, service, { auth: { persistSession: false } });
}

export async function POST(req: Request) {
  try {
    const guard = mustAdmin(req);
    if (guard) return guard;

    const body = await req.json().catch(() => ({}));
    const selectedCatIds: number[] = Array.isArray(body?.selectedCatIds)
      ? body.selectedCatIds.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n)).sort((a: number, b: number) => a - b)
      : [];

    if (selectedCatIds.length === 0) {
      return NextResponse.json({ ok: false, error: "沒有選貓，無法預覽" }, { status: 400 });
    }

    const s = srv();

    // 讀名稱做顯示
    const { data: cats, error: catsErr } = await s
      .from("cats")
      .select("id,name")
      .in("id", selectedCatIds);
    if (catsErr) throw new Error(catsErr.message);

    const nameMap = Object.fromEntries((cats ?? []).map(c => [c.id, c.name as string]));

    const results = selectedCatIds.map(id => ({
      note: "尚未開獎",
      catId: id,
      catName: nameMap[id] ?? `貓${id}`,
      winners: [],
    }));

    // 一次把 selected_cat_ids + results + phase + updated_at 寫回
    const { data: updated, error: upErr } = await s
      .from("live_state")
      .update({
        phase: "preview",
        selected_cat_ids: selectedCatIds,
        results,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1)
      .select()
      .single(); // 回傳更新後的實際內容

    if (upErr) throw new Error(upErr.message);

    return NextResponse.json({
      ok: true,
      updated_at: updated.updated_at,
      selected_cat_ids: updated.selected_cat_ids,
      cats: results.length,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown" }, { status: 500 });
  }
}
