// app/api/draw/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type LiveStateRow = {
  id: number;
  phase: "preview" | "draw";
  selected_cat_ids: number[]; // int4[]
  results: any; // jsonb
  updated_at: string;
};

type ApplicationRow = {
  id: string; // uuid
  applicant_id: string; // uuid
  choices: number[]; // int4[]
  created_at: string;
};

type ApplicantRow = {
  id: string; // uuid
  name: string;
  phone: string | null;
  township: string | null;
};

type Winner = {
  rank: "正取" | "備取1" | "備取2";
  name: string; // 我會塞入 `${township} ${name}` 讓 display 直接顯示地區
};

type ResultItem = {
  catId: number;
  catName: string;
  winners: Winner[];
};

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    // 注意：不要在檔案最外層 throw，避免 build 階段掛掉
    return null;
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

// Fisher–Yates shuffle
function shuffle<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export async function POST(req: Request) {
  try {
    // 0) 驗 admin key
    const adminKey = req.headers.get("x-admin-key") ?? "";
    if (!process.env.ADMIN_KEY) {
      return NextResponse.json(
        { error: "Server missing ADMIN_KEY env" },
        { status: 500 }
      );
    }
    if (adminKey !== process.env.ADMIN_KEY) {
      return NextResponse.json(
        { error: "401 Unauthorized: bad admin key" },
        { status: 401 }
      );
    }

    // 1) 建 Supabase（延後到這裡，避免 build 掛）
    const supabase = getSupabase();
    if (!supabase) {
      return NextResponse.json(
        { error: "Server missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    // 2) 讀 live_state 拿 selected_cat_ids
    const { data: live, error: liveErr } = await supabase
      .from("live_state")
      .select("id,phase,selected_cat_ids,results,updated_at")
      .eq("id", 1)
      .single();

    if (liveErr) throw new Error(liveErr.message);

    const selectedIds: number[] = (live as LiveStateRow)?.selected_cat_ids ?? [];
    const selected = Array.from(new Set(selectedIds.map(Number)))
      .filter((x) => Number.isFinite(x))
      .sort((a, b) => a - b);

    if (selected.length === 0) {
      return NextResponse.json(
        { error: "沒有選貓，無法抽籤" },
        { status: 400 }
      );
    }

    // 3) 讀 cats 名字（顯示用）
    const { data: cats, error: catsErr } = await supabase
      .from("cats")
      .select("id,name")
      .in("id", selected);

    if (catsErr) throw new Error(catsErr.message);

    const catNameMap = new Map<number, string>();
    for (const c of cats ?? []) {
      catNameMap.set(Number((c as any).id), String((c as any).name ?? ""));
    }

    // 4) 讀 applications（所有人所有選擇）
    //    之後我們用 choices contains catId 來分組
    const { data: apps, error: appErr } = await supabase
      .from("applications")
      .select("id,applicant_id,choices,created_at");

    if (appErr) throw new Error(appErr.message);

    const applications = (apps ?? []) as ApplicationRow[];

    // 5) 先清空 wins（避免 wins_one_per_applicant & 重抽殘留）
    //    你的 cat_id 都是正整數，所以用 >0 當作「刪全部」
    const { error: delErr } = await supabase
      .from("wins")
      .delete()
      .gt("cat_id", 0);

    if (delErr) throw new Error(delErr.message);

    // 6) 開始抽籤：同一輪 applicant 只能中一次（避免 unique constraint）
    const chosenApplicants = new Set<string>();
    const winsToInsert: { cat_id: number; rank: string; applicant_id: string }[] =
      [];
    const resultItems: ResultItem[] = [];

    // 先把每隻貓的候選 applicant_id 抽出來
    // 以及稍後要查 applicants 資料的所有 applicant_id
    const allWinnerApplicantIds: string[] = [];

    for (const catId of selected) {
      const pool = applications
        .filter((a) => Array.isArray(a.choices) && a.choices.includes(catId))
        .map((a) => a.applicant_id)
        .filter((id) => !!id && !chosenApplicants.has(id));

      shuffle(pool);

      const picks = pool.slice(0, 3); // 正取 + 備取1 + 備取2
      const ranks: Winner["rank"][] = ["正取", "備取1", "備取2"];

      // 先暫存 wins（name 後面再補 township）
      const tempWinners: { rank: Winner["rank"]; applicant_id: string }[] = [];

      for (let i = 0; i < picks.length; i++) {
        const applicant_id = picks[i];
        const rank = ranks[i];

        chosenApplicants.add(applicant_id);
        allWinnerApplicantIds.push(applicant_id);

        winsToInsert.push({
          cat_id: catId,
          rank, // ✅ rank 用文字，不會再出現 integer syntax error
          applicant_id,
        });

        tempWinners.push({ rank, applicant_id });
      }

      // 先放進 resultItems，等一下補 winner.name
      resultItems.push({
        catId,
        catName: catNameMap.get(catId) || `貓${catId}`,
        winners: tempWinners.map((w) => ({
          rank: w.rank,
          name: w.applicant_id, // 先塞 id 當 placeholder，後面替換
        })),
      });
    }

    // 7) 查 winners 的 applicants（拿 name + township）
    const uniqueWinnerIds = Array.from(new Set(allWinnerApplicantIds));
    const applicantMap = new Map<string, ApplicantRow>();

    if (uniqueWinnerIds.length > 0) {
      const { data: applicantRows, error: apErr } = await supabase
        .from("applicants")
        .select("id,name,phone,township")
        .in("id", uniqueWinnerIds);

      if (apErr) throw new Error(apErr.message);

      for (const r of (applicantRows ?? []) as any[]) {
        applicantMap.set(String(r.id), {
          id: String(r.id),
          name: String(r.name ?? ""),
          phone: r.phone ? String(r.phone) : null,
          township: r.township ? String(r.township) : null,
        });
      }
    }

    // 8) 把 resultItems 的 winner.name 改成「{township} {name}」
    //    （這樣 display 不用改就會顯示地區）
    for (const item of resultItems) {
      item.winners = item.winners.map((w) => {
        const ap = applicantMap.get(w.name); // w.name 現在是 applicant_id
        const township = ap?.township?.trim() ? ap!.township!.trim() : "";
        const name = ap?.name?.trim() ? ap!.name!.trim() : "—";
        const displayName = township ? `${township} ${name}` : name;
        return { rank: w.rank, name: displayName };
      });
    }

    // 9) 寫入 wins
    if (winsToInsert.length > 0) {
      const { error: insErr } = await supabase.from("wins").insert(winsToInsert);
      if (insErr) throw new Error(insErr.message);
    }

    // 10) 更新 live_state（display 會直接讀 results）
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
      cats: selected.length,
      inserted: winsToInsert.length,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "unknown" },
      { status: 500 }
    );
  }
}
