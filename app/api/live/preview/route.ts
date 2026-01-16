import { NextResponse } from "next/server";
import { supabaseServer } from "@/app/lib/supabaseServer";

export async function POST(req: Request) {
  const { password, selectedCatIds } = await req.json();

  if (!process.env.ADMIN_PASSWORD) {
    return new NextResponse("ADMIN_PASSWORD not set", { status: 500 });
  }
  if (password !== process.env.ADMIN_PASSWORD) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const supabase = supabaseServer();

  const payload = {
    phase: "preview",
    selected_cat_ids: selectedCatIds ?? [],
    results: null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("live_state")
    .update(payload)
    .eq("id", 1);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
