"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type ParsedProfileRow = {
  name: string;
  pronouns?: string;
  school?: string;
  bio?: string;
  canHelpWith?: string;
  canBeHelpedWith?: string;
  keyCrux?: string;
  personalLink?: string;
};

type Preview = {
  rows: ParsedProfileRow[];
  newCount: number;
  updateCount: number;
  toRemove: { id: string; name: string }[];
};

// Google Sheets puts an HTML <table> on the clipboard alongside plain text.
// The plain-text version doesn't reliably quote a cell's internal line breaks,
// so a multi-line cell can get mistaken for several new rows. The HTML table's
// <tr>/<td> boundaries are unambiguous, so rebuild the pasted text from that:
// real tabs between cells, real newlines between rows, and the Unicode
// line-separator code point standing in for a line break that happened
// *inside* one cell (unescaped back to "\n" server-side, see lib/profileImport.ts).
const CELL_NEWLINE = String.fromCharCode(8232);

function textFromHtmlTable(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table");
  if (!table) return null;
  const rows = Array.from(table.querySelectorAll("tr"));
  if (rows.length === 0) return null;
  const collapseRuns = new RegExp(CELL_NEWLINE + "+", "g");
  const trimEdges = new RegExp("^" + CELL_NEWLINE + "|" + CELL_NEWLINE + "$", "g");
  return rows
    .map((tr) =>
      Array.from(tr.querySelectorAll("td,th"))
        .map((cell) => {
          const clone = cell.cloneNode(true) as HTMLElement;
          clone.querySelectorAll("br").forEach((br) => br.replaceWith(CELL_NEWLINE));
          clone.querySelectorAll("div,p").forEach((el) => {
            el.prepend(CELL_NEWLINE);
          });
          return (clone.textContent || "")
            .replace(collapseRuns, CELL_NEWLINE)
            .replace(trimEdges, "")
            .trim();
        })
        .join("\t"),
    )
    .join("\n");
}

export default function ImportProfiles({ retreatId }: { retreatId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [keep, setKeep] = useState<Set<string>>(new Set());
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
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/${retreatId}/profiles/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error("Failed to preview import.");
      const data: Preview = await res.json();
      setPreview(data);
      setKeep(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to preview import.");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    if (!preview) return;
    setLoading(true);
    setError(null);
    try {
      const removeIds = preview.toRemove.filter((p) => !keep.has(p.id)).map((p) => p.id);
      const res = await fetch(`/api/admin/${retreatId}/profiles/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: preview.rows, removeIds }),
      });
      if (!res.ok) throw new Error("Failed to import.");
      setText("");
      setPreview(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import.");
    } finally {
      setLoading(false);
    }
  }

  function toggleKeep(id: string) {
    setKeep((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-stone-500 leading-relaxed">
        Select a range in Google Sheets, copy, and paste directly below — multi-line cells and blank (unanswered) cells are handled automatically. Columns, in order:
        <br />
        <span className="font-mono text-[11px] text-stone-600">
          Name, Pronouns, School, Bio, I can help others with…, Other people can help me with…, Key crux, Personal link
        </span>
        <br />
        A header row is fine, it&apos;s skipped automatically. Re-pasting a name updates their profile instead of duplicating them.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={handlePaste}
        rows={8}
        placeholder="Paste rows copied from Google Sheets here"
        className="w-full border border-stone-200 rounded-md px-3 py-2 text-xs font-mono bg-stone-50/50 focus:outline-none focus:ring-2 focus:ring-accent-500/20 focus:border-accent-500"
      />

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3">{error}</div>
      )}

      {!preview && (
        <button
          type="button"
          onClick={handlePreview}
          disabled={loading || !text.trim()}
          className="bg-accent-500 text-white rounded-md px-4 py-2 text-sm font-semibold hover:bg-accent-600 disabled:opacity-60"
        >
          {loading ? "Previewing…" : "Preview import"}
        </button>
      )}

      {preview && (
        <div className="space-y-3 rounded-md border border-stone-200 bg-stone-50/60 p-4">
          <div className="text-sm text-stone-700">
            <span className="font-semibold">{preview.newCount}</span> new,{" "}
            <span className="font-semibold">{preview.updateCount}</span> updated
            {preview.toRemove.length > 0 && (
              <>
                ,{" "}
                <span className="font-semibold text-red-600">{preview.toRemove.length}</span> not in this paste
              </>
            )}
          </div>

          {preview.toRemove.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md p-2.5 leading-relaxed">
                These people aren&apos;t in this paste and will be <strong>removed</strong> from the roster unless you check &quot;Keep&quot; next to their name.
              </p>
              <div className="rounded-md border border-stone-200 bg-white divide-y divide-stone-100 max-h-56 overflow-y-auto">
                {preview.toRemove.map((p) => (
                  <label key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-stone-50">
                    <span className={keep.has(p.id) ? "text-stone-700" : "text-red-600 line-through"}>
                      {p.name}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-stone-500 shrink-0">
                      <input
                        type="checkbox"
                        checked={keep.has(p.id)}
                        onChange={() => toggleKeep(p.id)}
                        className="rounded border-stone-300"
                      />
                      Keep
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

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
              disabled={loading}
              className="bg-accent-500 text-white rounded-md px-4 py-2 text-sm font-semibold hover:bg-accent-600 disabled:opacity-60"
            >
              {loading ? "Importing…" : "Confirm import"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
