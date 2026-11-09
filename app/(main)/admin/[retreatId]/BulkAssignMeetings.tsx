"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { textFromHtmlTable } from "../../../pasteTable";
import { formatSlotDay, formatSlotTime } from "@/lib/format";

type PreviewRow = {
  fromName: string;
  toName: string;
  fromUserId: string | null;
  toUserId: string | null;
  status: "ok" | "error";
  reason?: string;
};

type ApplyResult = { fromName: string; toName: string; ok: boolean; error?: string };

export default function BulkAssignMeetings({
  retreatId,
  slotGroups,
}: {
  retreatId: string;
  slotGroups: Record<string, string[]>;
}) {
  const router = useRouter();
  const days = Object.keys(slotGroups).sort();
  const [slot, setSlot] = useState("");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [results, setResults] = useState<ApplyResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const html = e.clipboardData.getData("text/html");
    if (!html) return;
    const rebuilt = textFromHtmlTable(html);
    if (!rebuilt) return;
    e.preventDefault();
    setText(rebuilt);
  }

  async function handlePreview() {
    if (!slot) {
      setError("Pick a time slot first.");
      return;
    }
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch(`/api/admin/${retreatId}/bulk-schedule/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotStart: slot, text }),
      });
      if (!res.ok) throw new Error("Failed to preview.");
      const data: { rows: PreviewRow[] } = await res.json();
      setPreview(data.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to preview.");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    if (!preview) return;
    const okPairs = preview.filter((r) => r.status === "ok");
    if (okPairs.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/${retreatId}/bulk-schedule/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slotStart: slot,
          pairs: okPairs.map((r) => ({
            fromUserId: r.fromUserId,
            toUserId: r.toUserId,
            fromName: r.fromName,
            toName: r.toName,
          })),
        }),
      });
      if (!res.ok) throw new Error("Failed to assign meetings.");
      const data: { results: ApplyResult[] } = await res.json();
      setResults(data.results);
      setPreview(null);
      setText("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign meetings.");
    } finally {
      setLoading(false);
    }
  }

  const okCount = preview?.filter((r) => r.status === "ok").length ?? 0;
  const errorCount = (preview?.length ?? 0) - okCount;

  return (
    <div className="space-y-3">
      <p className="text-xs text-stone-500 leading-relaxed">
        Pick one time slot, then paste two columns from a spreadsheet — Person A, Person B — one pair per row. Everyone in the list gets paired with their partner at that same slot.
      </p>

      <div>
        <label className="block text-xs font-semibold text-stone-600 mb-1">Time slot</label>
        <select
          value={slot}
          onChange={(e) => {
            setSlot(e.target.value);
            setPreview(null);
            setResults(null);
          }}
          className="w-full border border-stone-200 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent-500/20 focus:border-accent-500"
        >
          <option value="">Select a time…</option>
          {days.map((day) => (
            <optgroup key={day} label={formatSlotDay(new Date(day + "T00:00:00Z"))}>
              {slotGroups[day].map((iso) => (
                <option key={iso} value={iso}>
                  {formatSlotTime(new Date(iso))}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={handlePaste}
        rows={8}
        placeholder={"Jane Doe\tJohn Smith\nAlice Lee\tBob Chen"}
        className="w-full border border-stone-200 rounded-md px-3 py-2 text-xs font-mono bg-stone-50/50 focus:outline-none focus:ring-2 focus:ring-accent-500/20 focus:border-accent-500"
      />

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3">{error}</div>
      )}

      {results && (
        <div className="rounded-md border border-stone-200 bg-stone-50/60 p-4 space-y-2">
          <div className="text-sm text-stone-700">
            <span className="font-semibold text-emerald-600">{results.filter((r) => r.ok).length}</span> assigned
            {results.some((r) => !r.ok) && (
              <>
                , <span className="font-semibold text-red-600">{results.filter((r) => !r.ok).length}</span> failed
              </>
            )}
          </div>
          {results.filter((r) => !r.ok).map((r, i) => (
            <div key={i} className="text-xs text-red-600">
              {r.fromName} ↔ {r.toName}: {r.error}
            </div>
          ))}
        </div>
      )}

      {!preview && (
        <button
          type="button"
          onClick={handlePreview}
          disabled={loading || !text.trim() || !slot}
          className="bg-accent-500 text-white rounded-md px-4 py-2 text-sm font-semibold hover:bg-accent-600 disabled:opacity-60"
        >
          {loading ? "Previewing…" : "Preview"}
        </button>
      )}

      {preview && (
        <div className="space-y-3 rounded-md border border-stone-200 bg-stone-50/60 p-4">
          <div className="text-sm text-stone-700">
            <span className="font-semibold text-emerald-600">{okCount}</span> ready
            {errorCount > 0 && (
              <>
                , <span className="font-semibold text-red-600">{errorCount}</span> have a problem and will be skipped
              </>
            )}
          </div>
          <div className="rounded-md border border-stone-200 bg-white divide-y divide-stone-100 max-h-72 overflow-y-auto">
            {preview.map((r, i) => (
              <div key={i} className="px-3 py-2 text-sm flex items-center justify-between gap-3">
                <span className={r.status === "ok" ? "text-stone-700" : "text-red-600"}>
                  {r.fromName} ↔ {r.toName}
                </span>
                {r.status === "error" && <span className="text-xs text-red-500 shrink-0">{r.reason}</span>}
              </div>
            ))}
          </div>
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => setPreview(null)}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium border border-stone-200 rounded-md hover:bg-stone-50 text-stone-600 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={loading || okCount === 0}
              className="bg-accent-500 text-white rounded-md px-4 py-2 text-sm font-semibold hover:bg-accent-600 disabled:opacity-60"
            >
              {loading ? "Assigning…" : `Assign ${okCount} ${okCount === 1 ? "meeting" : "meetings"}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
