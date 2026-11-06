import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const UPDATE_FIXTURES = process.env.APP_UPDATE_FIXTURES === "1";
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
