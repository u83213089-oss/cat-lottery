import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LiveState = {
  id: number;
  phase: "preview" | "draw";
  selected_cat_ids: number[];
};

function shuffle<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function POST() {
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  try {
    // 1) 讀 live_state，只抽當下選的貓
    const { data: live, error: liveErr } = await supabase
      .from("live_state")
      .select("id, phase, selected_cat_ids")
      .eq("id", 1)
      .single();

    if (liveErr) throw new Error(liveErr.message);

    const selectedCatIds = Array.from(
      new Set((live as LiveState).selected_cat_ids.map(Number))
    )
      .filter((x) => Number.isFinite(x))
      .sort((a, b) => a - b);

    if (selectedCatIds.length === 0) {
      return NextResponse.json(
        { error: "沒有選擇任何貓，無法抽籤" },
        { status: 400 }
      );
    }

    // 2) 讀「本輪開始前」已中獎的人（排除用，符合 wins_one_per_applicant）
    //    注意：我們稍後會刪掉本輪 cats 的 wins，所以先讀出來
    const { data: oldWins, error: oldWinsErr } = await supabase
      .from("wins")
      .select("applicant_id, cat_id");

    if (oldWinsErr) throw new Error(oldWinsErr.message);

    const usedApplicants = new Set<string>();
    for (const w of oldWins ?? []) {
      const catId = Number((w as any).cat_id);
      const applicantId = String((w as any).applicant_id);
      if (!applicantId) continue;

      // ✅ 允許重抽本輪貓：本輪 cat 的舊 winners 不算已用
      if (!selectedCatIds.includes(catId)) usedApplicants.add(applicantId);
    }

    // 3) 只讀本輪 cats
    const { data: cats, error: catsErr } = await supabase
      .from("cats")
      .select("id, name, image_url")
      .in("id", selectedCatIds)
      .order("id", { ascending: true });

    if (catsErr) throw new Error(catsErr.message);

    // 4) 刪掉「本輪 cats」舊 wins（避免重抽撞 constraint）
    const { error: delErr } = await supabase
      .from("wins")
      .delete()
      .in("cat_id", selectedCatIds);

    if (delErr) throw new Error(delErr.message);

    // 5) 抽籤：只針對本輪 cats，並且全場去重
    const winsToInsert: { cat_id: number; applicant_id: string; rank: string }[] =
      [];
    const resultsForDisplay: any[] = [];

    for (const cat of cats ?? []) {
      const catId = Number((cat as any).id);

      const { data: apps, error: appErr } = await supabase
        .from("applications")
        .select("applicant_id")
        .contains("choices", [catId]);

      if (appErr) throw new Error(appErr.message);

      const allCandidateIds = Array.from(
        new Set((apps ?? []).map((r: any) => String(r.applicant_id)).filter(Boolean))
      );

      const pool = shuffle(allCandidateIds).filter((id) => !usedApplicants.has(id));

      const ranks = ["正取", "備取1", "備取2"] as const;
      const picked = pool.slice(0, 3);

      picked.forEach((id) => usedApplicants.add(id));

      picked.forEach((id, idx) => {
        winsToInsert.push({
          cat_id: catId,
          applicant_id: id,
          rank: ranks[idx],
        });
      });

      // display winners
      let winners: any[] = [];
      if (picked.length > 0) {
        const { data: people, error: pplErr } = await supabase
          .from("applicants")
          .select("id, name, township")
          .in("id", picked);

        if (pplErr) throw new Error(pplErr.message);

        const map = new Map<string, any>();
        for (const p of people ?? []) map.set(String((p as any).id), p);

        winners = picked.map((id, idx) => {
          const p = map.get(id);
          return {
            rank: ranks[idx],
            name: p?.name ?? "—",
            township: p?.township ?? "",
          };
        });
      }

      resultsForDisplay.push({
        catId,
        catName: (cat as any).name ?? `貓${catId}`,
        image_url: (cat as any).image_url ?? null,
        winners,
      });
    }

    // 6) insert wins
    if (winsToInsert.length > 0) {
      const { error: insErr } = await supabase.from("wins").insert(winsToInsert);
      if (insErr) throw new Error(insErr.message);
    }

    // ✅✅✅ 7) 這裡是關鍵：live_state.results 一律覆蓋成「只包含本輪 selected 的貓」
    // 這樣 display 不可能再殘留 1 號的結果
    const { error: upErr } = await supabase
      .from("live_state")
      .update({
        phase: "draw",
        selected_cat_ids: selectedCatIds,
        results: resultsForDisplay, // ← 只放本輪
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);

    if (upErr) throw new Error(upErr.message);

    return NextResponse.json({
      ok: true,
      selectedCats: selectedCatIds,
      insertedWins: winsToInsert.length,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}