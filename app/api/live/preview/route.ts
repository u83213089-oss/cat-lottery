import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // 一定要 service role
);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { selectedCatIds } = body;

    if (!Array.isArray(selectedCatIds)) {
      return NextResponse.json(
        { error: "selectedCatIds must be array" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("live_state")
      .update({
        phase: "preview",
        selected_cat_ids: selectedCatIds,
        results: null, // preview 一定沒有結果
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1)
      .select("*")     // 🔴 關鍵
      .single();       // 🔴 關鍵

    if (error) {
      console.error("preview update error", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      live_state: data,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "server error" },
      { status: 500 }
    );
  }
}
