import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type Applicant = {
  id: string;
  name?: string | null;
  phone?: string | null;
  township?: string | null;
};

function sbAdmin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

function maskPhone(phone?: string | null) {
  if (!phone) return "";
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length < 7) return String(phone);
  // 0912****78
  return digits.slice(0, 4) + "****" + digits.slice(-2);
}

function shuffle<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 重要假設（符合你目前表結構）：
 * - applications: id(uuid), applicant_id(uuid), choices(int4[])
 * - applicants: id(uuid), name(text), phone(text), township(text)
 * - live_state: id(int4=1), phase(text), selected_cat_ids(int4[]), results(jsonb)
 *
 * 若你的欄位名不同，告訴我我幫你改成完全對得上。
 */
export async function POST(req: Request) {
  try {
    const supabase = sbAdmin();
    const body = await req.json();
    const selectedCatIds: number[] = Array.isArray(body.selectedCatIds)
      ? body.selectedCatIds.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
      : [];

    if (selectedCatIds.length === 0) {
      return NextResponse.json({ ok: false, error: "selectedCatIds is empty" }, { status: 400 });
    }

    // 讀 cats 名稱
    const { data: cats, error: catErr } = await supabase
      .from("cats")
      .select("id,name")
      .in("id", selectedCatIds);

    if (catErr) throw catErr;

    const catNameMap = new Map<number, string>();
    (cats ?? []).forEach((c: any) => catNameMap.set(Number(c.id), c.name));

    // 讀取「已中籤的人」：避免一人重複中籤
    // 這裡我們用 wins 表（如果你還沒用 wins，也可以先建立；你現在左邊有 wins）
    const { data: wins, error: winsErr } = await supabase
      .from("wins")
      .select("applicant_id");

    if (winsErr) throw winsErr;

    const alreadyWon = new Set<string>((wins ?? []).map((w: any) => String(w.applicant_id)));

    const results: any[] = [];

    for (const catId of selectedCatIds) {
      // 找出選了這隻貓的 applications（choices contains catId）
      const { data: apps, error: appErr } = await supabase
        .from("applications")
        .select("id, applicant_id")
        .contains("choices", [catId]);

      if (appErr) throw appErr;

      const applicantIds = (apps ?? [])
        .map((a: any) => String(a.applicant_id))
        .filter((id: string) => !!id)
        .filter((id: string) => !alreadyWon.has(id)); // 排除已中籤者

      if (applicantIds.length === 0) {
        results.push({
          note: "目前無人報名",
          catId,
          catName: catNameMap.get(catId) ?? `貓 ${String(catId).padStart(2, "0")}`,
          winners: [],
        });
        continue;
      }

      // 取 applicant 詳細資料（姓名/電話/鄉鎮）
      const { data: applicants, error: apErr } = await supabase
        .from("applicants")
        .select("id,name,phone,township")
        .in("id", applicantIds);

      if (apErr) throw apErr;

      const map = new Map<string, Applicant>();
      (applicants ?? []).forEach((p: any) => map.set(String(p.id), p));

      // 隨機排序候選人
      const pool = shuffle(applicantIds);

      const pick = (idx: number) => {
        const id = pool[idx];
        const p = id ? map.get(id) : undefined;
        return {
          rank: idx === 0 ? "正取" : idx === 1 ? "備取1" : "備取2",
          name: p?.name ?? "—",
          phone: maskPhone(p?.phone),
          township: p?.township ?? "",
          applicantId: id ?? null, // 內部用，display 可不顯示
        };
      };

      const w0 = pick(0);
      const w1 = pick(1);
      const w2 = pick(2);

      // 把正取加入 alreadyWon，避免同一次抽多貓時重複中
      if (w0.applicantId) alreadyWon.add(w0.applicantId);

      // 寫入 wins（可讓你留痕、也可用來防重複中籤）
      // 建議 wins 表至少有：cat_id(int4), applicant_id(uuid), rank(text)
      const rowsToInsert = [w0, w1, w2]
        .filter((w) => w.applicantId)
        .map((w) => ({
          cat_id: catId,
          applicant_id: w.applicantId,
          rank: w.rank,
        }));

      if (rowsToInsert.length > 0) {
        const { error: insErr } = await supabase.from("wins").insert(rowsToInsert);
        // 若你想允許重抽同一貓（會撞資料），這裡會報錯
        // 先不 throw，避免影響直播；需要「可重抽」我再幫你改成 upsert/先刪後插
        if (insErr) console.warn("wins insert warning:", insErr.message);
      }

      // 給 display 的 winners：不要 applicantId（避免個資擴散）
      const winnersForDisplay = [w0, w1, w2].map(({ applicantId, ...rest }) => rest);

      results.push({
        note: "",
        catId,
        catName: catNameMap.get(catId) ?? `貓 ${String(catId).padStart(2, "0")}`,
        winners: winnersForDisplay,
      });
    }

    // 寫入 live_state
    const { error: upErr } = await supabase
      .from("live_state")
      .update({
        phase: "drawn",
        selected_cat_ids: selectedCatIds,
        results,
      })
      .eq("id", 1);

    if (upErr) throw upErr;

    return NextResponse.json({ ok: true, results });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
