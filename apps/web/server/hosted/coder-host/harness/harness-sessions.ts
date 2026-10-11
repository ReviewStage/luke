import { randomUUID } from "node:crypto";
import { Cause, Data, Effect, Exit, Fiber, Option, Queue, Stream } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type { SqlClient } from "effect/unstable/sql";
import type { GitHubApp } from "../../../github/github-app.js";
import { BRAIN_HOST_TURN } from "../../brain-host/bounds.js";
import { claimRuntimeSession } from "../../brain-host/conversation.js";
import {
  EVE_CANCEL_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveSessions,
} from "../../brain-host/eve-sessions.js";
import { memoryRelayState, type RelayStanding, StreamRelay } from "../../brain-host/relay.js";
import {
  type CodingAgent,
  readCodingAgentOfConversation,
  updateCodingAgentBranch,
} from "../../coding-agent-store.js";
import type { RepositorySandbox } from "../../repository-shell.js";
import type { ConversationTarget, StoreWriter } from "../../store/index.js";
import { checkoutBranch } from "../checkout.js";
import type { HarnessRuntime } from "./runtime-flag.js";
import { HarnessTurnEvents } from "./stream-events.js";

/**
 * harness-sessions.ts -- SPIKE (do not merge): a coding agent's Start, message, and Stop run on an official harness rather than on eve.
 *
 * The routes reach a coding agent through `EveSessions` alone (open with
 * the first message, send a later one, cancel a turn by id), so the
 * harness path is another implementation of that one interface and no
 * route changes shape. A turn is the harness's `stream()` read part by
 * part, each part told as the eve event of the same moment
 * (`stream-events.ts`) and handed to the shared relay, which writes the
 * turn, its journal, and its usage exactly as it writes an eve turn; the
 * transcript route, the status, and the tab read it unchanged. The
 * conversation's runtime session is claimed under the harness session's
 * own id, so a message and a Stop find it where they find eve's.
 *
 * What eve did and this file has to do instead: hold the turn. eve's
 * workflow runs a turn durably, past any one function; here the turn runs
 * in the sandbox's bridge, but the host reading it is a fiber of whichever
 * function forked it (`seams.fork`), so a turn longer than the function's
 * life needs the harness's `detach`/`continueFrom` from a durable driver
 * (`@ai-sdk/workflow-harness`), which this spike does not build. A Stop is
 * the turn's fiber interrupted, which aborts the harness's stream through
 * its signal; a Stop that lands on another function instance would have to
 * be carried through the turn row's stamp, which this spike does not
 * build either. Between turns the session is parked and its lifecycle
 * state kept (`seams.parked`), which the next turn resumes from.
 */

/** A harness turn the runtime could not open or run, in words fit for a log line. */
export class HarnessRefused extends Data.TaggedError("HarnessRefused")<{
  readonly reason: string;
}> {}

/** One agent's harness session as a turn reaches it: a turn's parts, and the session parked once the turn is done. */
export interface HarnessConversation {
  /** The model id the session runs on, as the turn row records it. */
  readonly modelId: string;
  /** One turn's AI SDK `fullStream`; the signal aborts the turn in the sandbox. */
  turn(prompt: string, abortSignal: AbortSignal): Promise<AsyncIterable<unknown>>;
  /** The session parked between turns: answers the lifecycle state the next turn resumes from. */
  park(): Promise<unknown>;
  /** The sandbox the checkout stands in, for the branch the turn ends on. */
  readonly sandbox: RepositorySandbox;
}

/** What the harness path is composed over: the deployment's in production, scripted doubles in a test. */
export interface HarnessSessionsSeams {
  readonly runtime: HarnessRuntime;
  /** The agent's session opened, or resumed from the state its last turn parked it in, with its checkout standing. */
  openConversation(
    target: ConversationTarget,
    agent: CodingAgent,
    parkedState: unknown,
  ): Effect.Effect<HarnessConversation, HarnessRefused, HarnessServices>;
  /** The parked state of each conversation's session, between its turns. */
  readonly parked: Map<string, unknown>;
  /** The turn under way on this instance for each conversation, whose fiber a Stop interrupts. */
  readonly running: Map<string, RunningTurn>;
  readonly writer: () => Effect.Effect<StoreWriter>;
  readonly now: () => number;
  /** Runs a turn past the request that started it: a detached fiber here, a durable driver in a real build. */
  fork(
    turn: Effect.Effect<void, never, HarnessServices>,
  ): Effect.Effect<void, never, HarnessServices>;
}

export type HarnessServices = SqlClient.SqlClient | HttpClient.HttpClient | GitHubApp;

/** A turn under way: the id it is recorded under, and the fiber reading its stream. */
export interface RunningTurn {
  readonly eveTurnId: string;
  readonly fiber: Fiber.Fiber<void, HarnessRefused>;
}

/** The harness session id for a conversation: one per conversation, as eve's is. */
export function harnessSessionId(conversationId: string): string {
  return `hrun_${conversationId}`;
}

/** The turn's parts read into a queue as the harness streams them, so the fiber reading the queue can relay each through the store. */
function streamInto(
  conversation: HarnessConversation,
  prompt: string,
  parts: Queue.Queue<unknown, Cause.Done>,
): Effect.Effect<void, HarnessRefused> {
  return Effect.tryPromise({
    try: async (signal) => {
      for await (const part of await conversation.turn(prompt, signal))
        Queue.offerUnsafe(parts, part);
    },
    catch: (cause) =>
      new HarnessRefused({ reason: cause instanceof Error ? cause.message : String(cause) }),
  }).pipe(Effect.ensuring(Queue.end(parts)));
}

