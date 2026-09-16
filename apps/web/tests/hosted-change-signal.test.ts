import assert from "node:assert/strict";
import {
  agentsHeadSchema,
  changesAnswerSchema,
  childrenHeadSchema,
  DEVICE_PLATFORM,
  HOSTED_API_ERROR,
  sequenceReadCursorSchema,
  turnReadCursorSchema,
} from "@sidecar/hosted";
import {
  CONVERSATION_EVENT_KIND,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  TURN_ORIGIN,
  TURN_STATUS,
  type UnparsedWireValue,
  type WireValue,
} from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Effect, type Schema as EffectSchema, Result } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { afterAll, test } from "vitest";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import { handleChanges } from "../server/hosted/change-signal";
import { deviceSeams } from "../server/hosted/device-store";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import {
  amendMessageInPlace,
  insertConversation,
  insertEvent,
  insertMessage,
  readDeviceById,
} from "./support/store-rows";

/**
 * The change signal over the real store and device rows: one poll moves the
 * device's last-seen, presence, and quiet instants exactly as it was told,
 * and answers every resource's head as the cursor a caught-up device holds,
 * whether or not the device row was the account's.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = Date.parse("2026-09-10T12:00:00.000Z");
const INSTALLATION_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const DEVICE_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const STRANGER_DEVICE_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae8";
const TYPED_ASK = { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED } as const;

const seams = deviceSeams();

function changesRequest(body: WireValue | undefined, method = "POST", authorized = true): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (authorized) headers.set("authorization", "Bearer token-1");
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request("https://luke.test/api/changes", init);
}

/** Positions in the one order the test compares them in: by conversation id. */
function sorted<Value>(positions: readonly [string, Value][]): [string, Value][] {
  return [...positions].sort(([a], [b]) => (a < b ? -1 : 1));
}

function options(userId: string, request: Request) {
  return {
    request,
    resolveUserId: () => Effect.succeed(userId),
    store: database.store,
    touchDevice: seams.touchDevice,
    now: () => NOW,
  };
}

async function deviceRow(id: string) {
  const row = await readDeviceById(database.run, id);
  assert.ok(row);
  return row;
}

function parse<Value, Encoded>(
  schema: EffectSchema.Codec<Value, Encoded>,
  value: UnparsedWireValue,
): Value | undefined {
  return Result.getOrUndefined(readEither(schema)(value));
}

async function answered(response: Response) {
  assert.equal(response.status, 200);
  // SAFETY: the response body is the route's own JSON; the schema read is the validation.
  const read = readEither(changesAnswerSchema)((await response.json()) as UnparsedWireValue);
  if (Result.isFailure(read))
    assert.fail(`${read.failure.refusal} at ${read.failure.path.join(".")}`);
  return read.success;
}

function positionsOf(cursor: string): [string, number][] {
  const decoded = parse(sequenceReadCursorSchema, cursor);
  assert.ok(decoded);
  return decoded.positions.map((position) => [position.conversationId, position.seq]);
}

/** Each position's revision, by conversation: the messages head carries one, the events head none. */
function revisionsOf(cursor: string): [string, number | undefined][] {
  const decoded = parse(sequenceReadCursorSchema, cursor);
  assert.ok(decoded);
  return decoded.positions.map((position) => [position.conversationId, position.revision]);
}

async function registerDevice(userId: string, installationId: string, deviceId: string) {
  await database.run(
    seams.registerDevice(
      userId,
      { installationId, platform: DEVICE_PLATFORM.MACOS, push: undefined },
      () => deviceId,
      new Date(NOW - 3_600_000),
    ),
  );
}

test("the gate order is method, bearer, and body, and a refused request moves no device", async () => {
  const userId = await database.createUser();
  await registerDevice(userId, INSTALLATION_ID, DEVICE_ID);
  const before = await deviceRow(DEVICE_ID);

  const wrongMethod = await database.run(
    handleChanges(options(userId, changesRequest(undefined, "GET"))),
  );
  assert.equal(wrongMethod.status, 405);
  assert.equal((await wrongMethod.json()).error, HOSTED_API_ERROR.METHOD_NOT_ALLOWED);

  const anonymous = await database.run(
    handleChanges({
      ...options(userId, changesRequest({ deviceId: DEVICE_ID }, "POST", false)),
      resolveUserId: () => Effect.succeed(undefined),
    }),
  );
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, HOSTED_API_ERROR.INVALID_TOKEN);

  const malformed: (WireValue | undefined)[] = [
    undefined,
    {},
    { deviceId: "mac" },
    { deviceId: DEVICE_ID, quietUntil: "later" },
  ];
  for (const body of malformed) {
    const refused = await database.run(handleChanges(options(userId, changesRequest(body))));
    assert.equal(refused.status, 400, JSON.stringify(body));
    assert.equal((await refused.json()).error, HOSTED_API_ERROR.INVALID_REQUEST);
  }
  assert.deepEqual(await deviceRow(DEVICE_ID), before);
});

