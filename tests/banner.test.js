import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  parseTimetable,
  parseCalendar,
  parseSectionDates,
  buildSnapshot,
  clock,
  discover,
} from "../scripts/sources/banner.js";
import { status, blocksForDay } from "../web/js/availability.js";
import { validateSnapshot } from "../web/js/schema.js";
const html = fs.readFileSync(
  new URL("./fixtures/banner.html", import.meta.url),
  "utf8",
);
const calendarHTML = fs.readFileSync(
  new URL("./fixtures/calendar.html", import.meta.url),
  "utf8",
);
const calendar = parseCalendar(calendarHTML, "Fall 2026");
const page = parseTimetable(html, "ARCH", "Fall 2026");
const meta = {
  crn: "81064",
  start_date: "2026-09-01",
  end_date: "2026-12-16",
  isCancelled: "",
};
function snapshot() {
  return buildSnapshot({
    term: { code: "202609", name: "Fall 2026" },
    calendar,
    names: new Map([
      ["CO", "Cowgill Hall"],
      ["HAN", "Hancock Hall"],
    ]),
    dates: new Map([[meta.crn, meta]]),
    pages: [page],
    fetchedAt: "2026-11-10T15:00:00Z",
    calendarURL: "https://www.registrar.vt.edu/",
  });
}
test("current Banner format handles extra modality column, continuation meetings and online ARR", () => {
  assert.equal(page.sections.length, 2);
  assert.equal(page.meetings.length, 2);
  assert.equal(page.skipped, 1);
  assert.equal(page.meetings[0].room, "102");
  assert.deepEqual(page.meetings[0].days, [1, 3, 5]);
  assert.equal(page.meetings[0].start, 805);
  assert.equal(page.meetings[1].section.crn, "81064");
  assert.equal(page.meetings[1].building, "HAN");
  assert.equal(clock("12:00AM"), 0);
  assert.equal(clock("12:30PM"), 750);
});
test("official calendar excludes Labor Day, Fall Break and all Thanksgiving break days", () => {
  assert.equal(calendar.start, "2026-08-24");
  assert.equal(calendar.end, "2026-12-09");
  assert.equal(calendar.excludeDates.length, 11);
  assert.ok(calendar.excludeDates.includes("2026-11-27"));
});
test("class-only snapshot respects section dates, holidays, finals boundary, and never claims available", () => {
  const data = validateSnapshot(snapshot()),
    room = data.buildings.find((b) => b.code === "CO").rooms[0];
  assert.equal(room.capacity, null);
  assert.equal(room.blocks[0].from, "2026-09-01");
  assert.equal(room.blocks[0].through, "2026-12-09");
  assert.equal(blocksForDay(room, "2026-11-23").length, 0);
  assert.equal(blocksForDay(room, "2026-11-16").length, 1);
  assert.equal(blocksForDay(room, "2026-12-14").length, 0);
  assert.equal(
    status(data, room, "2026-11-10", 600, 660, new Date(data.fetchedAt)),
    "unbooked",
  );
  assert.equal(
    status(data, room, "2026-11-11", 805, 900, new Date(data.fetchedAt)),
    "busy",
  );
  assert.equal(
    status(
      data,
      room,
      "2026-11-10",
      600,
      660,
      new Date("2026-11-12T15:00:00Z"),
    ),
    "unknown",
  );
});
test("markup errors, wrong terms, invalid times, and truncated metadata fail closed", () => {
  assert.throws(() =>
    parseTimetable("<html>Login</html>", "ARCH", "Fall 2026"),
  );
  assert.throws(() => parseTimetable(html, "ARCH", "Spring 2027"));
  assert.throws(() =>
    parseTimetable(html.replace("1:25PM", "bad-time"), "ARCH", "Fall 2026"),
  );
  assert.throws(() =>
    parseSectionDates({ srcdb: "202609", count: 2, results: [meta] }, "202609"),
  );
  assert.throws(() =>
    parseCalendar(
      calendarHTML.replace("Classes End", "End removed"),
      "Fall 2026",
    ),
  );
});
test("subject discovery uses the requested term and does not execute source JavaScript", () => {
  const html =
    '<select name="TERMYEAR"><option value="202609">Fall 2026</option></select><script>case "202609" : document.x=new Option("Architecture","ARCH",false,false); break;</script>';
  assert.deepEqual(discover(html, "202609").subjects, ["ARCH"]);
  assert.throws(() => discover(html, "202701"));
});

test("arranged physical meetings remove class-gap coverage", () => {
  const input = {
    ...page,
    unknownLocations: [{ location: "CO 102", crn: "81064" }],
  };
  const data = buildSnapshot({
    term: { code: "202609", name: "Fall 2026" },
    calendar,
    names: new Map([
      ["CO", "Cowgill"],
      ["HAN", "Hancock"],
    ]),
    dates: new Map([[meta.crn, meta]]),
    pages: [input],
    fetchedAt: "2026-11-10T15:00:00Z",
    calendarURL: "https://www.registrar.vt.edu/",
  });
  assert.equal(
    data.buildings.find((b) => b.code === "CO").rooms[0].coverage,
    null,
  );
  assert.equal(
    data.buildings.find((b) => b.code === "HAN").rooms[0].coverage.start,
    "2026-08-24",
  );
});
test("explicit no-results is accepted; generic source errors are not", () => {
  assert.equal(
    parseTimetable("NO SECTIONS FOUND FOR THIS INQUIRY.", "MED", "Fall 2026")
      .sections.length,
    0,
  );
  assert.throws(() =>
    parseTimetable("There was a problem with your request", "MED", "Fall 2026"),
  );
});
