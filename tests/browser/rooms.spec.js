import fs from "node:fs";
import { test, expect } from "@playwright/test";
const snapshot = (fetchedAt = new Date().toISOString()) => ({
  version: 1,
  timezone: "America/New_York",
  archived: false,
  fetchedAt,
  source: "Browser test fixture",
  term: "Test term",
  buildings: [
    {
      code: "AA",
      name: "Architecture Annex",
      rooms: [
        {
          number: "101",
          capacity: 25,
          attributes: ["FX14", "PC30"],
          coverage: { start: "2026-11-10", end: "2026-11-10" },
          blocks: [
            {
              start: 600,
              end: 660,
              days: [2],
              from: "2026-11-10",
              through: "2026-11-10",
              kind: "event",
              title: "Reserved event",
            },
          ],
        },
      ],
    },
  ],
});
async function archiveOnly(page) {
  await page.route("**/data/current.json", (r) =>
    r.fulfill({ status: 404, body: "" }),
  );
  await page.goto("/");
  await expect(page.locator(".room-card").first()).toBeVisible();
}
test("all buildings, Annex search, unknown availability and archive calendar", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await archiveOnly(page);
  await expect(page.locator("#building option")).toHaveCount(141);
  await page.locator("#search").fill("Archetecture Annex");
  await expect(page.locator(".room-card")).toHaveCount(24);
  await expect(page.locator(".room-status").first()).toHaveText("Unknown");
  await page.locator("#available").check();
  await expect(page.locator(".room-card")).toHaveCount(0);
  await page.locator("#available").uncheck();
  await page.locator(".room-card").first().click();
  await expect(page.locator("#agenda")).toContainText(
    "No schedule for this date.",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog")).not.toBeVisible();
  await page.getByText("More filters", { exact: true }).click();
  await page.locator("#archive").check();
  await page.locator("#building").selectOption("MCB");
  await page.locator("#search").fill("");
  await page.locator(".room-card").first().click();
  await expect(page.locator(".time-block.busy").first()).toBeVisible();
  await expect(page.locator("#calendar-date")).toContainText("Feb 5, 2018");
  await page.locator("#next").click();
  await expect(page.locator("#calendar-date")).toContainText("Feb 6, 2018");
  expect(errors).toEqual([]);
});
test("verified availability and boundary times agree with day calendar", async ({
  page,
}) => {
  await page.route("**/data/current.json", (r) =>
    r.fulfill({ json: snapshot() }),
  );
  await page.goto("/");
  await expect(page.locator(".room-card")).toHaveCount(1);
  await page.locator("#date").fill("2026-11-10");
  await expect(page.locator(".room-status")).toHaveText("Scheduled");
  await page.locator("#start").fill("11:00");
  await page.locator("#end").fill("12:00");
  await expect(page.locator(".room-status")).toHaveText("Available");
  await page.locator("#available").check();
  await expect(page.locator(".room-card")).toHaveCount(1);
  await page.locator(".room-card").click();
  await expect(page.locator(".time-block.busy")).toHaveCount(1);
  await expect(page.locator("#agenda")).toContainText("10:00 AM – 11:00 AM");
  await page.locator("#next").click();
  await expect(page.locator("#agenda")).toContainText(
    "No schedule for this date.",
  );
});
test("stale and malformed current feeds fail closed", async ({ page }) => {
  await page.route("**/data/current.json", (r) =>
    r.fulfill({ json: snapshot("2018-01-01T00:00:00Z") }),
  );
  await page.goto("/");
  await expect(page.locator(".room-status")).toHaveText("Unknown");
  await page.unroute("**/data/current.json");
  await page.route("**/data/current.json", (r) =>
    r.fulfill({ json: { buildings: [] } }),
  );
  await page.reload();
  await expect(page.locator("#schedule-status")).toContainText("Class schedule not loaded");
  await expect(page.locator(".room-status").first()).toHaveText("Unknown");
});
test("mobile layout, empty results, invalid intervals and reset", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await archiveOnly(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator("#search").fill("no-such-building");
  await expect(page.locator(".empty")).toBeVisible();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.locator(".room-card").first()).toBeVisible();
  await page.locator("#end").fill("09:00");
  await expect(page.locator("#feedback")).toContainText("end time after");
  await page.locator("#end").fill("11:00");
  await page.locator(".room-card").first().click();
  await expect(page.locator("dialog")).toBeVisible();
  expect(
    await page
      .locator("dialog")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
  ).toBe(true);
});
test("missing archive displays an actionable error instead of endless loading", async ({
  page,
}) => {
  await page.route("**/data/archive.json", (r) =>
    r.fulfill({ status: 500, body: "" }),
  );
  await page.goto("/");
  await expect(page.locator("#count")).toHaveText("Unable to load rooms");
});

