import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // 這個要放 Vercel env
);

export async function POST(req: Request) {
  const body = await req.json();
  // 確保是 number[]
  const selectedIds: number[] = (body.selectedCatIds ?? []).map((x: any) => Number(x));

  // 1) 先撈 cats 名稱（用來做預覽卡片）
  const { data: cats, error: catErr } = await supabase
    .from("cats")
    .select("id,name")
    .in("id", selectedIds);

  if (catErr) {
    return NextResponse.json({ error: catErr.message }, { status: 500 });
  }

  const results = (cats ?? [])
    // 依照選取順序排序（避免 in() 回傳順序不固定）
    .sort((a, b) => selectedIds.indexOf(a.id) - selectedIds.indexOf(b.id))
    .map((c) => ({
      catId: c.id,
      catName: c.name,
      note: "尚未抽籤",
      winners: [],
    }));

  // 2) 寫入 live_state：phase + selected_cat_ids + results
  const { error: upErr } = await supabase
    .from("live_state")
    .update({
      phase: "preview",
      selected_cat_ids: selectedIds, // int4[] 就要 number[]
      results, // jsonb
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, selectedIds, results });
}
