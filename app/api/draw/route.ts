import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LiveStateRow = {
  id: number;
  selected_cat_ids: number[]; // int4[]
};

type ApplicationRow = {
  applicant_id: string; // uuid
  choices: number[]; // int4[]
};

type ApplicantRow = {
  id: string;
  name: string | null;
  township: string | null;
};

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

function shuffle<T>(arr: T[]) {
  // Fisher-Yates
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function POST(req: Request) {
  try {
    // 0) 驗 admin key
    const adminKey = req.headers.get("x-admin-key") ?? "";
    if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
      return NextResponse.json(
        { error: "401 Unauthorized: bad admin key" },
        { status: 401 }
      );
    }

    // 1) 讀 live_state 選中的貓
    const { data: live, error: liveErr } = await supabase
      .from("live_state")
      .select("id, selected_cat_ids")
      .eq("id", 1)
      .single();

    if (liveErr) throw new Error(liveErr.message);

    const selectedIds = Array.from(
      new Set((live as LiveStateRow).selected_cat_ids.map((x) => Number(x)))
    )
      .filter((x) => Number.isFinite(x))
      .sort((a, b) => a - b);

    if (selectedIds.length === 0) {
      return NextResponse.json(
        { error: "沒有選貓，無法抽籤" },
        { status: 400 }
      );
    }

    // 2) 先清空 wins（整場重抽，避免撞 wins_one_per_applicant）
    const { error: clearErr } = await supabase
      .from("wins")
      .delete()
      .neq("cat_id", -1); // 等同刪光（cat_id 不可能是 -1）

    if (clearErr) throw new Error(clearErr.message);

    // 3) 抓出所有申請（applications），只抓跟選中貓有關的（choices overlap）
    const { data: apps, error: appErr } = await supabase
      .from("applications")
      .select("applicant_id,choices")
      .overlaps("choices", selectedIds);

    if (appErr) throw new Error(appErr.message);

    const applications = (apps ?? []) as ApplicationRow[];

    // 4) 抽籤（全場 applicant 去重）
    const used = new Set<string>(); // 已中獎 applicant（全場唯一）
    const winsToInsert: {
      cat_id: number;
      rank: "正取" | "備取1" | "備取2";
      applicant_id: string;
    }[] = [];

    // 為了讓每隻貓抽籤公平：每隻貓候選清單先 shuffle
    for (const catId of selectedIds) {
      const pool = shuffle(
        applications
          .filter((a) => Array.isArray(a.choices) && a.choices.includes(catId))
          .map((a) => a.applicant_id)
          .filter((id) => typeof id === "string" && id.length > 0)
      );

      const pick = () => {
        const found = pool.find((id) => !used.has(id));
        if (!found) return null;
        used.add(found);
        return found;
      };

      const w0 = pick();
      const w1 = pick();
      const w2 = pick();

      if (w0) winsToInsert.push({ cat_id: catId, rank: "正取", applicant_id: w0 });
      if (w1) winsToInsert.push({ cat_id: catId, rank: "備取1", applicant_id: w1 });
      if (w2) winsToInsert.push({ cat_id: catId, rank: "備取2", applicant_id: w2 });
    }

    // 5) 寫入 wins
    if (winsToInsert.length > 0) {
      const { error: insErr } = await supabase.from("wins").insert(winsToInsert);
      if (insErr) throw new Error(insErr.message);
    }

    // 6) 把中獎者姓名/鄉鎮補齊，寫進 live_state.results 讓 display 顯示 township
    const winnerApplicantIds = Array.from(
      new Set(winsToInsert.map((w) => w.applicant_id))
    );

    let applicantMap = new Map<string, ApplicantRow>();
    if (winnerApplicantIds.length > 0) {
      const { data: apData, error: apErr } = await supabase
        .from("applicants")
        .select("id,name,township")
        .in("id", winnerApplicantIds);

      if (apErr) throw new Error(apErr.message);

      for (const a of (apData ?? []) as ApplicantRow[]) {
        applicantMap.set(a.id, a);
      }
    }

    const resultItems = selectedIds.map((catId) => {
      const ws = winsToInsert.filter((w) => w.cat_id === catId);

      const winners = (["正取", "備取1", "備取2"] as const).map((rk) => {
        const hit = ws.find((x) => x.rank === rk);
        const ap = hit ? applicantMap.get(hit.applicant_id) : null;
        return {
          rank: rk,
          name: ap?.name ?? "—",
          township: ap?.township ?? "",
        };
      });

      return {
        catId,
        winners,
      };
    });

    // 7) 更新 live_state（phase=draw + results）
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
    return NextResponse.json(
      { error: e?.message ?? "unknown" },
      { status: 500 }
    );
  }
}
