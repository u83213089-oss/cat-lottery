import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type LiveStateRow = {
  id: number;
  phase: string;
  selected_cat_ids: number[];
  results: any; // jsonb
};

function sbAdmin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: Request) {
  try {
    const supabase = sbAdmin();
    const body = await req.json();
    const selectedCatIds: number[] = Array.isArray(body.selectedCatIds)
      ? body.selectedCatIds.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
      : [];

    // 讀 cats 名稱（用來顯示）
    const { data: cats, error: catErr } = await supabase
      .from("cats")
      .select("id,name")
      .in("id", selectedCatIds);

    if (catErr) throw catErr;

    const catNameMap = new Map<number, string>();
    (cats ?? []).forEach((c: any) => catNameMap.set(Number(c.id), c.name));

    // preview results：顯示選到的貓，但 winners 先空
    const results = selectedCatIds.map((catId) => ({
      note: "尚未抽籤",
      catId,
      catName: catNameMap.get(catId) ?? `貓 ${String(catId).padStart(2, "0")}`,
      winners: [],
    }));

    const payload: Partial<LiveStateRow> = {
      phase: "preview",
      selected_cat_ids: selectedCatIds,
      results,
    };

    const { error } = await supabase
      .from("live_state")
      .update(payload)
      .eq("id", 1);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
