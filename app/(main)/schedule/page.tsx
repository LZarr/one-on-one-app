import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getRetreat, generateSlots, groupSlotsByDay, nowInRetreatTz, getDayHoursMap, meetingSlotStarts } from "@/lib/config";
import {
  getMyAvailability,
  ensureDefaultAvailability,
} from "@/lib/availability";
import { prisma } from "@/lib/prisma";
import { Suspense } from "react";
import CalendarView from "./CalendarView";
import Toast from "./Toast";

export default async function SchedulePage() {
  const s = await getSession();
  if (!s.userId || !s.retreatId) redirect("/login");
  const retreat = (await getRetreat(s.retreatId))!;
  const dayHours = await getDayHoursMap(s.retreatId);
  const blockedSlots = new Set(retreat.blockedSlots ?? []);
  const slots = generateSlots(retreat, dayHours);
  const visibleSlots = slots.filter((slot) => !blockedSlots.has(slot.toISOString()));
  const groups = groupSlotsByDay(slots);
  await ensureDefaultAvailability(s.userId, s.retreatId, visibleSlots);

  const [mine, allRequests, agendaItems] = await Promise.all([
    getMyAvailability(s.userId, s.retreatId),
    prisma.meetingRequest.findMany({
      where: {
        retreatId: s.retreatId,
        OR: [{ fromUserId: s.userId }, { toUserId: s.userId }],
        status: { in: ["pending", "accepted"] },
      },
      include: {
        from: { select: { id: true, name: true, email: true } },
        to: { select: { id: true, name: true, email: true } },
      },
      orderBy: { slotStart: "asc" },
    }),
    prisma.agendaItem.findMany({
      where: { retreatId: s.retreatId },
      select: { date: true, startTime: true, endTime: true, title: true, subtitle: true },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    }),
  ]);

  const slotMeetings: Record<
    string,
    {
      requestId: string;
      otherPersonName: string;
      otherPersonId: string;
      type: "confirmed" | "incoming" | "outgoing";
      assignedByAdmin: boolean;
      message: string | null;
    }
  > = {};

  for (const r of allRequests) {
    const isIncoming = r.toUserId === s.userId && r.status === "pending";
    const isOutgoing = r.fromUserId === s.userId && r.status === "pending";
    const isConfirmed = r.status === "accepted";

    if (!isIncoming && !isOutgoing && !isConfirmed) continue;

    const other = r.fromUserId === s.userId ? r.to : r.from;
    const entry = {
      requestId: r.id,
      otherPersonName: other.name || "someone",
      otherPersonId: other.id,
      type: (isConfirmed ? "confirmed" : isIncoming ? "incoming" : "outgoing") as
        | "confirmed"
        | "incoming"
        | "outgoing",
      assignedByAdmin: r.assignedByAdmin,
      message: r.message,
    };
    // A 1:1 always runs the full meeting duration, which can span more than one
    // base-grid slot when the display granularity is finer than that — mark
    // every slot it occupies, not just the one it was booked at.
    for (const slot of meetingSlotStarts(r.slotStart, retreat)) {
      slotMeetings[slot.toISOString()] = entry;
    }
  }

  return (
    <>
      <Suspense fallback={null}>
        <Toast />
      </Suspense>
      <CalendarView
        groups={Object.fromEntries(
          Object.entries(groups).map(([k, v]) => [
            k,
            v.map((d) => d.toISOString()),
          ]),
        )}
        availableSlots={Array.from(mine)}
        slotMeetings={slotMeetings}
        highlightedSlots={retreat.highlightedSlots ?? []}
        blockedSlots={retreat.blockedSlots ?? []}
        agendaItems={agendaItems}
        now={nowInRetreatTz(retreat).toISOString()}
      />
    </>
  );
}
