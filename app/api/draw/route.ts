import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type LiveStateRow = {
  id: number;
  phase: "preview" | "draw";
  selected_cat_ids: number[];
  results: any;
  updated_at: string;
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
      { error: "Server missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  try {
    // 1) 讀 live_state：只抽它指定的貓（不用再按預覽）
    const { data: live, error: liveErr } = await supabase
      .from("live_state")
      .select("id,phase,selected_cat_ids,results,updated_at")
      .eq("id", 1)
      .single();

    if (liveErr) throw new Error(liveErr.message);

    const selectedIds = Array.from(
      new Set(((live as LiveStateRow).selected_cat_ids ?? []).map((x) => Number(x)))
    )
      .filter((x) => Number.isFinite(x))
      .sort((a, b) => a - b);

    if (selectedIds.length === 0) {
      return NextResponse.json(
        { error: "沒有選貓，無法抽籤（請先在 /admin 選貓）" },
        { status: 400 }
      );
    }

    // 2) 讀 cats 資料（名字/圖）
    const { data: cats, error: catsErr } = await supabase
      .from("cats")
      .select("id,name,image_url")
      .in("id", selectedIds)
      .order("id", { ascending: true });

    if (catsErr) throw new Error(catsErr.message);

    // 3) 重抽：先清 wins（避免舊資料卡住 constraint）
    //    如果你想「整場重抽」，就刪全部 wins 最簡單最穩
    const { error: delAllErr } = await supabase
      .from("wins")
      .delete()
      .gt("cat_id", 0);

    if (delAllErr) throw new Error(delAllErr.message);

    // 4) 全場去重：符合 wins_one_per_applicant
    const usedApplicants = new Set<string>();
    const winsToInsert: { cat_id: number; rank: string; applicant_id: string }[] = [];

    // 為 display 組 results（含鄉鎮；電話你若不顯示可不放）
    const allResults: any[] = [];

    for (const cat of cats ?? []) {
      const catId = Number((cat as any).id);

      // 候選池：只抓 choices 包含 catId 的人
      const { data: appRows, error: appErr } = await supabase
        .from("applications")
        .select("applicant_id")
        .contains("choices", [catId]);

      if (appErr) throw new Error(appErr.message);

      const poolAll = (appRows ?? [])
        .map((r: any) => String(r.applicant_id))
        .filter(Boolean);

      // 去掉已經中獎的人（全場唯一）
      const pool = shuffle(Array.from(new Set(poolAll))).filter(
        (id) => !usedApplicants.has(id)
      );

      const ranks = ["正取", "備取1", "備取2"] as const;
      const picked = pool.slice(0, 3);

      // 標記已用
      picked.forEach((id) => usedApplicants.add(id));

      // 寫 wins
      picked.forEach((id, idx) => {
        winsToInsert.push({
          cat_id: catId,
          applicant_id: id,
          rank: ranks[idx],
        });
      });

      // 抓 applicants 資料（用來顯示）
      let winners: any[] = [];
      if (picked.length > 0) {
        const { data: people, error: pplErr } = await supabase
          .from("applicants")
          .select("id,name,township,phone")
          .in("id", picked);

        if (pplErr) throw new Error(pplErr.message);

        const m = new Map<string, any>();
        for (const p of people ?? []) m.set(String((p as any).id), p);

        winners = picked.map((id, idx) => {
          const p = m.get(id);
          return {
            rank: ranks[idx],
            name: p?.name ?? "—",
            township: p?.township ?? "",
            // phone: p?.phone ?? "", // 你若 display 不顯示電話就不要放
          };
        });
      }

      allResults.push({
        catId,
        catName: (cat as any).name ?? `貓${catId}`,
        image_url: (cat as any).image_url ?? null,
        winners,
      });
    }

    // 5) 寫入 wins（一次 insert）
    if (winsToInsert.length > 0) {
      const { error: insErr } = await supabase.from("wins").insert(winsToInsert);
      if (insErr) throw new Error(insErr.message);
    }

    // 6) 更新 live_state（display 立刻跟著變）
    const { error: upErr } = await supabase
      .from("live_state")
      .update({
        phase: "draw",
        selected_cat_ids: selectedIds,
        results: allResults,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);

    if (upErr) throw new Error(upErr.message);

    return NextResponse.json({
      ok: true,
      selectedCats: selectedIds,
      inserted: winsToInsert.length,
      uniqueWinners: usedApplicants.size,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "unknown" },
      { status: 500 }
    );
  }
}