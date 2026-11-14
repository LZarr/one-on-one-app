export type AgendaItem = {
  date: string;
  startTime: string;
  endTime: string;
  title: string;
  subtitle: string | null;
};

export type AgendaCategory = "meal" | "oneOnOne" | "other";

export function categorizeAgendaItem(title: string): AgendaCategory {
  const t = title.toLowerCase();
  if (/breakfast|lunch|dinner|social time/.test(t)) return "meal";
  if (/1:1/.test(t)) return "oneOnOne";
  return "other";
}

export const AGENDA_CATEGORY_STYLES: Record<AgendaCategory, { bg: string; text: string }> = {
  meal: { bg: "bg-[#E6F4F3]", text: "text-[#3c6b67]" },
  oneOnOne: { bg: "bg-[#BCE0E3]", text: "text-[#1f5457]" },
  other: { bg: "bg-[#A8CED1]", text: "text-[#1f4345]" },
};

// Keep a long talk's row to one line: fall back to "Talk: <speaker>" when the full
// title + speaker wouldn't fit, rather than letting the block grow taller to wrap.
const FULL_LABEL_MAX_CHARS = 42;

export function agendaItemLabel(title: string, subtitle: string | null): string {
  const full = subtitle ? `${title} (${subtitle})` : title;
  if (full.length > FULL_LABEL_MAX_CHARS && subtitle && /^talk:/i.test(title)) {
    return `Talk: ${subtitle}`;
  }
  return full;
}