/**
 * One turn, start to end: the harness session opened or resumed, every
 * part told to the relay as it lands, and the turn's end told whatever
 * ended it; then the branch the checkout stands on recorded for the pull
 * request, and the session parked for the next turn.
 */
const runTurn = (
  seams: HarnessSessionsSeams,
  target: ConversationTarget,
  agent: CodingAgent,
  eveTurnId: string,
  message: string,
) =>
  Effect.gen(function* () {
    const sessionId = harnessSessionId(target.conversationId);
    const relay = new StreamRelay({
      writer: yield* seams.writer(),
      now: seams.now,
      report: (line) => console.warn(line),
    });
    const standing: RelayStanding = {
      sessionId,
      target,
      turn: BRAIN_HOST_TURN.TYPED,
      model: agent.model,
      reasoningEffort: agent.effort,
      state: memoryRelayState(),
    };
    const translator = new HarnessTurnEvents({
      turnId: eveTurnId,
      modelId: agent.model,
      now: seams.now,
    });
    const tell = (events: ReturnType<HarnessTurnEvents["events"]>) =>
      Effect.forEach(events, (event) => relay.handle(event, standing), { discard: true });
    yield* tell(translator.opening(message));
    const opened = yield* Effect.exit(
      seams.openConversation(target, agent, seams.parked.get(target.conversationId)),
    );
    if (Exit.isFailure(opened)) {
      yield* tell(translator.events({ type: "error", error: Cause.squash(opened.cause) }));
      return;
    }
    const conversation = opened.value;
    const parts = yield* Queue.unbounded<unknown, Cause.Done>();
    const streaming = yield* Effect.forkChild(streamInto(conversation, message, parts));
    seams.running.set(target.conversationId, { eveTurnId, fiber: streaming });
    yield* Stream.fromQueue(parts).pipe(Stream.runForEach((part) => tell(translator.events(part))));
    const ended = yield* Fiber.await(streaming);
    seams.running.delete(target.conversationId);
    // A turn interrupted by a Stop, or whose stream broke before it said how it ended, is told so here.
    if (Exit.isFailure(ended)) {
      yield* tell(
        Cause.hasInterruptsOnly(ended.cause)
          ? translator.cancelled()
          : translator.events({ type: "error", error: Cause.squash(ended.cause) }),
      );
    } else if (!translator.ended) {
      yield* tell(translator.cancelled());
    }
    const branch = yield* Effect.option(checkoutBranch(conversation.sandbox));
    if (Option.isSome(branch))
      yield* updateCodingAgentBranch(target.userId, agent.id, branch.value);
    const parked = yield* Effect.tryPromise(() => conversation.park()).pipe(Effect.option);
    if (Option.isSome(parked)) seams.parked.set(target.conversationId, parked.value);
  }).pipe(
    Effect.catch((failure) =>
      Effect.logWarning(`A harness turn of ${target.conversationId} failed: ${failure._tag}`),
    ),
  );

/** The id a harness turn is recorded under, as eve's turn id is: unique to the conversation, sorting in the order turns start. */
function harnessTurnId(now: number): string {
  return `hturn_${String(now).padStart(15, "0")}_${randomUUID()}`;
}

/**
 * The harness path as the routes reach eve, for one account: a Start's
 * first message, a later message, and a Stop, each answered in eve's own
 * outcomes so the routes read them unchanged. Note that a message that
 * lands while a turn runs is refused as not ready rather than steered in,
 * because both adapters mark steering experimental; the desktop retries a
 * not-ready send.
 */
export const harnessSessions = (
  seams: HarnessSessionsSeams,
  userId: string,
): Effect.Effect<EveSessions, never, HarnessServices> =>
  Effect.map(Effect.context<HarnessServices>(), (context): EveSessions => {
    const startTurn = (conversationId: string, message: string) =>
      Effect.gen(function* () {
        const target = { userId, conversationId };
        const agent = yield* readCodingAgentOfConversation(userId, conversationId);
        if (Option.isNone(agent)) return undefined;
        const sessionId = harnessSessionId(conversationId);
        yield* claimRuntimeSession(target, sessionId, new Date(seams.now()));
        yield* seams.fork(runTurn(seams, target, agent.value, harnessTurnId(seams.now()), message));
        return sessionId;
      }).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
        Effect.provideContext(context),
      );
    return {
      open: (message) =>
        Effect.map(startTurn(message.conversationId, message.message), (sessionId) =>
          sessionId === undefined
            ? { outcome: EVE_SEND_OUTCOME.FAILED, status: 404 }
            : { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId },
        ),
      send: (_sessionId, message) =>
        seams.running.has(message.conversationId)
          ? Effect.succeed({ outcome: EVE_SEND_OUTCOME.NOT_READY })
          : Effect.map(startTurn(message.conversationId, message.message), (sessionId) =>
              sessionId === undefined
                ? { outcome: EVE_SEND_OUTCOME.RETIRED }
                : { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId, deliveryId: sessionId },
            ),
      cancel: (sessionId, eveTurnId) => {
        const turn = [...seams.running.entries()].find(
          ([conversationId, running]) =>
            harnessSessionId(conversationId) === sessionId && running.eveTurnId === eveTurnId,
        );
        if (turn === undefined) {
          return Effect.succeed({ outcome: EVE_CANCEL_OUTCOME.NO_ACTIVE_TURN });
        }
        return Effect.as(Fiber.interrupt(turn[1].fiber), { outcome: EVE_CANCEL_OUTCOME.ACCEPTED });
      },
    };
  });
