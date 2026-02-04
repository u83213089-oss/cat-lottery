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
  catLabel?: string; // 想顯示 "3號貓咪" / "貓 03" 都可以從這裡控制
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

  // 讀 cats（有些環境可能還沒 image_url）
  let catsData: any[] | null = null;
  let catsErr: any = null;

  const q1 = await sb
    .from("cats")
    .select("id,name,image_url")
    .in("id", selectedCatIds);

  catsData = q1.data as any;
  catsErr = q1.error;

  // fallback：沒有 image_url 欄位
  if (catsErr && String(catsErr.message).includes("image_url")) {
    const q2 = await sb
      .from("cats")
      .select("id,name")
      .in("id", selectedCatIds);
    catsData = q2.data as any;
    catsErr = q2.error;
  }

  if (catsErr) {
    return NextResponse.json({ ok: false, error: "讀取 cats 失敗：" + catsErr.message }, { status: 500 });
  }

  const byId = new Map<number, any>();
  (catsData ?? []).forEach((c) => byId.set(Number(c.id), c));

  // ✅ Preview：先把卡片推去 display，但 winners 先用 — 佔位
  const results: ResultItem[] = selectedCatIds.map((catId) => {
    const c = byId.get(catId);
    const catName = c?.name ?? `貓${catId}`;
    const imageUrl = c?.image_url ?? null;

    return {
      catId,
      catName,
      catLabel: `${String(catId).padStart(2, "0")}號貓咪`, // 你想改成 "3號貓" 也在這裡改
      imageUrl,
      note: "待抽籤（預覽）",
      winners: [
        { rank: "正取", name: "—" },
        { rank: "備取1", name: "—" },
        { rank: "備取2", name: "—" },
      ],
    };
  });

  // 寫回 live_state (id=1)
  const { error: upErr } = await sb
    .from("live_state")
    .update({
      phase: "preview",
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
