import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * A golden held as the bytes a subject wrote, compared whole. For a document
 * whose text is the subject's own output — an export, a rendering — rather
 * than a value this module would serialize; the JSON Schema and response
 * goldens beside it own their serialization and compare through their own
 * readers.
 */

/** Records the golden instead of asserting it. `check.sh` never sets it. */
const UPDATE_FIXTURES = process.env.LUKE_UPDATE_FIXTURES === "1";

/** The text against the file it is recorded in, which `LUKE_UPDATE_FIXTURES=1` writes. */
export async function settleTextGolden(filePath: string, text: string): Promise<void> {
  if (UPDATE_FIXTURES) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, text);
    return;
  }
  const held = await fs.readFile(filePath, "utf8").catch(() => undefined);
  assert.ok(held !== undefined, `no golden recorded at ${filePath}`);
  assert.equal(text, held);
}
