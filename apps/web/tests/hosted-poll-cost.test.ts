import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  brainTurnsAnswerSchema,
  type ConversationMessagesAnswer,
  changesAnswerSchema,
  conversationEventsAnswerSchema,
  conversationMessagesAnswerSchema,
} from "@sidecar/hosted";
import type { ConversationViewMessage } from "@sidecar/session";
import { readStoredUIMessages } from "@sidecar/session/ui-messages";
import { readEither } from "@sidecar/wire/effect";
import { Effect, type Schema as EffectSchema, Either } from "effect";
import { afterAll, test } from "vitest";
import {
  ConversationViewSync,
  type ReadMessagesPage,
  type ReadTurnGroup,
} from "../../../packages/host/src/conversation-view-sync.js";
import {
  BRAIN_REQUEST_STATUS,
  BRAIN_RUN_EVENT,
  BRAIN_TURN_ORIGIN,
  BRAIN_TURN_TRIGGER,
  type BrainRunEvent,
  type BrainRunEventBody,
  MAIN_SESSION_KEY,
  MESSAGE_AUTHOR,
  MESSAGE_ROLE,
  UI_PART_STATE,
  UI_PART_TYPE,
  type UnparsedWireValue,
} from "../server/core";
import { standingMain } from "../server/hosted/brain-host/main";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";
import { handleChanges } from "../server/hosted/change-signal";
import {
  handleBrainTurns,
  handleConversationEvents,
  handleConversationMessages,
  type ResourceReadOptions,
} from "../server/hosted/resource-reads";
import { storeWriter } from "../server/hosted/store";
import { standingObservedConversation } from "../server/hosted/store/observed-conversations";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

/**
 * What one Mac's polling costs the service in a minute, counted through the
 * real change signal, the real reads, and the real fold, with the clock
 * stepped at the composer's own pace. LUKE-199: while any conversation has
 * an open journal, an observation turn's included, the signal's head stands
 * past the unsettled row and the device's cursor stands before it, so every
 * poll reads the messages resource again, answers nothing a screen would
 * draw, and moves nothing. The numbers here are today's, as values, so the
 * change that ends the re-read is measured against them.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

/** The composer's pace and the minute it makes. */
const POLL = { INTERVAL_MS: 5_000, PER_MINUTE: 12 } as const;

let clock = Date.parse("2026-09-12T12:00:00.000Z");
const now = () => clock;

const writer = await database.run(
  storeWriter({ tools: CATALOG_TOOL_SET, now: () => new Date(now()) }),
);

const READ_PATH = {
  MESSAGES: "/api/conversation/messages",
  EVENTS: "/api/conversation/events",
  TURNS: "/api/brain/turns",
  CHANGES: "/api/changes",
} as const;
const AFTER = "after";
const MAX_PAGES_PER_POLL = 25;
const SESSION = {
  providerId: "conductor",
  providerSessionId: "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50",
} as const;

function request(path: string, after: string | undefined): Request {
  const url = new URL(`https://luke.test${path}`);
  if (after !== undefined) url.searchParams.set(AFTER, after);
  return new Request(url, { method: "GET", headers: { authorization: "Bearer token-1" } });
}

function options(userId: string, req: Request): ResourceReadOptions {
  return { request: req, resolveUserId: async () => userId, store: database.store };
}

async function answered<Value, Encoded>(
  response: Response,
  schema: EffectSchema.Schema<Value, Encoded>,
): Promise<Value> {
  assert.equal(response.status, 200);
  // SAFETY: the response body is the route's own JSON; the schema read is the validation.
  const body = (await response.json()) as UnparsedWireValue;
  const read = readEither(schema)(body);
  if (Either.isLeft(read)) assert.fail(`${read.left.refusal} at ${read.left.path.join(".")}`);
  return read.right;
}

async function readPage(answer: ConversationMessagesAnswer): Promise<ReadMessagesPage> {
  const groups: ReadTurnGroup[] = [];
  for (const group of answer.groups) {
    const read = await readStoredUIMessages(
      group.messages.map((message) => message.message),
      CATALOG_TOOL_SET,
    );
    if (!read.ok) assert.fail(`the registry refused a row: ${read.refusal}`);
    const messages: ConversationViewMessage[] = group.messages.map((message, index) => {
      const stored = read.value[index];
      if (stored === undefined) assert.fail("the registry read answered fewer rows than it took");
      return {
        message: stored,
        seq: message.seq,
        createdAt: message.createdAt,
        tools: message.tools,
        ...(message.rating !== undefined ? { rating: message.rating } : undefined),
      };
    });
    groups.push({
      turnId: group.turnId,
      conversationId: group.conversationId,
      source: group.source,
      ...(group.turn !== undefined ? { turn: group.turn } : undefined),
      messages,
    });
  }
  return { conversations: answer.conversations, groups, next: answer.next };
}

