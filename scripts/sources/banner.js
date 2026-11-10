import { load } from "cheerio";
export const BASE = "https://selfservice.banner.vt.edu/ssb/";
export const clean = (s) =>
  s
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
export function discover(html, term) {
  const $ = load(html);
  const terms = $("select[name=TERMYEAR] option")
    .map((i, e) => ({ code: $(e).attr("value"), name: clean($(e).text()) }))
    .get()
    .filter((t) => !t.name.includes("Select"));
  const chosen = terms.find((t) => t.code === term);
  if (!chosen) throw new Error(`Term ${term} is not offered by Banner`);
  const section = html.split(`case "${term}" :`)[1]?.split(/\bbreak\s*;/)[0];
  const subjects = [
    ...new Set(
      [...(section || "").matchAll(/new Option\("[^"\n]*","([A-Z]+)"/g)].map(
        (m) => m[1],
      ),
    ),
  ];
  if (!subjects.length)
    throw new Error("Banner subject list missing or changed");
  return { ...chosen, subjects };
}
export function buildingNames(html) {
  const $ = load(html),
    result = new Map();
  for (const row of $("tr")) {
    const c = $(row)
      .children("td")
      .map((i, e) => clean($(e).text()))
      .get();
    if (c.length === 2 && /^[A-Z][A-Z\d ]{0,8}$/.test(c[0]) && c[1])
      result.set(c[0], c[1]);
  }
  if (!result.has("AA") || result.size < 20)
    throw new Error("Building directory missing or changed");
  return result;
}
export function clock(value) {
  const m = value.match(/^(\d{1,2}):(\d{2})(AM|PM)$/i);
  if (!m || +m[1] < 1 || +m[1] > 12 || +m[2] > 59)
    throw new Error(`Invalid Banner time: ${value}`);
  return (+m[1] % 12) * 60 + +m[2] + (m[3].toUpperCase() === "PM" ? 720 : 0);
}
export function parseTimetable(html, subject, termName) {
  const $ = load(html),
    table = $("table.dataentrytable");
  if (!table.length) {
    if (/NO SECTIONS FOUND FOR THIS INQUIRY\./.test($.text()))
      return { sections: [], meetings: [], skipped: 0, unknownLocations: [] };
    throw new Error(
      `${subject}: no timetable table (source error or markup change)`,
    );
  }
  if (!clean($.text()).includes(`Term: ${termName}`))
    throw new Error(`${subject}: wrong or missing term confirmation`);
  const sections = [],
    meetings = [],
    unknownLocations = [];
  let current = null,
    skipped = 0;
  const uncertain = (location) => {
    if (location && !["TBA", "ONLINE"].includes(location))
      unknownLocations.push({ location, crn: current.crn });
  };
  for (const row of table.find("tr")) {
    const cells = $(row)
      .children("td")
      .map((i, e) => clean($(e).text()))
      .get();
    if (!cells.length) continue;
    if (
      cells[0].startsWith("CRN") &&
      cells.some((c) => c.startsWith("Location"))
    )
      continue;
    if (cells.length === 2 && /Comments for CRN/.test(cells[0])) {
      if (current) current.comments += " " + cells[1];
      continue;
    }
    let values;
    if (/^\d{5}$/.test(cells[0])) {
      if (!cells[1].startsWith(subject + "-"))
        throw new Error(`${subject}: unexpected course ${cells[1]}`);
      current = {
        crn: cells[0],
        course: cells[1],
        title: cells[2],
        comments: "",
      };
      sections.push(current);
      if (cells.length === 8) {
        skipped++;
        continue;
      }
      if (cells.length === 13) values = cells.slice(8, 12);
      else if (cells.length === 12 && cells.some((c) => c.includes("(ARR)"))) {
        uncertain(cells[10]);
        skipped++;
        continue;
      } else
        throw new Error(
          `${subject} ${current.crn}: unexpected section shape (${cells.length})`,
        );
    } else if (cells.includes("* Additional Times *")) {
      if (!current) throw new Error(`${subject}: orphan additional meeting`);
      const i = cells.indexOf("* Additional Times *");
      values = cells.slice(i + 1, i + 5);
      if (values.some((c) => c.includes("(ARR)"))) {
        uncertain(values[2]);
        skipped++;
        continue;
      }
    } else
      throw new Error(
        `${subject}: unrecognized timetable row ${JSON.stringify(cells)}`,
      );
    const [days, start, end, location] = values;
    if (location === "TBA" || location === "ONLINE" || days === "(ARR)") {
      skipped++;
      continue;
    }
    const loc = location.match(/^(.+)\s+(\S+)$/);
    if (!loc) throw new Error(`${subject}: invalid room ${location}`);
    const letters = days.replace(/\s/g, "");
    if (!/^[UMTWRFS]+$/.test(letters))
      throw new Error(`${subject}: invalid days ${days}`);
    const a = clock(start),
      b = clock(end);
    if (a >= b)
      throw new Error(
        `${subject}: overnight/invalid meeting needs explicit handling`,
      );
    meetings.push({
      section: current,
      building: loc[1],
      room: loc[2],
      start: a,
      end: b,
      days: [...letters].map((d) => "UMTWRFS".indexOf(d)),
    });
  }
  if (!sections.length)
    throw new Error(
      `${subject}: empty table without explicit no-results message`,
    );
  return { sections, meetings, skipped, unknownLocations };
}
export function parseCalendar(html, name) {
  const $ = load(html),
    heading = $("h2")
      .filter((i, e) => clean($(e).text()) === name)
      .first();
  const year = Number(name.match(/\d{4}/)?.[0]);
  if (!heading.length || !/^Fall|^Spring/.test(name))
    throw new Error(`Unsupported or missing academic calendar for ${name}`);
  const date = (text) => {
    const d = new Date(`${clean(text)} ${year} 12:00:00 GMT`);
    if (!Number.isFinite(d.getTime()))
      throw new Error(`Unrecognized academic calendar date: ${text}`);
    return d.toISOString().slice(0, 10);
  };
  let start, end, breakStart;
  const excludeDates = [];
  for (const row of heading.nextAll("table").first().find("tr")) {
    const cells = $(row)
      .children("td")
      .map((i, e) => clean($(e).text()))
      .get();
    if (cells.length !== 2) continue;
    const [when, event] = cells;
    if (/^Classes Begin$/i.test(event)) start = date(when);
    if (/^Classes End$/i.test(event)) end = date(when);
    if (/No Classes/i.test(event)) excludeDates.push(date(when));
    if (/break begins/i.test(event)) breakStart = date(when);
    if (/break ends/i.test(event)) {
      if (!breakStart) throw new Error("Break end without start");
      const until = date(when);
      for (
        let d = breakStart;
        d <= until;
        d = new Date(Date.parse(d + "T12:00:00Z") + 86400000)
          .toISOString()
          .slice(0, 10)
      )
        excludeDates.push(d);
      breakStart = null;
    }
  }
  if (!start || !end || start > end || breakStart)
    throw new Error("Incomplete academic calendar");
  return { start, end, excludeDates: [...new Set(excludeDates)].sort() };
}
export function parseSectionDates(data, term) {
  if (
    data.srcdb !== term ||
    !Array.isArray(data.results) ||
    data.count !== data.results.length ||
    !data.count
  )
    throw new Error("Incomplete section-date metadata");
  const map = new Map();
  for (const r of data.results) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(r.start_date) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(r.end_date) ||
      r.start_date > r.end_date
    )
      throw new Error(`Invalid dates for ${r.crn}`);
    map.set(r.crn, r);
  }
  return map;
}
export function buildSnapshot({
  term,
  calendar,
  names,
  dates,
  pages,
  fetchedAt,
  calendarURL,
}) {
  const buildings = new Map(),
    issues = [];
  let sectionCount = 0,
    meetingCount = 0,
    skipped = 0;
  for (const page of pages) {
    sectionCount += page.sections.length;
    skipped += page.skipped;
    for (const m of page.meetings) {
      const meta = dates.get(m.section.crn);
      if (!meta) throw new Error(`Missing section dates: ${m.section.crn}`);
      if (meta.isCancelled) continue;
      const from = [calendar.start, meta.start_date].sort().at(-1),
        through = [calendar.end, meta.end_date].sort()[0];
      if (from > through) continue;
      if (!names.has(m.building))
        throw new Error(`Unrecognized building: ${m.building}`);
      if (!buildings.has(m.building))
        buildings.set(m.building, {
          code: m.building,
          name: names.get(m.building),
          rooms: [],
        });
      const b = buildings.get(m.building);
      let room = b.rooms.find((r) => r.number === m.room);
      if (!room) {
        room = {
          number: m.room,
          capacity: null,
          attributes: [],
          coverage: { start: calendar.start, end: calendar.end },
          blocks: [],
        };
        b.rooms.push(room);
      }
      // Notes can narrow meeting dates beyond the machine-readable section dates.
      // Preserve that uncertainty instead of asserting an exact daily schedule.
      if (
        /\b(?:\d{1,2}\/\d{1,2}|meet(?:s|ing)?\s+(?:only|on)|alternate|alternating)\b/i.test(
          m.section.comments,
        )
      ) {
        room.coverage = null;
        issues.push({
          crn: m.section.crn,
          building: m.building,
          room: m.room,
          reason: "Meeting-specific notes require review",
        });
      }
      const block = {
        start: m.start,
        end: m.end,
        days: m.days,
        from,
        through,
        excludeDates: calendar.excludeDates,
        kind: "class",
        title: `${m.section.course} · ${m.section.title}`,
        crn: m.section.crn,
      };
      if (!room.blocks.some((b) => JSON.stringify(b) === JSON.stringify(block)))
        room.blocks.push(block);
      meetingCount++;
    }
  }
  for (const page of pages)
    for (const item of page.unknownLocations || []) {
      const exact = [...buildings.keys()]
        .filter(
          (code) =>
            item.location === code || item.location.startsWith(code + " "),
        )
        .sort((a, b) => b.length - a.length)[0];
      if (!exact) continue;
      const b = buildings.get(exact),
        number = item.location.slice(exact.length).trim();
      for (const room of b.rooms)
        if (!number || room.number === number) {
          room.coverage = null;
          issues.push({
            building: exact,
            room: room.number,
            crn: item.crn,
            reason: "Arranged meeting time in a physical location",
          });
        }
    }
  if (!meetingCount)
    throw new Error("No physical meetings found; refusing to replace data");
  return {
    version: 1,
    timezone: "America/New_York",
    archived: false,
    scheduleScope: "classes",
    term: term.name,
    termCode: term.code,
    fetchedAt,
    source: BASE + "HZSKVTSC.P_DispRequest",
    sources: [
      BASE + "HZSKVTSC.P_DispRequest",
      "https://classes.vt.edu/",
      calendarURL,
    ],
    buildings: [...buildings.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    issues,
    stats: {
      subjects: pages.length,
      sections: sectionCount,
      meetings: meetingCount,
      unlocatedOrArranged: skipped,
    },
  };
}
