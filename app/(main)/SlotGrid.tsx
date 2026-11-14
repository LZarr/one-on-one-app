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
  // When set, every rendered row is assumed to be exactly this tall in px
  // (true for the schedule page, where even a merged multi-slot agenda
  // block keeps the same per-base-slot row height) — lets the Now line sit
  // at its actual proportional position instead of snapping to whichever
  // row it falls in, which matters once a row can represent several merged
  // base slots spanning hours rather than just one.
  rowHeightPx?: number;
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
  rowHeightPx,
  gapPx,
}: {
  day: string;
  slots: string[];
  nowMs: number;
  highlighted: Set<string>;
  renderSlot: SlotGridProps["renderSlot"];
  filterSlot?: SlotGridProps["filterSlot"];
  emptyDayMessage?: string;
  rowHeightPx?: number;
  gapPx: number;
}) {
  const safeSlots = slots ?? [];
  const filtered = filterSlot ? safeSlots.filter(filterSlot) : safeSlots;

  if (filtered.length === 0) {
    return emptyDayMessage
      ? <div className="text-xs text-stone-300 py-2">{emptyDayMessage}</div>
      : null;
  }

  if (rowHeightPx) {
    return (
      <ProportionalDayColumn
        filtered={filtered}
        nowMs={nowMs}
        highlighted={highlighted}
        renderSlot={renderSlot}
        rowHeightPx={rowHeightPx}
        gapPx={gapPx}
      />
    );
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

// Same row-stacking as the plain DayColumn, but the Now line is a single
// absolutely-positioned overlay placed at its true fractional position
// within whichever row it falls in, rather than always snapping to that
// row's bottom edge — the only way to keep it accurate once a row can be a
// merged block spanning many base slots (hours, in the agenda overlay).
function ProportionalDayColumn({
  filtered,
  nowMs,
  highlighted,
  renderSlot,
  rowHeightPx,
  gapPx,
}: {
  filtered: string[];
  nowMs: number;
  highlighted: Set<string>;
  renderSlot: SlotGridProps["renderSlot"];
  rowHeightPx: number;
  gapPx: number;
}) {
  // Per-base-slot duration, inferred from the grid itself so this works at
  // any retreat's granularity without needing it passed in separately.
  const stepMs =
    filtered.length > 1
      ? new Date(filtered[1]).getTime() - new Date(filtered[0]).getTime()
      : 15 * 60 * 1000;
  const pxPerMs = rowHeightPx / stepMs;

  const elements: ReactNode[] = [];
  const rendered: { ms: number }[] = [];
  for (const iso of filtered) {
    const slotMs = new Date(iso).getTime();
    const node = renderSlot(iso, { isHighlighted: highlighted.has(iso), isPast: slotMs < nowMs });
    if (node !== null) rendered.push({ ms: slotMs });
    elements.push(node);
  }

  const dayStartMs = new Date(filtered[0]).getTime();
  const dayEndMs = new Date(filtered[filtered.length - 1]).getTime() + stepMs;
  const isToday = filtered[0].slice(0, 10) === new Date(nowMs).toISOString().slice(0, 10);

  // Before the day's first slot (and only when this tab's day is actually
  // today — a future day's tab shouldn't show "Now" sitting above it): a
  // flow element above everything, same as the non-proportional column —
  // there's no row to be "proportional within" yet.
  if (rendered.length > 0 && isToday && nowMs < dayStartMs) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: gapPx }}>
        <NowBar />
        {elements}
      </div>
    );
  }

  let top: number | null = null;
  if (rendered.length > 0 && nowMs >= dayStartMs && nowMs < dayEndMs) {
    let cursor = 0;
    for (let i = 0; i < rendered.length; i++) {
      const start = rendered[i].ms;
      const end = i + 1 < rendered.length ? rendered[i + 1].ms : dayEndMs;
      if (nowMs >= start && nowMs < end) {
        top = cursor + (nowMs - start) * pxPerMs;
        break;
      }
      cursor += (end - start) * pxPerMs + gapPx;
    }
  }

  return (
    <div className="relative">
      <div style={{ display: "flex", flexDirection: "column", gap: gapPx }}>{elements}</div>
      {top !== null && (
        <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top }}>
          <NowBar />
        </div>
      )}
    </div>
  );
}

export default function SlotGrid({
  groups,
  now,
  highlightedSlots = [],
  renderSlot,
  filterSlot,
  emptyDayMessage,
  tabs = false,
  rowHeightPx,
}: SlotGridProps) {
  const nowMs = new Date(now).getTime();
  const highlighted = new Set(highlightedSlots);
  const days = Object.keys(groups).sort();

  const firstNonPastDay =
    days.find((d) => {
      const slots = filterSlot ? groups[d].filter(filterSlot) : groups[d];
      return slots.some((iso) => new Date(iso).getTime() >= nowMs);
    }) ?? days[0];

  // Matches whichever space-y-* utility actually wraps the column below, so
  // the proportional Now line's math agrees with the real rendered gap.
  const gapPx = tabs ? 2 : 6;

  const columnProps = (day: string) => ({
    day,
    slots: groups[day],
    nowMs,
    highlighted,
    renderSlot,
    filterSlot,
    emptyDayMessage,
    rowHeightPx,
    gapPx,
  });

  const [selectedDay, setSelectedDay] = useState(firstNonPastDay);
  const activeDay = days.includes(selectedDay) ? selectedDay : firstNonPastDay;

  if (tabs) {
    return (
      <div>
        <div className="flex gap-2 mb-2.5">
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
        <div className="space-y-0.5">
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
