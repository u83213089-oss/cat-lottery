import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type LiveStateRow = {
  id: number;
  phase: "preview" | "draw";
  selected_cat_ids: number[];
  results: any;
  updated_at: string;
};

export async function POST() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: "Server missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // 1) 讀 live_state：只抽它指定的貓
    const { data: live, error: liveErr } = await supabase
      .from("live_state")
      .select("id, phase, selected_cat_ids, results, updated_at")
      .eq("id", 1)
      .single();

    if (liveErr) throw new Error(liveErr.message);

    const selectedIds = (live?.selected_cat_ids ?? [])
      .map((x: any) => Number(x))
      .filter((x: number) => Number.isFinite(x));

    if (selectedIds.length === 0) {
      return NextResponse.json({ error: "沒有選貓，無法抽籤" }, { status: 400 });
    }

    // 2) 讀 cats 基本資料
    const { data: cats, error: catsErr } = await supabase
      .from("cats")
      .select("id,name,image_url")
      .in("id", selectedIds)
      .order("id", { ascending: true });

    if (catsErr) throw new Error(catsErr.message);

    // 3) 先刪除本次 selectedIds 的舊 wins（避免重抽撞 constraint、也避免舊資料混入）
    const { error: delErr } = await supabase
      .from("wins")
      .delete()
      .in("cat_id", selectedIds);

    if (delErr) throw new Error(delErr.message);

    // 4) 對每隻貓抽：候選人只取「choices 包含該貓 id」
    const allResults: any[] = [];
    const winsToInsert: any[] = [];
    const debugSkipped: any[] = []; // 硬驗證失敗的會記在這

    for (const cat of cats ?? []) {
      const catId = Number(cat.id);

      // 候選池：只從 applications 裡 choices 包含 catId 的人來
      const { data: apps, error: appErr } = await supabase
        .from("applications")
        .select("applicant_id, choices")
        .contains("choices", [catId]);

      if (appErr) throw new Error(appErr.message);

      const candidateIds = Array.from(
        new Set((apps ?? []).map((r: any) => r.applicant_id).filter(Boolean))
      );

      // 沒人選 → 顯示空結果
      if (candidateIds.length === 0) {
        allResults.push({
          catId,
          catName: cat.name,
          image_url: cat.image_url,
          winners: [],
        });
        continue;
      }

      // shuffle
      candidateIds.sort(() => Math.random() - 0.5);

      const pickedIds = candidateIds.slice(0, 3); // 正取 + 備取1 + 備取2

      // 5) 硬驗證：再用 SQL 重新確認「這個 applicant_id 的 choices 一定包含 catId」
      // （如果資料/程式哪裡怪掉，這邊會把人剔除，避免產出反例）
      const verified: string[] = [];
      for (const applicant_id of pickedIds) {
        const { data: v, error: vErr } = await supabase
          .from("applications")
          .select("id, applicant_id, choices")
          .eq("applicant_id", applicant_id)
          .contains("choices", [catId])
          .limit(1);

        if (vErr) throw new Error(vErr.message);

        if (!v || v.length === 0) {
          debugSkipped.push({ catId, applicant_id, reason: "verify_failed_not_in_choices" });
          continue;
        }
        verified.push(applicant_id);
      }

      const ranks = ["正取", "備取1", "備取2"] as const;

      // 6) 把 winners（含姓名電話鄉鎮）一起組到 live_state.results（display 直接用）
      const { data: people, error: pplErr } = await supabase
        .from("applicants")
        .select("id,name,phone,township")
        .in("id", verified);

      if (pplErr) throw new Error(pplErr.message);

      const personMap = new Map<string, any>();
      for (const p of people ?? []) personMap.set(p.id, p);

      const winners = verified.map((id, idx) => {
        const p = personMap.get(id);
        return {
          rank: ranks[idx],
          applicant_id: id,
          name: p?.name ?? "—",
          phone: p?.phone ?? "—",
          township: p?.township ?? "—",
        };
      });

      // 7) 寫 wins（wins 表先維持精簡：cat_id, applicant_id, rank）
      // 你要縣長聯絡資訊 → display 的 results 已帶 phone/township；
      // 若你也要在 DB 看到，建議用 view（你已有 wins_with_applicants）
      for (let i = 0; i < verified.length; i++) {
        winsToInsert.push({
          cat_id: catId,
          applicant_id: verified[i],
          rank: ranks[i],
        });
      }

      allResults.push({
        catId,
        catName: cat.name,
        image_url: cat.image_url,
        winners,
      });
    }

    // 8) 寫 wins
    if (winsToInsert.length > 0) {
      const { error: insErr } = await supabase.from("wins").insert(winsToInsert);
      if (insErr) throw new Error(insErr.message);
    }

    // 9) 更新 live_state → display 立刻看到
    const { error: upErr } = await supabase
      .from("live_state")
      .update({
        phase: "draw",
        results: allResults,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);

    if (upErr) throw new Error(upErr.message);

    return NextResponse.json({
      ok: true,
      cats: selectedIds.length,
      inserted: winsToInsert.length,
      skipped: debugSkipped.length,
      debugSkipped,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "unknown" }, { status: 500 });
  }
}