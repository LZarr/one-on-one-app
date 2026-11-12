"use client";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { formatSlotTime, formatSlotDay } from "@/lib/format";
import SlotGrid from "../SlotGrid";

type SlotMeeting = {
  requestId: string;
  otherPersonName: string;
  otherPersonId: string;
  type: "confirmed" | "incoming" | "outgoing";
  assignedByAdmin: boolean;
  message: string | null;
};

type AgendaItem = {
  date: string;
  startTime: string;
  endTime: string;
  title: string;
  subtitle: string | null;
};

type Props = {
  groups: Record<string, string[]>;
  availableSlots: string[];
  slotMeetings: Record<string, SlotMeeting>;
  highlightedSlots: string[];
  blockedSlots: string[];
  agendaItems: AgendaItem[];
  now: string;
};

type SlotState =
  | { kind: "confirmed"; meeting: SlotMeeting; isPast: boolean }
  | { kind: "incoming"; meeting: SlotMeeting; isPast: boolean }
  | { kind: "outgoing"; meeting: SlotMeeting; isPast: boolean }
  | { kind: "available" }
  | { kind: "blocked" }
  | { kind: "past" };

type AgendaCategory = "meal" | "oneOnOne" | "talk" | "evening";

function categorizeAgendaItem(title: string): AgendaCategory {
  const t = title.toLowerCase();
  if (/breakfast|lunch|dinner/.test(t)) return "meal";
  if (/1:1/.test(t)) return "oneOnOne";
  if (/reflection session|closing session|saturday night announcement|social time/.test(t)) return "evening";
  return "talk";
}

const AGENDA_CATEGORY_STYLES: Record<AgendaCategory, { bg: string; text: string; dot: string; label: string }> = {
  meal: { bg: "bg-[#E6F4F3]", text: "text-[#3c6b67]", dot: "bg-[#E6F4F3]", label: "dinner / meal" },
  oneOnOne: { bg: "bg-[#BCE0E3]", text: "text-[#1f5457]", dot: "bg-[#BCE0E3]", label: "1:1 prep & slots" },
  talk: { bg: "bg-[#A8CED1]", text: "text-[#1f4345]", dot: "bg-[#A8CED1]", label: "talks & day sessions" },
  evening: { bg: "bg-[#7BAEB0]", text: "text-[#1f4345]", dot: "bg-[#7BAEB0]", label: "evening sessions & social time" },
};

// Keep a long talk's row to one line: fall back to "Talk: <speaker>" when the full
// title + speaker wouldn't fit, rather than letting the block grow taller to wrap.
const FULL_LABEL_MAX_CHARS = 42;

function agendaItemLabel(title: string, subtitle: string | null): string {
  const full = subtitle ? `${title} (${subtitle})` : title;
  if (full.length > FULL_LABEL_MAX_CHARS && subtitle && /^talk:/i.test(title)) {
    return `Talk: ${subtitle}`;
  }
  return full;
}

