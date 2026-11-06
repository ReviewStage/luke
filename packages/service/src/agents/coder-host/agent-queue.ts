import type { DatabaseServices } from "@repo/database/core/query";
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
} from "@repo/database/models/agent-queue-store";
import { type Agent, readAgent } from "@repo/database/models/agent-store";
import { awaitingLinesOfReached, latestTurnsOfReached } from "@repo/database/models/message-reads";
import { storeWriter } from "@repo/database/models/writer";
import { MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import type { HostedApiError } from "@repo/features";
import { type AgentQueue, QUEUE_PAUSE, type QueuePause } from "@repo/features/agent-queue-wire";
import { AGENT_MACHINE, AGENT_STATUS } from "@repo/features/agent-wire";
import { TURN_STATUS } from "@repo/wire";
import { Clock, DateTime, Effect, Option } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { recordServerEvent, SERVER_EVENT } from "../../events/server-events.js";
import { type HostedRefusal, hostedStoreOrUnavailable } from "../../http/http-effect.js";
import type { AgentSessions, EveTypedTurn } from "../eve-host/eve-sessions.js";
import { routedSessions } from "./runtime-sessions.js";
import { agentStatusOf, startedBlank } from "./status.js";
import { steerAgentWritten } from "./steer.js";
import { CODER_TOOL_SET } from "./tool-set.js";

export type QueueSessions = (
  account: string,
) => Effect.Effect<
  AgentSessions<EveTypedTurn>,
  HostedRefusal,
  HttpClient.HttpClient | DatabaseServices
>;

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

export function queueOnPage(agentId: string) {
  return Effect.gen(function* () {
    const read = yield* agentQueueNow(agentId);
    return wireQueue(read, yield* DateTime.nowAsDate);
  });
}

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

export const sendQueued = Effect.fn("web/sendQueued")(function* (
  sessionsFor: QueueSessions,
  agent: Agent,
  message: QueuedMessageRow,
) {
  const eve = yield* sessionsFor(message.userId);
  const { sent } = yield* steerAgentWritten(
    eve,
    storeWriter({ tools: CODER_TOOL_SET }),
    message.userId,
    agent,
    {
      text: message.text,
      clientKey: message.id,
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
    },
  );
  if (sent !== undefined) {
    yield* recordServerEvent(
      SERVER_EVENT.MESSAGE_SEND,
      { userId: message.userId, workspaceId: agent.organizationId },
      {
        runtime: sent.runtime,
        machine: agent.machine ?? AGENT_MACHINE.VERCEL,
        agent_kind: agent.kind,
        turn_running: sent.turnRunning,
        queued: true,
      },
    );
  }
  yield* dropQueuedMessage(agent.id, message).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("agent-queue: a sent message's drop failed", cause),
    ),
  );
});

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

export const sendClaimed = Effect.fn("web/sendClaimedQueued")(function* (
  sessionsFor: QueueSessions,
  agent: Agent,
  message: QueuedMessageRow,
) {
  yield* sendQueued(sessionsFor, agent, message).pipe(
    Effect.catch((refusal: HostedRefusal) =>
      hostedStoreOrUnavailable(
        refuseQueuedMessage(agent.id, message, refusal.error as HostedApiError),
      ),
    ),
    Effect.catchCause((cause) => Effect.logWarning("agent-queue: a hand-off failed", cause)),
  );
});

export const handOnQueue = Effect.fn("web/handOnQueue")(function* (
  sessionsFor: QueueSessions,
  agent: Agent,
) {
  const claimed = yield* claimNext(agent);
  if (Option.isSome(claimed)) yield* sendClaimed(sessionsFor, agent, claimed.value);
});

export const queueAtTurnEnd = Effect.fn("web/queueAtTurnEnd")(function* (
  sessionsFor: QueueSessions,
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
  yield* handOnQueue(sessionsFor, agent);
});

const PAUSE_OF_TURN: ReadonlyMap<string, QueuePause> = new Map([
  [TURN_STATUS.FAILED, QUEUE_PAUSE.TURN_FAILED],
]);

export const queueAtNativeTurnEnd = (agent: Agent) =>
  Effect.gen(function* () {
    yield* queueAtTurnEnd(routedSessions, agent);
  });

const QUEUE_SWEEP_LIMIT = 50;

export const sweepAgentQueues = Effect.fn("web/sweepAgentQueues")(function* (
  sessionsFor: QueueSessions,
) {
  const queues = yield* unpausedQueues(QUEUE_SWEEP_LIMIT);
  for (const { agentId, userId } of queues) {
    const agent = yield* readAgent(userId, agentId);
    if (Option.isSome(agent)) yield* handOnQueue(sessionsFor, agent.value);
  }
  return queues.length;
});
