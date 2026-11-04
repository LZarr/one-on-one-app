import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function POST(req: Request) {
  const session = await getSession();
  const isRosterSession = !session.email && session.retreatId;
  const redirectTo = isRosterSession ? `/attend/${session.retreatId}` : "/login";
  session.destroy();
  return NextResponse.redirect(new URL(redirectTo, req.url), { status: 303 });
}
