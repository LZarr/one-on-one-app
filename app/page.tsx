import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export default async function Home() {
  const s = await getSession();
  if (!s.userId) {
    // The mwea.vercel.app vanity domain should drop straight into this retreat's
    // own sign-in picker instead of the generic "enter your email" login.
    const host = (await headers()).get("host") || "";
    if (host.includes("mwea")) redirect("/attend/mwea-2026");
    redirect("/login");
  }

  if (s.retreatId) redirect("/schedule");

  const attendance = await prisma.retreatAttendance.findFirst({
    where: { userId: s.userId, retreat: { active: true } },
    orderBy: { createdAt: "desc" },
  });
  if (attendance) {
    s.retreatId = attendance.retreatId;
    await s.save();
    redirect("/schedule");
  }

  redirect("/no-retreat");
}
