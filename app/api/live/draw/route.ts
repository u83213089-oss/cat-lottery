import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type Winner = {
  rank: "正取" | "備取1" | "備取2";
  name: string;
  uid?: string;
  phone?: string;
  township?: string;
};

type ResultItem = {
  catId: number;
  catName: string;
  catLabel?: string;
  imageUrl?: string | null;
  note?: string;
  winners: Winner[];
};

function mustAdmin(req: Request) {
  const key = req.headers.get("x-admin-key") ?? "";
  const expected = process.env.ADMIN_KEY || process.env.NEXT_PUBLIC_ADMIN_KEY || "";
  if (!expected || key !== expected) {
    return NextResponse.json({ ok: false, error: "401 Unauthorized: bad admin key" }, { status: 401 });
  }
  return null;
}

function adminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, service, { auth: { persistSession: false } });
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function POST(req: Request) {
  const authFail = mustAdmin(req);
  if (authFail) return authFail;

  const body = await req.json().catch(() => ({}));
  const selectedCatIds: number[] = Array.isArray(body.selectedCatIds)
    ? body.selectedCatIds.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n))
    : [];

  if (selectedCatIds.length === 0) {
    return NextResponse.json({ ok: false, error: "selectedCatIds is empty" }, { status: 400 });
  }

  const sb = adminSupabase();

  // cats（同 preview：兼容沒 image_url）
  let catsData: any[] | null = null;
  let catsErr: any = null;

  const q1 = await sb
    .from("cats")
    .select("id,name,image_url")
    .in("id", selectedCatIds);

  catsData = q1.data as any;
  catsErr = q1.error;

  if (catsErr && String(catsErr.message).includes("image_url")) {
    const q2 = await sb.from("cats").select("id,name").in("id", selectedCatIds);
    catsData = q2.data as any;
    catsErr = q2.error;
  }

  if (catsErr) {
    return NextResponse.json({ ok: false, error: "讀取 cats 失敗：" + catsErr.message }, { status: 500 });
  }

  const catById = new Map<number, any>();
  (catsData ?? []).forEach((c) => catById.set(Number(c.id), c));

  // 讀 applications（這張表：每個 applicant 一筆 choices int4[]）
  // 找出「choices 包含 catId」的申請者，抽出前三名
  const { data: applications, error: appErr } = await sb
    .from("applications")
    .select("id, applicant_id, choices");

  if (appErr) {
    return NextResponse.json({ ok: false, error: "讀取 applications 失敗：" + appErr.message }, { status: 500 });
  }

  // 讀 applicants（這張表：人的基本資料）
  // 你若還沒加 phone/township 欄位也沒關係：select 不到才會炸，所以這裡做 fallback
  let applicants: any[] | null = null;
  let aErr: any = null;

  const a1 = await sb
    .from("applicants")
    .select("id,name,phone,township");
  applicants = a1.data as any;
  aErr = a1.error;

  if (aErr && (String(aErr.message).includes("phone") || String(aErr.message).includes("township"))) {
    const a2 = await sb.from("applicants").select("id,name");
    applicants = a2.data as any;
    aErr = a2.error;
  }

  if (aErr) {
    return NextResponse.json({ ok: false, error: "讀取 applicants 失敗：" + aErr.message }, { status: 500 });
  }

  const applicantById = new Map<string, any>();
  (applicants ?? []).forEach((a) => applicantById.set(String(a.id), a));

  // 讓同一人同一輪不重複中不同貓
  const alreadyWon = new Set<string>();

  const results: ResultItem[] = [];

  for (const catId of selectedCatIds) {
    const c = catById.get(catId);
    const catName = c?.name ?? `貓${catId}`;
    const imageUrl = c?.image_url ?? null;

    // 找出有選這隻貓的 applicant_id
    const pool = (applications ?? [])
      .filter((x: any) => Array.isArray(x.choices) && x.choices.map(Number).includes(catId))
      .map((x: any) => String(x.applicant_id))
      .filter((id: string) => applicantById.has(id));

    const shuffled = shuffle(pool);

    const picked: string[] = [];
    for (const id of shuffled) {
      if (alreadyWon.has(id)) continue;
      picked.push(id);
      alreadyWon.add(id);
      if (picked.length >= 3) break;
    }

    const ranks: Winner["rank"][] = ["正取", "備取1", "備取2"];
    const winners: Winner[] = ranks.map((rank, idx) => {
      const aid = picked[idx];
      if (!aid) return { rank, name: "—" };

      const a = applicantById.get(aid);
      return {
        rank,
        name: a?.name ?? "—",
        uid: aid,
        phone: a?.phone ?? undefined,
        township: a?.township ?? undefined,
      };
    });

    const note =
      pool.length === 0
        ? "目前無人報名"
        : picked.length < 3
        ? `報名 ${pool.length} 人（名額不足，空位以 — 顯示）`
        : `報名 ${pool.length} 人`;

    results.push({
      catId,
      catName,
      catLabel: `${String(catId).padStart(2, "0")}號貓咪`,
      imageUrl,
      note,
      winners,
    });
  }

  // 寫回 live_state
  const { error: upErr } = await sb
    .from("live_state")
    .update({
      phase: "draw",
      selected_cat_ids: selectedCatIds,
      results,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  if (upErr) {
    return NextResponse.json({ ok: false, error: "更新 live_state 失敗：" + upErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
