import {
  campusDate,
  minutes,
  timeLabel,
  known,
  blocksForDay,
  segments,
  status,
} from "./availability.js";
import { validateSnapshot } from "./schema.js";
const $ = (id) => document.getElementById(id);
const make = (tag, text, cls) => {
  const el = document.createElement(tag);
  el.textContent = text;
  if (cls) el.className = cls;
  return el;
};
let historical,
  live,
  data,
  selected,
  limit = 48;
const dateLabel = (date) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
function populateBuildings() {
  const old = $("building").value;
  $("building").replaceChildren(new Option("All buildings", ""));
  for (const b of [...data.buildings].sort((a, b) =>
    a.name.localeCompare(b.name),
  ))
    $("building").add(new Option(`${b.name} (${b.rooms.length})`, b.code));
  if ([...$("building").options].some((o) => o.value === old))
    $("building").value = old;
}
function setMode() {
  data = $("archive").checked ? historical : live || historical;
  $("date").value = $("archive").checked ? "2018-02-05" : campusDate();
  $("available").checked = false;
  $("available-label").textContent =
    data.scheduleScope === "classes"
      ? "Only rooms with no classes"
      : "Only available rooms";
  populateBuildings();
  render();
}
function render() {
  if (!data) return;
  const archive = $("archive").checked,
    date = $("date").value;
  const start = minutes($("start").value),
    end = minutes($("end").value);
  const scheduleStatus = $("schedule-status");
  scheduleStatus.replaceChildren();
  if (archive) {
    scheduleStatus.textContent = "Spring 2018 archive";
  } else if (live) {
    const refreshed = make("time", new Date(live.fetchedAt).toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }));
    refreshed.dateTime = live.fetchedAt;
    scheduleStatus.append("Class schedule last refreshed: ", refreshed, ` · ${live.term}`);
  } else {
    scheduleStatus.textContent = "Class schedule not loaded · Spring 2018 room directory";
  }
  $("results").replaceChildren();
  $("more").hidden = true;
  if (
    !date ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start >= end ||
    !$("capacity").validity.valid
  ) {
    $("feedback").textContent =
      "Choose a date, a valid seat count, and an end time after the start time.";
    $("count").textContent = "Check your search";
    return;
  }
  $("feedback").textContent = "";
  $("results-date").textContent = dateLabel(date);
  $("coverage").textContent = archive
    ? "2018 archive"
    : `${timeLabel(start)} – ${timeLabel(end)}`;
  const query = $("search")
    .value.trim()
    .toLowerCase()
    .replace(/architectural|archetecture/g, "architecture");
  const features = [...document.querySelectorAll("[name=feature]:checked")].map(
    (e) => e.value,
  );
  const matches = [];
  for (const b of data.buildings) {
    if ($("building").value && b.code !== $("building").value) continue;
    for (const room of b.rooms) {
      if (
        !`${b.name} ${b.code} ${room.number}`
          .toLowerCase()
          .replace(/architectural/g, "architecture")
          .includes(query)
      )
        continue;
      if (
        $("capacity").valueAsNumber > 0 &&
        (room.capacity === null || room.capacity < $("capacity").valueAsNumber)
      )
        continue;
      if (!features.every((f) => room.attributes.includes(f))) continue;
      const state = status(data, room, date, start, end);
      if ($("available").checked && !["free", "unbooked"].includes(state))
        continue;
      matches.push({ b, room, state });
    }
  }
  const order = { free: 0, unbooked: 0, unknown: 1, busy: 2 };
  matches.sort(
    (a, b) =>
      order[a.state] - order[b.state] ||
      a.b.name.localeCompare(b.b.name) ||
      a.room.number.localeCompare(b.room.number, undefined, { numeric: true }),
  );
  $("count").textContent =
    `${matches.length} room${matches.length === 1 ? "" : "s"}`;
  if (!matches.length)
    $("results").append(
      make(
        "div",
        $("available").checked
          ? "No rooms match. Change the time or filters."
          : "No rooms match. Change the search or filters.",
        "empty",
      ),
    );
  for (const { b, room, state } of matches.slice(0, limit)) {
    const card = make("button", "", "room-card");
    card.type = "button";
    const name = make("span", "", "room-name");
    name.append(
      make("strong", b.name),
      make("span", `Room ${room.number}`, "room-number"),
    );
    const stateLabel = archive
      ? "2018 archive"
      : {
          free: "Available",
          unbooked: "No listed classes",
          busy: data.scheduleScope === "classes" ? "Class scheduled" : "Scheduled",
          unknown: "Unknown",
        }[state];
    card.setAttribute("aria-label", `${b.name} ${room.number}, ${stateLabel}, view schedule`);
    card.append(name);
    const tags = [];
    if (room.capacity !== null) tags.push(`${room.capacity} seats`);
    if (room.attributes.includes("FX14")) tags.push("Whiteboard");
    if (room.attributes.includes("FX13")) tags.push("Chalkboard");
    if (tags.length) card.append(make("span", tags.join(" · "), "room-features"));
    card.append(make("span", stateLabel, `room-status ${archive ? "unknown" : state}`));
    card.onclick = () => openRoom(b, room);
    $("results").append(card);
  }
  $("more").hidden = matches.length <= limit;
}
function openRoom(building, room) {
  selected = { building, room, date: $("date").value };
  renderCalendar();
  $("room-dialog").showModal();
  $("calendar-scroll").scrollTop = 7 * 48;
}
function renderCalendar() {
  const { building, room, date } = selected,
    archive = $("archive").checked;
  const readable =
    known(data, room, date) ||
    (archive &&
      room.coverage &&
      room.coverage.start <= date &&
      room.coverage.end >= date);
  $("room-title").textContent = `${building.name} ${room.number}`;
  $("room-meta").textContent =
    `${room.capacity === null ? "Capacity unknown" : room.capacity + " seats"} · ${building.code} · Eastern time`;
  $("calendar-date").textContent = dateLabel(date);
  $("gap-legend").textContent =
    data.scheduleScope === "classes" ? "No listed classes" : "Unscheduled";
  document.querySelector(".legend").hidden = !readable;
  $("calendar").replaceChildren();
  $("agenda").replaceChildren();
  const axis = make("div", "", "time-axis"),
    track = make("div", "", "day-track");
  for (let h = 0; h < 24; h++) {
    const label = make("span", timeLabel(h * 60));
    label.style.top = `${(h / 24) * 100}%`;
    axis.append(label);
  }
  for (const s of readable
    ? segments(room, date)
    : [{ start: 0, end: 1440, unknown: true }]) {
    const title = s.unknown
      ? "Unknown"
      : s.busy
        ? "Scheduled"
        : archive
          ? "No recorded booking"
          : data.scheduleScope === "classes"
            ? "No listed classes"
            : "Unscheduled";
    const block = make(
      "div",
      "",
      `time-block ${s.unknown ? "unknown" : s.busy ? "busy" : "free"}`,
    );
    block.style.top = `${(s.start / 1440) * 100}%`;
    block.style.height = `${((s.end - s.start) / 1440) * 100}%`;
    block.title = `${title}: ${timeLabel(s.start)} – ${timeLabel(s.end)}`;
    if (s.end - s.start >= 35)
      block.append(
        make("strong", title),
        make("span", `${timeLabel(s.start)} – ${timeLabel(s.end)}`),
      );
    track.append(block);
  }
  $("calendar").append(axis, track);
  if (readable) {
    const blocks = blocksForDay(room, date);
    if (!blocks.length)
      $("agenda").append(make("li", "No bookings recorded for this day."));
    for (const b of blocks)
      $("agenda").append(
        make("li", `${timeLabel(b.start)} – ${timeLabel(b.end)} · ${b.title}`),
      );
  } else $("agenda").append(make("li", "No schedule for this date."));
}
$("close").onclick = () => $("room-dialog").close();
$("room-dialog").addEventListener("click", (e) => {
  if (e.target === $("room-dialog")) {
    const r = e.target.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      e.target.close();
  }
});
for (const [id, delta] of [
  ["previous", -1],
  ["next", 1],
])
  $(id).onclick = () => {
    const d = new Date(`${selected.date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + delta);
    selected.date = d.toISOString().slice(0, 10);
    renderCalendar();
  };
$("archive").onchange = setMode;
$("filters").addEventListener("input", (e) => {
  if (e.target.id !== "archive") {
    limit = 48;
    render();
  }
});
$("filters").onsubmit = (e) => e.preventDefault();
$("filters").onreset = () =>
  setTimeout(() => {
    limit = 48;
    setMode();
    $("location-status").textContent = "";
  }, 0);
$("more").onclick = () => {
  limit += 48;
  render();
};
$("nearby").onclick = () => {
  if (!navigator.geolocation) {
    $("location-status").textContent =
      "Location is unavailable. Choose a building instead.";
    return;
  }
  $("nearby").disabled = true;
  $("location-status").textContent = "Finding nearby buildings…";
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const rad = (v) => (v * Math.PI) / 180;
      const distance = (b) => {
        const a =
          Math.sin(rad(b.latitude - coords.latitude) / 2) ** 2 +
          Math.cos(rad(coords.latitude)) *
            Math.cos(rad(b.latitude)) *
            Math.sin(rad(b.longitude - coords.longitude) / 2) ** 2;
        return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      };
      const candidates = data.buildings
        .filter((b) => b.latitude && b.longitude && b.rooms.length)
        .sort((a, b) => distance(a) - distance(b));
      if (candidates.length) {
        $("building").value = candidates[0].code;
        $("search").value = "";
        $("location-status").textContent =
          `Nearest building: ${candidates[0].name}`;
        render();
      } else
        $("location-status").textContent =
          "No mapped buildings available. Choose a building instead.";
      $("nearby").disabled = false;
    },
    () => {
      $("location-status").textContent =
        "Location unavailable or permission declined. Choose a building instead.";
      $("nearby").disabled = false;
    },
    { timeout: 10000, maximumAge: 30000 },
  );
};
async function read(url) {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const value = await response.json();
  validateSnapshot(value);
  return value;
}
try {
  historical = await read("./data/archive.json");
  try {
    live = await read("./data/current.json");
    if (live.archived) throw new Error("Not a current snapshot");
  } catch (error) {
    live = null;
  }
  setMode();
  // Recompute freshness while a page remains open.
  setInterval(() => {
    render();
    if ($("room-dialog").open) renderCalendar();
  }, 60000);
} catch (error) {
  $("schedule-status").textContent =
    "Room data could not be loaded. Reload the page or try again later.";
  $("count").textContent = "Unable to load rooms";
  $("filters").inert = true;
  console.error(error);
}
