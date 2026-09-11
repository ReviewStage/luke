import assert from "node:assert/strict";
import {
  changesAnswerSchema,
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
import { eq, sql } from "drizzle-orm";
import { afterAll, test } from "vitest";
import {
  CONVERSATION_KIND,
  conversations,
  devices,
  events,
  messages,
  turns,
} from "../server/db/schema";
import { type ChangeSignalOptions, handleChanges } from "../server/hosted/change-signal";
import { deviceSeams } from "../server/hosted/device-store";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

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

const seams = deviceSeams(database.db);

function changesRequest(body: WireValue | undefined, method = "POST", authorized = true): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (authorized) headers.set("authorization", "Bearer token-1");
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request("https://luke.test/api/changes", init);
}

/** Positions in the one order the test compares them in: by conversation id. */
function sorted(positions: readonly [string, number][]): [string, number][] {
  return [...positions].sort(([a], [b]) => (a < b ? -1 : 1));
}

function options(userId: string, request: Request): ChangeSignalOptions {
  return {
    request,
    resolveUserId: async () => userId,
    store: database.store,
    touchDevice: seams.touchDevice,
    now: () => NOW,
  };
}

async function deviceRow(id: string) {
  const [row] = await database.db.select().from(devices).where(eq(devices.id, id));
  assert.ok(row);
  return row;
}

async function answered(response: Response) {
  assert.equal(response.status, 200);
  // SAFETY: the response body is the route's own JSON; the schema read is the validation.
  const read = changesAnswerSchema.read((await response.json()) as UnparsedWireValue);
  if (!read.ok) assert.fail(`${read.refusal} at ${read.path.join(".")}`);
  return read.value;
}

function positionsOf(cursor: string): [string, number][] {
  const decoded = sequenceReadCursorSchema.parse(cursor);
  assert.ok(decoded);
  return decoded.positions.map((position) => [position.conversationId, position.seq]);
}

async function registerDevice(userId: string, installationId: string, deviceId: string) {
  await seams.registerDevice(
    userId,
    { installationId, platform: DEVICE_PLATFORM.MACOS, push: undefined },
    () => deviceId,
    new Date(NOW - 3_600_000),
  );
}

test("the gate order is method, bearer, and body, and a refused request moves no device", async () => {
  const userId = await database.createUser();
  await registerDevice(userId, INSTALLATION_ID, DEVICE_ID);
  const before = await deviceRow(DEVICE_ID);

  const wrongMethod = await handleChanges(options(userId, changesRequest(undefined, "GET")));
  assert.equal(wrongMethod.status, 405);
  assert.equal((await wrongMethod.json()).error, HOSTED_API_ERROR.METHOD_NOT_ALLOWED);

  const anonymous = await handleChanges({
    ...options(userId, changesRequest({ deviceId: DEVICE_ID }, "POST", false)),
    resolveUserId: async () => undefined,
  });
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, HOSTED_API_ERROR.INVALID_TOKEN);

  const malformed: (WireValue | undefined)[] = [
    undefined,
    {},
    { deviceId: "mac" },
    { deviceId: DEVICE_ID, quietUntil: "later" },
  ];
  for (const body of malformed) {
    const refused = await handleChanges(options(userId, changesRequest(body)));
    assert.equal(refused.status, 400, JSON.stringify(body));
    assert.equal((await refused.json()).error, HOSTED_API_ERROR.INVALID_REQUEST);
  }
  assert.deepEqual(await deviceRow(DEVICE_ID), before);
});

