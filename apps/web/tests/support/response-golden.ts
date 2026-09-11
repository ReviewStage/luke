import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * A response recorded whole — its status line, every header in the order the
 * answer carries them, and its body — so a route's bytes stand on disk and a
 * conversion that moved one of them fails rather than passes quietly.
 *
 * Headers are a list rather than a record because `set-cookie` arrives more
 * than once, and a record would record a joined byte no client is sent.
 */

const UPDATE_FIXTURES = process.env.LUKE_UPDATE_FIXTURES === "1";
const GOLDEN_SUFFIX = ".json";

export interface RecordedResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string;
}

export async function recordedResponse(response: Response): Promise<RecordedResponse> {
  return {
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers],
    body: await response.text(),
  };
}

const FRAMING_HEADER = { CONTENT_LENGTH: "content-length" } as const;

/**
 * A response recorded the way a converted route's answer is compared: the
 * framing header is held to the body it frames rather than recorded beside
 * it, since the platform's own web handler computes it from the very bytes
 * the golden holds, and recording it would record the same fact twice.
 */
export async function recordedAnswer(response: Response): Promise<RecordedResponse> {
  const recorded = await recordedResponse(response);
  const framed = recorded.headers.find(([name]) => name === FRAMING_HEADER.CONTENT_LENGTH);
  if (framed) assert.equal(Number(framed[1]), new TextEncoder().encode(recorded.body).byteLength);
  return {
    ...recorded,
    headers: recorded.headers.filter(([name]) => name !== FRAMING_HEADER.CONTENT_LENGTH),
  };
}

/** The recorded response against the file named for it, which `LUKE_UPDATE_FIXTURES=1` writes. */
export async function settleResponseGolden(
  root: string,
  name: string,
  recorded: RecordedResponse,
): Promise<void> {
  const text = `${JSON.stringify(recorded, undefined, 2)}\n`;
  const file = path.join(root, `${name}${GOLDEN_SUFFIX}`);
  if (UPDATE_FIXTURES) {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(file, text);
    return;
  }
  assert.equal(text, await fs.readFile(file, "utf8"));
}

/** The names recorded under a golden directory, so a test can hold the set to the one it declares. */
export async function recordedGoldenNames(root: string): Promise<string[]> {
  return (await fs.readdir(root))
    .filter((entry) => entry.endsWith(GOLDEN_SUFFIX))
    .map((entry) => entry.slice(0, -GOLDEN_SUFFIX.length))
    .sort();
}
