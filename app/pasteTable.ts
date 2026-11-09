// Google Sheets puts an HTML <table> on the clipboard alongside plain text.
// The plain-text version doesn't reliably quote a cell's internal line breaks,
// so a multi-line cell can get mistaken for several new rows. The HTML table's
// <tr>/<td> boundaries are unambiguous, so rebuild the pasted text from that:
// real tabs between cells, real newlines between rows, and the Unicode
// line-separator code point standing in for a line break that happened
// *inside* one cell (unescaped back to "\n" server-side, see lib/profileImport.ts).
// Browser-only (uses DOMParser) -- only call this from a client component.
export const CELL_NEWLINE = String.fromCharCode(8232);

export function textFromHtmlTable(html: string): string | null {
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
