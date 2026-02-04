import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mustAdmin(req: Request) {
  const key = req.headers.get("x-admin-key") ?? "";
  const expected =
    process.env.ADMIN_KEY ?? process.env.NEXT_PUBLIC_ADMIN_KEY ?? "";

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

function srv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("Server missing SUPABASE_URL");
  if (!service) throw new Error("Server missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, service, { auth: { persistSession: false } });
}

function normalizeIds(input: any): number[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
}

export async function POST(req: Request) {
  try {
    const guard = mustAdmin(req);
    if (guard) return guard;

    const s = srv();

    // 1) 先嘗試從 body 讀 ids（多 key 相容）
    const body = await req.json().catch(() => ({}));

    const fromBody =
      normalizeIds(body?.selectedCatIds) ||
      normalizeIds(body?.selected_cat_ids) ||
      normalizeIds(body?.selectedCatids); // 有人會少打 I

    let selectedCatIds = fromBody;

    // 2) 如果 body 真的拿不到，就 fallback 用 live_state.selected_cat_ids（保底）
    if (selectedCatIds.length === 0) {
      const { data: live, error: liveErr } = await s
        .from("live_state")
        .select("id, selected_cat_ids")
        .eq("id", 1)
        .single();
      if (liveErr) throw new Error(liveErr.message);

      selectedCatIds = normalizeIds(live?.selected_cat_ids);
    }

    // 3) 還是空才真的回錯
    if (selectedCatIds.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "selectedCatIds is empty",
          debug: {
            receivedBody: body,
            usedIds: selectedCatIds,
          },
        },
        { status: 400 }
      );
    }

    // cats 名稱顯示用
    const { data: cats, error: catsErr } = await s
      .from("cats")
      .select("id,name")
      .in("id", selectedCatIds);
    if (catsErr) throw new Error(catsErr.message);

    const nameMap: Record<number, string> = {};
    for (const c of cats ?? []) nameMap[c.id] = c.name;

    const results = selectedCatIds.map((id) => ({
      note: "尚未開獎",
      catId: id,
      catName: nameMap[id] ?? `貓${id}`,
      winners: [],
    }));

    // 一次寫回 live_state：selected_cat_ids + results
    const { data: updated, error: upErr } = await s
      .from("live_state")
      .update({
        phase: "preview",
        selected_cat_ids: selectedCatIds,
        results,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1)
      .select("updated_at, selected_cat_ids")
      .single();

    if (upErr) throw new Error(upErr.message);

    return NextResponse.json({
      ok: true,
      cats: results.length,
      selected_cat_ids: updated?.selected_cat_ids,
      updated_at: updated?.updated_at,
      debug: {
        receivedBody: body,
        usedIds: selectedCatIds,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "unknown" },
      { status: 500 }
    );
  }
}