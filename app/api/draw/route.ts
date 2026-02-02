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
      { error: "Missing SUPABASE_URL or SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  try {
    /* --------------------------------------------------
     * 1️⃣ 只讀「目前 admin 選的貓」
     * -------------------------------------------------- */
    const { data: live, error: liveErr } = await supabase
      .from("live_state")
      .select("id, phase, selected_cat_ids")
      .eq("id", 1)
      .single();

    if (liveErr) throw new Error(liveErr.message);

    const selectedCatIds = Array.from(
      new Set((live as LiveState).selected_cat_ids.map(Number))
    ).sort((a, b) => a - b);

    if (selectedCatIds.length === 0) {
      return NextResponse.json(
        { error: "沒有選擇任何貓，無法抽籤" },
        { status: 400 }
      );
    }

    /* --------------------------------------------------
     * 2️⃣ 只讀這次要抽的貓（不會碰到其他貓）
     * -------------------------------------------------- */
    const { data: cats, error: catsErr } = await supabase
      .from("cats")
      .select("id, name, image_url")
      .in("id", selectedCatIds)
      .order("id", { ascending: true });

    if (catsErr) throw new Error(catsErr.message);

    /* --------------------------------------------------
     * 3️⃣ 只刪「這次要抽的貓」的舊 wins
     * -------------------------------------------------- */
    const { error: delErr } = await supabase
      .from("wins")
      .delete()
      .in("cat_id", selectedCatIds);

    if (delErr) throw new Error(delErr.message);

    /* --------------------------------------------------
     * 4️⃣ 抽籤（全場去重，符合 wins_one_per_applicant）
     * -------------------------------------------------- */
    const usedApplicants = new Set<string>();
    const winsToInsert: any[] = [];
    const resultsForDisplay: any[] = [];

    for (const cat of cats ?? []) {
      const catId = Number(cat.id);

      // 只抓「有選這隻貓」的人
      const { data: apps, error: appErr } = await supabase
        .from("applications")
        .select("applicant_id")
        .contains("choices", [catId]);

      if (appErr) throw new Error(appErr.message);

      // 候選池（去重、去掉已中過的人）
      const pool = shuffle(
        Array.from(
          new Set((apps ?? []).map((r: any) => String(r.applicant_id)))
        )
      ).filter((id) => !usedApplicants.has(id));

      const ranks = ["正取", "備取1", "備取2"] as const;
      const picked = pool.slice(0, 3);

      picked.forEach((id) => usedApplicants.add(id));

      // 寫 wins
      picked.forEach((id, idx) => {
        winsToInsert.push({
          cat_id: catId,
          applicant_id: id,
          rank: ranks[idx],
        });
      });

      // 拿來給 display 用（姓名 / 鄉鎮）
      let winners: any[] = [];
      if (picked.length > 0) {
        const { data: people, error: pplErr } = await supabase
          .from("applicants")
          .select("id, name, township")
          .in("id", picked);

        if (pplErr) throw new Error(pplErr.message);

        const map = new Map<string, any>();
        for (const p of people ?? []) map.set(String(p.id), p);

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
        catName: cat.name,
        image_url: cat.image_url,
        winners,
      });
    }

    /* --------------------------------------------------
     * 5️⃣ 寫入 wins
     * -------------------------------------------------- */
    if (winsToInsert.length > 0) {
      const { error: insErr } = await supabase
        .from("wins")
        .insert(winsToInsert);
      if (insErr) throw new Error(insErr.message);
    }

    /* --------------------------------------------------
     * 6️⃣ 抽完立刻更新 live_state（display 直接變）
     * -------------------------------------------------- */
    const { error: upErr } = await supabase
      .from("live_state")
      .update({
        phase: "draw",
        selected_cat_ids: selectedCatIds,
        results: resultsForDisplay,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);

    if (upErr) throw new Error(upErr.message);

    return NextResponse.json({
      ok: true,
      cats_drawn: selectedCatIds,
      winners_count: winsToInsert.length,
      unique_winners: usedApplicants.size,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}
