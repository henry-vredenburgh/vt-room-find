import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { load } from "cheerio";
import {
  BASE,
  discover,
  buildingNames,
  parseTimetable,
  parseCalendar,
  parseSectionDates,
  buildSnapshot,
} from "./sources/banner.js";
import { importSnapshot } from "./import-snapshot.js";
const root = fileURLToPath(new URL("../", import.meta.url)),
  cache = path.join(root, ".cache/timetable");
await fs.mkdir(cache, { recursive: true });
let earliest = Date.now();
async function request(
  key,
  url,
  body,
  contentType = "application/x-www-form-urlencoded",
) {
  const file = path.join(cache, key + ".json");
  try {
    const saved = JSON.parse(await fs.readFile(file, "utf8"));
    if (Date.now() - saved.at < 3600000 && Date.now() >= saved.at) {
      earliest = Math.min(earliest, saved.at);
      return saved.text;
    }
  } catch {}
  for (let attempt = 0; attempt < 3; attempt++) {
    await delay(400 + attempt * 1500);
    try {
      const response = await fetch(url, {
        method: body ? "POST" : "GET",
        body,
        headers: body ? { "Content-Type": contentType } : {},
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (!text.length) throw new Error("Empty response");
      const at = Date.now();
      earliest = Math.min(earliest, at);
      await fs.writeFile(file, JSON.stringify({ at, text }));
      return text;
    } catch (error) {
      if (attempt === 2) throw new Error(`${key}: ${error.message}`);
    }
  }
}
try {
  const html = await request("form", BASE + "HZSKVTSC.P_DispRequest");
  const $ = load(html);
  const defaultTerm = $("select[name=TERMYEAR] option").first().attr("value");
  const code = process.argv[2] || defaultTerm;
  if (!/^\d{6}$/.test(code))
    throw new Error("Usage: npm run scrape -- [YYYYMM]");
  const term = discover(html, code);
  const year = Number(code.slice(0, 4)),
    ay = code.endsWith("09") ? year : year - 1;
  const calendarURL = `https://www.registrar.vt.edu/dates-deadlines/academic-calendar/${ay}-${ay + 1}.html`;
  const calendar = parseCalendar(
    await request(`calendar-${ay}`, calendarURL),
    term.name,
  );
  const names = buildingNames(
    await request("buildings", BASE + "hzskvtsc.P_DispBldgList"),
  );
  const dateJSON = await request(
    `dates-${code}`,
    "https://classes.vt.edu/api/?page=fose&route=search",
    JSON.stringify({ other: { srcdb: code }, criteria: [] }),
    "application/json",
  );
  const dates = parseSectionDates(JSON.parse(dateJSON), code),
    pages = [];
  for (const subject of term.subjects) {
    const body = new URLSearchParams({
      CAMPUS: "0",
      TERMYEAR: code,
      CORE_CODE: "AR%",
      subj_code: subject,
      SCHDTYPE: "%",
      sess_code: "%",
      CRSE_NUMBER: "",
      crn: "",
      open_only: "",
      disp_comments_in: "Y",
      BTN_PRESSED: "FIND class sections",
      inst_name: "",
    }).toString();
    const page = parseTimetable(
      await request(
        `${code}-${subject}`,
        BASE + "HZSKVTSC.P_ProcRequest",
        body,
      ),
      subject,
      term.name,
    );
    pages.push(page);
    console.log(
      `${pages.length}/${term.subjects.length} ${subject}: ${page.sections.length} sections, ${page.meetings.length} located meetings`,
    );
  }
  const snapshot = buildSnapshot({
    term,
    calendar,
    names,
    dates,
    pages,
    fetchedAt: new Date(earliest).toISOString(),
    calendarURL,
  });
  const staged = path.join(cache, "snapshot.json");
  await fs.writeFile(staged, JSON.stringify(snapshot));
  const count = await importSnapshot(
    staged,
    path.join(root, "web/data/current.json"),
  );
  console.log(
    `Published ${count} rooms in ${snapshot.buildings.length} buildings. ${snapshot.stats.meetings} class meeting patterns. Events are NOT covered. ${snapshot.issues.length} date-note issues marked unknown.`,
  );
} catch (error) {
  console.error(
    `Timetable refresh failed; previous snapshot preserved. ${error.message}`,
  );
  process.exitCode = 1;
}
