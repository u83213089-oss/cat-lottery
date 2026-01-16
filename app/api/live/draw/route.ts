import { NextResponse } from "next/server";
import { supabaseServer } from "@/app/lib/supabaseServer";

type Winner = { rank: "正取" | "備取1" | "備取2"; name: string; uid: string };

export async function POST(req: Request) {
  const { password, selectedCatIds } = await req.json();

  if (!process.env.ADMIN_PASSWORD) {
    return new NextResponse("ADMIN_PASSWORD not set", { status: 500 });
  }
  if (password !== process.env.ADMIN_PASSWORD) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const supabase = supabaseServer();
  const ids: number[] = Array.isArray(selectedCatIds) ? selectedCatIds : [];

  // 取貓資料（用來顯示貓名）
  const { data: cats, error: catsErr } = await supabase
    .from("cats")
    .select("id,name")
    .in("id", ids);

  if (catsErr) return NextResponse.json({ ok: false, error: catsErr.message }, { status: 500 });

  const catNameMap = new Map<number, string>((cats ?? []).map((c: any) => [c.id, c.name]));

  const results: Array<{ catId: number; catName: string; winners: Winner[]; note?: string }> = [];

  // 逐隻貓抽（你也可以改成一次抽多隻同批）
  for (const catId of ids) {
    // 候選人：有選這隻貓，且尚未中過（wins 沒有 applicant_id）
    // 這裡用兩段查，保持新手也看得懂、好 debug

    // 1) 找所有報名這隻貓的 applicant_id
    const { data: apps, error: appsErr } = await supabase
      .from("applications")
      .select("applicant_id, choices")
      .contains("choices", [catId]);

    if (appsErr) {
      return NextResponse.json({ ok: false, error: appsErr.message }, { status: 500 });
    }

    const applicantIds = (apps ?? []).map((a: any) => a.applicant_id);

    if (applicantIds.length === 0) {
      results.push({
        catId,
        catName: catNameMap.get(catId) ?? `貓${catId}`,
        winners: [],
        note: "目前無人報名",
      });
      continue;
    }

    // 2) 排除已中籤者
    const { data: already, error: alreadyErr } = await supabase
      .from("wins")
      .select("applicant_id")
      .in("applicant_id", applicantIds);

    if (alreadyErr) {
      return NextResponse.json({ ok: false, error: alreadyErr.message }, { status: 500 });
    }

    const alreadySet = new Set((already ?? []).map((w: any) => w.applicant_id));
    const remaining = applicantIds.filter((id) => !alreadySet.has(id));

    if (remaining.length === 0) {
      results.push({
        catId,
        catName: catNameMap.get(catId) ?? `貓${catId}`,
        winners: [],
        note: "報名者皆已在其他貓中籤（依規則不得重複中籤）",
      });
      continue;
    }

    // 3) 隨機抽 3 人（正取/備取1/備取2）
    // 先把 applicants 抓出來，再用 JS 洗牌（避免 SQL/權限卡住，新手最好維護）
    const { data: people, error: pplErr } = await supabase
      .from("applicants")
      .select("id,name,uid")
      .in("id", remaining);

    if (pplErr) {
      return NextResponse.json({ ok: false, error: pplErr.message }, { status: 500 });
    }

    const shuffled = [...(people ?? [])].sort(() => Math.random() - 0.5);
    const picked = shuffled.slice(0, 3);

    // 4) 寫入 wins（鎖住「這些人已中籤」）
    // rank: 0 正取, 1 備取1, 2 備取2
    for (let i = 0; i < picked.length; i++) {
      const p: any = picked[i];
      const { error: insErr } = await supabase.from("wins").insert({
        applicant_id: p.id,
        cat_id: catId,
        rank: i,
      });
      if (insErr) {
        return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
      }
    }

    const winners: Winner[] = [
      { rank: "正取", name: picked[0]?.name ?? "-", uid: picked[0]?.uid ?? "-" },
      { rank: "備取1", name: picked[1]?.name ?? "-", uid: picked[1]?.uid ?? "-" },
      { rank: "備取2", name: picked[2]?.name ?? "-", uid: picked[2]?.uid ?? "-" },
    ];

    results.push({
      catId,
      catName: catNameMap.get(catId) ?? `貓${catId}`,
      winners,
    });
  }

  // 5) 寫入 live_state，讓 /display 即時更新
  const payload = {
    phase: "result",
    selected_cat_ids: ids,
    results,
    updated_at: new Date().toISOString(),
  };

  const { error: liveErr } = await supabase.from("live_state").update(payload).eq("id", 1);
  if (liveErr) return NextResponse.json({ ok: false, error: liveErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, results });
}
