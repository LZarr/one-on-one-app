import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getRetreat } from "@/lib/config";
import AgendaView from "./AgendaView";

function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

export default async function AgendaPage() {
  const s = await getSession();
  if (!s.userId || !s.retreatId) redirect("/login");

  const retreat = await getRetreat(s.retreatId);
  if (!retreat) redirect("/no-retreat");

  const [agendaItems, myMeetings] = await Promise.all([
    prisma.agendaItem.findMany({
      where: { retreatId: s.retreatId },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    }),
    prisma.meetingRequest.findMany({
      where: {
        retreatId: s.retreatId,
        status: "accepted",
        OR: [{ fromUserId: s.userId }, { toUserId: s.userId }],
      },
      include: {
        from: { select: { id: true, name: true } },
        to: { select: { id: true, name: true } },
      },
    }),
  ]);

  const myMeetingItems = myMeetings.map((m) => {
    const other = m.fromUserId === s.userId ? m.to : m.from;
    const iso = m.slotStart.toISOString();
    const date = iso.slice(0, 10);
    const startTime = iso.slice(11, 16);
    return {
      id: m.id,
      date,
      startTime,
      endTime: addMinutes(startTime, retreat.granularityMinutes),
      otherName: other.name || "someone",
      assignedByAdmin: m.assignedByAdmin,
    };
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-stone-900">Agenda</h1>
        <p className="text-sm text-stone-400 mt-0.5">The full retreat schedule</p>
      </div>
      <AgendaView agendaItems={agendaItems} myMeetings={myMeetingItems} />
    </div>
  );
}