export default function CalendarView({
  groups,
  availableSlots,
  slotMeetings: initialSlotMeetings,
  highlightedSlots,
  blockedSlots,
  agendaItems,
  now,
}: Props) {
  const router = useRouter();
  const [available, setAvailable] = useState<Set<string>>(
    new Set(availableSlots),
  );
  const [meetings, setMeetings] =
    useState<Record<string, SlotMeeting>>(initialSlotMeetings);
  const nowMs = new Date(now).getTime();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState<string | null>(null);
  const [showPendingModal, setShowPendingModal] = useState(false);
  const [showAgenda, setShowAgenda] = useState(false);
  const adminBlocked = new Set(blockedSlots);

  const agendaRanges = useMemo(
    () =>
      agendaItems.map((a, i) => ({
        key: `${a.date}T${a.startTime}-${a.title}-${i}`,
        startMs: new Date(`${a.date}T${a.startTime}:00Z`).getTime(),
        endMs: new Date(`${a.date}T${a.endTime}:00Z`).getTime(),
        label: agendaItemLabel(a.title, a.subtitle),
        category: categorizeAgendaItem(a.title),
      })),
    [agendaItems],
  );

  // Precompute, per slot, which agenda block covers it and whether this slot is the
  // first/last in that block's contiguous run — so the overlay can render one merged
  // colored block per event instead of repeating a tint on every slot it spans.
  const agendaRunInfo = useMemo(() => {
    const info: Record<
      string,
      { key: string; label: string; category: AgendaCategory; isStart: boolean; isEnd: boolean }
    > = {};
    for (const isos of Object.values(groups)) {
      const matchKeys: (string | null)[] = isos.map((iso) => {
        const slotMs = new Date(iso).getTime();
        const matches = agendaRanges.filter((a) => slotMs >= a.startMs && slotMs < a.endMs);
        if (matches.length === 0) return null;
        info[iso] = {
          key: matches.map((m) => m.key).join("+"),
          label: matches.map((m) => m.label).join(" · "),
          category: matches[0].category,
          isStart: false,
          isEnd: false,
        };
        return info[iso].key;
      });
      for (let i = 0; i < isos.length; i++) {
        const key = matchKeys[i];
        if (key === null) continue;
        info[isos[i]].isStart = key !== matchKeys[i - 1];
        info[isos[i]].isEnd = key !== matchKeys[i + 1];
      }
    }
    return info;
  }, [groups, agendaRanges]);

  // Collects every slot (by iso) belonging to the same contiguous agenda run as
  // `startIso`, so a run can be rendered as one merged block instead of N separate
  // rows glued together with CSS.
  function getAgendaRunIsos(startIso: string): string[] {
    const dateKey = startIso.slice(0, 10);
    const dayIsos = groups[dateKey] ?? [];
    const idx = dayIsos.indexOf(startIso);
    if (idx === -1) return [startIso];
    const key = agendaRunInfo[startIso]?.key;
    const run = [startIso];
    for (let i = idx + 1; i < dayIsos.length; i++) {
      const info = agendaRunInfo[dayIsos[i]];
      if (!info || info.isStart || info.key !== key) break;
      run.push(dayIsos[i]);
    }
    return run;
  }

  const usedAgendaCategories = useMemo(
    () => Array.from(new Set(agendaRanges.map((a) => a.category))),
    [agendaRanges],
  );

  const incomingRequests = Object.entries(meetings)
    .filter(
      ([iso, m]) => m.type === "incoming" && new Date(iso).getTime() >= nowMs,
    )
    .sort(([a], [b]) => a.localeCompare(b));

  const modalOpen = showPendingModal && incomingRequests.length > 0;

  const bufferMs = 30 * 60 * 1000;

  function classify(iso: string): SlotState {
    const slotMs = new Date(iso).getTime();
    const isPast = slotMs < nowMs;
    const tooSoon = slotMs < nowMs + bufferMs;
    const m = meetings[iso];
    if (m) {
      if (m.type === "confirmed")
        return { kind: "confirmed", meeting: m, isPast };
      if (m.type === "incoming")
        return { kind: "incoming", meeting: m, isPast };
      return { kind: "outgoing", meeting: m, isPast };
    }
    if (isPast) return { kind: "past" };
    if (tooSoon) return { kind: "blocked" };
    if (adminBlocked.has(iso)) return { kind: "blocked" };
    if (available.has(iso)) return { kind: "available" };
    return { kind: "blocked" };
  }

  async function toggleBlock(iso: string) {
    const isAvailable = available.has(iso);
    const next = new Set(available);
    if (isAvailable) next.delete(iso);
    else next.add(iso);
    setAvailable(next);
    startTransition(async () => {
      await fetch("/api/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotStart: iso, available: !isAvailable }),
      });
    });
  }

  async function act(
    id: string,
    action: "accept" | "decline" | "cancel",
    iso: string,
  ) {
    setBusy(id);
    const res = await fetch(`/api/requests/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error || "Failed");
      return;
    }
    const updated = { ...meetings };
    if (action === "accept") {
      updated[iso] = { ...updated[iso], type: "confirmed" };
    } else if (action === "decline" || action === "cancel") {
      delete updated[iso];
    }
    setMeetings(updated);
    startTransition(() => router.refresh());
  }

  function renderSlot(iso: string, { isHighlighted }: { isHighlighted: boolean; isPast: boolean }) {
    const state = classify(iso);
    const time = formatSlotTime(new Date(iso));

    const base =
      "flex items-center gap-2 pl-3 pr-0 py-0 rounded-md border text-sm overflow-hidden min-h-[36px]";
    const flatBase = "flex items-center gap-1 px-1 py-1 text-sm min-h-[26px]";
    const hlCls = isHighlighted
      ? "ring-2 ring-amber-400/60 border-amber-300 bg-amber-50/40"
      : "";
    const flatHlCls = isHighlighted ? "ring-2 ring-amber-400/40 rounded-md bg-amber-50/40" : "";

    const agenda = showAgenda ? agendaRunInfo[iso] : undefined;
    // No live meeting on this slot: the whole row can be tinted and merged into one
    // continuous block with its neighbors in the same agenda run.
    const canTintRow = state.kind === "past" || state.kind === "available" || state.kind === "blocked";
    const tint = canTintRow && agenda ? AGENDA_CATEGORY_STYLES[agenda.category] : null;

    // Continuation slot of an already-rendered merged block: nothing to draw here.
    if (tint && !agenda!.isStart) return null;

    function tintedBlock() {
      const runIsos = getAgendaRunIsos(iso);
      return (
        <div key={iso} className={`${tint!.bg} rounded-md overflow-hidden`}>
          {runIsos.map((runIso, i) => (
            <div key={runIso} className="flex items-center gap-1 px-1 py-1 text-sm min-h-[26px]">
              <span className={`text-xs w-16 shrink-0 font-medium ${tint!.text}`}>
                {formatSlotTime(new Date(runIso))}
              </span>
              {i === 0 && (
                <span className={`text-sm font-medium min-w-0 flex-1 truncate ${tint!.text}`}>
                  {agenda!.label}
                </span>
              )}
            </div>
          ))}
        </div>
      );
    }

    // A live meeting (confirmed/incoming/outgoing) keeps its own semantic color; it
    // only gets a small caption for context, shown once at the start of the block.
    const caption = !canTintRow && agenda?.isStart ? agenda.label : null;

    const wrap = (row: ReactNode) => (
      <div key={iso}>
        {row}
        {caption && (
          <div className="text-[11px] text-stone-400 italic pl-3 pt-0.5 pb-1.5 truncate">
            {caption}
          </div>
        )}
      </div>
    );

    if (state.kind === "past") {
      if (tint) return tintedBlock();
      return wrap(
        <div className={`${flatBase} ${flatHlCls}`}>
          <span className="text-xs text-stone-300 w-16 shrink-0 font-medium">{time}</span>
        </div>,
      );
    }

    if ((state.kind === "incoming" || state.kind === "outgoing") && state.isPast) {
      return wrap(
        <div className={`${base} border-stone-200 bg-stone-50/60 opacity-90 ${hlCls}`}>
          <span className="text-xs text-stone-400 w-16 shrink-0 font-medium">{time}</span>
          <div className="w-2 h-2 rounded-full bg-stone-300 shrink-0" />
          <span className="text-sm text-stone-500 truncate flex-1">{state.meeting.otherPersonName}</span>
          <span className="text-[11px] text-stone-400 shrink-0 italic pr-3">missed</span>
        </div>,
      );
    }

    if (state.kind === "confirmed") {
      const pastCls = state.isPast ? "opacity-50" : "";
      const assigned = state.meeting.assignedByAdmin;
      const colorCls = assigned ? "border-stone-200 bg-white" : "border-emerald-200 bg-emerald-50";
      const dotCls = assigned ? "bg-stone-300" : "bg-emerald-500";
      const timeCls = assigned ? "text-stone-600" : "text-emerald-700";
      const nameCls = assigned ? "text-stone-700" : "text-emerald-900";
      const borderCls = assigned ? "border-stone-200" : "border-emerald-200";
      return wrap(
        <div className={`${base} ${colorCls} ${hlCls} ${pastCls}`}>
          <span className={`text-xs ${timeCls} w-16 shrink-0 font-semibold`}>{time}</span>
          <div className={`w-2 h-2 rounded-full ${dotCls} shrink-0`} />
          <span className={`text-sm font-medium ${nameCls} truncate flex-1`}>
            {state.meeting.otherPersonName}
            {assigned && <span className="font-normal text-stone-400"> (assigned)</span>}
          </span>
          {!state.isPast && (
            <div className={`flex self-stretch shrink-0 w-[72px] border-l ${borderCls}`}>
              <button
                onClick={() => {
                  if (confirmingCancel === state.meeting.requestId) {
                    setConfirmingCancel(null);
                    act(state.meeting.requestId, "cancel", iso);
                  } else {
                    setConfirmingCancel(state.meeting.requestId);
                  }
                }}
                onBlur={() => {
                  if (confirmingCancel === state.meeting.requestId)
                    setConfirmingCancel(null);
                }}
                disabled={busy === state.meeting.requestId}
                className={`self-stretch flex-1 text-xs font-medium ${
                  confirmingCancel === state.meeting.requestId
                    ? "text-stone-800 bg-stone-100 font-semibold"
                    : "text-stone-600 hover:bg-stone-50 hover:text-stone-800"
                }`}
              >
                {confirmingCancel === state.meeting.requestId ? "Sure?" : "Cancel"}
              </button>
            </div>
          )}
        </div>,
      );
    }

    if (state.kind === "incoming") {
      return wrap(
        <div className={`${base} border-amber-200 bg-amber-50 ${hlCls}`}>
          <span className="text-xs text-amber-700 w-16 shrink-0 font-semibold">{time}</span>
          <div className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
          <span className="text-sm font-medium text-amber-900 truncate flex-1">
            {state.meeting.otherPersonName}
            {state.meeting.message && (
              <span title={state.meeting.message}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-3.5 h-3.5 inline-block ml-1.5 -mt-0.5 text-amber-500"
                >
                  <path fillRule="evenodd" d="M2 4.25A2.25 2.25 0 0 1 4.25 2h11.5A2.25 2.25 0 0 1 18 4.25v8.5A2.25 2.25 0 0 1 15.75 15H9.06l-2.573 2.573A.75.75 0 0 1 5.25 17v-2H4.25A2.25 2.25 0 0 1 2 12.75v-8.5Z" clipRule="evenodd" />
                </svg>
              </span>
            )}
          </span>
          <div className="flex self-stretch shrink-0 w-[112px] border-l border-amber-200">
            <button
              onClick={() => act(state.meeting.requestId, "accept", iso)}
              disabled={busy === state.meeting.requestId}
              className="self-stretch flex-1 text-emerald-600 text-xs font-semibold hover:bg-emerald-50 disabled:opacity-50"
            >
              Accept
            </button>
            <button
              onClick={() => act(state.meeting.requestId, "decline", iso)}
              disabled={busy === state.meeting.requestId}
              className="self-stretch flex-1 border-l border-amber-200 text-stone-400 text-xs font-medium hover:bg-stone-50 hover:text-stone-600 disabled:opacity-50"
            >
              Decline
            </button>
          </div>
        </div>,
      );
    }

    if (state.kind === "outgoing") {
      return wrap(
        <div className={`${base} border-stone-200 bg-white ${hlCls}`}>
          <span className="text-xs text-stone-500 w-16 shrink-0 font-medium">{time}</span>
          <div className="w-2 h-2 rounded-full bg-stone-300 shrink-0" />
          <span className="text-sm font-medium text-stone-600 truncate flex-1">{state.meeting.otherPersonName}</span>
          <span className="text-[11px] text-stone-400 shrink-0 italic">waiting</span>
          <div className="flex self-stretch shrink-0 w-[72px] border-l border-stone-200">
            <button
              onClick={() => {
                if (confirmingCancel === state.meeting.requestId) {
                  setConfirmingCancel(null);
                  act(state.meeting.requestId, "cancel", iso);
                } else {
                  setConfirmingCancel(state.meeting.requestId);
                }
              }}
              onBlur={() => {
                if (confirmingCancel === state.meeting.requestId)
                  setConfirmingCancel(null);
              }}
              disabled={busy === state.meeting.requestId}
              className={`self-stretch flex-1 text-xs font-medium ${
                confirmingCancel === state.meeting.requestId
                  ? "text-stone-700 bg-stone-100 font-semibold"
                  : "text-stone-400 hover:bg-stone-50 hover:text-stone-600"
              }`}
            >
              {confirmingCancel === state.meeting.requestId ? "Sure?" : "Cancel"}
            </button>
          </div>
        </div>,
      );
    }

    if (state.kind === "available") {
      if (showAgenda) {
        if (tint) return tintedBlock();
        return wrap(
          <div className={`${flatBase} ${flatHlCls}`}>
            <span className="text-xs text-stone-300 w-16 shrink-0 font-medium">{time}</span>
          </div>,
        );
      }
      return wrap(
        <div className={`${flatBase} rounded-md hover:bg-stone-50 ${flatHlCls}`}>
          <span className="text-xs text-stone-500 w-16 shrink-0 font-medium">{time}</span>
          <button
            onClick={() => router.push(`/attendees?slot=${iso}`)}
            className="text-sm text-stone-500 truncate flex-1 text-left hover:text-accent-600 cursor-pointer font-medium"
          >
            Available
          </button>
          <button
            onClick={() => toggleBlock(iso)}
            className="text-stone-300 text-xs font-medium hover:text-stone-600 shrink-0 pr-2"
          >
            Block
          </button>
        </div>,
      );
    }

    const isAdminBlocked = adminBlocked.has(iso);
    if (showAgenda) {
      if (tint) return tintedBlock();
      return wrap(
        <div className={`${flatBase} ${flatHlCls}`}>
          <span className="text-xs text-stone-300 w-16 shrink-0 font-medium">{time}</span>
        </div>,
      );
    }
    return wrap(
      <div className={`${flatBase} rounded-md hover:bg-stone-50 ${flatHlCls}`}>
        <span className="text-xs text-stone-300 w-16 shrink-0 font-medium">{time}</span>
        <span className="text-sm text-stone-300 flex-1">{isAdminBlocked ? "Blocked by admin" : "Blocked"}</span>
        {!isAdminBlocked && (
          <button
            onClick={() => toggleBlock(iso)}
            className="text-stone-300 text-xs font-medium hover:text-stone-600 shrink-0 pr-2"
          >
            Unblock
          </button>
        )}
      </div>,
    );
  }

  return (
    <div>
      {incomingRequests.length > 0 && (
        <button
          onClick={() => setShowPendingModal(true)}
          className="w-full mb-4 bg-red-50 border border-red-300 rounded-md px-4 py-3 flex items-center justify-between gap-3 hover:bg-red-100 group"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="inline-flex rounded-full h-2.5 w-2.5 bg-red-500 shrink-0"></span>
            <span className="text-sm font-semibold text-red-800 truncate">
              You have {incomingRequests.length} pending 1:1 {incomingRequests.length === 1 ? "request" : "requests"}
            </span>
          </div>
          <span className="text-xs text-red-700 font-semibold shrink-0">
            Review &rarr;
          </span>
        </button>
      )}

      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Your Schedule</h1>
          <p className="text-sm text-stone-400 mt-0.5">Manage your availability and meetings</p>
        </div>
        {agendaItems.length > 0 && (
          <label className="flex items-center gap-2 text-sm font-medium text-stone-600 border border-stone-200 rounded-md px-3 py-2 cursor-pointer hover:bg-stone-50 shrink-0">
            <input
              type="checkbox"
              checked={showAgenda}
              onChange={(e) => setShowAgenda(e.target.checked)}
              className="rounded border-stone-300"
            />
            Show retreat schedule
          </label>
        )}
      </div>

      <div className="text-xs text-stone-400 flex flex-wrap gap-4 mb-5 pb-4 border-b border-stone-200/60">
        <span className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 bg-emerald-500 rounded" />
          confirmed
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 bg-amber-500 rounded" />
          incoming request
        </span>
        {highlightedSlots.length > 0 && (
          <span className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 ring-2 ring-amber-400 bg-amber-50 rounded" />
            designated 1:1 time
          </span>
        )}
        {showAgenda &&
          usedAgendaCategories.map((cat) => (
            <span key={cat} className="flex items-center gap-2">
              <span className={`inline-block w-3 h-3 rounded border border-black/10 ${AGENDA_CATEGORY_STYLES[cat].dot}`} />
              {AGENDA_CATEGORY_STYLES[cat].label}
            </span>
          ))}
      </div>

      <SlotGrid
        groups={groups}
        now={now}
        highlightedSlots={highlightedSlots}
        renderSlot={renderSlot}
        tabs
      />

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={() => setShowPendingModal(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-stone-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-stone-900">Pending 1:1 Requests</h2>
                <p className="text-xs text-stone-500 mt-0.5">
                  {incomingRequests.length} waiting on your response
                </p>
              </div>
              <button
                onClick={() => setShowPendingModal(false)}
                className="text-stone-400 hover:text-stone-700 text-2xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-stone-100"
                aria-label="Close"
              >
                &times;
              </button>
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-stone-100">
              {incomingRequests.map(([iso, m]) => (
                <div key={iso} className="px-5 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-stone-900 truncate">{m.otherPersonName}</div>
                    <div className="text-xs text-stone-500 mt-0.5">
                      {formatSlotDay(new Date(iso))} · {formatSlotTime(new Date(iso))}
                    </div>
                    {m.message && (
                      <div className="text-xs text-stone-500 italic mt-1 whitespace-pre-wrap">&ldquo;{m.message}&rdquo;</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => act(m.requestId, "accept", iso)}
                      disabled={busy === m.requestId}
                      className="px-3 py-1.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-semibold hover:bg-emerald-100 disabled:opacity-50"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => act(m.requestId, "decline", iso)}
                      disabled={busy === m.requestId}
                      className="px-3 py-1.5 rounded-md border border-stone-200 bg-white text-stone-500 text-xs font-medium hover:bg-stone-50 hover:text-stone-700 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
