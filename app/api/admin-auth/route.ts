import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { password } = await req.json();

  const adminPass = process.env.ADMIN_PASSWORD;
  if (!adminPass) {
    return new NextResponse("ADMIN_PASSWORD not set", { status: 500 });
  }

  if (password !== adminPass) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
