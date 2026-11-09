"use client";
import { useMemo, useState } from "react";
import { formatSlotDay, formatSlotTime } from "@/lib/format";

type AgendaItem = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  title: string;
  subtitle: string | null;
};

type MyMeeting = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  otherName: string;
  assignedByAdmin: boolean;
};

type Row =
  | { kind: "agenda"; startTime: string; endTime: string; title: string; subtitle: string | null; key: string }
  | { kind: "mine"; startTime: string; endTime: string; otherName: string; assignedByAdmin: boolean; key: string };

function toDate(date: string, time: string) {
  return new Date(`${date}T${time}:00Z`);
}

export default function AgendaView({
  agendaItems,
  myMeetings,
}: {
  agendaItems: AgendaItem[];
  myMeetings: MyMeeting[];
}) {
  const [showMine, setShowMine] = useState(false);

  const days = useMemo(() => {
    const byDate: Record<string, Row[]> = {};
    for (const item of agendaItems) {
      (byDate[item.date] ||= []).push({
        kind: "agenda",
        startTime: item.startTime,
        endTime: item.endTime,
        title: item.title,
        subtitle: item.subtitle,
        key: item.id,
      });
    }
    if (showMine) {
      for (const m of myMeetings) {
        (byDate[m.date] ||= []).push({
          kind: "mine",
          startTime: m.startTime,
          endTime: m.endTime,
          otherName: m.otherName,
          assignedByAdmin: m.assignedByAdmin,
          key: m.id,
        });
      }
    }
    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, rows]) => ({
        date,
        rows: rows.sort((a, b) => a.startTime.localeCompare(b.startTime)),
      }));
  }, [agendaItems, myMeetings, showMine]);

  if (agendaItems.length === 0) {
    return (
      <div className="text-sm text-stone-500 bg-white rounded-md border border-stone-200 shadow-sm p-6 text-center">
        No agenda has been posted yet.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <label className="flex items-center gap-2.5 text-sm font-medium text-stone-700 bg-white border border-stone-200 rounded-md px-4 py-3 shadow-sm w-fit cursor-pointer">
        <input
          type="checkbox"
          checked={showMine}
          onChange={(e) => setShowMine(e.target.checked)}
          className="rounded border-stone-300"
        />
        Show my 1:1s on the schedule
      </label>

      {days.map(({ date, rows }) => (
        <div key={date}>
          <h2 className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-2.5">
            {formatSlotDay(toDate(date, "00:00"))}
          </h2>
          <div className="space-y-1.5">
            {rows.map((r) =>
              r.kind === "mine" ? (
                <div
                  key={r.key}
                  className="rounded-md border border-emerald-200 bg-emerald-50 px-3.5 py-2.5"
                >
                  <div className="text-xs text-emerald-700 font-semibold">
                    {formatSlotTime(toDate(date, r.startTime))} – {formatSlotTime(toDate(date, r.endTime))}
                  </div>
                  <div className="text-sm font-medium text-emerald-900">
                    1:1 with {r.otherName}
                    {r.assignedByAdmin && <span className="font-normal text-emerald-700/70"> (assigned)</span>}
                  </div>
                </div>
              ) : (
                <div
                  key={r.key}
                  className="rounded-md border border-stone-200 bg-white px-3.5 py-2.5"
                >
                  <div className="text-xs text-stone-500 font-semibold">
                    {formatSlotTime(toDate(date, r.startTime))} – {formatSlotTime(toDate(date, r.endTime))}
                  </div>
                  <div className="text-sm font-medium text-stone-900">{r.title}</div>
                  {r.subtitle && <div className="text-xs text-stone-500 mt-0.5">{r.subtitle}</div>}
                </div>
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
