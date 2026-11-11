import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Serves a user's profile photo as a real cacheable image response instead of
// inlining the base64 data URI into every page that lists attendees — that was
// bloating list pages by ~25-35KB per person and causing multi-second loads.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await prisma.user.findUnique({ where: { id }, select: { photoUrl: true } });
  const match = user?.photoUrl?.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return new NextResponse(null, { status: 404 });

  const [, mime, base64] = match;
  const buffer = Buffer.from(base64, "base64");
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": mime,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
