// A scheduled refresh of an authorized, normalized JSON feed. No credentials are logged.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importSnapshot } from "./import-snapshot.js";
const source = process.env.ROOM_FEED_URL;
if (!source) {
  await import("./scrape-timetable.js");
} else {
  let temporary;
  try {
    const url = new URL(source);
    if (url.protocol !== "https:") throw new Error("Feed URL must use HTTPS");
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}`);
    if (!response.headers.get("content-type")?.includes("application/json"))
      throw new Error(
        "Expected JSON; source may have redirected to a login or error page",
      );
    const body = await response.text();
    if (body.length > 20_000_000) throw new Error("Feed exceeds 20 MB limit");
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), "vt-refresh-"));
    const input = path.join(temporary, "snapshot.json");
    await fs.writeFile(input, body);
    const count = await importSnapshot(
      input,
      fileURLToPath(new URL("../web/data/current.json", import.meta.url)),
    );
    console.log(
      `Refreshed ${count} rooms. Deploy web/ to publish this snapshot.`,
    );
  } catch (error) {
    console.error(
      `Refresh failed; previous snapshot preserved. ${error.message}`,
    );
    process.exitCode = 1;
  } finally {
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
  }
}