test("a poll moves the device's last-seen, presence, and quiet instants as reported, and clears one told null", async () => {
  const userId = await database.createUser();
  await registerDevice(userId, INSTALLATION_ID, DEVICE_ID);

  const reported = await answered(
    await database.run(
      handleChanges(
        options(
          userId,
          changesRequest({
            deviceId: DEVICE_ID,
            activeUntil: NOW + 120_000,
            quietUntil: NOW + 1_800_000,
          }),
        ),
      ),
    ),
  );
  assert.equal(reported.seen, true);
  const moved = await deviceRow(DEVICE_ID);
  assert.deepEqual(moved.lastSeenAt, new Date(NOW));
  assert.deepEqual(moved.activeUntil, new Date(NOW + 120_000));
  assert.deepEqual(moved.quietUntil, new Date(NOW + 1_800_000));

  await answered(
    await database.run(
      handleChanges(options(userId, changesRequest({ deviceId: DEVICE_ID, quietUntil: null }))),
    ),
  );
  const unquieted = await deviceRow(DEVICE_ID);
  assert.equal(unquieted.quietUntil, null);
  assert.deepEqual(unquieted.activeUntil, new Date(NOW + 120_000));

  await answered(
    await database.run(
      handleChanges(options(userId, changesRequest({ deviceId: DEVICE_ID, activeUntil: null }))),
    ),
  );
  assert.equal((await deviceRow(DEVICE_ID)).activeUntil, null);

  await answered(
    await database.run(
      handleChanges(
        options(userId, changesRequest({ deviceId: DEVICE_ID, quietUntil: NOW + 900_000 })),
      ),
    ),
  );
  await registerDevice(userId, INSTALLATION_ID, DEVICE_ID);
  assert.equal((await deviceRow(DEVICE_ID)).quietUntil, null);
});

