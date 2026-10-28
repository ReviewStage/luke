/**
 * agent-queue.ts -- a coding agent's queue as the service runs it: the queue as a transcript carries it, and its messages handed on, one a turn, once the agent's turn is over.
 *
 * A message queued behind the agent's running turn waits in the store,
 * unsent (`@luke/database/models/agent-queue-store`). Once nothing runs, the
 * first one goes as its member's own message, under its own send key, so a
 * hand-off repeated sends it once (`steer.ts`'s repeat), and it opens the
 * next turn; it leaves the queue only once it went. A hand-off the service
 * refuses keeps the message, pausing the queue under the refusal, since
 * nobody watches it go to say why it did not. The agent is at work while a
 * turn runs or a message sent to it still awaits its turn, and then nothing
 * is handed on: the turn's end hands on the next (`runner-events-app.ts`'s
 * `turnEnded`), and so does a message queued, the queue put in a new order,
 * or Resume while the agent stands idle, so a queue never waits on a turn
 * end that came and went.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import {
  type AgentQueueRead,
  agentQueueNow,
  dropQueuedMessage,
  heldAt,
  pauseAgentQueue,
  type QueuedMessageRow,
  queueHead,
} from "@luke/database/models/agent-queue-store";
import { type CodingAgent, RUNNING_TURN_STATUSES } from "@luke/database/models/coding-agent-store";
import { awaitingLinesOfReached, latestTurnsOfReached } from "@luke/database/models/message-reads";
import { storeWriter } from "@luke/database/models/writer";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import type { HostedApiError } from "@luke/features";
import { type AgentQueue, QUEUE_PAUSE } from "@luke/features/agent-queue-wire";
import { Clock, DateTime, Duration, Effect, Option } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { type HostedRefusal, hostedStoreOrUnavailable } from "../../http/http-effect.js";
import { deploymentEve, deploymentEveForAccounts } from "../deployment-eve.js";
import { deploymentEveOrigin } from "../eve-host/eve-origin.js";
import { type AgentSessions, EVE_MOUNT, type EveTypedTurn } from "../eve-host/eve-sessions.js";
import { CODER } from "./bounds.js";
import { routedSessions } from "./runtime-sessions.js";
import { steerCodingAgentWritten } from "./steer.js";
import { type EveReach, eveFor } from "./stop.js";
import { CODER_TOOL_SET } from "./tool-set.js";

/** eve as the service reaches it acting for one member, whose queued message goes as theirs, or the refusal where it cannot. */
export type QueueEve = (
  account: string,
) => Effect.Effect<
  AgentSessions<EveTypedTurn>,
  HostedRefusal,
  HttpClient.HttpClient | DatabaseServices
>;

/**
 * eve for the queue a request changed, acting for each member whose queued
 * message it sends: the request's own caller as `eveFor` reaches them, and
 * any other member as the deployment acting for them, since a message
 * another member queued goes as theirs.
 */
export function queueEveFor(reach: EveReach, request: Request, requester: string): QueueEve {
  return (account) =>
    account === requester
      ? eveFor<EveTypedTurn>(reach, request, account)
      : Effect.gen(function* () {
          if (reach.eveAs !== undefined)
            return yield* routedSessions(reach.eveAs(account), account);
          const eveAs = yield* deploymentEve<EveTypedTurn>(reach.eveOrigin(), EVE_MOUNT.CODER);
          return eveAs(account);
        });
}

/** The queue as a transcript carries it at `now`: its messages, which of them an edit holds, and its pause; nothing while none is queued. */
export function wireQueue(read: AgentQueueRead, now: Date): AgentQueue | undefined {
  if (read.messages.length === 0) return undefined;
  return {
    messages: read.messages.map((message) => ({
      id: message.id,
      text: message.text,
      queuedBy: message.userId,
      ...(heldAt(message, now) ? { editing: true as const } : undefined),
      ...(message.attachments.length === 0
        ? undefined
        : {
            files: message.attachments.map((file) => ({
              name: file.name,
              mediaType: file.mediaType,
            })),
          }),
    })),
    ...(read.paused === undefined
      ? undefined
      : {
          paused: {
            because: read.paused.because,
            ...(read.paused.refusal === undefined ? undefined : { refusal: read.paused.refusal }),
          },
        }),
  };
}

