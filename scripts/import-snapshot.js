// Import a normalized schedule export from an authorized source, atomically.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateSnapshot } from "../web/js/schema.js";
export async function importSnapshot(input, output, now = new Date()) {
  const value = validateSnapshot(JSON.parse(await fs.readFile(input, "utf8")));
  if (value.archived)
    throw new Error("Archived data cannot be installed as a current feed");
  const age = now.getTime() - Date.parse(value.fetchedAt);
  if (age < 0 || age > 86400000)
    throw new Error("Snapshot must have been fetched within the last 24 hours");
  const rooms = value.buildings.flatMap((b) => b.rooms);
  if (!rooms.length || !rooms.some((r) => r.coverage))
    throw new Error("No verified room coverage in export");
  await fs.mkdir(path.dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value) + "\n", { flag: "wx" });
    await fs.rename(temporary, output);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return rooms.length;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [
    input,
    output = fileURLToPath(
      new URL("../web/data/current.json", import.meta.url),
    ),
  ] = process.argv.slice(2);
  if (!input) {
    console.error(
      "Usage: npm run import -- /path/to/normalized-snapshot.json [output.json]",
    );
    process.exitCode = 1;
  } else
    try {
      console.log(
        `Imported ${await importSnapshot(input, output)} rooms into ${output}`,
      );
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
}
