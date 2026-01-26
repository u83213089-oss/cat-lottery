import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const runtime = "nodejs";

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function normalizeIds(input: any): number[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n > 0);
}

function shuffle<T>(arr: T[]): T[] {
  // Fisher–Yates shuffle using crypto for better randomness
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

type WinnerOut = {
  rank: "正取" | "備取1" | "備取2";
  applicantId?: string;
  name: string;
  phone?: string;
  township?: string;
};

type ResultItem = {
  catId: number;
  catName: string;
  note?: string;
  winners: WinnerOut[];
};

export async function POST(req: Request) {
  // 1) Admin key check
  const adminKey = req.headers.get("x-admin-key") ?? "";
  const expected = process.env.NEXT_PUBLIC_ADMIN_KEY ?? "";
  if (!expected || adminKey !== expected) {
    return jsonError(401, "Unauthorized: bad admin key");
  }

  // 2) Parse body
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Bad Request: invalid JSON");
  }

  const selectedCatIds = normalizeIds(body?.selectedCatIds);
  if (selectedCatIds.length === 0) {
    return jsonError(400, "selectedCatIds is required");
  }

  // 3) Supabase service role client
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return jsonError(500, "Missing SUPABASE env vars on server");
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  // 4) Load cats (name mapping)
  const { data: catRows, error: catErr } = await supabase
    .from("cats")
    .select("id,name")
    .in("id", selectedCatIds);

  if (catErr) {
    return jsonError(500, `Load cats failed: ${catErr.message}`);
  }

  const catNameMap = new Map<number, string>(
    (catRows ?? []).map((c: any) => [Number(c.id), String(c.name ?? "")])
  );

  const results: ResultItem[] = [];

  // 5) For each cat, find candidates from applications.choices contains catId
  for (const catId of selectedCatIds) {
    // applications: { id uuid, applicant_id uuid, choices int4[], created_at ... }
    const { data: apps, error: appErr } = await supabase
      .from("applications")
      .select("applicant_id, choices")
      .contains("choices", [catId]);

    if (appErr) {
      return jsonError(
        500,
        `Load applications failed (cat ${catId}): ${appErr.message}`
      );
    }

    const applicantIds = Array.from(
      new Set((apps ?? []).map((a: any) => String(a.applicant_id)))
    );

    if (applicantIds.length === 0) {
      results.push({
        catId,
        catName: catNameMap.get(catId) ?? `貓${catId}`,
        note: "目前無人報名",
        winners: [],
      });
      continue;
    }

    // applicants: 你之後會加 phone / township，先用 select 兼容
    const { data: people, error: peopleErr } = await supabase
      .from("applicants")
      .select("id,name,phone,township")
      .in("id", applicantIds);

    if (peopleErr) {
      return jsonError(
        500,
        `Load applicants failed (cat ${catId}): ${peopleErr.message}`
      );
    }

    const pool = shuffle(
      (people ?? []).map((p: any) => ({
        id: String(p.id),
        name: String(p.name ?? ""),
        phone: p.phone ? String(p.phone) : "",
        township: p.township ? String(p.township) : "",
      }))
    );

    const picked = pool.slice(0, 3);

    const ranks: WinnerOut["rank"][] = ["正取", "備取1", "備取2"];
    const winners: WinnerOut[] = ranks.map((rank, idx) => {
      const p = picked[idx];
      if (!p) {
        return { rank, name: "—", phone: "", township: "" };
      }
      return {
        rank,
        applicantId: p.id,
        name: p.name || "—",
        phone: p.phone || "",
        township: p.township || "",
      };
    });

    results.push({
      catId,
      catName: catNameMap.get(catId) ?? `貓${catId}`,
      winners,
    });
  }

  // 6) Update live_state
  const { error: updateErr } = await supabase
    .from("live_state")
    .update({
      phase: "draw",
      selected_cat_ids: selectedCatIds,
      results: results as any,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  if (updateErr) {
    return jsonError(500, `Update live_state failed: ${updateErr.message}`);
  }

  return NextResponse.json({
    ok: true,
    phase: "draw",
    selectedCatIds,
    results,
  });
}
