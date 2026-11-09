import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { isRetreatAdmin } from "@/lib/config";
import { createAdminMeeting } from "@/lib/adminSchedule";

const schema = z.object({
  fromUserId: z.string(),
  toUserId: z.string(),
  slotStart: z.string(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ retreatId: string }> },
) {
  const s = await getSession();
  if (!s.userId) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const { retreatId } = await params;
  if (!(await isRetreatAdmin(s.userId, retreatId)))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "bad input" }, { status: 400 });
  const { fromUserId, toUserId } = parsed.data;
  const slotStart = new Date(parsed.data.slotStart);

  const result = await createAdminMeeting(retreatId, s.userId, fromUserId, toUserId, slotStart);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, id: result.id });
}
