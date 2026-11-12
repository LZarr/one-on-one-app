import { cache } from "react";
import { prisma } from "./prisma";
import type { Retreat } from "@prisma/client";

export type RetreatConfig = Retreat;

// 1:1s are always 30 minutes long regardless of the retreat's display/browsing
// slot granularity (which controls how finely the schedule and agenda overlay
// subdivide time, not how long a meeting actually runs).
export const MEETING_DURATION_MINUTES = 30;

export function getMeetingSlotCount(retreat: RetreatConfig): number {
  return Math.max(1, Math.round(MEETING_DURATION_MINUTES / retreat.granularityMinutes));
}

// All the base-grid slot starts a meeting beginning at `slotStart` occupies.
export function meetingSlotStarts(slotStart: Date, retreat: RetreatConfig): Date[] {
  const count = getMeetingSlotCount(retreat);
  const stepMs = retreat.granularityMinutes * 60 * 1000;
  return Array.from({ length: count }, (_, i) => new Date(slotStart.getTime() + i * stepMs));
}

export async function getActiveRetreats(): Promise<RetreatConfig[]> {
  return prisma.retreat.findMany({ where: { active: true }, orderBy: { createdAt: "asc" } });
}

// Wrapped in React's per-request cache: the layout and the page it renders
// both call getRetreat with the same id on every request, so without this
// every single page load did the same lookup twice.
export const getRetreat = cache(async (id: string): Promise<RetreatConfig | null> => {
  return prisma.retreat.findUnique({ where: { id } });
});

export type UserRetreatItem = { retreatId: string; name: string; isCurrent: boolean };

export const getUserRetreats = cache(
  async (userId: string, currentRetreatId?: string | null): Promise<UserRetreatItem[]> => {
    const attendances = await prisma.retreatAttendance.findMany({
      where: { userId, retreat: { active: true } },
      orderBy: { createdAt: "desc" },
      include: { retreat: true },
    });
    return attendances.map((a) => ({
      retreatId: a.retreatId,
      name: a.retreat.name,
      isCurrent: a.retreatId === currentRetreatId,
    }));
  }
);

export async function isSuperAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { superAdmin: true } });
  return user?.superAdmin ?? false;
}

export async function isRetreatAdmin(userId: string, retreatId: string): Promise<boolean> {
  const [user, ra] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { superAdmin: true } }),
    prisma.retreatAdmin.findUnique({ where: { userId_retreatId: { userId, retreatId } } }),
  ]);
  return (user?.superAdmin ?? false) || !!ra;
}

export type DayHoursOverride = { dayStart: string; dayEnd: string };
export type DayHoursMap = Record<string, DayHoursOverride>;

export async function getDayHoursMap(retreatId: string): Promise<DayHoursMap> {
  const rows = await prisma.retreatDayHours.findMany({ where: { retreatId } });
  return Object.fromEntries(rows.map((r) => [r.date, { dayStart: r.dayStart, dayEnd: r.dayEnd }]));
}

export function generateSlots(retreat: RetreatConfig, overrides: DayHoursMap = {}): Date[] {
  const startDate = new Date(retreat.slotsStart + ":00Z");
  const endDate = new Date(retreat.slotsEnd + ":00Z");

  const slots: Date[] = [];
  const cursor = new Date(startDate);
  while (cursor < endDate) {
    const dateKey = cursor.toISOString().slice(0, 10);
    const hours = overrides[dateKey] ?? { dayStart: retreat.dayStart, dayEnd: retreat.dayEnd };
    const [dsH, dsM] = hours.dayStart.split(":").map(Number);
    const [deH, deM] = hours.dayEnd.split(":").map(Number);
    const h = cursor.getUTCHours();
    const m = cursor.getUTCMinutes();
    const minutesOfDay = h * 60 + m;
    const dayStartMin = dsH * 60 + dsM;
    const dayEndMin = deH * 60 + deM;
    if (minutesOfDay >= dayStartMin && minutesOfDay < dayEndMin) {
      slots.push(new Date(cursor));
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + retreat.granularityMinutes);
  }
  return slots;
}

export function isRetreatJoinable(retreat: RetreatConfig): boolean {
  if (!retreat.active) return false;
  const end = new Date(retreat.slotsEnd + ":00Z");
  return end > nowInRetreatTz(retreat);
}

export function nowInRetreatTz(retreat: RetreatConfig): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: retreat.timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return new Date(
    `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`
  );
}

export function isValidTimezone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function groupSlotsByDay(slots: Date[]): Record<string, Date[]> {
  const groups: Record<string, Date[]> = {};
  for (const s of slots) {
    const key = s.toISOString().slice(0, 10);
    (groups[key] ||= []).push(s);
  }
  return groups;
}
