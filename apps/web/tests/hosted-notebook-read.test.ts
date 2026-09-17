import assert from "node:assert/strict";
import { HOSTED_API_ERROR, NOTEBOOK_READ_BOUNDS, notebookAnswerSchema } from "@sidecar/hosted";

import { EXCESS_KEYS, type UnparsedWireValue } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Option, Result } from "effect";
import { afterAll, test } from "vitest";
import { dailyNotePath, WORKSPACE_FILE } from "../server/core";
import {
  handleBrainNotebook,
  type NotebookReadOptions,
  notebookOrder,
} from "../server/hosted/notebook-read";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

/**
 * The notebook read over the real store: the curated files lead, the dated
 * notes follow newest first and bounded, the instruction files never travel,
 * a long row travels as its head with its whole length beside it, and the
 * gate is the reads' own — GET, a bearer, nothing else.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = Date.parse("2026-09-14T12:00:00.000Z");
const DAY_MS = 86_400_000;
const PATH = "/api/brain/notebook";

function request(method = "GET"): Request {
  return new Request(`https://luke.test${PATH}`, {
    method,
    headers: { authorization: "Bearer token-1" },
  });
}

function options(userId: string | undefined, req: Request): NotebookReadOptions {
  return {
    request: req,
    resolveUserId: () => Effect.succeed(Option.fromUndefinedOr(userId)),
    store: database.store,
  };
}

async function answered(response: Response) {
  assert.equal(response.status, 200);
  // SAFETY: the response body is the route's own JSON; the schema read is the validation.
  const body = (await response.json()) as UnparsedWireValue;
  const read = readEither(notebookAnswerSchema, { excess: EXCESS_KEYS.DROP })(body);
  if (Result.isFailure(read))
    assert.fail(`${read.failure.refusal} at ${read.failure.path.join(".")}`);
  return read.success;
}

async function write(userId: string, path: string, content: string, at = NOW): Promise<void> {
  await database.run(database.store.workspace.write(userId, path, content, at));
}

test("the notebook answers curated files first, notes newest after, and never an instruction file", async () => {
  const userId = await database.createUser();
  await write(userId, WORKSPACE_FILE.AGENTS, "# AGENTS\n\nnot memory");
  await write(userId, WORKSPACE_FILE.IDENTITY, "# IDENTITY\n\nnot memory");
  await write(userId, WORKSPACE_FILE.USER, "# You\n\n- likes espresso", NOW - 1);
  await write(userId, WORKSPACE_FILE.MEMORY, "# Memory\n\n- shipped the notch", NOW);
  await write(userId, dailyNotePath(NOW - 2 * DAY_MS), "older note");
  await write(userId, dailyNotePath(NOW), "today's note");
  await write(userId, dailyNotePath(NOW - DAY_MS), "yesterday's note");
  // A Markdown file one level too deep is outside the notebook, whatever its name.
  await write(userId, "memory/drafts/2026-09-01.md", "not a note");

  const answer = await answered(
    await database.run(handleBrainNotebook(options(userId, request()))),
  );

  assert.deepEqual(
    answer.files.map((file) => file.path),
    [
      WORKSPACE_FILE.MEMORY,
      WORKSPACE_FILE.USER,
      dailyNotePath(NOW),
      dailyNotePath(NOW - DAY_MS),
      dailyNotePath(NOW - 2 * DAY_MS),
    ],
  );
  assert.equal(answer.omittedNotes, 0);
  const memory = answer.files[0];
  assert.ok(memory);
  assert.equal(memory.content, "# Memory\n\n- shipped the notch");
  assert.equal(memory.chars, memory.content.length);
  assert.equal(memory.updatedAt, NOW);
});

test("a row past the wire's bound travels as its head, with its whole length beside it", async () => {
  const userId = await database.createUser();
  const long = "y".repeat(NOTEBOOK_READ_BOUNDS.MAX_FILE_CHARS + 250);
  await write(userId, dailyNotePath(NOW), long);

  const answer = await answered(
    await database.run(handleBrainNotebook(options(userId, request()))),
  );

  const note = answer.files[0];
  assert.ok(note);
  assert.equal(note.content.length, NOTEBOOK_READ_BOUNDS.MAX_FILE_CHARS);
  assert.equal(note.chars, long.length);
});

test("more notes than the answer holds are counted, not carried, and the curated files always fit", () => {
  const notes = Array.from({ length: NOTEBOOK_READ_BOUNDS.MAX_FILES + 5 }, (_, day) =>
    dailyNotePath(NOW - day * DAY_MS),
  );
  const order = notebookOrder([
    ...notes.toReversed(),
    WORKSPACE_FILE.USER,
    WORKSPACE_FILE.AGENTS,
    WORKSPACE_FILE.MEMORY,
  ]);
  assert.equal(order.kept.length, NOTEBOOK_READ_BOUNDS.MAX_FILES);
  assert.deepEqual(order.kept.slice(0, 2), [WORKSPACE_FILE.MEMORY, WORKSPACE_FILE.USER]);
  // Newest first: the note for today leads the notes, the oldest are the ones left out.
  assert.equal(order.kept[2], dailyNotePath(NOW));
  assert.equal(order.omittedNotes, notes.length - (NOTEBOOK_READ_BOUNDS.MAX_FILES - 2));
  assert.deepEqual(notebookOrder([]), { kept: [], omittedNotes: 0 });
});

test("an account with no notebook yet answers an empty notebook, not a refusal", async () => {
  const userId = await database.createUser();
  const answer = await answered(
    await database.run(handleBrainNotebook(options(userId, request()))),
  );
  assert.deepEqual(answer, { files: [], omittedNotes: 0 });
});

test("the gate is the reads' own: only GET, only with a bearer that resolves", async () => {
  const userId = await database.createUser();
  const wrongMethod = await database.run(handleBrainNotebook(options(userId, request("POST"))));
  assert.equal(wrongMethod.status, 405);
  assert.equal((await wrongMethod.json()).error, HOSTED_API_ERROR.METHOD_NOT_ALLOWED);

  const anonymous = await database.run(handleBrainNotebook(options(undefined, request())));
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, HOSTED_API_ERROR.INVALID_TOKEN);
});