test("a poll answers every resource's head as the cursor a caught-up device holds, for the account's device and a stranger's alike", async () => {
  const userId = await database.createUser();
  const stranger = await database.createUser();
  await registerDevice(userId, INSTALLATION_ID, DEVICE_ID);
  await registerDevice(stranger, "0f8fad5b-d9cb-469f-a165-70867728950f", STRANGER_DEVICE_ID);

  const empty = await answered(
    await database.run(handleChanges(options(userId, changesRequest({ deviceId: DEVICE_ID })))),
  );
  assert.deepEqual(positionsOf(empty.messages), []);
  assert.deepEqual(positionsOf(empty.events), []);
  assert.equal(empty.turns, undefined);
  assert.equal(empty.children, undefined);
  assert.equal(empty.agents, undefined);
  assert.equal(empty.rosterObservedAt, undefined);

  const main = await insertConversation(database.run, {
    userId,
    nextMessageSeq: 3,
    nextEventSeq: 1,
  });
  const observed = await insertConversation(database.run, {
    userId,
    kind: CONVERSATION_KIND.OBSERVED,
    providerId: "conductor",
    providerSessionId: "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50",
    nextMessageSeq: 1,
    nextEventSeq: 2,
  });
  // Opened on the test's own clock, so the Clear below stamps it at an instant after its opening.
  const child = await insertConversation(database.run, {
    userId,
    kind: CONVERSATION_KIND.CHILD,
    parentConversationId: main,
    nextMessageSeq: 9,
    createdAt: new Date(NOW - 60_000),
  });
  assert.ok(main && observed && child);
  // A sub-millisecond instant, so the turn cursor's own precision (finer than a JS `Date`) is what the test compares.
  const turnId = await database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`
        insert into turns (user_id, conversation_id, origin, status, queued_at)
        values (
          ${userId}, ${main}, ${TURN_ORIGIN.TYPED}, ${TURN_STATUS.RUNNING},
          '2026-09-10 12:00:00.000500+00'::timestamptz
        )
        returning id
      `;
      return rows[0]?.id;
    }),
  );
  assert.ok(turnId);
  const messageId = await insertMessage(database.run, {
    userId,
    conversationId: main,
    seq: 1,
    clientId: "client-1",
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text: "ask" }],
    metadata: TYPED_ASK,
  });
  await insertEvent(database.run, {
    userId,
    conversationId: observed,
    seq: 1,
    messageId,
    kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
  });
  await database.run(database.store.roster.write(userId, { body: "{}", observedAt: NOW - 30_000 }));

  const heads = await answered(
    await database.run(handleChanges(options(userId, changesRequest({ deviceId: DEVICE_ID })))),
  );
  assert.deepEqual(
    sorted(positionsOf(heads.messages)),
    sorted([
      [main, 2],
      [observed, 0],
    ]),
  );
  assert.deepEqual(
    sorted(positionsOf(heads.events)),
    sorted([
      [main, 0],
      [observed, 1],
    ]),
  );
  assert.deepEqual(parse(turnReadCursorSchema, heads.turns ?? ""), {
    changedAt: "2026-09-10 12:00:00.0005+00",
    id: turnId,
  });
  // The observed conversation holds no turn yet, so it is no agent and the head is absent.
  assert.equal(heads.agents, undefined);
  assert.equal(heads.rosterObservedAt, NOW - 30_000);
  // The children head names the child that changed last; here the one child, at its opening.
  assert.equal(parse(childrenHeadSchema, heads.children ?? "")?.id, child);
  // The messages head carries each conversation's journal revision; the events head carries none.
  assert.deepEqual(
    sorted(revisionsOf(heads.messages)),
    sorted([
      [main, 0],
      [observed, 0],
    ]),
  );
  assert.deepEqual(
    sorted(revisionsOf(heads.events)),
    sorted([
      [main, undefined],
      [observed, undefined],
    ]),
  );

  const misnamed = await answered(
    await database.run(
      handleChanges(options(userId, changesRequest({ deviceId: STRANGER_DEVICE_ID }))),
    ),
  );
  assert.equal(misnamed.seen, false);
  assert.equal(misnamed.messages, heads.messages);
  assert.deepEqual((await deviceRow(STRANGER_DEVICE_ID)).lastSeenAt, new Date(NOW - 3_600_000));

  // A write to a numbered row in place moves the messages head and nothing else.
  await amendMessageInPlace(database.run, {
    conversationId: main,
    id: messageId,
    parts: [{ type: "text", text: "ask, edited" }],
  });
  const written = await answered(
    await database.run(handleChanges(options(userId, changesRequest({ deviceId: DEVICE_ID })))),
  );
  assert.deepEqual(sorted(positionsOf(written.messages)), sorted(positionsOf(heads.messages)));
  assert.deepEqual(
    sorted(revisionsOf(written.messages)),
    sorted([
      [main, 1],
      [observed, 0],
    ]),
  );
  assert.equal(written.events, heads.events);
  assert.equal(written.turns, heads.turns);
  assert.equal(written.children, heads.children);

  // A turn about the observed session makes it an agent: the head names it at the turn's queuing.
  await database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        insert into turns (user_id, conversation_id, origin, status, queued_at)
        values (
          ${userId}, ${observed}, ${TURN_ORIGIN.TRANSCRIPT_CHANGE}, ${TURN_STATUS.QUEUED},
          ${new Date(NOW + 500)}
        )
      `;
    }),
  );
  const observing = await answered(
    await database.run(handleChanges(options(userId, changesRequest({ deviceId: DEVICE_ID })))),
  );
  assert.deepEqual(parse(agentsHeadSchema, observing.agents ?? ""), {
    changedAt: "2026-09-10 12:00:00.5+00",
    id: observed,
  });

  const { opened } = await database.run(database.store.main.clear(userId, new Date(NOW + 1000)));
  const cleared = await answered(
    await database.run(handleChanges(options(userId, changesRequest({ deviceId: DEVICE_ID })))),
  );
  assert.deepEqual(
    sorted(positionsOf(cleared.messages)),
    sorted([
      [opened, 0],
      [observed, 0],
    ]),
  );
  assert.equal(cleared.turns, undefined);
  // The child went with its parent: the list reads empty now, and the head moved to say so.
  assert.ok(cleared.children !== undefined);
  assert.notEqual(cleared.children, heads.children);
  assert.equal(parse(childrenHeadSchema, cleared.children)?.id, child);
});
