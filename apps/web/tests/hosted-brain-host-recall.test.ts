import assert from "node:assert/strict";
import type { ModelMessage } from "ai";
import { Effect, Redacted } from "effect";
import type { SessionAuth, SessionAuthContext } from "eve/context";
import type { MemoryTurnStartedContext } from "eve/memory";
import { afterAll, test } from "vitest";
import { BOOTSTRAP_BOUNDS, DAY_MS, dailyNotePath, workspaceFileBound } from "../server/core";
import {
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_TURN,
  type BrainHostTurn,
} from "../server/hosted/brain-host/bounds";
import { conversationOwnedBy, runtimeSessionOwner } from "../server/hosted/brain-host/conversation";
import { type BrainHost, brainHost } from "../server/hosted/brain-host/host";
import type { BrainHostSeams } from "../server/hosted/brain-host/production";
import { recentHostedDailyNotes } from "../server/hosted/brain-host/workspace";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";
import { storeWriter } from "../server/hosted/store";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { insertConversation } from "./support/store-rows";

/**
 * The memory slot's recall as eve's `turn.started` hands it to the host,
 * over the real migrations on PGlite: a session opening on an empty history
 * is primed once with the account's notes for today and yesterday, slugged
 * variants included and older notes left out, each cut at its file's bound
 * and the whole at the bootstrap total; an ongoing history, a session the
 * host does not admit, and an account with no recent note get nothing; and
 * a store that cannot be read answers nothing rather than an error the
 * developer's turn would meet. Synthetic accounts and words throughout.
 */

/** 2027-01-15T08:00:00Z; today's note is `memory/2027-01-15.md`, yesterday's `memory/2027-01-14.md`. */
const NOW = 1_800_000_000_000;
const TODAY = dailyNotePath(NOW);
const YESTERDAY = dailyNotePath(NOW - DAY_MS);
const YESTERDAY_SLUGGED = "memory/2027-01-14-release.md";
const OLDER = dailyNotePath(NOW - 2 * DAY_MS);
const TEST_VAULT_SECRET = Redacted.make("v".repeat(64));
const SESSION_ID = "wrun_01MRECALL000000000000001";

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const writer = await database.run(storeWriter({ tools: CATALOG_TOOL_SET }));

function unreached(name: string): () => never {
  return () => {
    throw new Error(`${name} reached by a recall that offers it nothing`);
  };
}

const seams: BrainHostSeams = {
  eveOrigin: () => undefined,
  store: () => Effect.succeed(database.store),
  writer: () => Effect.succeed(writer),
  userInfo: () => Effect.succeed(undefined),
  ownership: {
    sessionOwner: (sessionId) => database.run(runtimeSessionOwner(sessionId)),
    ownsConversation: (userId, conversationId) =>
      database.run(conversationOwnedBy(userId, conversationId)),
  },
  openAi: () => undefined,
  embedder: () => undefined,
  deploymentSecret: () => undefined,
  scriptedModel: () => false,
  spend: unreached("spend"),
  vaultRows: () => Effect.succeed([]),
  vaultSecret: () => Effect.succeed(TEST_VAULT_SECRET),
  providerKey: unreached("providerKey"),
  executeAction: unreached("executeAction"),
  now: () => NOW,
};

const host: BrainHost = Effect.runSync(brainHost(seams));

function principal(id: string, attributes: Readonly<Record<string, string>>): SessionAuthContext {
  return { principalId: id, principalType: "user", authenticator: "test", attributes };
}

