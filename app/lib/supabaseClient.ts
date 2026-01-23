import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    global: {
      headers: {
        "x-admin-key": process.env.NEXT_PUBLIC_ADMIN_KEY!, // 待會加到 Vercel env
      },
    },
  }
);
