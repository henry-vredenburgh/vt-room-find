import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  campusDate,
  blocksForDay,
  segments,
  status,
  overlaps,
  minutes,
} from "../web/js/availability.js";
import { validateSnapshot } from "../web/js/schema.js";
import { importSnapshot } from "../scripts/import-snapshot.js";
const now = new Date("2026-11-10T15:00:00Z");
const block = {
  start: 600,
  end: 660,
  days: [2],
  from: "2026-11-10",
  through: "2026-11-10",
  kind: "event",
  title: "Meeting",
};
const room = {
  number: "101",
  capacity: 20,
  attributes: ["FX14"],
  coverage: { start: "2026-11-10", end: "2026-11-10" },
  blocks: [block],
};
const data = {
  version: 1,
  timezone: "America/New_York",
  archived: false,
  fetchedAt: now.toISOString(),
  term: "Fall 2026",
  source: "Test fixture",
  buildings: [{ code: "AA", name: "Architecture Annex", rooms: [room] }],
};
test("half-open intervals allow bookings ending exactly at search start", () => {
  assert.equal(overlaps(660, 720, block), false);
  assert.equal(overlaps(540, 600, block), false);
  assert.equal(overlaps(659, 720, block), true);
  assert.equal(overlaps(590, 670, block), true);
});
test("specific date and weekday, inclusive event date limits", () => {
  assert.equal(blocksForDay(room, "2026-11-10").length, 1);
  assert.equal(blocksForDay(room, "2026-11-17").length, 0);
  assert.equal(blocksForDay(room, "2026-11-09").length, 0);
});
test("stale, future, missing, archived and out-of-coverage schedules never mean free", () => {
  assert.equal(status(data, room, "2026-11-10", 660, 720, now), "free");
  assert.equal(status(data, room, "2026-11-10", 600, 620, now), "busy");
  for (const patch of [
    { archived: true },
    { fetchedAt: null },
    { fetchedAt: "2026-11-08T15:00:00Z" },
    { fetchedAt: "2026-11-11T15:00:00Z" },
  ])
    assert.equal(
      status({ ...data, ...patch }, room, "2026-11-10", 660, 720, now),
      "unknown",
    );
  assert.equal(
    status(data, { ...room, coverage: null }, "2026-11-10", 660, 720, now),
    "unknown",
  );
  assert.equal(status(data, room, "2026-11-11", 660, 720, now), "unknown");
});
test("calendar merges overlapping and adjacent bookings without losing open gaps", () => {
  const r = {
    ...room,
    blocks: [
      block,
      { ...block, start: 630, end: 700 },
      { ...block, start: 700, end: 720 },
    ],
  };
  assert.deepEqual(segments(r, "2026-11-10"), [
    { start: 0, end: 600, busy: false },
    { start: 600, end: 720, busy: true },
    { start: 720, end: 1440, busy: false },
  ]);
  assert.deepEqual(segments({ ...room, blocks: [] }, "2026-11-10"), [
    { start: 0, end: 1440, busy: false },
  ]);
});
test("campus date is Eastern regardless of browser timezone, including DST", () => {
  assert.equal(campusDate(new Date("2026-11-10T02:00:00Z")), "2026-11-09");
  assert.equal(campusDate(new Date("2026-07-10T04:00:00Z")), "2026-07-10");
  assert.equal(minutes("00:15"), 15);
  assert.equal(minutes("12:00"), 720);
});
test("archive includes Architecture Annex and all buildings", async () => {
  const archive = validateSnapshot(
    JSON.parse(
      await fs.readFile(new URL("../web/data/archive.json", import.meta.url)),
    ),
  );
  assert.equal(archive.buildings.length, 140);
  assert.equal(
    archive.buildings.reduce((n, b) => n + b.rooms.length, 0),
    1188,
  );
  assert.equal(archive.buildings.find((b) => b.code === "AA").rooms.length, 24);
  assert.equal(archive.archived, true);
});
test("validation rejects malformed data rather than treating it as an empty schedule", () => {
  assert.equal(validateSnapshot(data), data);
  for (const patch of [
    { start: 700, end: 600 },
    { start: 1380, end: 1500 },
    { from: "2026-02-30" },
    { days: [7] },
    { through: "2020-01-01" },
  ]) {
    const copy = structuredClone(data);
    copy.buildings[0].rooms[0].blocks = [{ ...block, ...patch }];
    assert.throws(() => validateSnapshot(copy));
  }
  const copy = structuredClone(data);
  copy.buildings[0].rooms.push(room);
  assert.throws(() => validateSnapshot(copy));
});
test("atomic import keeps last good output on invalid or stale refresh", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vt-room-test-"));
  const input = path.join(dir, "in.json"),
    output = path.join(dir, "out.json");
  try {
    await fs.writeFile(input, JSON.stringify(data));
    await importSnapshot(input, output, now);
    const good = await fs.readFile(output, "utf8");
    await fs.writeFile(input, '{"broken":true}');
    await assert.rejects(importSnapshot(input, output, now));
    assert.equal(await fs.readFile(output, "utf8"), good);
    await fs.writeFile(
      input,
      JSON.stringify({ ...data, fetchedAt: "2018-01-01T00:00:00Z" }),
    );
    await assert.rejects(importSnapshot(input, output, now));
    assert.equal(await fs.readFile(output, "utf8"), good);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
