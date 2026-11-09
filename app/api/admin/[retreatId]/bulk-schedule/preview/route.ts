import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { isRetreatAdmin } from "@/lib/config";
import { parseTsv } from "@/lib/tsv";

const schema = z.object({
  slotStart: z.string(),
  text: z.string(),
});

type PreviewRow = {
  fromName: string;
  toName: string;
  fromUserId: string | null;
  toUserId: string | null;
  status: "ok" | "error";
  reason?: string;
};

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

  const rawRows = parseTsv(parsed.data.text)
    .map((cols) => cols.map((c) => c.trim()))
    .filter((cols) => cols[0] && cols[1])
    .filter((cols) => cols[0].toLowerCase() !== "person a" && cols[0].toLowerCase() !== "name");

  const [attendances, busyMeetings] = await Promise.all([
    prisma.retreatAttendance.findMany({
      where: { retreatId },
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.meetingRequest.findMany({
      where: { retreatId, slotStart, status: "accepted" },
      select: { fromUserId: true, toUserId: true },
    }),
  ]);
  const byName = new Map(attendances.map((a) => [a.user.name.toLowerCase(), a.user.id]));
  const busyIds = new Set(busyMeetings.flatMap((m) => [m.fromUserId, m.toUserId]));

  const usedInBatch = new Set<string>();
  const rows: PreviewRow[] = rawRows.map(([fromName, toName]) => {
    const fromUserId = byName.get(fromName.toLowerCase()) ?? null;
    const toUserId = byName.get(toName.toLowerCase()) ?? null;

    if (!fromUserId) return { fromName, toName, fromUserId, toUserId, status: "error", reason: `"${fromName}" not found in roster` };
    if (!toUserId) return { fromName, toName, fromUserId, toUserId, status: "error", reason: `"${toName}" not found in roster` };
    if (fromUserId === toUserId)
      return { fromName, toName, fromUserId, toUserId, status: "error", reason: "Can't pair someone with themselves" };
    if (busyIds.has(fromUserId))
      return { fromName, toName, fromUserId, toUserId, status: "error", reason: `${fromName} already has a meeting at this time` };
    if (busyIds.has(toUserId))
      return { fromName, toName, fromUserId, toUserId, status: "error", reason: `${toName} already has a meeting at this time` };
    if (usedInBatch.has(fromUserId))
      return { fromName, toName, fromUserId, toUserId, status: "error", reason: `${fromName} appears more than once in this list` };
    if (usedInBatch.has(toUserId))
      return { fromName, toName, fromUserId, toUserId, status: "error", reason: `${toName} appears more than once in this list` };

    usedInBatch.add(fromUserId);
    usedInBatch.add(toUserId);
    return { fromName, toName, fromUserId, toUserId, status: "ok" };
  });

  return NextResponse.json({ rows });
}