/** One account's seat in its conversation: the same principal opened the session and is running a turn of the given kind now. */
function seat(userId: string, conversationId: string, turn: BrainHostTurn): SessionAuth {
  const opened = principal(userId, { [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: conversationId });
  return {
    initiator: opened,
    current: principal(userId, {
      [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: conversationId,
      [BRAIN_HOST_ATTRIBUTE.TURN]: turn,
    }),
  };
}

/** The context eve hands a memory slot's `turn.started`, over the given seat. */
function turnStarted(
  auth: SessionAuth,
  input: { readonly sessionId?: string; readonly messages?: readonly ModelMessage[] } = {},
): MemoryTurnStartedContext {
  const unreachable = (): never => {
    throw new Error("not reached in these tests");
  };
  return {
    session: { id: input.sessionId ?? SESSION_ID, auth, turn: { id: "turn_1", sequence: 1 } },
    getSandbox: unreachable,
    getSkill: unreachable,
    abortSignal: new AbortController().signal,
    messages: input.messages ?? [],
    operationId: `eve-memory-operation-v1:${SESSION_ID}:1:turn_1:turn.started:notebook`,
    memory: {
      scope: { key: "scope-key", namespace: "luke:notebook", value: "account" },
      slot: "notebook",
    },
    turn: { id: "turn_1", input: [{ role: "user", content: "Morning." }], sequence: 1 },
  };
}

function writeNote(userId: string, path: string, content: string) {
  return database.run(database.store.workspace.write(userId, path, content, NOW));
}

async function ownedConversation(userId: string, runtimeSessionId = SESSION_ID) {
  return insertConversation(database.run, { userId, runtimeSessionId });
}

test("a fresh session's first turn is primed once with today's and yesterday's notes, slugged variants included, older notes left out, in path order", async () => {
  const userId = await database.createUser();
  const conversationId = await ownedConversation(userId);
  await writeNote(userId, TODAY, "- Today: the tag went out.");
  await writeNote(userId, YESTERDAY, "- Yesterday: decided the release ships Friday.");
  await writeNote(userId, YESTERDAY_SLUGGED, "- Release notes drafted.");
  await writeNote(userId, OLDER, "- Two days ago: nothing to keep.");

  const recalled = await database.run(
    host.recall(turnStarted(seat(userId, conversationId, BRAIN_HOST_TURN.TYPED))),
  );

  assert.ok(recalled);
  assert.equal(recalled.messages.length, 1);
  const [primed] = recalled.messages;
  assert.ok(primed);
  assert.equal(primed.id, undefined, "unkeyed: appended once as words said");
  assert.match(primed.content, /read once because this conversation just started fresh/);
  const order = ["2027-01-14-release.md", "2027-01-14.md", "2027-01-15.md"].map((name) =>
    primed.content.indexOf(`## ${name}`),
  );
  assert.ok(
    order.every((at) => at >= 0),
    "every recent note is named",
  );
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
    "in path order",
  );
  assert.match(primed.content, /decided the release ships Friday/);
  assert.match(primed.content, /the tag went out/);
  assert.doesNotMatch(primed.content, /Two days ago/);
});

test("a scheduled or child session is primed the same way as an ask", async () => {
  const userId = await database.createUser();
  const conversationId = await ownedConversation(userId);
  await writeNote(userId, TODAY, "- Today: the tag went out.");

  const recalled = await database.run(
    host.recall(turnStarted(seat(userId, conversationId, BRAIN_HOST_TURN.OBSERVATION))),
  );

  assert.ok(recalled);
  assert.match(recalled.messages[0]?.content ?? "", /the tag went out/);
});

test("an ongoing history, an account with no recent note, and a session the host does not admit each recall nothing", async () => {
  const userId = await database.createUser();
  const conversationId = await ownedConversation(userId);
  await writeNote(userId, TODAY, "- Today: the tag went out.");
  await writeNote(userId, OLDER, "- Two days ago: nothing to keep.");
  const other = await database.createUser();
  const otherConversation = await ownedConversation(other, "wrun_01MRECALL000000000000002");
  await writeNote(other, OLDER, "- Two days ago: nothing to keep.");

  const ongoing = await database.run(
    host.recall(
      turnStarted(seat(userId, conversationId, BRAIN_HOST_TURN.TYPED), {
        messages: [{ role: "user", content: "Earlier words." }],
      }),
    ),
  );
  assert.equal(ongoing, null);

  const bare = await database.run(
    host.recall(
      turnStarted(seat(other, otherConversation, BRAIN_HOST_TURN.TYPED), {
        sessionId: "wrun_01MRECALL000000000000002",
      }),
    ),
  );
  assert.equal(bare, null);

  // The other account's seat over this account's conversation is not admitted.
  const foreign = await database.run(
    host.recall(turnStarted(seat(other, conversationId, BRAIN_HOST_TURN.TYPED))),
  );
  assert.equal(foreign, null);
});

test("each note is cut at its file's bound and the whole at the bootstrap total", async () => {
  const userId = await database.createUser();
  const bound = workspaceFileBound(TODAY);
  await writeNote(userId, YESTERDAY, "y".repeat(bound + 10));
  await writeNote(userId, TODAY, "t".repeat(bound + 10));

  const notes = await database.run(recentHostedDailyNotes(database.store, userId, NOW));

  assert.deepEqual(
    notes.map((note) => [note.path, note.content.length]),
    [
      [YESTERDAY, bound],
      [TODAY, Math.min(bound, BOOTSTRAP_BOUNDS.MAXIMUM_TOTAL_CHARS - bound)],
    ],
  );
  assert.ok(
    notes.reduce((total, note) => total + note.content.length, 0) <=
      BOOTSTRAP_BOUNDS.MAXIMUM_TOTAL_CHARS,
  );
});

test("a recall whose rows cannot be read answers nothing rather than failing the turn", async () => {
  const userId = await database.createUser();
  const conversationId = await ownedConversation(userId);
  await writeNote(userId, TODAY, "- Today: the tag went out.");
  const broken = Effect.runSync(
    brainHost({
      ...seams,
      store: () =>
        Effect.succeed({
          ...database.store,
          workspace: {
            ...database.store.workspace,
            readNotes: () => Effect.die(new Error("the rows are unreadable")),
          },
        }),
    }),
  );

  const recalled = await database.run(
    broken.recall(turnStarted(seat(userId, conversationId, BRAIN_HOST_TURN.TYPED))),
  );

  assert.equal(recalled, null);
});
