import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!; // 一定要在 .env.local / Vercel 設定
const ADMIN_KEY = process.env.ADMIN_KEY!; // 你自己設的後台密碼（跟 AdminClient 送出的 x-admin-key 對上）

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

type WinnerRow = {
  cat_id: number;
  rank: "正取" | "備取1" | "備取2";
  applicant_id: string;
};

function uniqSorted(nums: number[]) {
  return Array.from(new Set(nums)).sort((a, b) => a - b);
}

function pickRandom<T>(arr: T[], count: number) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

export async function POST(req: Request) {
  try {
    // 0) admin key
    const key = req.headers.get("x-admin-key") || "";
    if (!ADMIN_KEY || key !== ADMIN_KEY) {
      return NextResponse.json({ error: "401 Unauthorized: bad admin key" }, { status: 401 });
    }

    // 1) 讀 live_state.selected_cat_ids
    const { data: live, error: liveErr } = await supabase
      .from("live_state")
      .select("id, selected_cat_ids")
      .eq("id", 1)
      .single();

    if (liveErr) throw new Error(liveErr.message);

    const selectedIds: number[] = uniqSorted((live?.selected_cat_ids ?? []).map((x: any) => Number(x)).filter(Number.isFinite));

    if (selectedIds.length === 0) {
      return NextResponse.json({ error: "沒有選貓，無法抽籤" }, { status: 400 });
    }

    // 2) 讀 cats（名字/圖片）
    const { data: cats, error: catsErr } = await supabase
      .from("cats")
      .select("id,name,image_url")
      .in("id", selectedIds);

    if (catsErr) throw new Error(catsErr.message);

    const catMap = new Map<number, { name: string; image_url: string | null }>();
    (cats ?? []).forEach((c: any) => catMap.set(Number(c.id), { name: c.name, image_url: c.image_url ?? null }));

    // 3) 讀 applications（每個人選了哪些貓）
    const { data: apps, error: appsErr } = await supabase
      .from("applications")
      .select("id, applicant_id, choices")
      .not("choices", "is", null);

    if (appsErr) throw new Error(appsErr.message);

    // 4) 先抓出「每隻貓的候選人」
    const candidatesByCat = new Map<number, string[]>();
    for (const cid of selectedIds) candidatesByCat.set(cid, []);

    for (const row of apps ?? []) {
      const applicantId = row.applicant_id as string;
      const choices = (row.choices ?? []) as number[];
      for (const cid of choices) {
        if (candidatesByCat.has(cid)) {
          candidatesByCat.get(cid)!.push(applicantId);
        }
      }
    }

    // 5) 用 wins_one_per_applicant 的規則：同一個人最多中一次
    //    做法：抽的時候把已中者排除掉
    const used = new Set<string>();

    const ranks: WinnerRow["rank"][] = ["正取", "備取1", "備取2"];
    const winsToInsert: any[] = [];
    const resultItems: any[] = [];

    for (const catId of selectedIds) {
      const pool = candidatesByCat.get(catId) ?? [];
      const available = pool.filter((id) => !used.has(id));

      const picked = pickRandom(available, 3);
      picked.forEach((id) => used.add(id));

      const winners = picked.map((applicant_id, idx) => ({
        rank: ranks[idx],
        applicant_id,
      }));

      // 寫入 wins 的 rows（先暫存）
      winners.forEach((w) => {
        winsToInsert.push({
          cat_id: catId,
          rank: w.rank, // 這裡是文字：正取/備取1/備取2
          applicant_id: w.applicant_id,
        });
      });

      resultItems.push({
        catId,
        catName: catMap.get(catId)?.name ?? `貓${catId}`,
        image_url: catMap.get(catId)?.image_url ?? null,
        winners: winners.map((w) => ({
          rank: w.rank,
          name: "", // display 用不到電話/姓名就先不塞，或你也可以在這裡 join applicants 後塞 name
        })),
      });
    }

    // 6) 先清掉本輪 selected cats 的舊 wins（避免 duplicate）
    const { error: delErr } = await supabase
      .from("wins")
      .delete()
      .in("cat_id", selectedIds);

    if (delErr) throw new Error(delErr.message);

    // 7) 寫入 wins
    if (winsToInsert.length > 0) {
      const { error: insErr } = await supabase.from("wins").insert(winsToInsert);
      if (insErr) throw new Error(insErr.message);
    }

    // 8) 更新 live_state（讓 display 即時看到）
    const { error: upErr } = await supabase
      .from("live_state")
      .update({
        phase: "draw",
        results: resultItems,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);

    if (upErr) throw new Error(upErr.message);

    return NextResponse.json({
      ok: true,
      cats: selectedIds.length,
      inserted: winsToInsert.length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "unknown" }, { status: 500 });
  }
}
