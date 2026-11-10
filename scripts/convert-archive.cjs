// Convert the original trusted, checked-in dataset; never run untrusted JavaScript here.
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const old = {};
vm.runInNewContext(
  fs.readFileSync(path.join(root, "web/js/data.js"), "utf8"),
  old,
);
const easternDate = (timestamp) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp * 1000));
const data = {
  version: 1,
  timezone: "America/New_York",
  archived: true,
  term: "Spring 2018",
  fetchedAt: null,
  source: "Original Campus Cuckoo snapshot (2018)",
  buildings: old.BUILDINGS.map((code, i) => ({
    code,
    name: code === "AA" ? "Architecture Annex" : old.BUILDING_NAMES[i],
    latitude: old.LATITUDES[i] || null,
    longitude: old.LONGITUDES[i] || null,
    rooms: old.ROOMS[i].map((number, j) => ({
      number,
      capacity: old.ROOM_CAPACITIES[i][j],
      attributes: old.ROOM_ATTRIBS[i][j],
      coverage: { start: "2018-01-16", end: "2018-05-02" },
      blocks: [
        ...old.CLASSES[i]
          .filter((b) => b[3] === number)
          .map((b) => ({
            start: b[0],
            end: b[1],
            days: [old.DAYS.indexOf(b[2])],
            from: "2018-01-16",
            through: "2018-05-02",
            kind: "class",
            title: "Scheduled class",
          })),
        ...old.EVENTS[i]
          .filter((b) => b[5] === number)
          .map((b) => ({
            start: b[0],
            end: b[1],
            days: [old.DAYS.indexOf(b[4])],
            from: easternDate(b[2]),
            through: easternDate(b[3]),
            kind: "event",
            title: "Reserved event",
          })),
      ],
    })),
  })),
};
data.issues = [];
for (const building of data.buildings)
  for (const room of building.rooms) {
    const invalid = room.blocks.filter(
      (b) => b.start >= b.end || b.start < 0 || b.end > 1440,
    );
    if (invalid.length) {
      data.issues.push({
        building: building.code,
        room: room.number,
        reason: "Invalid original event times; schedule coverage disabled",
        blocks: invalid,
      });
      room.coverage = null;
      room.blocks = room.blocks.filter((b) => !invalid.includes(b));
    }
  }
fs.writeFileSync(
  path.join(root, "web/data/archive.json"),
  JSON.stringify(data),
);
console.log(
  `${data.buildings.length} buildings; ${data.buildings.reduce((n, b) => n + b.rooms.length, 0)} rooms converted. Historical patterns only, not verified historical availability.`,
);
