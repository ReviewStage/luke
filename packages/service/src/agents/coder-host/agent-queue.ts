/**
 * agent-queue.ts -- a coding agent's queue as the service runs it: the queue as a transcript carries it, and its messages handed on, one a turn, once the agent's turn is over.
 *
 * A message queued behind the agent's turn waits in the store, unsent
 * (`@luke/database/models/agent-queue-store`, whose header writes down the
 * states a message moves through). Once the agent stands idle, the first one
 * is claimed, which takes it off every window's queue and out of reach of a
 * member's change, and then sent as its member's own message, under its own
 * send key, so a hand-off repeated sends it once (`steer.ts`'s repeat); it
 * opens the next turn, and leaves the queue once it went. A send the service
 * refuses lets the message go back to its place and pauses the queue under
 * the refusal, since nobody watches it go to say why it did not.
 *
 * The agent is at work while it starts, while a turn runs, and while a
 * message sent to it awaits its turn, as its status reads
 * (`agentStatusOf`), and then nothing is handed on: the turn's end
 * hands on the next (`runner-events-app.ts`'s `turnEnded`), and so does a
 * change a member makes while the agent stands idle, so a queue never waits
 * on a turn end that came and went. A member's change claims in the request
 * itself (`claimNext`), before its answer reads the queue, so the answer
 * never lists a message about to go, and sends after the response
 * (`sendClaimed`), which no answer waits on.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import {
  type AgentQueueRead,
  agentQueueNow,
  claimedAt,
  claimQueueHead,
  dropQueuedMessage,
  pauseAgentQueue,
  type QueuedMessageRow,
  refuseQueuedMessage,
  unpausedQueues,
} from "@luke/database/models/agent-queue-store";
import { type Agent, readAgent } from "@luke/database/models/agent-store";
import { awaitingLinesOfReached, latestTurnsOfReached } from "@luke/database/models/message-reads";
import { storeWriter } from "@luke/database/models/writer";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import type { HostedApiError } from "@luke/features";
import { type AgentQueue, QUEUE_PAUSE, type QueuePause } from "@luke/features/agent-queue-wire";
import { AGENT_STATUS } from "@luke/features/agent-wire";
import { TURN_STATUS } from "@luke/wire";
import { Clock, DateTime, Effect, Option } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { type HostedRefusal, hostedStoreOrUnavailable } from "../../http/http-effect.js";
import { deploymentEve, deploymentEveForAccounts } from "../deployment-eve.js";
import { deploymentEveOrigin } from "../eve-host/eve-origin.js";
import { type AgentSessions, EVE_MOUNT, type EveTypedTurn } from "../eve-host/eve-sessions.js";
import { routedSessions } from "./runtime-sessions.js";
import { agentStatusOf, startedBlank } from "./status.js";
import { steerAgentWritten } from "./steer.js";
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

/**
 * The queue as the agent's own transcript carries it at `now`, on every
 * page, empty or not: its messages but one being sent, which of them a
 * member is editing, its pause, and its revision, which a window's change still out is
 * drawn over until a page stands at.
 */
export function wireQueue(read: AgentQueueRead, now: Date): AgentQueue {
  const queued = read.messages.filter((message) => !claimedAt(message, now));
  return {
    messages: queued.map((message) => ({
      id: message.id,
      text: message.text,
      queuedBy: message.userId,
      ...(message.editing ? { editing: true as const } : undefined),
      ...(message.attachments.length === 0
        ? undefined
        : {
            files: message.attachments.map((file) => ({
              name: file.name,
              mediaType: file.mediaType,
              id: file.id,
            })),
          }),
    })),
    // Note that a pause stands only over messages, so one a member's messages cascaded out from under reads as none.
    ...(read.paused === undefined || queued.length === 0
      ? undefined
      : {
          paused: {
            because: read.paused.because,
            ...(read.paused.refusal === undefined ? undefined : { refusal: read.paused.refusal }),
          },
        }),
    revision: read.revision,
  };
}

/** The agent's queue as a transcript of its own carries it. */
export function queueOnPage(agentId: string) {
  return Effect.gen(function* () {
    const read = yield* agentQueueNow(agentId);
    return wireQueue(read, yield* DateTime.nowAsDate);
  });
}

/** Whether the agent is at work, as its status reads: starting, a turn running, or a message sent to it awaiting its turn. */
const atWork = Effect.fn("web/queueAtWork")(function* (agent: Agent) {
  const turn = (yield* latestTurnsOfReached([agent.conversationId])).get(agent.conversationId);
  const awaitingLineAt = (yield* awaitingLinesOfReached([agent.conversationId])).get(
    agent.conversationId,
  );
  const status = agentStatusOf(turn, {
    createdAt: agent.createdAt,
    now: yield* Clock.currentTimeMillis,
    awaitingLineAt,
    blank: startedBlank(agent),
  });
  return status === AGENT_STATUS.STARTING || status === AGENT_STATUS.RUNNING;
});

/**
 * One claimed message sent now as its member's own message, under its own
 * send key, and taken out of the queue once it went: as the next turn where
 * none runs, or steering the one under way. A refusal fails, the message
 * still claimed, for its caller to let go of.
 */
