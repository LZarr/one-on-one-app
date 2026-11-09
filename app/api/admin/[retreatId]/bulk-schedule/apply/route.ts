import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { isRetreatAdmin } from "@/lib/config";
import { createAdminMeeting } from "@/lib/adminSchedule";

const schema = z.object({
  slotStart: z.string(),
  pairs: z.array(
    z.object({
      fromUserId: z.string(),
      toUserId: z.string(),
      fromName: z.string(),
      toName: z.string(),
    }),
  ),
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
  if (!parsed.success) return NextResponse.json({ error: "bad input" }, { status: 400 });

  const slotStart = new Date(parsed.data.slotStart);

  // Applied one at a time (not in parallel) so each pair's conflict check
  // sees the meetings already created earlier in this same batch.
  const results: { fromName: string; toName: string; ok: boolean; error?: string }[] = [];
  for (const pair of parsed.data.pairs) {
    const result = await createAdminMeeting(retreatId, s.userId, pair.fromUserId, pair.toUserId, slotStart);
    results.push({
      fromName: pair.fromName,
      toName: pair.toName,
      ok: result.ok,
      error: result.ok ? undefined : result.error,
    });
  }

  return NextResponse.json({ results });
}
