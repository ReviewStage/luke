const SEARCH_DAYS = 366;

const WILDCARD = "*";

function fieldOf(text: string, min: number, max: number): number | "any" | undefined {
  if (text === WILDCARD) return "any";
  if (!/^\d{1,2}$/.test(text)) return undefined;
  const value = Number(text);
  return value >= min && value <= max ? value : undefined;
}

export function oneShotDueAt(schedule: string, now: Date): Date | undefined {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return undefined;
  const [minuteText, hourText, dayText, monthText, weekdayText] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];
  const minute = fieldOf(minuteText, 0, 59);
  const hour = fieldOf(hourText, 0, 23);
  const day = fieldOf(dayText, 1, 31);
  const month = fieldOf(monthText, 1, 12);
  if (typeof minute !== "number" || typeof hour !== "number") return undefined;
  if (day === undefined || month === undefined || weekdayText !== WILDCARD) return undefined;
  for (let offset = 0; offset <= SEARCH_DAYS; offset += 1) {
    const candidate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + offset,
      hour,
      minute,
    );
    const dayMatches = day === "any" || candidate.getDate() === day;
    const monthMatches = month === "any" || candidate.getMonth() + 1 === month;
    if (dayMatches && monthMatches && candidate.getTime() > now.getTime()) return candidate;
  }
  return undefined;
}
