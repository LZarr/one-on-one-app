import { prisma } from "./prisma";
import { lockSlot } from "./booking";
import { notifyAdminScheduled } from "./notifications";
import { meetingSlotStarts } from "./config";

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
      const [fromAttendance, toAttendance, retreat] = await Promise.all([
        tx.retreatAttendance.findUnique({ where: { userId_retreatId: { userId: fromUserId, retreatId } } }),
        tx.retreatAttendance.findUnique({ where: { userId_retreatId: { userId: toUserId, retreatId } } }),
        tx.retreat.findUnique({ where: { id: retreatId } }),
      ]);
      if (!fromAttendance || !toAttendance) throw new Error("Both users must be retreat attendees.");
      if (!retreat) throw new Error("Retreat not found.");

      // A 1:1 always runs the full meeting duration, which can span more than
      // one base-grid slot when the display granularity is finer than that.
      const meetingSlots = meetingSlotStarts(slotStart, retreat);
      for (const slot of meetingSlots) {
        await lockSlot(tx, retreatId, slot, [fromUserId, toUserId]);
      }
      // Blocked slots exist to keep *self-service* requests out of admin-
      // reserved time (like a designated paired-1:1 slot) — this function is
      // only ever called by the admin scheduling tools, which need to be able
      // to assign meetings into exactly those slots, so it doesn't check
      // retreat.blockedSlots at all.
      for (const slot of meetingSlots) {
        const conflict = await tx.meetingRequest.findFirst({
          where: {
            retreatId,
            slotStart: slot,
            status: "accepted",
            OR: [
              { fromUserId },
              { toUserId: fromUserId },
              { fromUserId: toUserId },
              { toUserId },
            ],
          },
        });
        if (conflict) throw new Error("One or both already have a meeting at that time.");
      }

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
      // Cancel any pending requests overlapping this window for either party
      await tx.meetingRequest.updateMany({
        where: {
          retreatId,
          slotStart: { in: meetingSlots },
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
