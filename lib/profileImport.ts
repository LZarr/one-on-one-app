import { parseTsv } from "./tsv";

export type ParsedProfileRow = {
  name: string;
  pronouns?: string;
  school?: string;
  bio?: string;
  canHelpWith?: string;
  canBeHelpedWith?: string;
  keyCrux?: string;
  personalLink?: string;
};

// A line break that happened *inside* a spreadsheet cell gets encoded as the
// Unicode line-separator code point (via the client's HTML-table paste
// reconstruction in ImportProfiles.tsx) so it survives being on the same
// textarea line as other cells without being mistaken for a new row/person.
// Convert it back to a real newline before the value is stored anywhere.
export const CELL_NEWLINE = String.fromCharCode(8232);

function unescapeCell(value: string): string {
  return value.split(CELL_NEWLINE).join("\n").trim();
}

function fieldsFromCols(cols: string[]): Omit<ParsedProfileRow, "name"> {
  const fields: Omit<ParsedProfileRow, "name"> = {};
  if (cols[1]) fields.pronouns = unescapeCell(cols[1]);
  if (cols[2]) fields.school = unescapeCell(cols[2]);
  if (cols[3]) fields.bio = unescapeCell(cols[3]);
  if (cols[4]) fields.canHelpWith = unescapeCell(cols[4]);
  if (cols[5]) fields.canBeHelpedWith = unescapeCell(cols[5]);
  if (cols[6]) fields.keyCrux = unescapeCell(cols[6]);
  if (cols[7]) fields.personalLink = unescapeCell(cols[7]);
  return fields;
}

export function parseProfileRows(text: string): ParsedProfileRow[] {
  return parseTsv(text)
    .map((cols) => cols.map((c) => c.trim()))
    .filter((cols) => cols[0] && cols[0].toLowerCase() !== "name")
    .map((cols) => ({
      name: unescapeCell(cols[0]),
      ...fieldsFromCols(cols),
    }));
}
