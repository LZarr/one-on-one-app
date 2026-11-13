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

type AgendaCategory = "meal" | "oneOnOne" | "other";

function categorizeAgendaItem(title: string): AgendaCategory {
  const t = title.toLowerCase();
  if (/breakfast|lunch|dinner|social time/.test(t)) return "meal";
  if (/1:1/.test(t)) return "oneOnOne";
  return "other";
}

const AGENDA_CATEGORY_STYLES: Record<AgendaCategory, { bg: string; text: string }> = {
  meal: { bg: "bg-[#E6F4F3]", text: "text-[#3c6b67]" },
  oneOnOne: { bg: "bg-[#BCE0E3]", text: "text-[#1f5457]" },
  other: { bg: "bg-[#A8CED1]", text: "text-[#1f4345]" },
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
  const [showAgenda, setShowAgenda] = useState(true);
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

  // A 1:1 always spans one or more consecutive base-grid slots (see
  // meetingSlotStarts in lib/config.ts) — every one of them points at the same
  // SlotMeeting object (same requestId), so adjacency alone tells us whether a
  // slot continues the previous one's meeting, with no extra data needed.
  function isMeetingContinuation(iso: string): boolean {
    const dateKey = iso.slice(0, 10);
    const dayIsos = groups[dateKey] ?? [];
    const idx = dayIsos.indexOf(iso);
    if (idx <= 0) return false;
    const reqId = meetings[iso]?.requestId;
    return !!reqId && meetings[dayIsos[idx - 1]]?.requestId === reqId;
  }

  // Walks back to the slot a meeting actually started at, regardless of which
  // agenda-tinted block that slot happens to fall in — needed because a
  // merged block only knows about its own rows, but accept/cancel need to
  // touch every slot the meeting occupies, including ones in an earlier block.
  function getMeetingTrueStart(iso: string): string {
    let cur = iso;
    while (isMeetingContinuation(cur)) {
      const dateKey = cur.slice(0, 10);
      const dayIsos = groups[dateKey] ?? [];
      cur = dayIsos[dayIsos.indexOf(cur) - 1];
    }
    return cur;
  }

  // Would this meeting slot be drawn by an agenda-tinted merged block (true),
  // or by the plain standalone renderer (false)? Mirrors the tint decision
  // renderSlot makes for a slot it's actually rendering, so tintedBlock can
  // tell whether a meeting's earlier slot was handled by a *different* tinted
  // block (draw this one too) or by the standalone renderer, which already
  // drew this meeting's full remaining span on its own (don't duplicate it).
  function isMeetingSlotTinted(iso: string, kind: "confirmed" | "incoming" | "outgoing"): boolean {
    if (!showAgenda || !agendaRunInfo[iso]) return false;
    if (kind === "confirmed") return true;
    return new Date(iso).getTime() >= nowMs;
  }

  function getMeetingRunIsos(startIso: string): string[] {
    const dateKey = startIso.slice(0, 10);
    const dayIsos = groups[dateKey] ?? [];
    const idx = dayIsos.indexOf(startIso);
    if (idx === -1) return [startIso];
    const reqId = meetings[startIso]?.requestId;
    const run = [startIso];
    for (let i = idx + 1; i < dayIsos.length; i++) {
      if (meetings[dayIsos[i]]?.requestId === reqId) run.push(dayIsos[i]);
      else break;
    }
    return run;
  }

  // A multi-slot meeting occupies several keys in `meetings` (same requestId)
  // — keep only the earliest slot per request, both so it's counted once and
  // so the iso handed to accept/decline is the run's real start.
  const incomingByRequest = new Map<string, [string, SlotMeeting]>();
  for (const [iso, m] of Object.entries(meetings)) {
    if (m.type !== "incoming" || new Date(iso).getTime() < nowMs) continue;
    const existing = incomingByRequest.get(m.requestId);
    if (!existing || iso < existing[0]) incomingByRequest.set(m.requestId, [iso, m]);
  }
  const incomingRequests = Array.from(incomingByRequest.values()).sort(([a], [b]) =>
    a.localeCompare(b),
  );

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
      for (const runIso of getMeetingRunIsos(iso)) {
        updated[runIso] = { ...updated[runIso], type: "confirmed" };
      }
    } else if (action === "decline" || action === "cancel") {
      for (const runIso of getMeetingRunIsos(iso)) {
        delete updated[runIso];
      }
    }
    setMeetings(updated);
    startTransition(() => router.refresh());
  }

  function renderSlot(iso: string, { isHighlighted }: { isHighlighted: boolean; isPast: boolean }) {
    const state = classify(iso);
    const time = formatSlotTime(new Date(iso));

    // No vertical padding and a fixed height, matching the tinted rows'
    // ROW_H exactly — otherwise this row renders taller than a tinted one
    // and the whole list shifts/reflows when the agenda overlay is toggled.
    const flatBase = "flex items-center gap-1 px-1 text-sm";
    const flatStyle = { height: 26 };
    const hlCls = isHighlighted
      ? "ring-2 ring-amber-400/60 border-amber-300 bg-amber-50/40"
      : "";
    const flatHlCls = isHighlighted ? "ring-2 ring-amber-400/40 rounded-md bg-amber-50/40" : "";

    const agenda = showAgenda ? agendaRunInfo[iso] : undefined;
    // No live meeting on this slot (or it's a confirmed one, while the overlay is
    // showing): the row can be tinted and merged into one continuous block with
    // its neighbors in the same agenda run.
    const canTintRow =
      state.kind === "past" ||
      state.kind === "available" ||
      state.kind === "blocked" ||
      (state.kind === "confirmed" && showAgenda) ||
      ((state.kind === "incoming" || state.kind === "outgoing") && showAgenda && !state.isPast);
    const tint = canTintRow && agenda ? AGENDA_CATEGORY_STYLES[agenda.category] : null;

    // Continuation slot of an already-rendered merged block: nothing to draw here.
    // A tinted row merges along agenda-run boundaries (handled here); a live
    // meeting with no agenda tint at all merges along its own meeting-run instead
    // (handled below) — the two runs don't always line up at the same slot.
    if (tint && !agenda!.isStart) return null;
    if (
      ((state.kind === "confirmed" ||
        state.kind === "incoming" ||
        state.kind === "outgoing") &&
        !tint) &&
      isMeetingContinuation(iso)
    ) {
      return null;
    }

    // Renders one merged, agenda-tinted block. A confirmed meeting inside this
    // block (which may start partway through it, not necessarily at the top)
    // gets a name tag sized to the full span of slots it actually occupies,
    // instead of a tag confined to a single 15-minute row. A row with no
    // meeting still needs to stay actionable (book it, or unblock it) even
    // while the agenda overlay is on, so those get their own chip too.
    const ROW_H = 26;
    type MeetingChip = {
      top: number;
      height: number;
      name: string;
      requestId: string;
      startIso: string;
      isPast: boolean;
      kind: "confirmed" | "incoming" | "outgoing";
      // Whether this chip is actually one half of a meeting that straddles
      // into a *neighboring tinted block* on that side — when true, that edge
      // sits flush (no border-radius, no gap) against the other half's chip,
      // so the two halves read as one continuous pill instead of two stacked
      // boxes with a seam between them.
      continuesFromPrev: boolean;
      continuesToNext: boolean;
    };
    function tintedBlock() {
      const runIsos = getAgendaRunIsos(iso);
      const chips: MeetingChip[] = [];
      runIsos.forEach((runIso, i) => {
        const m = meetings[runIso];
        if (!m) return;
        // A continuation *within this block* was already drawn by the chip
        // pushed for its earlier row — skip it here.
        if (i > 0 && meetings[runIsos[i - 1]]?.requestId === m.requestId) return;
        let continuesFromPrev = false;
        if (i === 0 && isMeetingContinuation(runIso)) {
          // This meeting started before this block. If that earlier slot was
          // itself in a *different tinted block*, that block only drew its own
          // portion — this one needs to pick up the rest. But if the earlier
          // slot wasn't tinted at all, the standalone (non-agenda) renderer
          // already drew this meeting's full remaining span starting there,
          // this row included — drawing it again here would duplicate it.
          const dateKey = runIso.slice(0, 10);
          const dayIsos = groups[dateKey] ?? [];
          const prevIso = dayIsos[dayIsos.indexOf(runIso) - 1];
          if (!isMeetingSlotTinted(prevIso, m.type)) return;
          continuesFromPrev = true;
        }
        let span = 0;
        for (let j = i; j < runIsos.length; j++) {
          if (meetings[runIsos[j]]?.requestId === m.requestId) span++;
          else break;
        }
        let continuesToNext = false;
        if (i + span === runIsos.length) {
          const lastIso = runIsos[i + span - 1];
          const dateKey = lastIso.slice(0, 10);
          const dayIsos = groups[dateKey] ?? [];
          const nextIso = dayIsos[dayIsos.indexOf(lastIso) + 1];
          const nextM = nextIso ? meetings[nextIso] : undefined;
          if (nextM && nextM.requestId === m.requestId && isMeetingSlotTinted(nextIso, nextM.type)) {
            continuesToNext = true;
          }
        }
        const trueStart = getMeetingTrueStart(runIso);
        chips.push({
          top: i * ROW_H,
          height: Math.max(1, span) * ROW_H,
          name: m.otherPersonName,
          requestId: m.requestId,
          startIso: trueStart,
          isPast: new Date(trueStart).getTime() < nowMs,
          kind: m.type,
          continuesFromPrev,
          continuesToNext,
        });
      });
      // Only reserve room for a chip on the label's own row if one actually
      // overlaps it — otherwise the label gets padded/truncated for a chip
      // that isn't even there.
      const labelNeedsClearance = chips.some((c) => c.top === 0);
      // If a chip at the very top/bottom of this block is half of a straddling
      // meeting, pull this block flush against its neighbor on that edge
      // (cancelling the gap between blocks) and square off that corner.
      const blockContinuesFromPrev = chips.some((c) => c.top === 0 && c.continuesFromPrev);
      const blockContinuesToNext = chips.some((c) => c.top + c.height === runIsos.length * ROW_H && c.continuesToNext);
      const blockRoundCls = `${blockContinuesFromPrev ? "rounded-t-none" : "rounded-t-md"} ${
        blockContinuesToNext ? "rounded-b-none" : "rounded-b-md"
      }`;
      return (
        <div
          key={iso}
          // The parent's `space-y-0.5` sets margin-top via a `> * + *` selector,
          // which beats a plain `-mt-0.5` utility class on specificity — an
          // inline style is the only way to actually cancel that gap here.
          style={blockContinuesFromPrev ? { marginTop: "-2px" } : undefined}
          className={`${tint!.bg} ${blockRoundCls} overflow-hidden relative`}
        >
          {runIsos.map((runIso, i) => {
            const m = meetings[runIso];
            // Book/Block live in this row's own flex row (same as every other
            // row on the page) instead of an absolutely-positioned overlay, so
            // they land on exactly the same baseline as the time label next to
            // them — a separately-positioned overlay drifted a few px off.
            const rowState = !m ? classify(runIso) : null;
            // A blocked slot should read as de-emphasized even on top of an
            // agenda tint, same as it does outside the overlay — otherwise it
            // looks identical to an open, bookable slot. Opacity alone won't
            // do it here: the tint is painted by the parent block, not this
            // row, so a plain opacity on this row only fades its own text,
            // not the color behind it — it needs its own wash on top instead.
            const isBlockedRow = rowState?.kind === "blocked";
            return (
              <div
                key={runIso}
                className={`flex items-center gap-1 px-1 text-sm ${isBlockedRow ? "bg-white/60" : ""}`}
                style={{ height: ROW_H }}
              >
                <span className={`text-sm w-16 shrink-0 font-medium ${tint!.text}`}>
                  {formatSlotTime(new Date(runIso))}
                </span>
                {i === 0 && (
                  <span
                    className={`text-sm font-medium min-w-0 flex-1 truncate ${labelNeedsClearance ? "pr-20" : ""} ${tint!.text}`}
                  >
                    {agenda!.label}
                  </span>
                )}
                {rowState?.kind === "available" && (
                  <div className="flex items-center gap-2 shrink-0 pr-2 ml-auto">
                    <button
                      onClick={() => router.push(`/attendees?slot=${runIso}`)}
                      className="text-sm text-stone-900 font-medium hover:text-accent-600 border border-stone-300 hover:border-accent-400 rounded-md px-2 py-0.5 leading-none bg-white/70"
                    >
                      Book
                    </button>
                    <button
                      onClick={() => toggleBlock(runIso)}
                      className="text-sm text-stone-900 font-medium hover:text-accent-600 border border-stone-300 hover:border-accent-400 rounded-md px-2 py-0.5 leading-none bg-white/70"
                    >
                      Block
                    </button>
                  </div>
                )}
                {isBlockedRow && !adminBlocked.has(runIso) && (
                  <button
                    onClick={() => toggleBlock(runIso)}
                    className="text-sm text-stone-900 font-medium hover:text-accent-600 shrink-0 pr-2 ml-auto"
                  >
                    Unblock
                  </button>
                )}
              </div>
            );
          })}
          {chips.map((c, i) => {
            // The usual 3px breathing room above/below a chip has to disappear
            // on whichever edge touches the other half of a straddling
            // meeting — otherwise that inset alone still shows as a gap even
            // once the border/radius on that edge is gone.
            const topInset = c.continuesFromPrev ? 0 : 3;
            const bottomInset = c.continuesToNext ? 0 : 3;
            const posStyle = {
              position: "absolute" as const,
              top: c.top + topInset,
              height: c.height - topInset - bottomInset,
              right: 4,
            };
            // Only let the name wrap to a second line when the chip actually
            // has room for it (spans 2+ rows) — a 1-row chip is too short for
            // two lines and the overflow just bleeds into the row below it.
            const nameWrapCls = c.height >= 2 * ROW_H - 6 ? "line-clamp-2 leading-tight" : "truncate";
            // A chip that's half of a meeting straddling into a neighboring
            // tinted block sits flush against its other half on that edge —
            // square off the corner and drop the border there so the two
            // halves read as one continuous pill.
            const edgeCls = `${c.continuesFromPrev ? "rounded-t-none border-t-0" : "rounded-t-md"} ${
              c.continuesToNext ? "rounded-b-none border-b-0" : "rounded-b-md"
            }`;
            // A continuation half is visually part of the same pill as the
            // segment before it — show the name (and any actions) only once,
            // on the first segment, instead of repeating them on every half.
            if (c.isPast) {
              const past =
                c.kind === "confirmed"
                  ? { dot: "bg-emerald-500", text: "text-emerald-900", cls: "border-emerald-200 bg-emerald-50" }
                  : { dot: "bg-stone-300", text: "text-stone-500", cls: "border-stone-200 bg-stone-50" };
              return (
                <div
                  key={i}
                  style={posStyle}
                  className={`flex items-center justify-center gap-1.5 px-2.5 border w-[40%] ${edgeCls} ${past.cls}`}
                >
                  {!c.continuesFromPrev && (
                    <>
                      <span className={`w-2 h-2 rounded-full ${past.dot} shrink-0`} />
                      <span className={`text-sm font-medium ${past.text} ${nameWrapCls} text-center`}>{c.name}</span>
                    </>
                  )}
                </div>
              );
            }
            if (c.kind === "incoming") {
              return (
                <div
                  key={i}
                  style={posStyle}
                  className={`flex items-center border border-amber-200 bg-amber-50 w-1/2 overflow-hidden ${edgeCls}`}
                >
                  {c.continuesFromPrev ? (
                    <span className="flex-1" />
                  ) : (
                    <>
                      <span className={`text-sm font-medium text-amber-900 ${nameWrapCls} flex-1 px-2`}>{c.name}</span>
                      <button
                        onClick={() => act(c.requestId, "accept", c.startIso)}
                        disabled={busy === c.requestId}
                        className="self-stretch px-2 text-sm font-semibold text-emerald-600 hover:bg-emerald-100 disabled:opacity-50"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => act(c.requestId, "decline", c.startIso)}
                        disabled={busy === c.requestId}
                        className="self-stretch px-2 text-sm font-medium text-stone-400 border-l border-amber-200 hover:bg-stone-100 disabled:opacity-50"
                      >
                        Decline
                      </button>
                    </>
                  )}
                </div>
              );
            }
            const confirming = confirmingCancel === c.requestId;
            const live =
              c.kind === "confirmed"
                ? {
                    dot: "bg-emerald-500",
                    text: "text-emerald-900",
                    cls: confirming
                      ? "border-stone-300 bg-stone-100"
                      : "border-emerald-200 bg-emerald-50 hover:bg-emerald-100",
                  }
                : {
                    dot: "bg-amber-500",
                    text: "text-amber-900",
                    cls: confirming
                      ? "border-stone-300 bg-stone-100"
                      : "border-amber-200 bg-amber-50 hover:bg-amber-100",
                  };
            return (
              <button
                key={i}
                style={posStyle}
                onClick={() => {
                  if (confirming) {
                    setConfirmingCancel(null);
                    act(c.requestId, "cancel", c.startIso);
                  } else {
                    setConfirmingCancel(c.requestId);
                  }
                }}
                onBlur={() => {
                  if (confirming) setConfirmingCancel(null);
                }}
                disabled={busy === c.requestId}
                className={`flex items-center justify-center gap-1.5 px-2.5 border w-[40%] ${edgeCls} ${live.cls}`}
              >
                {confirming ? (
                  <span className="text-sm font-semibold text-stone-800">Cancel?</span>
                ) : (
                  !c.continuesFromPrev && (
                    <>
                      <span className={`w-2 h-2 rounded-full ${live.dot} shrink-0`} />
                      <span className={`text-sm font-medium ${live.text} ${nameWrapCls} text-center`}>{c.name}</span>
                    </>
                  )
                )}
              </button>
            );
          })}
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
          <div className="text-xs text-stone-400 italic pl-3 pt-0.5 pb-1.5 truncate">
            {caption}
          </div>
        )}
      </div>
    );

    if (state.kind === "past") {
      if (tint) return tintedBlock();
      return wrap(
        <div className={`${flatBase} ${flatHlCls}`} style={flatStyle}>
          <span className="text-sm text-stone-300 w-16 shrink-0 font-medium">{time}</span>
        </div>,
      );
    }

    if ((state.kind === "incoming" || state.kind === "outgoing") && state.isPast) {
      const runIsos = getMeetingRunIsos(iso);
      return wrap(
        <div className={`rounded-md border overflow-hidden flex items-center border-stone-200 bg-stone-50/60 opacity-90 ${hlCls}`}>
          <div className="flex flex-col shrink-0 w-16">
            {runIsos.map((runIso) => (
              <div key={runIso} className="flex items-center pl-1" style={{ height: ROW_H }}>
                <span className="text-sm text-stone-400 font-medium">{formatSlotTime(new Date(runIso))}</span>
              </div>
            ))}
          </div>
          <div className="w-2 h-2 rounded-full bg-stone-300 shrink-0" />
          <span className="text-sm text-stone-500 truncate flex-1 px-2">{state.meeting.otherPersonName}</span>
          <span className="text-xs text-stone-400 shrink-0 italic pr-3">missed</span>
        </div>,
      );
    }

    if (state.kind === "confirmed" && showAgenda) {
      // In the retreat-schedule overlay, a confirmed 1:1 shouldn't take over the
      // whole row — just a small name tag on the side, so the printed schedule
      // stays the main thing you're looking at.
      if (tint) return tintedBlock();
      const runIsos = getMeetingRunIsos(iso);
      // Apply any highlight ring once, to the whole merged block, rather than
      // per 15-min sub-row (which drew a visible seam between them).
      const blockHlCls = runIsos.some((ri) => highlightedSlots.includes(ri))
        ? "ring-2 ring-amber-400/40 bg-amber-50/40"
        : "";
      return (
        <div key={iso} className={`rounded-md overflow-hidden relative ${blockHlCls} ${state.isPast ? "opacity-60" : ""}`}>
          {runIsos.map((runIso) => (
            <div key={runIso} className={flatBase} style={{ height: 26 }}>
              <span className="text-sm text-stone-500 w-16 shrink-0 font-medium">{formatSlotTime(new Date(runIso))}</span>
            </div>
          ))}
          {(() => {
            const requestId = state.meeting.requestId;
            const confirming = confirmingCancel === requestId;
            const posStyle = { position: "absolute" as const, top: 3, height: runIsos.length * 26 - 6, right: 4 };
            const clsBase = "flex items-center justify-center gap-1.5 px-2.5 rounded-md border w-[40%]";
            const nameWrapCls = runIsos.length >= 2 ? "line-clamp-2 leading-tight" : "truncate";
            if (state.isPast) {
              return (
                <div style={posStyle} className={`${clsBase} border-emerald-200 bg-emerald-50`}>
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                  <span className={`text-sm font-medium text-emerald-900 ${nameWrapCls} text-center`}>{state.meeting.otherPersonName}</span>
                </div>
              );
            }
            return (
              <button
                style={posStyle}
                onClick={() => {
                  if (confirming) {
                    setConfirmingCancel(null);
                    act(requestId, "cancel", iso);
                  } else {
                    setConfirmingCancel(requestId);
                  }
                }}
                onBlur={() => {
                  if (confirming) setConfirmingCancel(null);
                }}
                disabled={busy === requestId}
                className={`${clsBase} ${
                  confirming ? "border-stone-300 bg-stone-100" : "border-emerald-200 bg-emerald-50 hover:bg-emerald-100"
                }`}
              >
                {confirming ? (
                  <span className="text-sm font-semibold text-stone-800">Cancel?</span>
                ) : (
                  <>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                    <span className={`text-sm font-medium text-emerald-900 ${nameWrapCls} text-center`}>{state.meeting.otherPersonName}</span>
                  </>
                )}
              </button>
            );
          })()}
        </div>
      );
    }

    if (state.kind === "outgoing" && showAgenda) {
      // Same small-tag treatment as a confirmed meeting — a pending request
      // you sent shouldn't take over the row either.
      if (tint) return tintedBlock();
      const runIsos = getMeetingRunIsos(iso);
      const blockHlCls = runIsos.some((ri) => highlightedSlots.includes(ri))
        ? "ring-2 ring-amber-400/40 bg-amber-50/40"
        : "";
      return (
        <div key={iso} className={`rounded-md overflow-hidden relative ${blockHlCls}`}>
          {runIsos.map((runIso) => (
            <div key={runIso} className={flatBase} style={{ height: 26 }}>
              <span className="text-sm text-stone-500 w-16 shrink-0 font-medium">{formatSlotTime(new Date(runIso))}</span>
            </div>
          ))}
          {(() => {
            const requestId = state.meeting.requestId;
            const confirming = confirmingCancel === requestId;
            const posStyle = { position: "absolute" as const, top: 3, height: runIsos.length * 26 - 6, right: 4 };
            const nameWrapCls = runIsos.length >= 2 ? "line-clamp-2 leading-tight" : "truncate";
            return (
              <button
                style={posStyle}
                onClick={() => {
                  if (confirming) {
                    setConfirmingCancel(null);
                    act(requestId, "cancel", iso);
                  } else {
                    setConfirmingCancel(requestId);
                  }
                }}
                onBlur={() => {
                  if (confirming) setConfirmingCancel(null);
                }}
                disabled={busy === requestId}
                className={`flex items-center justify-center gap-1.5 px-2.5 rounded-md border w-[40%] ${
                  confirming ? "border-stone-300 bg-stone-100" : "border-amber-200 bg-amber-50 hover:bg-amber-100"
                }`}
              >
                {confirming ? (
                  <span className="text-sm font-semibold text-stone-800">Cancel?</span>
                ) : (
                  <>
                    <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                    <span className={`text-sm font-medium text-amber-900 ${nameWrapCls} text-center`}>{state.meeting.otherPersonName}</span>
                  </>
                )}
              </button>
            );
          })()}
        </div>
      );
    }

    if (state.kind === "incoming" && showAgenda) {
      // Same small-tag treatment, but a request waiting on you needs its
      // Accept/Decline actions rather than a Cancel.
      if (tint) return tintedBlock();
      const runIsos = getMeetingRunIsos(iso);
      const blockHlCls = runIsos.some((ri) => highlightedSlots.includes(ri))
        ? "ring-2 ring-amber-400/40 bg-amber-50/40"
        : "";
      return (
        <div key={iso} className={`rounded-md overflow-hidden relative ${blockHlCls}`}>
          {runIsos.map((runIso) => (
            <div key={runIso} className={flatBase} style={{ height: 26 }}>
              <span className="text-sm text-stone-500 w-16 shrink-0 font-medium">{formatSlotTime(new Date(runIso))}</span>
            </div>
          ))}
          <div
            style={{ position: "absolute", top: 3, height: runIsos.length * 26 - 6, right: 4 }}
            className="flex items-center rounded-md border border-amber-200 bg-amber-50 w-1/2 overflow-hidden"
          >
            <span
              className={`text-sm font-medium text-amber-900 flex-1 px-2 ${
                runIsos.length >= 2 ? "line-clamp-2 leading-tight" : "truncate"
              }`}
            >
              {state.meeting.otherPersonName}
            </span>
            <button
              onClick={() => act(state.meeting.requestId, "accept", iso)}
              disabled={busy === state.meeting.requestId}
              className="self-stretch px-2 text-sm font-semibold text-emerald-600 hover:bg-emerald-100 disabled:opacity-50"
            >
              Accept
            </button>
            <button
              onClick={() => act(state.meeting.requestId, "decline", iso)}
              disabled={busy === state.meeting.requestId}
              className="self-stretch px-2 text-sm font-medium text-stone-400 border-l border-amber-200 hover:bg-stone-100 disabled:opacity-50"
            >
              Decline
            </button>
          </div>
        </div>
      );
    }

    if (state.kind === "confirmed") {
      const pastCls = state.isPast ? "opacity-50" : "";
      const assigned = state.meeting.assignedByAdmin;
      const colorCls = assigned ? "border-stone-200 bg-white" : "border-emerald-200 bg-emerald-50";
      const dotCls = assigned ? "bg-stone-300" : "bg-emerald-500";
      const timeCls = assigned ? "text-stone-600" : "text-emerald-700";
      const nameCls = assigned ? "text-stone-700" : "text-emerald-900";
      const runIsos = getMeetingRunIsos(iso);
      return wrap(
        <div className={`rounded-md border overflow-hidden flex items-center ${colorCls} ${hlCls} ${pastCls}`}>
          <div className="flex flex-col shrink-0 w-16">
            {runIsos.map((runIso) => (
              <div key={runIso} className="flex items-center pl-1" style={{ height: ROW_H }}>
                <span className={`text-sm ${timeCls} font-medium`}>{formatSlotTime(new Date(runIso))}</span>
              </div>
            ))}
          </div>
          <div className={`w-2 h-2 rounded-full ${dotCls} shrink-0`} />
          <span className={`text-sm font-medium ${nameCls} truncate flex-1 px-2`}>
            {state.meeting.otherPersonName}
            {assigned && <span className="font-normal text-stone-400"> (assigned)</span>}
          </span>
          {!state.isPast && (
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
              className={`self-stretch shrink-0 w-[72px] text-sm font-medium ${
                confirmingCancel === state.meeting.requestId
                  ? "text-stone-800 bg-stone-100 font-semibold"
                  : "text-stone-600 hover:bg-stone-50 hover:text-stone-800"
              }`}
            >
              {confirmingCancel === state.meeting.requestId ? "Sure?" : "Cancel"}
            </button>
          )}
        </div>,
      );
    }

    if (state.kind === "incoming") {
      const runIsos = getMeetingRunIsos(iso);
      return wrap(
        <div className={`rounded-md border overflow-hidden flex items-center border-amber-200 bg-amber-50 ${hlCls}`}>
          <div className="flex flex-col shrink-0 w-16">
            {runIsos.map((runIso) => (
              <div key={runIso} className="flex items-center pl-1" style={{ height: ROW_H }}>
                <span className="text-sm text-amber-700 font-medium">{formatSlotTime(new Date(runIso))}</span>
              </div>
            ))}
          </div>
          <div className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
          <span className="text-sm font-medium text-amber-900 truncate flex-1 px-2">
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
              className="self-stretch flex-1 text-emerald-600 text-sm font-semibold hover:bg-emerald-50 disabled:opacity-50"
            >
              Accept
            </button>
            <button
              onClick={() => act(state.meeting.requestId, "decline", iso)}
              disabled={busy === state.meeting.requestId}
              className="self-stretch flex-1 border-l border-amber-200 text-stone-400 text-sm font-medium hover:bg-stone-50 hover:text-stone-600 disabled:opacity-50"
            >
              Decline
            </button>
          </div>
        </div>,
      );
    }

    if (state.kind === "outgoing") {
      const runIsos = getMeetingRunIsos(iso);
      return wrap(
        <div className={`rounded-md border overflow-hidden flex items-center border-stone-200 bg-white ${hlCls}`}>
          <div className="flex flex-col shrink-0 w-16">
            {runIsos.map((runIso) => (
              <div key={runIso} className="flex items-center pl-1" style={{ height: ROW_H }}>
                <span className="text-sm text-stone-500 font-medium">{formatSlotTime(new Date(runIso))}</span>
              </div>
            ))}
          </div>
          <div className="w-2 h-2 rounded-full bg-stone-300 shrink-0" />
          <span className="text-sm font-medium text-stone-600 truncate flex-1 px-2">{state.meeting.otherPersonName}</span>
          <span className="text-xs text-stone-400 shrink-0 italic">waiting</span>
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
            className={`self-stretch shrink-0 w-[72px] text-sm font-medium ${
              confirmingCancel === state.meeting.requestId
                ? "text-stone-700 bg-stone-100 font-semibold"
                : "text-stone-400 hover:bg-stone-50 hover:text-stone-600"
            }`}
          >
            {confirmingCancel === state.meeting.requestId ? "Sure?" : "Cancel"}
          </button>
        </div>,
      );
    }

    if (state.kind === "available") {
      if (tint) return tintedBlock();
      return wrap(
        <div className={`${flatBase} rounded-md hover:bg-stone-50 ${flatHlCls}`} style={flatStyle}>
          <span className="text-sm text-stone-500 w-16 shrink-0 font-medium">{time}</span>
          <span className="flex-1" />
          <div className="flex items-center gap-2 shrink-0 pr-2">
            <button
              onClick={() => router.push(`/attendees?slot=${iso}`)}
              className="text-sm text-stone-900 font-medium hover:text-accent-600 border border-stone-300 hover:border-accent-400 rounded-md px-2 py-0.5 leading-none bg-white/70"
            >
              Book
            </button>
            <button
              onClick={() => toggleBlock(iso)}
              className="text-sm text-stone-900 font-medium hover:text-accent-600 border border-stone-300 hover:border-accent-400 rounded-md px-2 py-0.5 leading-none bg-white/70"
            >
              Block
            </button>
          </div>
        </div>,
      );
    }

    const isAdminBlocked = adminBlocked.has(iso);
    if (tint) return tintedBlock();
    return wrap(
      <div className={`${flatBase} rounded-md hover:bg-stone-50 ${flatHlCls}`} style={flatStyle}>
        <span className="text-sm text-stone-300 w-16 shrink-0 font-medium">{time}</span>
        <span className="flex-1" />
        {!isAdminBlocked && (
          <button
            onClick={() => toggleBlock(iso)}
            className="text-stone-300 text-sm font-medium hover:text-stone-600 shrink-0 pr-2"
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
          <span className="text-sm text-red-700 font-semibold shrink-0">
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

      <div className="text-sm text-stone-400 flex flex-wrap gap-4 mb-5 pb-4 border-b border-stone-200/60">
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
                <p className="text-sm text-stone-500 mt-0.5">
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
                    <div className="text-sm text-stone-500 mt-0.5">
                      {formatSlotDay(new Date(iso))} · {formatSlotTime(new Date(iso))}
                    </div>
                    {m.message && (
                      <div className="text-sm text-stone-500 italic mt-1 whitespace-pre-wrap">&ldquo;{m.message}&rdquo;</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => act(m.requestId, "accept", iso)}
                      disabled={busy === m.requestId}
                      className="px-3 py-1.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm font-semibold hover:bg-emerald-100 disabled:opacity-50"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => act(m.requestId, "decline", iso)}
                      disabled={busy === m.requestId}
                      className="px-3 py-1.5 rounded-md border border-stone-200 bg-white text-stone-500 text-sm font-medium hover:bg-stone-50 hover:text-stone-700 disabled:opacity-50"
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