export const sendQueued = Effect.fn("web/sendQueued")(function* (
  eveFor: QueueEve,
  agent: Agent,
  message: QueuedMessageRow,
) {
  const eve = yield* eveFor(message.userId);
  yield* steerAgentWritten(eve, storeWriter({ tools: CODER_TOOL_SET }), message.userId, agent, {
    text: message.text,
    clientKey: message.id,
    // Note that each file goes as it came, without the id the queue read its bytes by.
    ...(message.attachments.length === 0
      ? undefined
      : {
          attachments: message.attachments.map(({ name, mediaType, data }) => ({
            name,
            mediaType,
            data,
          })),
        }),
    sender: { kind: MESSAGE_SENDER.MEMBER, userId: message.userId },
  });
  // Note that the message went, so a failure to take it out of the queue is no refusal of it: it is logged, and
  // its claim left to lapse, after which the next hand-off sends it again under its id, answered as a repeat.
  yield* dropQueuedMessage(agent.id, message).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("agent-queue: a sent message's drop failed", cause),
    ),
  );
});

/**
 * The agent's next message claimed to send, where the agent stands idle and
 * the queue unpaused; none otherwise. Run inside a member's request before
 * its answer reads the queue, so the answer already leaves the message out.
 * A failure is logged rather than answered, and claims nothing.
 */
export const claimNext = Effect.fn("web/claimNextQueued")(function* (agent: Agent) {
  const step = Effect.gen(function* () {
    if (yield* hostedStoreOrUnavailable(atWork(agent))) return Option.none<QueuedMessageRow>();
    return yield* hostedStoreOrUnavailable(claimQueueHead(agent.id));
  });
  return yield* step.pipe(
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logWarning("agent-queue: a claim failed", cause),
        Option.none<QueuedMessageRow>(),
      ),
    ),
  );
});

/**
 * A message the hand-off claimed, sent. A refusal lets it go back to its
 * place and pauses the queue under the refusal; any other failure is logged,
 * its claim left to lapse, after which the next hand-off sends it again
 * under its id. Nobody's answer waits on it.
 */
export const sendClaimed = Effect.fn("web/sendClaimedQueued")(function* (
  eveFor: QueueEve,
  agent: Agent,
  message: QueuedMessageRow,
) {
  yield* sendQueued(eveFor, agent, message).pipe(
    Effect.catch((refusal: HostedRefusal) =>
      hostedStoreOrUnavailable(
        refuseQueuedMessage(agent.id, message, refusal.error as HostedApiError),
      ),
    ),
    Effect.catchCause((cause) => Effect.logWarning("agent-queue: a hand-off failed", cause)),
  );
});

/** The agent's queue handed on where the agent stands idle and the queue unpaused: its next message claimed, then sent. */
export const handOnQueue = Effect.fn("web/handOnQueue")(function* (eveFor: QueueEve, agent: Agent) {
  const claimed = yield* claimNext(agent);
  if (Option.isSome(claimed)) yield* sendClaimed(eveFor, agent, claimed.value);
});

/**
 * The agent's queue at its turn's end: paused where the turn failed, as its
 * row says, and handed on otherwise. Note that a turn stopped pauses nothing
 * here, because the Stop paused the queue as it was asked (`stop.ts`), and a
 * Resume since then must stand; and that the row is read rather than the
 * runner's word for its end, because a turn the CLI failed may end its
 * launch as any other.
 */
export const queueAtTurnEnd = Effect.fn("web/queueAtTurnEnd")(function* (
  eveFor: QueueEve,
  agent: Agent,
) {
  const turns = yield* latestTurnsOfReached([agent.conversationId]).pipe(
    Effect.catchCause((cause) =>
      Effect.as(Effect.logWarning("agent-queue: a turn read failed", cause), undefined),
    ),
  );
  const status = turns?.get(agent.conversationId)?.status;
  const because = PAUSE_OF_TURN.get(status ?? "");
  if (because !== undefined) {
    return yield* Effect.asVoid(pauseAgentQueue(agent.id, because)).pipe(
      Effect.catchCause((cause) => Effect.logWarning("agent-queue: a pause failed", cause)),
    );
  }
  yield* handOnQueue(eveFor, agent);
});

/** Why a turn's end pauses the queue, by the status the turn ended under. */
const PAUSE_OF_TURN: ReadonlyMap<string, QueuePause> = new Map([
  [TURN_STATUS.FAILED, QUEUE_PAUSE.TURN_FAILED],
]);

/**
 * The queue at a native agent's turn's end, as the runner's events route
 * tells it (`../native-events/runner-events-app.ts`'s `turnEnded`): eve
 * reached as the deployment acting for each queued message's member, since
 * no request of theirs stands behind it.
 */
export const queueAtNativeTurnEnd = (agent: Agent) =>
  Effect.gen(function* () {
    const eveFor = yield* deploymentEveForAccounts<EveTypedTurn>(
      deploymentEveOrigin(),
      EVE_MOUNT.CODER,
    );
    yield* queueAtTurnEnd(eveFor, agent);
  });

/** How many queues a sweep hands on at most, as each of the sweep's passes is bounded. */
const QUEUE_SWEEP_LIMIT = 50;

/**
 * The maintenance sweep's pass over the queues standing unpaused: each
 * handed on where its agent idles, as a turn's end would, so a queue whose
 * turn's end found nothing to hand on (a send cut off whose claim lapsed,
 * or a turn ended outside the runner's events) still goes. Note that an
 * edit's mark cleared hands on in its own request, as every member's change
 * does. Answers how many queues it
 * looked at.
 */
export const sweepAgentQueues = Effect.fn("web/sweepAgentQueues")(function* (eveFor: QueueEve) {
  const queues = yield* unpausedQueues(QUEUE_SWEEP_LIMIT);
  for (const { agentId, userId } of queues) {
    const agent = yield* readAgent(userId, agentId);
    if (Option.isSome(agent)) yield* handOnQueue(eveFor, agent.value);
  }
  return queues.length;
});