/** What a span of polls cost: the requests made, the rows the messages answers carried, and how often the picture moved. */
interface PollCost {
  readonly polls: number;
  readonly messagesReads: number;
  readonly rowsAnswered: number;
  readonly eventsReads: number;
  readonly turnsReads: number;
  readonly pictureMoved: number;
}

const NOTHING: PollCost = {
  polls: 0,
  messagesReads: 0,
  rowsAnswered: 0,
  eventsReads: 0,
  turnsReads: 0,
  pictureMoved: 0,
};

/** One Mac as the conversation composer polls, its requests counted. */
class Mac {
  readonly sync = new ConversationViewSync();
  readonly #deviceId = randomUUID();
  #cost: PollCost = NOTHING;

  constructor(private readonly userId: string) {}

  async poll(): Promise<void> {
    const revision = this.sync.revision;
    let messagesReads = 0;
    let rowsAnswered = 0;
    let eventsReads = 0;
    let turnsReads = 0;
    const signal = await answered(
      await database.run(
        handleChanges({
          request: new Request(`https://luke.test${READ_PATH.CHANGES}`, {
            method: "POST",
            headers: { authorization: "Bearer token-1", "content-type": "application/json" },
            body: JSON.stringify({ deviceId: this.#deviceId }),
          }),
          resolveUserId: async () => this.userId,
          store: database.store,
          touchDevice: () => Effect.succeed(false),
          now,
        }),
      ),
      changesAnswerSchema,
    );
    const cursors = this.sync.cursors();
    if (signal.messages !== cursors.messages) {
      for (let pages = 0; pages < MAX_PAGES_PER_POLL; pages += 1) {
        messagesReads += 1;
        const answer = await answered(
          await database.run(
            handleConversationMessages(
              options(this.userId, request(READ_PATH.MESSAGES, this.sync.cursors().messages)),
            ),
          ),
          conversationMessagesAnswerSchema,
        );
        rowsAnswered += answer.groups.reduce((count, group) => count + group.messages.length, 0);
        this.sync.applyMessages(await readPage(answer));
        if (!answer.hasMore) break;
      }
    }
    if (signal.events !== cursors.events) {
      eventsReads += 1;
      const answer = await answered(
        await database.run(
          handleConversationEvents(
            options(this.userId, request(READ_PATH.EVENTS, this.sync.cursors().events)),
          ),
        ),
        conversationEventsAnswerSchema,
      );
      this.sync.applyEvents(answer.events, answer.next, answer.hasMore);
    }
    if (signal.turns !== cursors.turns) {
      turnsReads += 1;
      const answer = await answered(
        await database.run(
          handleBrainTurns(
            options(this.userId, request(READ_PATH.TURNS, this.sync.cursors().turns)),
          ),
        ),
        brainTurnsAnswerSchema,
      );
      this.sync.applyTurns(answer.turns, answer.next);
    }
    this.#cost = {
      polls: this.#cost.polls + 1,
      messagesReads: this.#cost.messagesReads + messagesReads,
      rowsAnswered: this.#cost.rowsAnswered + rowsAnswered,
      eventsReads: this.#cost.eventsReads + eventsReads,
      turnsReads: this.#cost.turnsReads + turnsReads,
      pictureMoved: this.#cost.pictureMoved + (this.sync.revision === revision ? 0 : 1),
    };
  }

  /** A minute at the composer's pace, and what it cost. */
  async minute(): Promise<PollCost> {
    const before = this.#cost;
    for (let polls = 0; polls < POLL.PER_MINUTE; polls += 1) {
      clock += POLL.INTERVAL_MS;
      await this.poll();
    }
    const after = this.#cost;
    return {
      polls: after.polls - before.polls,
      messagesReads: after.messagesReads - before.messagesReads,
      rowsAnswered: after.rowsAnswered - before.rowsAnswered,
      eventsReads: after.eventsReads - before.eventsReads,
      turnsReads: after.turnsReads - before.turnsReads,
      pictureMoved: after.pictureMoved - before.pictureMoved,
    };
  }
}

/** One turn's stream, numbered as the relay numbers it. */
class Stream {
  #sequence = 0;
  constructor(readonly turnId: string) {}

