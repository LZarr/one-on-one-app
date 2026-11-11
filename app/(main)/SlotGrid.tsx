"use client";
import { useState, type ReactNode } from "react";
import { formatSlotTime, formatSlotDay } from "@/lib/format";

type SlotGridProps = {
  groups: Record<string, string[]>;
  now: string;
  highlightedSlots?: string[];
  renderSlot: (iso: string, opts: { isHighlighted: boolean; isPast: boolean }) => ReactNode;
  filterSlot?: (iso: string) => boolean;
  emptyDayMessage?: string;
  /** Render a single day at a time, switchable via tab buttons, instead of side-by-side columns / accordion. */
  tabs?: boolean;
};

function NowBar() {
  return (
    <div className="flex items-center gap-2 -my-0.5 z-20 relative">
      <span className="text-[10px] font-bold text-red-500 shrink-0">Now</span>
      <div className="flex-1 h-0.5 bg-red-500 rounded-full" />
    </div>
  );
}

function DayColumn({
  day,
  slots,
  nowMs,
  highlighted,
  renderSlot,
  filterSlot,
  emptyDayMessage,
}: {
  day: string;
  slots: string[];
  nowMs: number;
  highlighted: Set<string>;
  renderSlot: SlotGridProps["renderSlot"];
  filterSlot?: SlotGridProps["filterSlot"];
  emptyDayMessage?: string;
}) {
  const safeSlots = slots ?? [];
  const filtered = filterSlot ? safeSlots.filter(filterSlot) : safeSlots;

  if (filtered.length === 0) {
    return emptyDayMessage
      ? <div className="text-xs text-stone-300 py-2">{emptyDayMessage}</div>
      : null;
  }

  let nowInserted = false;
  const elements: ReactNode[] = [];

  for (let i = 0; i < filtered.length; i++) {
    const iso = filtered[i];
    const slotMs = new Date(iso).getTime();
    const nextMs = i + 1 < filtered.length ? new Date(filtered[i + 1]).getTime() : null;

    if (!nowInserted && slotMs <= nowMs && (nextMs === null || nextMs > nowMs)) {
      elements.push(
        renderSlot(iso, { isHighlighted: highlighted.has(iso), isPast: slotMs < nowMs }),
      );
      if (nextMs !== null) {
        elements.push(<NowBar key="now-bar" />);
      }
      nowInserted = true;
    } else {
      elements.push(
        renderSlot(iso, { isHighlighted: highlighted.has(iso), isPast: slotMs < nowMs }),
      );
    }
  }

  // If now is before the first slot of the day but on this day, show bar at the top
  if (!nowInserted && filtered.length > 0) {
    const firstMs = new Date(filtered[0]).getTime();
    const dayStr = filtered[0].slice(0, 10);
    const nowDayStr = new Date(nowMs).toISOString().slice(0, 10);
    if (nowDayStr === dayStr && nowMs < firstMs) {
      elements.unshift(<NowBar key="now-bar" />);
    }
  }

  return <>{elements}</>;
}

export default function SlotGrid({
  groups,
  now,
  highlightedSlots = [],
  renderSlot,
  filterSlot,
  emptyDayMessage,
  tabs = false,
}: SlotGridProps) {
  const nowMs = new Date(now).getTime();
  const highlighted = new Set(highlightedSlots);
  const days = Object.keys(groups).sort();

  const firstNonPastDay =
    days.find((d) => {
      const slots = filterSlot ? groups[d].filter(filterSlot) : groups[d];
      return slots.some((iso) => new Date(iso).getTime() >= nowMs);
    }) ?? days[0];

  const columnProps = (day: string) => ({
    day,
    slots: groups[day],
    nowMs,
    highlighted,
    renderSlot,
    filterSlot,
    emptyDayMessage,
  });

  const [selectedDay, setSelectedDay] = useState(firstNonPastDay);
  const activeDay = days.includes(selectedDay) ? selectedDay : firstNonPastDay;

  if (tabs) {
    return (
      <div>
        <div className="flex gap-2 mb-5">
          {days.map((day) => {
            const isActive = day === activeDay;
            return (
              <button
                key={day}
                onClick={() => setSelectedDay(day)}
                className={`flex-1 py-2.5 rounded-md text-sm font-semibold transition-colors ${
                  isActive
                    ? "bg-teal-800 text-white"
                    : "bg-white border border-stone-300 text-stone-700 hover:bg-stone-50"
                }`}
              >
                {formatSlotDay(new Date(day))}
              </button>
            );
          })}
        </div>
        <div className="space-y-1">
          <DayColumn {...columnProps(activeDay)} />
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Desktop: columns */}
      <div
        className="hidden lg:grid gap-5"
        style={{ gridTemplateColumns: `repeat(${days.length}, 1fr)` }}
      >
        {days.map((day) => (
          <div key={day}>
            <h3 className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-3 sticky top-0 bg-stone-50 py-1.5 z-10">
              {formatSlotDay(new Date(day))}
            </h3>
            <div className="space-y-1.5">
              <DayColumn {...columnProps(day)} />
            </div>
          </div>
        ))}
      </div>

      {/* Mobile: stacked days, today open by default, others collapsed */}
      <div className="lg:hidden space-y-2.5">
        {days.map((day) => (
          <details key={day} open={day === firstNonPastDay} className="group">
            <summary className="cursor-pointer select-none list-none flex items-center gap-2 py-2">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-stone-400 transition-transform group-open:rotate-90 shrink-0">
                <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
              </svg>
              <h3 className="text-xs font-bold text-stone-500 uppercase tracking-wider">
                {formatSlotDay(new Date(day))}
              </h3>
            </summary>
            <div className="space-y-1.5 pl-5 pb-1">
              <DayColumn {...columnProps(day)} />
            </div>
          </details>
        ))}
      </div>
    </>
  );
}
