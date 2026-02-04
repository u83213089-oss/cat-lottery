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

export async function POST(req: Request) {
  try {
    const guard = mustAdmin(req);
    if (guard) return guard;

    const raw = await req.text(); // 先用 text 抓，避免 json() 解析失敗看不到原文
    let body: any = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = { __raw: raw };
    }

    // ✅ 同時支援多種 key，避免你前後端命名不一致
    const arr =
      body?.selectedCatIds ??
      body?.selected_cat_ids ??
      body?.selectedIds ??
      [];

    const selectedCatIds: number[] = Array.isArray(arr)
      ? arr
          .map((x: any) => Number(x))
          .filter((n: number) => Number.isFinite(n))
          .sort((a: number, b: number) => a - b)
      : [];

    // 🔥 Debug：直接回報 server 看到的 body
    if (selectedCatIds.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "selectedCatIds is empty",
          debug: {
            contentType: req.headers.get("content-type"),
            raw,
            body,
            parsedSelectedCatIds: selectedCatIds,
          },
        },
        { status: 400 }
      );
    }

    const s = srv();

    const { data: cats, error: catsErr } = await s
      .from("cats")
      .select("id,name")
      .in("id", selectedCatIds);

    if (catsErr) throw new Error(catsErr.message);

    const nameMap = Object.fromEntries((cats ?? []).map((c) => [c.id, c.name]));

    const results = selectedCatIds.map((id) => ({
      note: "尚未開獎",
      catId: id,
      catName: nameMap[id] ?? `貓${id}`,
      winners: [],
    }));

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
      .single();

    if (upErr) throw new Error(upErr.message);

    return NextResponse.json({
      ok: true,
      received: selectedCatIds,
      updated_at: updated.updated_at,
      selected_cat_ids: updated.selected_cat_ids,
      cats: results.length,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "unknown" },
      { status: 500 }
    );
  }
}