  event(body: BrainRunEventBody): BrainRunEvent {
    this.#sequence += 1;
    return {
      ...body,
      conversationId: MAIN_SESSION_KEY,
      turnId: this.turnId,
      sequence: this.#sequence,
    };
  }

  started(origin: (typeof BRAIN_TURN_ORIGIN)[keyof typeof BRAIN_TURN_ORIGIN]): BrainRunEvent {
    return this.event({
      kind: BRAIN_RUN_EVENT.TURN_STARTED,
      origin,
      trigger:
        origin === BRAIN_TURN_ORIGIN.OBSERVATION
          ? BRAIN_TURN_TRIGGER.ROSTER
          : BRAIN_TURN_TRIGGER.ASK,
      at: now(),
    });
  }

  step(): BrainRunEvent {
    return this.event({ kind: BRAIN_RUN_EVENT.STEP_STARTED, step: 1 });
  }

  answered(text: string): BrainRunEvent {
    return this.event({
      kind: BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
      message: {
        id: randomUUID(),
        role: MESSAGE_ROLE.ASSISTANT,
        metadata: { author: MESSAGE_AUTHOR.BRAIN },
        parts: [{ type: UI_PART_TYPE.TEXT, text, state: UI_PART_STATE.DONE }],
      },
    });
  }

  ended(): BrainRunEvent {
    return this.event({
      kind: BRAIN_RUN_EVENT.TURN_ENDED,
      status: BRAIN_REQUEST_STATUS.SUCCEEDED,
      usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, reasoningTokens: 0 },
      responseIds: [],
      at: now(),
    });
  }
}

const QUIET_MINUTE: PollCost = { ...NOTHING, polls: POLL.PER_MINUTE };

test("one open observation journal costs every Mac on the account one messages read per poll, answering nothing it draws, until the journal ends", async () => {
  const userId = await database.createUser();
  const conversationId = await database.run(standingMain(userId, new Date(now())));
  const target = { userId, conversationId };
  const macs = [new Mac(userId), new Mac(userId)];
  const write = async (
    conversation: { readonly userId: string; readonly conversationId: string },
    event: BrainRunEvent,
  ) => {
    const result = await database.run(writer.consume(conversation, event));
    assert.ok(result.ok, JSON.stringify(result));
  };
  const everyMac = async (act: (mac: Mac) => Promise<void>) => {
    for (const mac of macs) await act(mac);
  };

  // A settled exchange in the main, so the picture each Mac holds is not empty.
  const exchange = new Stream(randomUUID());
  await write(target, exchange.started(BRAIN_TURN_ORIGIN.SPOKEN));
  await write(target, exchange.step());
  await write(target, exchange.answered("fixture reply"));
  await write(target, exchange.ended());
  await everyMac((mac) => mac.poll());

  // A quiet minute: the signal alone, twelve times, and nothing read.
  await everyMac(async (mac) => assert.deepEqual(await mac.minute(), QUIET_MINUTE));

  // An observation turn on an observed conversation opens its journal and does not end.
  clock += POLL.INTERVAL_MS;
  const observedId = await database.run(
    standingObservedConversation(userId, SESSION, new Date(now())),
  );
  assert.ok(observedId !== undefined);
  const observation = new Stream(randomUUID());
  await write(
    { userId, conversationId: observedId },
    observation.started(BRAIN_TURN_ORIGIN.OBSERVATION),
  );
  await write({ userId, conversationId: observedId }, observation.step());
  // The poll that first meets the journal reads it; that read is the preview and is not the cost.
  await everyMac((mac) => mac.poll());

  // Today's cost: a messages read on every poll, answering no row a screen draws, moving nothing.
  await everyMac(async (mac) =>
    assert.deepEqual(await mac.minute(), { ...QUIET_MINUTE, messagesReads: POLL.PER_MINUTE }),
  );

  // The journal ends, and the next minute is quiet again.
  await write({ userId, conversationId: observedId }, observation.answered("noted"));
  await write({ userId, conversationId: observedId }, observation.ended());
  await everyMac((mac) => mac.poll());
  await everyMac(async (mac) => assert.deepEqual(await mac.minute(), QUIET_MINUTE));
});
