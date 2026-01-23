// app/api/live/preview/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return createClient(url, anon, { auth: { persistSession: false } });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    const selectedCatIds: number[] = Array.isArray(body?.selectedCatIds)
      ? body.selectedCatIds.map((x: any) => Number(x)).filter((n: any) => Number.isFinite(n))
      : [];

    // phase: preview（只顯示貓、尚未抽結果）
    const supabase = getSupabase();

    const { error } = await supabase
      .from("live_state")
      .update({
        phase: "preview",
        selected_cat_ids: selectedCatIds, // ⚠️ 這裡是 integer[]，所以用 JS array 就對了
        results: {},                     // jsonb
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message, details: error },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, selectedCatIds }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown server error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
}
