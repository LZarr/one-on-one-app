import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

// A bookmarkable direct sign-in link for an attendee who's hidden from the
// public name picker (e.g. an admin-only account) -- same effect as picking
// a name on /attend/[retreatId], just not listed there.
export default async function DirectSignIn({
  params,
}: {
  params: Promise<{ retreatId: string; userId: string }>;
}) {
  const { retreatId, userId } = await params;
  const attendance = await prisma.retreatAttendance.findUnique({
    where: { userId_retreatId: { userId, retreatId } },
    include: { user: { select: { id: true, name: true } } },
  });
  if (!attendance) notFound();

  const session = await getSession();
  session.userId = attendance.user.id;
  session.name = attendance.user.name;
  session.retreatId = retreatId;
  delete session.email;
  await session.save();
  redirect("/schedule");
}
