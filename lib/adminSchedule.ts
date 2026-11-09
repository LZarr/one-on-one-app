import { prisma } from "./prisma";
import { lockSlot } from "./booking";
import { notifyAdminScheduled } from "./notifications";

export type AdminMeetingResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

// Directly pairs two retreat attendees for a confirmed 1:1 at a given slot,
// bypassing the usual request/accept flow. Used by both the single-pair and
// bulk admin scheduling tools.
export async function createAdminMeeting(
  retreatId: string,
  adminUserId: string,
  fromUserId: string,
  toUserId: string,
  slotStart: Date,
): Promise<AdminMeetingResult> {
  if (fromUserId === toUserId) return { ok: false, error: "Can't pair someone with themselves." };

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      await lockSlot(tx, retreatId, slotStart, [fromUserId, toUserId]);
      const [fromAttendance, toAttendance, retreat, conflict] = await Promise.all([
        tx.retreatAttendance.findUnique({ where: { userId_retreatId: { userId: fromUserId, retreatId } } }),
        tx.retreatAttendance.findUnique({ where: { userId_retreatId: { userId: toUserId, retreatId } } }),
        tx.retreat.findUnique({ where: { id: retreatId }, select: { blockedSlots: true } }),
        tx.meetingRequest.findFirst({
          where: {
            retreatId,
            slotStart,
            status: "accepted",
            OR: [
              { fromUserId },
              { toUserId: fromUserId },
              { fromUserId: toUserId },
              { toUserId },
            ],
          },
        }),
      ]);
      if (!fromAttendance || !toAttendance) throw new Error("Both users must be retreat attendees.");
      if (retreat?.blockedSlots.includes(slotStart.toISOString()))
        throw new Error("That slot is blocked.");
      if (conflict) throw new Error("One or both already have a meeting at that time.");

      const meeting = await tx.meetingRequest.create({
        data: {
          retreatId,
          fromUserId,
          toUserId,
          slotStart,
          status: "accepted",
          assignedByAdmin: true,
        },
      });
      // Cancel any pending requests at this slot for either party
      await tx.meetingRequest.updateMany({
        where: {
          retreatId,
          slotStart,
          status: "pending",
          id: { not: meeting.id },
          OR: [
            { fromUserId },
            { toUserId: fromUserId },
            { fromUserId: toUserId },
            { toUserId },
          ],
        },
        data: { status: "cancelled" },
      });
      return meeting;
    });
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to schedule." };
  }

  const [admin, fromUser, toUser] = await Promise.all([
    prisma.user.findUnique({ where: { id: adminUserId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: fromUserId }, select: { name: true, email: true } }),
    prisma.user.findUnique({ where: { id: toUserId }, select: { name: true, email: true } }),
  ]);
  if (admin && fromUser?.email && toUser) {
    notifyAdminScheduled(fromUser.email, admin.name || "Admin", toUser.name || "someone", slotStart);
  }
  if (admin && toUser?.email && fromUser) {
    notifyAdminScheduled(toUser.email, admin.name || "Admin", fromUser.name || "someone", slotStart);
  }

  return { ok: true, id: created.id };
}
