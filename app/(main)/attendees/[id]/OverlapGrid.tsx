"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatSlotTime, formatSlotTimeRange, formatSlotDay } from "@/lib/format";
import { MEETING_DURATION_MINUTES } from "@/lib/config";
import SlotGrid from "../../SlotGrid";

type BetweenUsRequest = {
  requestId: string;
  slotStart: string;
  direction: "incoming" | "outgoing";
  status: "pending" | "accepted";
  message: string | null;
};

type Props = {
  toUserId: string;
  toUserName: string;
  groups: Record<string, string[]>;
  mine: string[];
  theirs: string[];
  myBooked: string[];
  theirBooked: string[];
  betweenUs: BetweenUsRequest[];
  highlightedSlots?: string[];
  blockedSlots?: string[];
  meetingSlotCount?: number;
  now: string;
  preselectedSlot?: string;
};

type SlotState =
  | "available"
  | "pendingOutgoing"
  | "pendingIncoming"
  | "confirmed"
  | "booked"
  | "myBooked"
  | "theirBooked"
  | "bothBooked"
  | "none";

export default function OverlapGrid({
  toUserId,
  toUserName,
  groups,
  mine,
  theirs,
  myBooked,
  theirBooked,
  betweenUs,
  highlightedSlots = [],
  blockedSlots = [],
  meetingSlotCount = 1,
  now,
  preselectedSlot,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(preselectedSlot ?? null);
  const [message, setMessage] = useState("");
  const [confirmingCancel, setConfirmingCancel] = useState<string | null>(null);

  // A 1:1 always runs the full meeting duration, which can span more than one
  // base-grid slot (meetingSlotCount > 1). Every slot it occupies needs to
  // point at the same request, both so it can't be double-booked and so
  // cancelling it from any of its slots clears the whole thing.
  function getRunIsos(startIso: string): string[] {
    const dateKey = startIso.slice(0, 10);
    const dayIsos = groups[dateKey] ?? [];
    const idx = dayIsos.indexOf(startIso);
    if (idx === -1) return [startIso];
    const run = [startIso];
    for (let i = 1; i < meetingSlotCount; i++) {
      const nextIso = dayIsos[idx + i];
      if (!nextIso) break;
      run.push(nextIso);
    }
    return run;
  }

  // The slot right after this one in its day, if it's part of the same
  // request's run — used to skip re-rendering a row that's already covered
  // by the merged box the run's first slot draws.
  function isRunContinuation(iso: string): boolean {
    const dateKey = iso.slice(0, 10);
    const dayIsos = groups[dateKey] ?? [];
    const idx = dayIsos.indexOf(iso);
    if (idx <= 0) return false;
    const reqId = betweenUsMap[iso]?.requestId;
    return !!reqId && betweenUsMap[dayIsos[idx - 1]]?.requestId === reqId;
  }

  const [betweenUsMap, setBetweenUsMap] = useState<Record<string, BetweenUsRequest>>(() => {
    const map: Record<string, BetweenUsRequest> = {};
    for (const p of betweenUs) {
      for (const runIso of getRunIsos(p.slotStart)) map[runIso] = p;
    }
    return map;
  });
  const mineSet = new Set(mine);
  const theirsSet = new Set(theirs);
  const myBookedSet = new Set(myBooked.flatMap(getRunIsos));
  const theirBookedSet = new Set(theirBooked.flatMap(getRunIsos));
  const blockedSet = new Set(blockedSlots);
  const nowMs = new Date(now).getTime();

  async function request(iso: string, msg: string) {
    setConfirm(null);
    setBusy(iso);
    setError(null);
    const res = await fetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toUserId, slotStart: iso, message: msg.trim() || undefined }),
    });
    setBusy(null);
    setMessage("");
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "Failed");
      return;
    }
    const j = await res.json().catch(() => ({}));
    if (j.id) {
      const entry: BetweenUsRequest = {
        requestId: j.id,
        slotStart: iso,
        direction: "outgoing",
        status: "pending",
        message: msg.trim() || null,
      };
      const next = { ...betweenUsMap };
      for (const runIso of getRunIsos(iso)) next[runIso] = entry;
      setBetweenUsMap(next);
    }
    router.refresh();
  }

  async function act(
    requestId: string,
    action: "accept" | "decline" | "cancel",
    startIso: string,
  ) {
    setBusy(requestId);
    setError(null);
    const res = await fetch(`/api/requests/${requestId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "Failed");
      return;
    }
    const next = { ...betweenUsMap };
    const runIsos = getRunIsos(startIso);
    if (action === "accept") {
      for (const runIso of runIsos) {
        const existing = next[runIso];
        if (existing) next[runIso] = { ...existing, status: "accepted" };
      }
    } else {
      for (const runIso of runIsos) delete next[runIso];
    }
    setBetweenUsMap(next);
    router.refresh();
  }

  const bufferMs = 30 * 60 * 1000;

  function classify(iso: string): SlotState | null {
    const slotMs = new Date(iso).getTime();
    if (slotMs < nowMs) return null;
    if (slotMs < nowMs + bufferMs) return "booked";
    const p = betweenUsMap[iso];
    if (p) {
      if (p.status === "accepted") return "confirmed";
      return p.direction === "outgoing" ? "pendingOutgoing" : "pendingIncoming";
    }
    const myHasOther = myBookedSet.has(iso);
    const theirHasOther = theirBookedSet.has(iso);
    if (myHasOther && theirHasOther) return "bothBooked";
    if (myHasOther) return "myBooked";
    if (theirHasOther) return "theirBooked";
    if (blockedSet.has(iso)) return "none";
    if (mineSet.has(iso) && theirsSet.has(iso)) {
      // A 1:1 always runs the full meeting duration, which can span more than
      // one base-grid slot. Only offer this slot if every slot it would occupy
      // is also free for both people — otherwise the request would just fail.
      if (meetingSlotCount > 1) {
        const dateKey = iso.slice(0, 10);
        const dayIsos = groups[dateKey] ?? [];
        const idx = dayIsos.indexOf(iso);
        for (let i = 1; i < meetingSlotCount; i++) {
          const nextIso = dayIsos[idx + i];
          if (!nextIso) return "none";
          const nextMs = new Date(nextIso).getTime();
          if (nextMs < nowMs + bufferMs) return "none";
          if (betweenUsMap[nextIso]) return "none";
          if (myBookedSet.has(nextIso) || theirBookedSet.has(nextIso)) return "none";
          if (blockedSet.has(nextIso)) return "none";
          if (!mineSet.has(nextIso) || !theirsSet.has(nextIso)) return "none";
        }
      }
      return "available";
    }
    return "none";
  }

  function filterSlot(iso: string): boolean {
    const state = classify(iso);
    return state !== null && state !== "none";
  }

  const allSlots = Object.values(groups).flat();
  const totalAvailable = allSlots.filter((iso) => classify(iso) === "available").length;
  // A multi-slot meeting is still just one request — count distinct requests,
  // not every slot it happens to occupy.
  const totalBetweenUs = new Set(
    allSlots
      .filter((iso) => {
        const s = classify(iso);
        return s === "pendingOutgoing" || s === "pendingIncoming" || s === "confirmed";
      })
      .map((iso) => betweenUsMap[iso]!.requestId),
  ).size;

  const base =
    "flex items-center gap-2 pl-3 pr-0 py-0 rounded-md border text-sm overflow-hidden min-h-[36px]";

  function meetingTimeRange(p: BetweenUsRequest): string {
    const start = new Date(p.slotStart);
    const end = new Date(start.getTime() + MEETING_DURATION_MINUTES * 60 * 1000);
    return formatSlotTimeRange(start, end);
  }

  function renderSlot(iso: string, { isHighlighted }: { isHighlighted: boolean; isPast: boolean }) {
    const state = classify(iso);
    if (!state || state === "none") return null;
    // A multi-slot meeting/request is one box, not one per base-grid slot it
    // occupies — the run's first slot draws the whole thing, so later slots
    // in the same run render nothing.
    if (
      (state === "confirmed" || state === "pendingOutgoing" || state === "pendingIncoming") &&
      isRunContinuation(iso)
    ) {
      return null;
    }
    const time = formatSlotTime(new Date(iso));
    const hlCls = isHighlighted
      ? "ring-2 ring-amber-400/60 border-amber-300 bg-amber-50/40"
      : "";

    if (state === "available") {
      return (
        <div
          key={iso}
          className={`${base} border-accent-200 bg-accent-50 hover:bg-accent-100 cursor-pointer ${hlCls}`}
          onClick={() => setConfirm(iso)}
        >
          <span className="text-xs text-accent-700 w-16 shrink-0 font-semibold">{time}</span>
          <div className="w-2 h-2 rounded-full bg-accent-500 shrink-0" />
          <span className="text-sm font-medium text-accent-700 truncate flex-1">Both free</span>
          <div className="flex self-stretch shrink-0 w-[72px] border-l border-accent-200">
            <button
              disabled={busy === iso}
              className="self-stretch flex-1 text-accent-600 text-xs font-semibold hover:bg-accent-200"
            >
              Request
            </button>
          </div>
        </div>
      );
    }

    if (state === "confirmed") {
      const p = betweenUsMap[iso]!;
      return (
        <div key={iso} className={`${base} border-emerald-200 bg-emerald-50 ${hlCls}`}>
          <span className="text-xs text-emerald-700 w-24 shrink-0 font-semibold">{meetingTimeRange(p)}</span>
          <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
          <span className="text-sm font-medium text-emerald-900 truncate flex-1">
            Meeting with {toUserName}
          </span>
          <div className="flex self-stretch shrink-0 w-[72px] border-l border-emerald-200">
            <button
              onClick={() => {
                if (confirmingCancel === p.requestId) {
                  setConfirmingCancel(null);
                  act(p.requestId, "cancel", p.slotStart);
                } else {
                  setConfirmingCancel(p.requestId);
                }
              }}
              onBlur={() => {
                if (confirmingCancel === p.requestId) setConfirmingCancel(null);
              }}
              disabled={busy === p.requestId}
              className={`self-stretch flex-1 text-xs font-medium ${
                confirmingCancel === p.requestId
                  ? "text-stone-800 bg-stone-100 font-semibold"
                  : "text-stone-600 hover:bg-stone-50 hover:text-stone-800"
              }`}
            >
              {confirmingCancel === p.requestId ? "Sure?" : "Cancel"}
            </button>
          </div>
        </div>
      );
    }

    if (state === "pendingOutgoing") {
      const p = betweenUsMap[iso]!;
      return (
        <div key={iso} className={`${base} border-amber-200 bg-amber-50 ${hlCls}`}>
          <span className="text-xs text-amber-700 w-24 shrink-0 font-semibold">{meetingTimeRange(p)}</span>
          <div className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
          <span className="text-sm font-medium text-amber-800 truncate flex-1 text-center">Requested</span>
          <span className="text-[11px] text-amber-700/70 shrink-0 italic text-center">waiting</span>
          <div className="flex self-stretch shrink-0 w-[72px] border-l border-amber-200">
            <button
              onClick={() => {
                if (confirmingCancel === p.requestId) {
                  setConfirmingCancel(null);
                  act(p.requestId, "cancel", p.slotStart);
                } else {
                  setConfirmingCancel(p.requestId);
                }
              }}
              onBlur={() => {
                if (confirmingCancel === p.requestId) setConfirmingCancel(null);
              }}
              disabled={busy === p.requestId}
              className={`self-stretch flex-1 text-xs font-medium ${
                confirmingCancel === p.requestId
                  ? "text-red-600 bg-red-50 font-semibold"
                  : "text-amber-700/80 hover:bg-amber-100 hover:text-red-600"
              }`}
            >
              {confirmingCancel === p.requestId ? "Sure?" : "Cancel"}
            </button>
          </div>
        </div>
      );
    }

    if (state === "pendingIncoming") {
      const p = betweenUsMap[iso]!;
      return (
        <div key={iso} className={`${base} border-amber-200 bg-amber-50 ${hlCls}`}>
          <span className="text-xs text-amber-700 w-24 shrink-0 font-semibold">{meetingTimeRange(p)}</span>
          <div className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
          <span className="text-sm font-medium text-amber-900 truncate flex-1 text-center">
            {toUserName} requested
            {p.message && (
              <span title={p.message}>
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
              onClick={() => act(p.requestId, "accept", p.slotStart)}
              disabled={busy === p.requestId}
              className="self-stretch flex-1 text-emerald-600 text-xs font-semibold hover:bg-emerald-50 disabled:opacity-50"
            >
              Accept
            </button>
            <button
              onClick={() => act(p.requestId, "decline", p.slotStart)}
              disabled={busy === p.requestId}
              className="self-stretch flex-1 border-l border-amber-200 text-stone-400 text-xs font-medium hover:bg-stone-50 hover:text-stone-600 disabled:opacity-50"
            >
              Decline
            </button>
          </div>
        </div>
      );
    }

    const unavailableLabel =
      state === "myBooked"
        ? "You're unavailable"
        : state === "theirBooked"
          ? "They're unavailable"
          : state === "bothBooked"
            ? "Both unavailable"
            : "Unavailable";
    return (
      <div key={iso} className={`${base} border-stone-100 bg-stone-50 opacity-50 ${hlCls}`}>
        <span className="text-xs text-stone-400 w-16 shrink-0 font-medium">{time}</span>
        <span className="text-sm text-stone-400 truncate flex-1">{unavailableLabel}</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="text-xs text-stone-400 flex flex-wrap gap-4 pb-3 border-b border-stone-200/60">
        <span className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 bg-accent-500 rounded" />
          both free
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 bg-emerald-500 rounded" />
          confirmed
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 bg-amber-500 rounded" />
          requested
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 bg-stone-300 rounded" />
          unavailable
        </span>
        {highlightedSlots.length > 0 && (
          <span className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 ring-2 ring-amber-400 bg-amber-50 rounded" />
            designated 1:1 time
          </span>
        )}
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3">
          {error}
        </div>
      )}

      {totalAvailable === 0 && totalBetweenUs === 0 && (
        <div className="text-sm text-stone-500 bg-white rounded-md border border-stone-200 shadow-sm p-6 text-center">
          No overlapping availability right now.
          <br />
          <span className="text-xs text-stone-400">
            Check back later or update your schedule.
          </span>
        </div>
      )}

      <SlotGrid
        groups={groups}
        now={now}
        highlightedSlots={highlightedSlots}
        renderSlot={renderSlot}
        filterSlot={filterSlot}
        emptyDayMessage="No overlap"
        tabs
      />

      {confirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setConfirm(null)}
        >
          <div
            className="bg-white rounded-lg border border-stone-200 shadow-lg p-6 w-full max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-10 rounded-md bg-accent-500 flex items-center justify-center mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="white" className="w-5 h-5">
                <path d="M5.25 12a.75.75 0 0 1 .75-.75h.01a.75.75 0 0 1 .75.75v.01a.75.75 0 0 1-.75.75H6a.75.75 0 0 1-.75-.75V12ZM6 13.25a.75.75 0 0 0-.75.75v.01c0 .414.336.75.75.75h.01a.75.75 0 0 0 .75-.75V14a.75.75 0 0 0-.75-.75H6ZM7.25 12a.75.75 0 0 1 .75-.75h.01a.75.75 0 0 1 .75.75v.01a.75.75 0 0 1-.75.75H8a.75.75 0 0 1-.75-.75V12ZM8 13.25a.75.75 0 0 0-.75.75v.01c0 .414.336.75.75.75h.01a.75.75 0 0 0 .75-.75V14a.75.75 0 0 0-.75-.75H8ZM9.25 10a.75.75 0 0 1 .75-.75h.01a.75.75 0 0 1 .75.75v.01a.75.75 0 0 1-.75.75H10a.75.75 0 0 1-.75-.75V10Z" />
                <path fillRule="evenodd" d="M5.75 2a.75.75 0 0 1 .75.75V4h7V2.75a.75.75 0 0 1 1.5 0V4h.25A2.75 2.75 0 0 1 18 6.75v8.5A2.75 2.75 0 0 1 15.25 18H4.75A2.75 2.75 0 0 1 2 15.25v-8.5A2.75 2.75 0 0 1 4.75 4H5V2.75A.75.75 0 0 1 5.75 2Zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75Z" clipRule="evenodd" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-stone-900 mb-1">Request 1:1</h3>
            <p className="text-sm text-stone-500 mb-4">
              Meet with <span className="font-semibold text-stone-700">{toUserName}</span> on{" "}
              <span className="font-semibold text-stone-700">{formatSlotDay(new Date(confirm))}</span>{" "}
              from{" "}
              <span className="font-semibold text-stone-700">
                {formatSlotTimeRange(
                  new Date(confirm),
                  new Date(new Date(confirm).getTime() + MEETING_DURATION_MINUTES * 60 * 1000),
                )}
              </span>?
            </p>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">
              Message <span className="font-normal text-stone-400">(optional)</span>
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              placeholder="Say what you'd like to chat about..."
              className="w-full border border-stone-200 rounded-md px-3 py-2 text-sm bg-stone-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent-500/20 focus:border-accent-500 mb-5"
            />
            <div className="flex gap-2.5 justify-end">
              <button
                onClick={() => {
                  setConfirm(null);
                  setMessage("");
                }}
                className="px-4 py-2 text-sm font-medium border border-stone-200 rounded-md hover:bg-stone-50 text-stone-600"
              >
                Cancel
              </button>
              <button
                onClick={() => request(confirm, message)}
                disabled={busy === confirm}
                className="px-4 py-2 text-sm font-semibold bg-accent-500 text-white rounded-md hover:bg-accent-600 disabled:opacity-50"
              >
                {busy === confirm ? "Sending..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
