import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getRetreat, generateSlots, groupSlotsByDay, nowInRetreatTz, getDayHoursMap, getMeetingSlotCount } from "@/lib/config";
import { getMyAvailability } from "@/lib/availability";
import OverlapGrid from "./OverlapGrid";
import Avatar from "../../../Avatar";

export default async function AttendeeProfile({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ slot?: string }>;
}) {
  const s = await getSession();
  if (!s.userId || !s.retreatId) redirect("/login");
  const { id } = await params;
  const { slot: preselectedSlot } = await searchParams;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) notFound();
  const member = await prisma.retreatAttendance.findUnique({
    where: { userId_retreatId: { userId: id, retreatId: s.retreatId } },
  });
  if (!member) notFound();

  const retreat = (await getRetreat(s.retreatId))!;
  const dayHours = await getDayHoursMap(s.retreatId);
  const slots = generateSlots(retreat, dayHours);
  const groups = groupSlotsByDay(slots);

  const [mine, theirs, myMeetings, theirMeetings, pending] = await Promise.all([
    getMyAvailability(s.userId, s.retreatId),
    getMyAvailability(id, s.retreatId),
    prisma.meetingRequest.findMany({
      where: {
        retreatId: s.retreatId,
        status: { in: ["accepted", "pending"] },
        OR: [{ fromUserId: s.userId }, { toUserId: s.userId }],
      },
      select: { slotStart: true },
    }),
    prisma.meetingRequest.findMany({
      where: {
        retreatId: s.retreatId,
        status: { in: ["accepted", "pending"] },
        OR: [{ fromUserId: id }, { toUserId: id }],
      },
      select: { slotStart: true },
    }),
    prisma.meetingRequest.findMany({
      where: {
        retreatId: s.retreatId,
        status: { in: ["accepted", "pending"] },
        OR: [
          { fromUserId: s.userId, toUserId: id },
          { fromUserId: id, toUserId: s.userId },
        ],
      },
      select: { id: true, slotStart: true, fromUserId: true, status: true, message: true },
    }),
  ]);

  return (
    <div>
      <Link
        href="/attendees"
        className="inline-flex items-center gap-1.5 text-xs text-stone-400 hover:text-accent-600 mb-4 font-medium"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
          <path fillRule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
        </svg>
        All attendees
      </Link>
      <div className="flex items-center gap-3">
        <Avatar name={user.name} userId={user.id} size={52} />
        <div>
          <h1 className="text-2xl font-bold text-stone-900">
            {user.name}
            {user.pronouns && <span className="text-base font-normal text-stone-400 ml-2">{user.pronouns}</span>}
          </h1>
          {user.school && <p className="text-sm text-stone-500 mt-0.5">{user.school}</p>}
        </div>
      </div>

      {(user.bio || user.canHelpWith || user.canBeHelpedWith || user.keyCrux || user.personalLink) && (
        <details className="group mt-4 mb-6 rounded-md border border-stone-200 bg-white shadow-sm overflow-hidden">
          <summary className="cursor-pointer select-none list-none px-4 py-3 flex items-center gap-2 hover:bg-stone-50">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-stone-400 transition-transform group-open:rotate-90 shrink-0">
              <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
            </svg>
            <h2 className="text-sm font-bold text-stone-700">View profile</h2>
          </summary>
          <div className="border-t border-stone-100 divide-y divide-stone-100">
          {user.bio && (
            <div className="p-4">
              <div className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-1">Bio</div>
              <p className="text-sm text-stone-700 whitespace-pre-wrap">{user.bio}</p>
            </div>
          )}
          {user.canHelpWith && (
            <div className="p-4">
              <div className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-1">
                {user.name} can help others with
              </div>
              <p className="text-sm text-stone-700 whitespace-pre-wrap">{user.canHelpWith}</p>
            </div>
          )}
          {user.canBeHelpedWith && (
            <div className="p-4">
              <div className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-1">
                Others can help {user.name} with
              </div>
              <p className="text-sm text-stone-700 whitespace-pre-wrap">{user.canBeHelpedWith}</p>
            </div>
          )}
          {user.keyCrux && (
            <div className="p-4">
              <div className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-1">Key uncertainty / crux</div>
              <p className="text-sm text-stone-700 whitespace-pre-wrap">{user.keyCrux}</p>
            </div>
          )}
          {user.personalLink && (
            <div className="p-4">
              <a
                href={/^https?:\/\//i.test(user.personalLink) ? user.personalLink : `https://${user.personalLink}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-accent-600 font-medium hover:underline break-all"
              >
                {user.personalLink}
              </a>
            </div>
          )}
          </div>
        </details>
      )}

      <div className="mb-6" />
      <OverlapGrid
        toUserId={id}
        toUserName={user.name || "them"}
        groups={Object.fromEntries(
          Object.entries(groups).map(([k, v]) => [
            k,
            v.map((d) => d.toISOString()),
          ]),
        )}
        mine={Array.from(mine)}
        theirs={Array.from(theirs)}
        myBooked={myMeetings.map((m) => m.slotStart.toISOString())}
        theirBooked={theirMeetings.map((m) => m.slotStart.toISOString())}
        betweenUs={pending.map((p) => ({
          requestId: p.id,
          slotStart: p.slotStart.toISOString(),
          direction: p.fromUserId === s.userId ? "outgoing" : "incoming",
          status: p.status as "pending" | "accepted",
          message: p.message,
        }))}
        highlightedSlots={retreat.highlightedSlots ?? []}
        blockedSlots={retreat.blockedSlots ?? []}
        meetingSlotCount={getMeetingSlotCount(retreat)}
        now={nowInRetreatTz(retreat).toISOString()}
        preselectedSlot={preselectedSlot}
      />
    </div>
  );
}
