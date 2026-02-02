import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST() {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: "missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // 1. 取得目前要抽的貓
    const { data: cats } = await supabase
      .from("cats")
      .select("id, name, image_url");

    if (!cats || cats.length === 0) {
      throw new Error("no cats");
    }

    // 2. 清掉舊 wins（本次全部重抽）
    await supabase.from("wins").delete().in(
      "cat_id",
      cats.map(c => c.id)
    );

    const allResults: any[] = [];

    for (const cat of cats) {
      // 3. 候選人：只抓有選這隻貓的人
      const { data: apps } = await supabase
        .from("applications")
        .select("applicant_id")
        .contains("choices", [cat.id]);

      if (!apps || apps.length === 0) continue;

      // shuffle
      const shuffled = apps
        .map(a => a.applicant_id)
        .sort(() => Math.random() - 0.5);

      const picks = [
        { rank: "正取", applicant_id: shuffled[0] },
        { rank: "備取1", applicant_id: shuffled[1] },
        { rank: "備取2", applicant_id: shuffled[2] }
      ].filter(p => p.applicant_id);

      // 4. 寫 wins
      await supabase.from("wins").insert(
        picks.map(p => ({
          cat_id: cat.id,
          applicant_id: p.applicant_id,
          rank: p.rank
        }))
      );

      allResults.push({
        cat,
        results: picks
      });
    }

    // 5. 寫 live_state（display 唯一來源）
    await supabase.from("live_state").update({
      phase: "drawn",
      results: allResults,
      updated_at: new Date().toISOString()
    }).eq("id", 1);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message ?? "unknown" },
      { status: 500 }
    );
  }
}
