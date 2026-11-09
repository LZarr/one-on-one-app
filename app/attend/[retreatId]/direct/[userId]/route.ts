import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

// A bookmarkable direct sign-in link for an attendee who's hidden from the
// public name picker (e.g. an admin-only account) -- same effect as picking
// a name on /attend/[retreatId], just not listed there. Cookies can only be
// set from a Route Handler (not a plain page), hence this lives as a route.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ retreatId: string; userId: string }> },
) {
  const { retreatId, userId } = await params;
  const attendance = await prisma.retreatAttendance.findUnique({
    where: { userId_retreatId: { userId, retreatId } },
    include: { user: { select: { id: true, name: true } } },
  });
  if (!attendance) return new NextResponse("Not found", { status: 404 });

  const session = await getSession();
  session.userId = attendance.user.id;
  session.name = attendance.user.name;
  session.retreatId = retreatId;
  delete session.email;
  await session.save();

  return NextResponse.redirect(new URL("/schedule", req.url));
}
