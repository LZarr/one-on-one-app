import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { isRetreatAdmin, generateSlots, getDayHoursMap } from "@/lib/config";
import { ensureDefaultAvailability } from "@/lib/availability";

const rowSchema = z.object({
  name: z.string().min(1),
  pronouns: z.string().optional(),
  school: z.string().optional(),
  bio: z.string().optional(),
  canHelpWith: z.string().optional(),
  canBeHelpedWith: z.string().optional(),
  keyCrux: z.string().optional(),
  personalLink: z.string().optional(),
});

const schema = z.object({
  rows: z.array(rowSchema),
  removeIds: z.array(z.string()).default([]),
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

  const [existing, retreat, dayHours] = await Promise.all([
    prisma.retreatAttendance.findMany({
      where: { retreatId },
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.retreat.findUnique({ where: { id: retreatId } }),
    getDayHoursMap(retreatId),
  ]);
  if (!retreat) return NextResponse.json({ error: "retreat not found" }, { status: 404 });
  const slots = generateSlots(retreat, dayHours);
  const byName = new Map(existing.map((a) => [a.user.name.toLowerCase(), a.user.id]));

  for (const { name, ...fields } of parsed.data.rows) {
    const existingId = byName.get(name.toLowerCase());
    if (existingId) {
      await prisma.user.update({ where: { id: existingId }, data: fields });
    } else {
      const user = await prisma.user.create({ data: { name, ...fields } });
      await prisma.retreatAttendance.create({ data: { userId: user.id, retreatId } });
      await ensureDefaultAvailability(user.id, retreatId, slots);
      byName.set(name.toLowerCase(), user.id);
    }
  }

  for (const userId of parsed.data.removeIds) {
    await prisma.meetingRequest.updateMany({
      where: { retreatId, OR: [{ fromUserId: userId }, { toUserId: userId }], status: { in: ["pending", "accepted"] } },
      data: { status: "cancelled" },
    });
    await prisma.availability.deleteMany({ where: { userId, retreatId } });
    await prisma.retreatAttendance.deleteMany({ where: { userId, retreatId } });
  }

  return NextResponse.json({ ok: true });
}
