import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

  // 3) Supabase service role client (server only)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return jsonError(500, "Missing SUPABASE env vars on server");
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  // 4) Update live_state row id=1
  const { error } = await supabase
    .from("live_state")
    .update({
      phase: "preview",
      selected_cat_ids: selectedCatIds, // int4[]
      results: [], // jsonb
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  if (error) {
    return jsonError(500, `Supabase update failed: ${error.message}`);
  }

  return NextResponse.json({
    ok: true,
    phase: "preview",
    selectedCatIds,
  });
}
