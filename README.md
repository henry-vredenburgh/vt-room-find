# Campus Cuckoo / VT Room Finder

A static Virginia Tech classroom directory and daily schedule viewer, based on Brandon Walker's original Campus Cuckoo (MIT license).

## Run locally

Requires Node.js 22+ for tests/imports and Python 3 for the local static server. The website itself has no runtime dependencies or build step.

```sh
npm start
# Open http://localhost:8080
npm test
```

Serve the `web/` directory on any static host, including a GitHub Pages subdirectory. All app assets use relative paths. A GitHub Actions workflow refreshes a downloadable site artifact every six hours once enabled on the default branch. It does not publish a website or change repository contents.

## Current data status — verified November 10, 2026

**The original deployment works visually, but it does not have live schedules.** Its `js/data.js` is byte-for-byte identical to this repository's Spring 2018 snapshot. That snapshot has 140 buildings and 1,188 rooms, including 24 Architecture Annex rooms hidden by the original frontend's building whitelist.

- `https://info.classroomav.vt.edu/RoomSchedule.aspx` returns HTTP 404.
- The current [AV classroom catalog](https://www.classroomav.vt.edu/roominfosite.html) redirects to `catalog.classroomav.vt.edu`, which returned a Virginia Tech login-error page to an unauthenticated request.
- The [Registrar's reservation notice](https://www.registrar.vt.edu/faculty-staff/Room-Reservations.html) says event reservations moved to EMS for Fall 2026. Academic classes remain in the official timetable; a class-only scrape cannot prove a room is free of events.
- The public EMS URL returned an application-error page during inspection. No working public replacement schedule feed was verified.

**Current class schedules now work.** Run `npm run refresh` (or `npm run scrape -- 202609` for an explicit term). The adapter combines three public official sources:

1. Banner's current timetable: every subject for the selected term, all sections including full sections, Blacksburg campus. Parses all primary and additional meeting rows.
2. `classes.vt.edu` course-search JSON: complete section date ranges and cancellation flags, joined by CRN. Its meeting fields were empty during verification, so it is not used for room/time assignments.
3. The Registrar's academic calendar: start/end of teaching and no-class days, including entire break ranges. Final exams are excluded from the regular-class coverage window.

Buildings are discovered from Banner's current building directory; rooms are discovered from current physical class meetings. The current dataset does not reuse 2018 capacities or amenities, and section enrollment capacity is never presented as room capacity. A room without a located class in this term will not appear in the current directory; the archive remains separately accessible.

**This is a class timetable, not a complete room-reservation feed.** Current gaps are labeled **No listed classes**, never Available. Events, special permissions, locked doors, and unannounced course changes remain unverified. EMS still returned an application error in unauthenticated requests; no event feed has been implemented. `scheduleScope: "classes"` ensures the UI and calendar retain this distinction. Rooms with ambiguous date-specific notes or arranged times at a physical location have unknown coverage rather than inferred free time.

Refresh makes sequential requests spaced at least 400 ms apart, retries transport failures up to three times, and caches responses for one hour under ignored `.cache/timetable/`. It checks term identity, subject discovery, table row formats, complete section metadata, valid rooms/times/dates, and holiday calendar structure. Failed scans preserve the last successful snapshot. `fetchedAt` uses the oldest response included in a scan, so reusing cache never makes the data look newer. Remove the cache to force a new network scan. The browser stops treating snapshots as current after 24 hours.

Fall and Spring calendars are supported. Winter and Summer have multiple overlapping sessions and deliberately fail rather than borrow a fall/spring calendar. The default term comes from Banner's current form, not a guessed month. An explicit term must also be present in that form. Source-specific format changes stop the import and require updating the adapter; they do not publish partial results.

The “2018 archive” toggle under “More filters” still demonstrates historical patterns, not verified past or present availability. Historical room names, capacities, and amenities may have changed. One malformed event (HUTCH 207, end before start) is recorded under `issues` and its archive coverage is disabled.

### Refresh and hosting

```sh
npm ci
npm run refresh                 # public VT timetable; default current term
npm run scrape -- 202609         # explicit Fall 2026
npm start                       # http://localhost:8080
```

The page shows “Class schedule last refreshed” below the title, using the saved snapshot’s `fetchedAt` timestamp in Eastern time. Reload the page after a refresh to see the updated schedule and timestamp.

The generated `web/data/current.json` is ignored by Git. Include it when deploying `web/`. `.github/workflows/refresh-timetable.yml` runs every six hours and exposes the complete `classroom-site` artifact for seven days. Scheduled Actions may need enabling on a fork; no workflow has been pushed or activated by this local implementation. Deploy that artifact with your hosting workflow to keep a public site updated. The scraper's nonzero exit code causes failed Actions runs rather than publishing partial data.

## Features and correctness

- Search every imported building and room, including Architecture/Architectural Annex and building codes.
- Date, time, seats, amenities, and general-assignment filters; optional nearest mapped building.
- Click a room for a 24-hour calendar with previous/next day controls and a textual booking list.
- Exact dates and Eastern time; event date ranges and weekdays are respected.
- Half-open intervals: a class ending at 11:00 does not block a search starting at 11:00.
- Overlapping bookings merge visually without hiding details.
- Missing coverage, expired snapshots, invalid feeds, and future timestamps produce unknown availability, never free rooms. Availability expires after 24 hours; open pages recheck every minute.
- Accessible native forms/dialog, keyboard controls, responsive layout, and no third-party CDN dependencies.

## Installing a verified schedule export

The browser looks for `web/data/current.json`, generated by the timetable scraper or installed from another authorized source. A failed request falls back to the clearly labeled archive directory. Import validates everything before atomically replacing the previous snapshot:

```sh
npm run import -- /path/to/normalized-snapshot.json
# Optional alternative: replace the timetable adapter with an authorized normalized feed (HTTPS JSON):
ROOM_FEED_URL=https://your-authorized-source.example/snapshot.json npm run refresh
```

The example hostname is a placeholder, not a provided service. `current.json` is ignored by Git; include it in the deployed `web/` artifact. Run refresh at least daily (hourly is preferable for changing reservations) on your scheduler and publish only on success. Monitor its nonzero exit status. A failure preserves the previous data, whose timestamp will still expire naturally. Refresh does not republish a static deployment by itself.

Snapshot format (illustrative values only):

```json
{
  "version": 1,
  "timezone": "America/New_York",
  "archived": false,
  "source": "Authorized combined class and event export",
  "term": "Fall 2026",
  "fetchedAt": "2026-11-10T15:00:00Z",
  "buildings": [{
    "code": "AA",
    "name": "Architecture Annex",
    "latitude": null,
    "longitude": null,
    "rooms": [{
      "number": "101",
      "capacity": 25,
      "attributes": ["FX14"],
      "coverage": {"start": "2026-11-10", "end": "2026-11-10"},
      "blocks": [{
        "start": 600,
        "end": 660,
        "days": [2],
        "from": "2026-11-10",
        "through": "2026-11-10",
        "kind": "event",
        "title": "Reserved event"
      }]
    }]
  }]
}
```

Times are integer minutes after Eastern midnight; dates are inclusive ISO calendar dates; weekdays are 0=Sunday through 6=Saturday. Block kinds are `class` or `event`. Split overnight bookings into two dated blocks at midnight, shifting the second block's weekday and dates. Materialize holidays, cancellations, and different class date ranges in the adapter; do not blindly repeat every class for an entire semester. Use generic booking titles if event details are private.

`coverage: null` means unknown, even with an empty block list. Without `scheduleScope`, coverage requires all class and event bookings; with `scheduleScope: "classes"`, it covers only published class patterns. Never omit this field on a class-only feed. A block may include `excludeDates`, an array of ISO dates for official no-class days. An empty `blocks` array with confirmed coverage means no recorded bookings. Fetch/parser failures must never become empty covered schedules. `fetchedAt` is the source collection time, not the import time. Import rejects snapshots older than 24 hours or dated in the future. Capacity may be `null`; unknown capacity never satisfies a positive seat requirement. Attribute codes retain the original mapping: FX14 whiteboard, FX13 chalkboard, PC19 A/C, PC30 general assignment.

## Development and tests

```sh
npm ci
npm test
npm run test:browser
```

Browser tests use an installed Google Chrome at `/usr/bin/google-chrome`, or set `CHROME_PATH` to your Chromium executable. Tests exercise captured current Banner markup, continuation meetings, calendar breaks, section dates, invalid source responses, class-only status, current/stale data, search, archive navigation, calendar boundaries, mobile layout, failed loads, and keyboard dismissal. Browser test data is intercepted fixtures, not published or represented as live VT data.

The original data and scraper files are retained for provenance. `scripts/convert-archive.cjs` regenerates the explicitly archived JSON from the trusted checked-in `web/js/data.js`; never point it at untrusted JavaScript. The old pickle processors also must only read trusted files. The historical exporter now uses each individual event's times and an explicit Eastern timezone. The old AV scraper has modern retry arguments, HTTP error checks, and the corrected schedule endpoint, but its command-line entry point exits with the retired-source explanation instead of silently running a 2018 scrape. The other old scripts are historical tools, not the supported refresh path.

## License

MIT. See [LICENSE](LICENSE). Original project by Brandon Walker.
