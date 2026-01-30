import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type WinnerRank = "正取" | "備取1" | "備取2";

function pickN<T>(arr: T[], n: number) {
  // Fisher-Yates shuffle then slice
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

export async function POST(req: Request) {
  try {
    const adminKey = req.headers.get("x-admin-key") ?? "";
      const ok =
        adminKey &&
        (adminKey === process.env.ADMIN_PASSWORD ||
        adminKey === process.env.NEXT_PUBLIC_ADMIN_KEY);

if (!ok) {
  return NextResponse.json(
    { error: "Unauthorized: bad admin key" },
    { status: 401 }
  );
}


    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY! // ✅只放 server
    );

    // 1) 讀 live_state 這輪要抽哪些貓
    const { data: live, error: liveErr } = await supabase
      .from("live_state")
      .select("id, selected_cat_ids")
      .eq("id", 1)
      .single();

    if (liveErr) throw new Error(liveErr.message);

    const selectedIds: number[] = (live?.selected_cat_ids ?? [])
      .map((x: any) => Number(x))
      .filter((x: number) => Number.isFinite(x));

    if (selectedIds.length === 0) {
      return NextResponse.json({ error: "沒有選貓，無法抽籤" }, { status: 400 });
    }

    // 2) 讀 cats（拿名字/圖片）
    const { data: cats, error: catsErr } = await supabase
      .from("cats")
      .select("id,name,image_url")
      .in("id", selectedIds);

    if (catsErr) throw new Error(catsErr.message);
    const catMap = new Map<number, any>();
    (cats ?? []).forEach((c) => catMap.set(c.id, c));

    // 3) 讀 applications + applicants（要 township）
    // applications: applicant_id, choices(int4[])
    // applicants: id, name, township
    const { data: apps, error: appsErr } = await supabase
      .from("applications")
      .select("applicant_id, choices");

    if (appsErr) throw new Error(appsErr.message);

    const applicantIds = Array.from(
      new Set((apps ?? []).map((x: any) => x.applicant_id))
    );

    const { data: people, error: peopleErr } = await supabase
      .from("applicants")
      .select("id,name,township")
      .in("id", applicantIds);

    if (peopleErr) throw new Error(peopleErr.message);

    const peopleMap = new Map<string, { name: string; township: string | null }>();
    (people ?? []).forEach((p: any) =>
      peopleMap.set(p.id, { name: p.name, township: p.township ?? null })
    );

    // 4) 對每隻貓，找報名者（choices 包含 catId）
    const winsToInsert: any[] = [];
    const resultItems: any[] = [];

    for (const catId of selectedIds.sort((a, b) => a - b)) {
      const candidates = (apps ?? [])
        .filter((ap: any) => Array.isArray(ap.choices) && ap.choices.includes(catId))
        .map((ap: any) => ap.applicant_id)
        .filter((id: any) => peopleMap.has(id));

      const picked = pickN(candidates, 3);

      const ranks: WinnerRank[] = ["正取", "備取1", "備取2"];
      const winners = picked.map((applicant_id: string, idx: number) => {
        const person = peopleMap.get(applicant_id)!;
        return {
          rank: ranks[idx],
          name: person.name,
          township: person.township ?? "",
          applicant_id,
        };
      });

      // 寫進 wins（如果你 wins 欄位不同，跟我說我再改）
      winners.forEach((w: any) => {
        winsToInsert.push({
          cat_id: catId,
          rank: w.rank,
          applicant_id: w.applicant_id,
        });
      });

      resultItems.push({
        catId,
        catName: catMap.get(catId)?.name ?? `貓${catId}`,
        image_url: catMap.get(catId)?.image_url ?? null,
        winners: winners.map((w: any) => ({
          rank: w.rank,
          name: w.name,
          township: w.township,
        })),
      });
    }

    // 5) 清掉舊 wins（可選）
    // 如果你要每次抽籤都覆蓋同一輪，就先清掉這些貓的舊資料
    await supabase.from("wins").delete().in("cat_id", selectedIds);

    // 6) 寫入 wins
    const { error: insertErr } = await supabase.from("wins").insert(winsToInsert);
    if (insertErr) throw new Error(insertErr.message);

    // 7) 更新 live_state（讓 display 顯示結果）
    const { error: upErr } = await supabase
      .from("live_state")
      .update({
        phase: "draw",
        results: resultItems,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);

    if (upErr) throw new Error(upErr.message);

    return NextResponse.json({ ok: true, inserted: winsToInsert.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "unknown" }, { status: 500 });
  }
}
