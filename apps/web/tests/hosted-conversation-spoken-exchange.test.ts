import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  brainTurnsAnswerSchema,
  type ConversationMessagesAnswer,
  changesAnswerSchema,
  conversationEventsAnswerSchema,
  conversationMessagesAnswerSchema,
} from "@sidecar/hosted";
import type { ConversationViewMessage, ConversationViewSnapshot } from "@sidecar/session";
import { readStoredUIMessages } from "@sidecar/session/ui-messages";
import { readEither } from "@sidecar/wire/effect";
import { Effect, type Schema as EffectSchema, Either } from "effect";
import { afterAll } from "vitest";
import {
  ConversationViewSync,
  type ReadMessagesPage,
  type ReadTurnGroup,
} from "../../../packages/host/src/conversation-view-sync.js";
import {
  ASK_ORIGIN,
  BRAIN_REQUEST_STATUS,
  BRAIN_RUN_EVENT,
  BRAIN_TURN_ORIGIN,
  BRAIN_TURN_TRIGGER,
  type BrainRunEvent,
  type BrainRunEventBody,
  MAIN_SESSION_KEY,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
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
import { STORE_WRITE_EFFECT, storeWriter, voiceWriter } from "../server/hosted/store";
import { askRecord } from "../server/hosted/store/asks";
import { standingObservedConversation } from "../server/hosted/store/observed-conversations";
import { promisedVoiceSessionRecord, voiceSessionRecord } from "../server/voice/session-record";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { heard, said } from "./support/live-events";

/**
 * A Mac's picture of the Conversation across whole spoken exchanges, over the
 * real writer, the real reads, and the real change signal on PGlite, folded by
 * the same `ConversationViewSync` the desktop host folds pages with. LUKE-197
 * reported the Conversation tab emptying to "No messages yet" at the instant
 * Luke stops speaking; the record survives a relaunch, so what is held to
 * here is that no write a spoken exchange makes — the ask recorded, the
 * voice writer's cut of the transcript, the turn's start, the line taken into
 * the turn, the journal opened and streamed, the answer, the turn's end — can
 * empty or shrink what a device that polls between the writes holds, in
 * either order the line and the journal can land, and with another
 * conversation's journal standing open through it all; and that an exchange
 * the voice model answered itself — the two settled utterances the voice
 * writer cuts into rows of their own, with no turn — reaches the picture as
 * rows in the store's order, survives the settle, and is read the same on a
 * relaunch. Synthetic words throughout: no real spoken word is written.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

let clock = Date.parse("2026-09-12T12:00:00.000Z");
const now = () => clock;
function tick(): void {
  clock += 1000;
}

const writer = await database.run(
  storeWriter({ tools: CATALOG_TOOL_SET, now: () => new Date(now()) }),
);

const VOICE_ASK = { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.VOICE } as const;
const SESSION = {
  providerId: "conductor",
  providerSessionId: "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50",
} as const;
const READ_PATH = {
  MESSAGES: "/api/conversation/messages",
  EVENTS: "/api/conversation/events",
  TURNS: "/api/brain/turns",
  CHANGES: "/api/changes",
} as const;
const AFTER = "after";
/** The composer's own bound on how many pages one poll takes of one resource. */
const MAX_PAGES_PER_POLL = 25;

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

/** A page held to the vocabulary under the catalog's registry, as `compose-conversation.ts` holds one before folding it in. */
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
      if (stored === undefined)
        throw new Error("the registry read answered fewer rows than it took");
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

/** Each group as its turn's status and its rows' roles at their sequences, for an assertion that reads as the thread does. */
function shape(
  snapshot: ConversationViewSnapshot,
): readonly (readonly [string, readonly string[]])[] {
  return snapshot.groups.map((group) => [
    group.turn?.status ?? "",
    group.messages.map((message) => `${message.message.role}@${message.seq}`),
  ]);
}

/**
 * One Mac as the conversation composer polls: the change signal first, then
 * only the resources whose head differs from the cursor held, each page
 * folded by the real sync. Every poll is written down so a failure names the
 * write it followed.
 */
class Mac {
  readonly sync = new ConversationViewSync();
  readonly #deviceId = randomUUID();
  readonly #log: string[] = [];

  constructor(private readonly userId: string) {}

  get log(): string {
    return this.#log.join("\n");
  }

  async poll(label: string): Promise<ConversationViewSnapshot> {
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
        const answer = await answered(
          await database.run(
            handleConversationMessages(
              options(this.userId, request(READ_PATH.MESSAGES, this.sync.cursors().messages)),
            ),
          ),
          conversationMessagesAnswerSchema,
        );
        this.sync.applyMessages(await readPage(answer));
        if (!answer.hasMore) break;
      }
    }
    if (signal.events !== cursors.events) {
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
    const snapshot = this.sync.snapshot();
    this.#log.push(`${label}: settled=${snapshot.settled} ${JSON.stringify(shape(snapshot))}`);
    return snapshot;
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

const EXCHANGE_ROLES = [MESSAGE_ROLE.USER, MESSAGE_ROLE.ASSISTANT];

it.effect(
  "no write a spoken exchange makes empties or shrinks a Mac's picture of the Conversation, whichever of the line and the journal lands first, with another conversation's journal open",
  () =>
    Effect.promise(async () => {
      const userId = await database.createUser();
      const conversationId = await database.run(standingMain(userId, new Date(now())));
      const target = { userId, conversationId };
      const askEffects = askRecord();
      const asks = {
        record: (write: Parameters<typeof askEffects.record>[0]) =>
          database.run(askEffects.record(write)),
        dispatchOnce: (
          target: Parameters<typeof askEffects.dispatchOnce>[0],
          id: string,
          dispatch: Parameters<typeof askEffects.dispatchOnce>[2],
        ) => database.run(askEffects.dispatchOnce(target, id, dispatch)),
      };
      const mac = new Mac(userId);

      let snapshot = await mac.poll("launch");
      assert.equal(snapshot.settled, true);
      assert.equal(snapshot.groups.length, 0);

      /** A write landed; the picture holds every group it held, and one more where the write opened one. */
      async function holds(label: string, groups: number): Promise<ConversationViewSnapshot> {
        snapshot = await mac.poll(label);
        assert.equal(snapshot.settled, true, mac.log);
        assert.equal(snapshot.groups.length, groups, mac.log);
        return snapshot;
      }

      async function write(
        conversation: { readonly userId: string; readonly conversationId: string },
        event: BrainRunEvent,
      ): Promise<void> {
        const result = await database.run(writer.consume(conversation, event));
        assert.ok(result.ok, JSON.stringify(result));
      }

      // Two exchanges in the usual order: the voice writer's cut lands before the turn starts.
      for (const exchange of [1, 2]) {
        const settled = exchange - 1;
        tick();
        const delegationId = `dl_${exchange}`;
        const ask = await asks.record({
          userId,
          conversationId,
          clientId: delegationId,
          origin: ASK_ORIGIN.SPOKEN,
          question: `fixture ask ${exchange}`,
          createdAt: new Date(now()),
        });
        await holds(`${exchange}: ask recorded`, settled);

        tick();
        const line = await database.run(
          writer.recordUserMessage(target, {
            clientId: delegationId,
            turnOfAsk: true,
            text: `fixture ask ${exchange}`,
            metadata: VOICE_ASK,
          }),
        );
        assert.ok(line.ok);
        await holds(`${exchange}: line written`, settled + 1);

        tick();
        const stream = new Stream(randomUUID());
        await write(target, stream.started(BRAIN_TURN_ORIGIN.SPOKEN));
        await holds(`${exchange}: turn started`, settled + 1);
        await asks.dispatchOnce(target, ask.id, async () => ({
          sessionId: `wrun_${exchange}`,
          turnId: stream.turnId,
        }));
        assert.deepEqual(await database.run(writer.attachAskLines(target, stream.turnId)), {
          ok: true,
          attached: [line.id],
        });
        await holds(`${exchange}: line taken into the turn`, settled + 1);

        tick();
        await write(target, stream.step());
        await holds(`${exchange}: journal open`, settled + 1);
        tick();
        await write(target, stream.answered(`fixture reply ${exchange}`));
        await holds(`${exchange}: answered`, settled + 1);
        tick();
        await write(target, stream.ended());
        const ended = await holds(`${exchange}: turn ended`, settled + 1);
        assert.deepEqual(
          ended.groups.at(-1)?.messages.map((message) => message.message.role),
          EXCHANGE_ROLES,
          mac.log,
        );
        await holds(`${exchange}: quiet`, settled + 1);
      }

      // An observed conversation's observation turn opens its journal and leaves it open through the next exchange.
      tick();
      const observedId = await database.run(
        standingObservedConversation(userId, SESSION, new Date(now())),
      );
      assert.ok(observedId !== undefined);
      const observed = { userId, conversationId: observedId };
      const observation = new Stream(randomUUID());
      await write(observed, observation.started(BRAIN_TURN_ORIGIN.OBSERVATION));
      await write(observed, observation.step());
      // An observed row with neither announcement nor action is not drawn, so the picture holds as it was.
      await holds("observation journal open", 2);

      // A third exchange in the other order: the turn opens its journal before the voice writer's cut lands.
      tick();
      const lateAsk = await asks.record({
        userId,
        conversationId,
        clientId: "dl_3",
        origin: ASK_ORIGIN.SPOKEN,
        question: "fixture ask 3",
        createdAt: new Date(now()),
      });
      const late = new Stream(randomUUID());
      await write(target, late.started(BRAIN_TURN_ORIGIN.SPOKEN));
      await asks.dispatchOnce(target, lateAsk.id, async () => ({
        sessionId: "wrun_3",
        turnId: late.turnId,
      }));
      assert.deepEqual(await database.run(writer.attachAskLines(target, late.turnId)), {
        ok: true,
        attached: [],
      });
      await write(target, late.step());
      const previewed = await holds("3: journal open before the line", 3);
      assert.deepEqual(
        previewed.groups.at(-1)?.messages.map((message) => message.message.role),
        [MESSAGE_ROLE.ASSISTANT],
        mac.log,
      );

      tick();
      const lateLine = await database.run(
        writer.recordUserMessage(target, {
          clientId: "dl_3",
          turnOfAsk: true,
          text: "fixture ask 3",
          metadata: VOICE_ASK,
        }),
      );
      assert.ok(lateLine.ok);
      // The line stands ahead of the journal the store moved behind it, and the journal stands once.
      const reordered = await holds("3: line landed after the journal", 3);
      assert.deepEqual(
        reordered.groups.at(-1)?.messages.map((message) => message.message.role),
        EXCHANGE_ROLES,
        mac.log,
      );

      tick();
      await write(target, late.answered("fixture reply 3"));
      await holds("3: answered", 3);
      tick();
      await write(target, late.ended());
      const done = await holds("3: turn ended", 3);
      assert.deepEqual(
        done.groups.map((group) => group.turn?.status),
        ["settled", "settled", "settled"],
        mac.log,
      );
      await holds("3: quiet", 3);

      // An exchange the voice model answers itself: the developer's settled utterance and
      // Luke's settled answer are cut into rows of their own by the voice writer, from the
      // segments the deltas left, with no turn and no delegation. Both reach the picture,
      // and nothing leaves it.
      tick();
      const liveSessionId = `sess_${randomUUID()}`;
      await promisedVoiceSessionRecord(database.run, voiceSessionRecord(now)).register({
        userId,
        sessionId: liveSessionId,
      });
      const voice = voiceWriter({ store: writer });
      const live = { userId, liveSessionId, conversation: target };
      for (const event of [
        heard("Which agent is", 1000, 2200),
        heard(" waiting on me?", 2100, 3400),
        said("The fixture agent,", 3600, 4800),
        said(" on a permission prompt.", 4700, 6000),
      ]) {
        const result = await database.run(voice.consume(live, event));
        assert.ok(result.ok, JSON.stringify(result));
      }
      // Segments alone move nothing the panel draws.
      await holds("spoken: segments", 3);
      tick();
      const lineWritten = await database.run(
        voice.recordSpokenLine(live, { startMs: 1000, endMs: 3400 }),
      );
      assert.deepEqual(lineWritten, { ok: true, effect: STORE_WRITE_EFFECT.WRITTEN });
      const lineHeld = await holds("spoken: developer's line settled", 4);
      assert.deepEqual(
        lineHeld.groups
          .at(-1)
          ?.messages.map((message) => [message.message.role, message.message.parts]),
        [
          [
            MESSAGE_ROLE.USER,
            [
              {
                type: UI_PART_TYPE.TEXT,
                text: "Which agent is waiting on me?",
                state: UI_PART_STATE.DONE,
              },
            ],
          ],
        ],
        mac.log,
      );
      tick();
      const replyWritten = await database.run(
        voice.recordSpokenReply(live, { startMs: 3600, endMs: 6000 }),
      );
      assert.deepEqual(replyWritten, { ok: true, effect: STORE_WRITE_EFFECT.WRITTEN });
      const replyHeld = await holds("spoken: Luke's answer settled", 5);
      // Two groups of their own, the developer's line before the answer, each a settled row under no turn.
      assert.deepEqual(
        replyHeld.groups
          .slice(-2)
          .map((group) => [group.turn, group.messages.map((message) => message.message.role)]),
        [
          [undefined, [MESSAGE_ROLE.USER]],
          [undefined, [MESSAGE_ROLE.ASSISTANT]],
        ],
        mac.log,
      );
      const [lineSeq, replySeq] = replyHeld.groups
        .slice(-2)
        .map((group) => group.messages[0]?.seq ?? 0);
      assert.ok((lineSeq ?? 0) < (replySeq ?? 0), mac.log);
      await holds("spoken: quiet", 5);

      // A relaunch reads from nothing and holds the same rows in the same places.
      const relaunched = new Mac(userId);
      const fresh = await relaunched.poll("relaunch");
      assert.deepEqual(shape(fresh), shape(snapshot));
    }),
);
