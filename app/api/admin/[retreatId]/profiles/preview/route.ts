import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { isRetreatAdmin } from "@/lib/config";
import { parseProfileRows } from "@/lib/profileImport";

const schema = z.object({ text: z.string() });

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

  const rows = parseProfileRows(parsed.data.text);

  const existing = await prisma.retreatAttendance.findMany({
    where: { retreatId },
    include: { user: { select: { id: true, name: true } } },
  });

  const pastedNames = new Set(rows.map((r) => r.name.toLowerCase()));
  const existingNames = new Set(existing.map((a) => a.user.name.toLowerCase()));

  const newCount = rows.filter((r) => !existingNames.has(r.name.toLowerCase())).length;
  const updateCount = rows.length - newCount;
  const toRemove = existing
    .filter((a) => !pastedNames.has(a.user.name.toLowerCase()))
    .map((a) => ({ id: a.user.id, name: a.user.name }));

  return NextResponse.json({ rows, newCount, updateCount, toRemove });
}
