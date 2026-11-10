export const TIMEZONE = "America/New_York";
export function campusDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export const minutes = (value) => {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
};
export function timeLabel(value) {
  if (value === 1440) return "12 AM (next day)";
  return `${Math.floor(value / 60) % 12 || 12}:${String(value % 60).padStart(2, "0")} ${value < 720 ? "AM" : "PM"}`;
}
export function known(data, room, date, now = new Date()) {
  const age = now.getTime() - Date.parse(data.fetchedAt);
  return (
    !data.archived &&
    Number.isFinite(age) &&
    age >= 0 &&
    age <= 86400000 &&
    room.coverage &&
    room.coverage.start <= date &&
    room.coverage.end >= date
  );
}
export function blocksForDay(room, date) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return room.blocks
    .filter(
      (b) =>
        b.from <= date &&
        b.through >= date &&
        b.days.includes(day) &&
        !(b.excludeDates || []).includes(date),
    )
    .sort((a, b) => a.start - b.start);
}
export const overlaps = (start, end, block) =>
  start < block.end && end > block.start;
export function segments(room, date) {
  const merged = [];
  for (const b of blocksForDay(room, date)) {
    const last = merged.at(-1);
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
    else merged.push({ start: b.start, end: b.end });
  }
  const result = [];
  let cursor = 0;
  for (const b of merged) {
    if (b.start > cursor)
      result.push({ start: cursor, end: b.start, busy: false });
    result.push({ ...b, busy: true });
    cursor = b.end;
  }
  if (cursor < 1440) result.push({ start: cursor, end: 1440, busy: false });
  return result;
}
export function status(data, room, date, start, end, now) {
  if (!known(data, room, date, now)) return "unknown";
  return blocksForDay(room, date).some((b) => overlaps(start, end, b))
    ? "busy"
    : data.scheduleScope === "classes"
      ? "unbooked"
      : "free";
}