/** The agent's queue as a transcript of its own carries it. */
export function queueOnPage(agentId: string) {
  return Effect.gen(function* () {
    const read = yield* agentQueueNow(agentId);
    return wireQueue(read, yield* DateTime.nowAsDate);
  });
}

/** Whether the agent is at work: a turn runs, or a message sent to it still awaits its turn within the grace a line reads as awaiting. */
const atWork = Effect.fn("web/queueAtWork")(function* (agent: CodingAgent) {
  const turns = yield* latestTurnsOfReached([agent.conversationId]);
  const turn = turns.get(agent.conversationId);
  if (turn !== undefined && RUNNING_TURN_STATUSES.has(turn.status)) return true;
  const awaiting = (yield* awaitingLinesOfReached([agent.conversationId])).get(
    agent.conversationId,
  );
  const now = yield* Clock.currentTimeMillis;
  return awaiting !== undefined && now - awaiting.getTime() < Duration.toMillis(CODER.LINE_GRACE);
});

/**
 * One queued message sent now as its member's own message, under its own
 * send key, and taken out of the queue once it went: as the next turn where
 * none runs, or steering the one under way.
 */
export const sendQueued = Effect.fn("web/sendQueued")(function* (
  eveFor: QueueEve,
  agent: CodingAgent,
  message: QueuedMessageRow,
) {
  const eve = yield* eveFor(message.userId);
  yield* steerCodingAgentWritten(
    eve,
    storeWriter({ tools: CODER_TOOL_SET }),
    message.userId,
    agent,
    {
      text: message.text,
      clientKey: message.clientKey,
      ...(message.attachments.length === 0 ? undefined : { attachments: message.attachments }),
      sender: { kind: MESSAGE_SENDER.MEMBER, userId: message.userId },
    },
  );
  yield* hostedStoreOrUnavailable(dropQueuedMessage(agent.id, message.id));
});

/**
 * The agent's queue handed on where the agent stands idle and the queue
 * unpaused: its first message sent as the next turn. A refusal keeps the
 * message and pauses the queue under it, and any failure is logged rather
 * than answered, since whoever's act set this off is not waiting on it.
 */
export const handOnQueue = Effect.fn("web/handOnQueue")(function* (
  eveFor: QueueEve,
  agent: CodingAgent,
) {
  const step = Effect.gen(function* () {
    if (yield* hostedStoreOrUnavailable(atWork(agent))) return;
    const head = yield* hostedStoreOrUnavailable(queueHead(agent.id));
    if (Option.isNone(head)) return;
    yield* sendQueued(eveFor, agent, head.value).pipe(
      Effect.catch((refusal: HostedRefusal) =>
        hostedStoreOrUnavailable(
          pauseAgentQueue(agent.id, QUEUE_PAUSE.REFUSED, refusal.error as HostedApiError),
        ),
      ),
    );
  });
  yield* step.pipe(
    Effect.catchCause((cause) => Effect.logWarning("agent-queue: a hand-off failed", cause)),
  );
});

/** The agent's queue paused at its turn's end where the turn was stopped or failed, and handed on otherwise. */
export const queueAtTurnEnd = Effect.fn("web/queueAtTurnEnd")(function* (
  eveFor: QueueEve,
  agent: CodingAgent,
  ended: { readonly stopped: boolean; readonly failed: boolean },
) {
  if (ended.stopped || ended.failed) {
    const because = ended.stopped ? QUEUE_PAUSE.STOPPED : QUEUE_PAUSE.TURN_FAILED;
    return yield* pauseAgentQueue(agent.id, because).pipe(
      Effect.catchCause((cause) => Effect.logWarning("agent-queue: a pause failed", cause)),
    );
  }
  yield* handOnQueue(eveFor, agent);
});

/**
 * The queue at a native agent's turn's end, as the runner's events route
 * tells it (`../native-events/runner-events-app.ts`'s `turnEnded`): eve
 * reached as the deployment acting for each queued message's member, since
 * no request of theirs stands behind it.
 */
export const queueAtNativeTurnEnd = (
  agent: CodingAgent,
  ended: { readonly stopped: boolean; readonly failed: boolean },
) =>
  Effect.gen(function* () {
    const eveFor = yield* deploymentEveForAccounts<EveTypedTurn>(
      deploymentEveOrigin(),
      EVE_MOUNT.CODER,
    );
    yield* queueAtTurnEnd(eveFor, agent, ended);
  });
