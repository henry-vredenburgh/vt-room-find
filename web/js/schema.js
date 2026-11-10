// Shared by the browser and importer. Reject ambiguous or partial schedules.
export function validateSnapshot(data) {
  const fail = (message) => {
    throw new Error(`Invalid snapshot: ${message}`);
  };
  const date = (value) =>
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value + "T12:00:00Z").toISOString().slice(0, 10) === value;
  const text = (value) => typeof value === "string" && value.trim().length > 0;
  if (
    !data ||
    data.version !== 1 ||
    data.timezone !== "America/New_York" ||
    typeof data.archived !== "boolean"
  )
    fail("version, timezone, or archive flag");
  if (!text(data.source) || !text(data.term)) fail("source and term required");
  if (
    !data.archived &&
    (!text(data.fetchedAt) ||
      !/(Z|[+-]\d\d:\d\d)$/.test(data.fetchedAt) ||
      !Number.isFinite(Date.parse(data.fetchedAt)))
  )
    fail("fetchedAt must include a timezone");
  if (!Array.isArray(data.buildings) || !data.buildings.length)
    fail("buildings required");
  if (
    data.scheduleScope !== undefined &&
    !["classes", "complete"].includes(data.scheduleScope)
  )
    fail("schedule scope");
  const codes = new Set();
  for (const b of data.buildings) {
    if (
      !text(b.code) ||
      !text(b.name) ||
      codes.has(b.code) ||
      !Array.isArray(b.rooms)
    )
      fail("building identity or rooms");
    codes.add(b.code);
    if (
      (b.latitude != null &&
        (!Number.isFinite(b.latitude) || Math.abs(b.latitude) > 90)) ||
      (b.longitude != null &&
        (!Number.isFinite(b.longitude) || Math.abs(b.longitude) > 180))
    )
      fail("coordinates");
    const numbers = new Set();
    for (const room of b.rooms) {
      if (!text(room.number) || numbers.has(room.number))
        fail("duplicate or missing room number");
      numbers.add(room.number);
      if (
        room.capacity !== null &&
        (!Number.isInteger(room.capacity) || room.capacity < 0)
      )
        fail("capacity");
      if (
        !Array.isArray(room.attributes) ||
        !room.attributes.every(text) ||
        !Array.isArray(room.blocks)
      )
        fail("attributes or blocks");
      if (
        room.coverage !== null &&
        (!room.coverage ||
          !date(room.coverage.start) ||
          !date(room.coverage.end) ||
          room.coverage.start > room.coverage.end)
      )
        fail("coverage");
      for (const block of room.blocks) {
        if (
          block.excludeDates !== undefined &&
          (!Array.isArray(block.excludeDates) ||
            !block.excludeDates.every(date))
        )
          fail("excluded dates");
        if (
          !Number.isInteger(block.start) ||
          !Number.isInteger(block.end) ||
          block.start < 0 ||
          block.end > 1440 ||
          block.start >= block.end
        )
          fail("block time; split overnight bookings at midnight");
        if (
          !date(block.from) ||
          !date(block.through) ||
          block.from > block.through
        )
          fail("block dates");
        if (
          !Array.isArray(block.days) ||
          !block.days.length ||
          !block.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        )
          fail("block weekdays");
        if (!["class", "event"].includes(block.kind) || !text(block.title))
          fail("block kind or title");
      }
    }
  }
  return data;
}