test("current timetable shows class gaps without claiming room availability", async ({
  page,
}) => {
  const data = snapshot();
  data.scheduleScope = "classes";
  data.buildings[0].rooms[0].blocks[0].kind = "class";
  data.buildings[0].rooms[0].blocks[0].excludeDates = ["2026-11-11"];
  await page.route("**/data/current.json", (r) => r.fulfill({ json: data }));
  await page.goto("/");
  await expect(page.locator(".room-card")).toHaveCount(1);
  await page.locator("#date").fill("2026-11-10");
  await expect(page.locator("#schedule-status")).toContainText("Class schedule last refreshed:");
  await expect(page.locator("#schedule-status time")).toHaveAttribute("datetime", data.fetchedAt);
  await expect(page.locator(".room-status")).toHaveText("Class scheduled");
  await page.locator("#start").fill("11:00");
  await page.locator("#end").fill("12:00");
  await expect(page.locator(".room-status")).toHaveText("No listed classes");
  await page.locator("#available").check();
  await expect(page.locator(".room-card")).toHaveCount(1);
  await page.locator(".room-card").click();
  await expect(page.locator(".notice")).toHaveCount(0);
  await expect(page.locator(".time-block.free").first()).toContainText(
    "No listed classes",
  );
});

test("locally scraped dataset loads without intercepted responses", async ({
  page,
}, testInfo) => {
  const file = new URL("../../web/data/current.json", import.meta.url);
  test.skip(
    !fs.existsSync(file),
    "Run npm run scrape to test a real collected dataset",
  );
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const annex = data.buildings.find((b) => b.code === "AA");
  await page.goto("/");
  await expect(page.locator("#count")).toContainText(
    String(data.buildings.reduce((n, b) => n + b.rooms.length, 0)),
  );
  await expect(page.locator("#schedule-status")).toContainText(data.term);
  await page.screenshot({ path: testInfo.outputPath("desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("mobile.png") });
  await page.locator("#building").selectOption("AA");
  await expect(page.locator(".room-card")).toHaveCount(annex.rooms.length);
  await page.locator(".room-card").filter({ hasText: "Room 114" }).click();
  await expect(page.locator("#room-title")).toContainText("Architecture Annex");
  await expect(page.locator(".notice")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("current-annex.png") });
});


test.describe("refresh timestamp", () => {
  test.use({ timezoneId: "Asia/Tokyo" });

  test("shows saved collection time in Eastern time and separates the archive", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-11-10T16:00:00Z"));
    const data = snapshot("2026-11-10T15:38:01.873Z");
    data.scheduleScope = "classes";
    await page.route("**/data/current.json", (r) => r.fulfill({ json: data }));
    await page.goto("/");
    await expect(page.locator("#schedule-status time")).toHaveText("Nov 10, 2026, 10:38 AM EST");
    await page.locator("#search").fill("Annex");
    await expect(page.locator("#schedule-status time")).toHaveAttribute("datetime", data.fetchedAt);
    await page.getByText("More filters", { exact: true }).click();
    await page.locator("#archive").check();
    await expect(page.locator("#schedule-status")).toHaveText("Spring 2018 archive");
    await expect(page.locator("#schedule-status time")).toHaveCount(0);
    await page.locator("#archive").uncheck();
    await expect(page.locator("#schedule-status time")).toHaveAttribute("datetime", data.fetchedAt);
  });
});