test("a poll moves the device's last-seen, presence, and quiet instants as reported, and clears one told null", async () => {
  const userId = await database.createUser();
  await registerDevice(userId, INSTALLATION_ID, DEVICE_ID);

  const reported = await answered(
    await handleChanges(
      options(
        userId,
        changesRequest({
          deviceId: DEVICE_ID,
          activeUntil: NOW + 120_000,
          quietUntil: NOW + 1_800_000,
        }),
      ),
    ),
  );
  assert.equal(reported.seen, true);
  const moved = await deviceRow(DEVICE_ID);
  assert.deepEqual(moved.lastSeenAt, new Date(NOW));
  assert.deepEqual(moved.activeUntil, new Date(NOW + 120_000));
  assert.deepEqual(moved.quietUntil, new Date(NOW + 1_800_000));

  await answered(
    await handleChanges(options(userId, changesRequest({ deviceId: DEVICE_ID, quietUntil: null }))),
  );
  const unquieted = await deviceRow(DEVICE_ID);
  assert.equal(unquieted.quietUntil, null);
  assert.deepEqual(unquieted.activeUntil, new Date(NOW + 120_000));

  await answered(
    await handleChanges(
      options(userId, changesRequest({ deviceId: DEVICE_ID, activeUntil: null })),
    ),
  );
  assert.equal((await deviceRow(DEVICE_ID)).activeUntil, null);

  await answered(
    await handleChanges(
      options(userId, changesRequest({ deviceId: DEVICE_ID, quietUntil: NOW + 900_000 })),
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
    await handleChanges(options(userId, changesRequest({ deviceId: DEVICE_ID }))),
  );
  assert.deepEqual(positionsOf(empty.messages), []);
  assert.deepEqual(positionsOf(empty.events), []);
  assert.equal(empty.turns, undefined);
  assert.equal(empty.rosterObservedAt, undefined);

  const [main] = await database.db
    .insert(conversations)
    .values({ userId, kind: CONVERSATION_KIND.MAIN, nextMessageSeq: 3, nextEventSeq: 1 })
    .returning({ id: conversations.id });
  const [observed] = await database.db
    .insert(conversations)
    .values({
      userId,
      kind: CONVERSATION_KIND.OBSERVED,
      providerId: "conductor",
      providerSessionId: "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50",
      nextMessageSeq: 1,
      nextEventSeq: 2,
    })
    .returning({ id: conversations.id });
  const [child] = await database.db
    .insert(conversations)
    .values({
      userId,
      kind: CONVERSATION_KIND.CHILD,
      parentConversationId: main?.id,
      nextMessageSeq: 9,
    })
    .returning({ id: conversations.id });
  assert.ok(main && observed && child);
  const [turn] = await database.db
    .insert(turns)
    .values({
      userId,
      conversationId: main.id,
      origin: TURN_ORIGIN.TYPED,
      status: TURN_STATUS.RUNNING,
      queuedAt: sql`'2026-09-10 12:00:00.000500+00'::timestamptz`,
    })
    .returning({ id: turns.id });
  assert.ok(turn);
  const [message] = await database.db
    .insert(messages)
    .values({
      userId,
      conversationId: main.id,
      seq: 1,
      clientId: "client-1",
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text: "ask" }],
      metadata: TYPED_ASK,
    })
    .returning({ id: messages.id });
  assert.ok(message);
  await database.db.insert(events).values({
    userId,
    conversationId: observed.id,
    seq: 1,
    messageId: message.id,
    kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
  });
  await database.store.roster.write(userId, { body: "{}", observedAt: NOW - 30_000 });

  const heads = await answered(
    await handleChanges(options(userId, changesRequest({ deviceId: DEVICE_ID }))),
  );
  assert.deepEqual(
    sorted(positionsOf(heads.messages)),
    sorted([
      [main.id, 2],
      [observed.id, 0],
    ]),
  );
  assert.deepEqual(
    sorted(positionsOf(heads.events)),
    sorted([
      [main.id, 0],
      [observed.id, 1],
    ]),
  );
  assert.deepEqual(turnReadCursorSchema.parse(heads.turns ?? ""), {
    changedAt: "2026-09-10 12:00:00.0005+00",
    id: turn.id,
  });
  assert.equal(heads.rosterObservedAt, NOW - 30_000);

  const misnamed = await answered(
    await handleChanges(options(userId, changesRequest({ deviceId: STRANGER_DEVICE_ID }))),
  );
  assert.equal(misnamed.seen, false);
  assert.equal(misnamed.messages, heads.messages);
  assert.deepEqual((await deviceRow(STRANGER_DEVICE_ID)).lastSeenAt, new Date(NOW - 3_600_000));

  const { opened } = await database.store.main.clear(userId, new Date(NOW + 1000));
  const cleared = await answered(
    await handleChanges(options(userId, changesRequest({ deviceId: DEVICE_ID }))),
  );
  assert.deepEqual(
    sorted(positionsOf(cleared.messages)),
    sorted([
      [opened, 0],
      [observed.id, 0],
    ]),
  );
  assert.equal(cleared.turns, undefined);
});
