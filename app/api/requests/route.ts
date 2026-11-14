import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { notifyNewRequest } from "@/lib/notifications";
import { getRetreat, nowInRetreatTz, getDayHoursMap, generateSlots, meetingSlotStarts, noStartSlotsFromAgenda } from "@/lib/config";
import { lockSlot } from "@/lib/booking";

const schema = z.object({
  toUserId: z.string(),
  slotStart: z.string(),
  message: z.string().max(1000).optional(),
});

export async function POST(req: Request) {
  const s = await getSession();
  if (!s.userId || !s.retreatId)
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "bad input" }, { status: 400 });
  const slotStart = new Date(parsed.data.slotStart);

  // Slots are stored as "fake UTC" — wall-clock time in the retreat's timezone
  // pretending to be UTC (see lib/config.ts generateSlots). Compare against
  // the same convention, not real UTC now, or west-coast users booking later
  // today get rejected because their local-hour < current UTC-hour.
  const retreat = await getRetreat(s.retreatId);
  if (!retreat)
    return NextResponse.json({ error: "retreat not found" }, { status: 400 });

  const BUFFER_MS = 30 * 60 * 1000;
  if (slotStart.getTime() < nowInRetreatTz(retreat).getTime() + BUFFER_MS) {
    return NextResponse.json(
      { error: "Can't book a slot less than 30 minutes from now." },
      { status: 400 },
    );
  }

  // The back half of a named "1:1 Slot" window can't be a fresh request
  // start (it would spill 15 minutes into the next slot) — but it's fine as
  // the second half of a meeting starting at the slot's own first base slot,
  // so this only rejects slotStart itself, not every slot the meeting spans.
  const agendaItems = await prisma.agendaItem.findMany({
    where: { retreatId: s.retreatId },
    select: { date: true, startTime: true, endTime: true, title: true, subtitle: true },
  });
  if (noStartSlotsFromAgenda(agendaItems, retreat).has(slotStart.toISOString())) {
    return NextResponse.json(
      { error: "A 1:1 can't start partway through that slot." },
      { status: 400 },
    );
  }

  // A 1:1 always runs the full MEETING_DURATION_MINUTES, which may span several
  // base-grid slots when the retreat's display granularity is finer than that
  // (e.g. a 15-minute grid needs 2 slots for a 30-minute meeting). Every one of
  // those slots must be a real, open, unblocked slot for both people.
  const dayHours = await getDayHoursMap(s.retreatId);
  const validSlots = new Set(generateSlots(retreat, dayHours).map((d) => d.toISOString()));
  const meetingSlots = meetingSlotStarts(slotStart, retreat);
  const blocked = new Set(retreat.blockedSlots ?? []);
  for (const slot of meetingSlots) {
    const iso = slot.toISOString();
    if (!validSlots.has(iso)) {
      return NextResponse.json(
        { error: "That time doesn't leave room for a full 30-minute meeting." },
        { status: 400 },
      );
    }
    if (blocked.has(iso)) {
      return NextResponse.json(
        { error: "That slot has been blocked by the retreat admin." },
        { status: 400 },
      );
    }
  }

  // Capture narrowed values for use inside transaction closure
  const userId = s.userId;
  const retreatId = s.retreatId;
  const toUserId = parsed.data.toUserId;

  // Validate and create inside a transaction to prevent double-booking
  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      for (const slot of meetingSlots) {
        await lockSlot(tx, retreatId, slot, [userId, toUserId]);
      }

      for (const slot of meetingSlots) {
        const [fromAvail, toAvail, conflict] = await Promise.all([
          tx.availability.findUnique({
            where: { userId_retreatId_slotStart: { userId, retreatId, slotStart: slot } },
          }),
          tx.availability.findUnique({
            where: { userId_retreatId_slotStart: { userId: toUserId, retreatId, slotStart: slot } },
          }),
          tx.meetingRequest.findFirst({
            where: {
              retreatId,
              slotStart: slot,
              status: { in: ["accepted", "pending"] },
              OR: [
                { fromUserId: userId },
                { toUserId: userId },
                { fromUserId: toUserId },
                { toUserId: toUserId },
              ],
            },
          }),
        ]);
        if (!fromAvail || !toAvail) throw new Error("Both users must mark this full 30 minutes available.");
        if (conflict) throw new Error("That time is no longer available.");
      }

      return tx.meetingRequest.create({
        data: {
          retreatId,
          fromUserId: userId,
          toUserId,
          slotStart,
          status: "pending",
          message: parsed.data.message,
        },
      });
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to create request.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const [toUser, fromUser] = await Promise.all([
    prisma.user.findUnique({ where: { id: parsed.data.toUserId }, select: { email: true } }),
    prisma.user.findUnique({ where: { id: s.userId }, select: { name: true } }),
  ]);

  if (toUser?.email && fromUser) {
    notifyNewRequest(toUser.email, fromUser.name || "Someone", slotStart, created.id, parsed.data.message);
  }

  return NextResponse.json({ ok: true, id: created.id });
}
