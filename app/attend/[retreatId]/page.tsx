import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getRetreat } from "@/lib/config";
import { getSession } from "@/lib/session";
import NamePicker from "./NamePicker";
import BrandMark from "../../BrandMark";

async function selectAttendee(retreatId: string, formData: FormData) {
  "use server";
  const userId = String(formData.get("userId") || "");
  const attendance = await prisma.retreatAttendance.findUnique({
    where: { userId_retreatId: { userId, retreatId } },
    include: { user: { select: { id: true, name: true } } },
  });
  if (!attendance) redirect(`/attend/${retreatId}`);

  const session = await getSession();
  session.userId = attendance.user.id;
  session.name = attendance.user.name;
  session.retreatId = retreatId;
  delete session.email;
  await session.save();
  redirect("/schedule");
}

export default async function AttendPage({
  params,
}: {
  params: Promise<{ retreatId: string }>;
}) {
  const { retreatId } = await params;
  const retreat = await getRetreat(retreatId);
  if (!retreat) notFound();

  const attendances = await prisma.retreatAttendance.findMany({
    where: { retreatId },
    include: { user: { select: { id: true, name: true, superAdmin: true } } },
    orderBy: { user: { name: "asc" } },
  });
  const people = attendances
    .filter((a) => !a.user.superAdmin)
    .map((a) => ({ id: a.user.id, name: a.user.name }));
  const action = selectAttendee.bind(null, retreatId);

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="mx-auto mb-4 flex justify-center">
            <BrandMark size="lg" />
          </div>
          <h1 className="text-2xl font-bold text-stone-900">{retreat.name}</h1>
        </div>
        <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-6">
          <NamePicker people={people} action={action} />
        </div>
      </div>
    </div>
  );
}
