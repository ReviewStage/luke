import type { DatabaseServices } from "@repo/database/core/query";
import { settleEndedSessionTurn } from "@repo/database/models/abandoned-turns";
import {
  type Agent,
  type AgentLatestTurn,
  type AgentStoreEffect,
  dispatchMentioningServers,
  latestTurnsOfReached,
  RUNNING_TURN_STATUSES,
  readAgent,
  readAgentRouting,
  taskNamesOf,
  unarchiveAgentFrom,
} from "@repo/database/models/agent-store";
import { sentLineStands } from "@repo/database/models/message-reads";
import {
  claimRuntimeSession,
  recordedRuntimeSession,
} from "@repo/database/models/recorded-session";
import { readTaskDescription } from "@repo/database/models/task-store";
import { readAccountNames } from "@repo/database/models/workspace-store";
import {
  type AwaitingLineMetadata,
  type ConversationTarget,
  type LineSender,
  STORE_WRITE_EFFECT,
  STORE_WRITE_REFUSAL,
  type StoreWriter,
} from "@repo/database/models/writer";
import { type ConversationRuntime, MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import { AGENT_MACHINE, AGENT_STATUS, type AgentAttachment } from "@repo/features/agent-wire";
import { MENTION_KIND, withoutMemberLinks } from "@repo/features/mention-link";
import { agentName } from "@repo/features/model-label";
import { causeKind } from "@repo/runtime/effect";
import { sentLineId } from "@repo/wire/host-ids";
import { Clock, Effect, Option, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { MESSAGE_CHANNEL } from "../../core.js";
import { recordServerEvent, SERVER_EVENT } from "../../events/server-events.js";
import type { GitHubApp } from "../../github/github-app.js";
import {
  agentMember,
  agentWorkspace,
  workspaceRepository,
} from "../../github/workspace-repository.js";
import { HOSTED_HTTP_STATUS } from "../../http/http.js";
import {
  credentialMissing,
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../../http/http-effect.js";
import { controlsAgent, writesToAgent } from "../agent-reach.js";
import { eveContent, keptHandedImages, senderLabel } from "../attached-files.js";
import { EVE_HOST_TURN } from "../eve-host/bounds.js";
import {
  type AgentSessions,
  describeUnreachable,
  EVE_SEND_OUTCOME,
  type EveTypedTurn,
  type EveUnreachable,
} from "../eve-host/eve-sessions.js";
import { mentionedContext, mentionedServers, NO_MENTIONED_READS } from "../mentioned-context.js";
import { readMentioned } from "../mentioned-reads.js";
import { descriptionsOnFor } from "../descriptions-on.js";
import { workspaceStepOf, writtenMention } from "../written-mentions.js";
import { messageCredentialMissing } from "./agent-runtime-choice.js";
import { harnessOf } from "./native-runtime.js";
import { failedCallRefusal, routedSessions } from "./runtime-sessions.js";
import { agentStatusOf } from "./status.js";

export interface SteerLine {
  readonly text: string;
  readonly clientKey: string;
  readonly attachments?: readonly AgentAttachment[] | undefined;
  readonly sender: LineSender;
  readonly metadata?: AwaitingLineMetadata | undefined;
  readonly serverWords?: string | undefined;
}

export function agentLineSender(agent: Agent): LineSender {
  return {
    kind: MESSAGE_SENDER.AGENT,
    agentId: agent.id,
    name: agentName(agent),
    model: agent.model,
  };
}

export const STEER_OUTCOME = {
  SENT: "sent",
  REPEATED: "repeated",
} as const;

type SteerOutcome = (typeof STEER_OUTCOME)[keyof typeof STEER_OUTCOME];

const REFUSAL_OF_SEND_OUTCOME = {
  [EVE_SEND_OUTCOME.NOT_READY]: HOSTED_REFUSAL.AGENT_NOT_READY,
} as const;

const REFUSAL_OF_UNWRITTEN_LINE = {
  [STORE_WRITE_REFUSAL.NO_CONVERSATION]: HOSTED_REFUSAL.NOT_FOUND,
  [STORE_WRITE_REFUSAL.BUSY]: HOSTED_REFUSAL.UNAVAILABLE,
  [STORE_WRITE_REFUSAL.MESSAGE_REFUSED]: HOSTED_REFUSAL.INVALID_REQUEST,
} as const;

const opensUnclaimed = (agent: Agent) =>
  Effect.map(
    Clock.currentTimeMillis,
    (now) =>
      (agent.descriptionSnapshot === null && agent.prompt === null) ||
      agentStatusOf(undefined, { createdAt: agent.createdAt, now }) === AGENT_STATUS.FAILED,
  );

const unreached = (failure: EveUnreachable) =>
  Effect.as(
    Effect.logWarning(
      `eve could not be reached to message a coding agent: ${describeUnreachable(failure)}`,
    ),
    { outcome: EVE_SEND_OUTCOME.FAILED, status: HOSTED_HTTP_STATUS.BAD_GATEWAY } as const,
  );

const FORMER_MEMBER = "A former member";

const teammateLabel = (agent: Agent, sender: LineSender) => {
  if (sender.kind !== MESSAGE_SENDER.MEMBER || sender.userId === agent.userId) {
    return Effect.succeed(undefined);
  }
  const { userId } = sender;
  return Effect.map(
    Effect.all([readAccountNames([userId]), workspaceStepOf(agent.userId, agent.organizationId)], {
      concurrency: "unbounded",
    }),
    ([names, step]) =>
      senderLabel(
        writtenMention(
          { kind: MENTION_KIND.PERSON, userId },
          names.get(userId) ?? FORMER_MEMBER,
          step,
        ),
      ),
  );
};

const claimedFor = (target: ConversationTarget, sessionId: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    yield* claimRuntimeSession(target, sessionId, new Date(now));
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning(
        `a coding agent's fresh session did not claim its record: ${causeKind(cause)}`,
      ),
    ),
  );

const runningTurnOf = (agent: Agent) =>
  Effect.map(
    hostedStoreOrUnavailable(latestTurnsOfReached([agent.conversationId])),
    (turns): AgentLatestTurn | undefined => {
      const turn = turns.get(agent.conversationId);
      return turn !== undefined && RUNNING_TURN_STATUSES.has(turn.status) ? turn : undefined;
    },
  );

const settledEnded = (writer: Effect.Effect<StoreWriter>, agent: Agent, turn: AgentLatestTurn) =>
  Effect.gen(function* () {
    const write = yield* writer;
    const now = yield* Clock.currentTimeMillis;
    yield* settleEndedSessionTurn(
      write,
      { id: turn.id, userId: agent.userId, conversationId: agent.conversationId },
      now,
    );
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning(
        `the turn of a coding agent whose session ended was not settled: ${causeKind(cause)}`,
      ),
    ),
  );

const refusalNow = /* @__PURE__ */ Effect.fnUntraced(function* (userId: string, agent: Agent) {
  const tasks = agent.taskId === null ? undefined : yield* taskNamesOf(userId, [agent.taskId]);
  if (agent.taskId !== null && tasks?.has(agent.taskId) !== true) return HOSTED_REFUSAL.NOT_FOUND;
  const now = yield* readAgent(userId, agent.id);
  return Option.isNone(now) || now.value.archivedAt !== null ? HOSTED_REFUSAL.NOT_FOUND : undefined;
});

export interface SteerWritten {
  readonly outcome: SteerOutcome;
  readonly txid?: string;
  readonly sent?: { readonly runtime: ConversationRuntime; readonly turnRunning: boolean };
}

export const steerAgent = (
  eve: AgentSessions<EveTypedTurn>,
  writer: Effect.Effect<StoreWriter>,
  userId: string,
  agent: Agent,
  line: SteerLine,
) => Effect.map(steerAgentWritten(eve, writer, userId, agent, line), (written) => written.outcome);

export const steerAgentWritten = /* @__PURE__ */ Effect.fn("web/steerAgent")(function* (
  eve: AgentSessions<EveTypedTurn>,
  writer: Effect.Effect<StoreWriter>,
  userId: string,
  agent: Agent,
  line: SteerLine,
): Effect.fn.Return<
  SteerWritten,
  HostedRefusal,
  DatabaseServices | HttpClient.HttpClient | GitHubApp
> {
  if (!controlsAgent(userId, agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  const target = { userId: agent.userId, conversationId: agent.conversationId };
  const read = yield* Effect.all(
    {
      routing: Effect.result(hostedStoreOrUnavailable(readAgentRouting(userId, agent.id))),
      repeated: Effect.result(
        hostedStoreOrUnavailable(
          sentLineStands(agent.userId, agent.conversationId, sentLineId(line.clientKey)),
        ),
      ),
      task: Effect.result(
        agent.taskId === null
          ? Effect.succeed(undefined)
          : hostedStoreOrUnavailable(readTaskDescription(userId, agent.taskId)),
      ),
      workspace: Effect.result(hostedStoreOrUnavailable(agentWorkspace(userId, agent))),
      sessionId: Effect.result(hostedStoreOrUnavailable(recordedRuntimeSession(target))),
      running: Effect.result(runningTurnOf(agent)),
      label: Effect.result(hostedStoreOrUnavailable(teammateLabel(agent, line.sender))),
    },
    { concurrency: "unbounded" },
  );
  const routing = yield* Effect.fromResult(read.routing);
  if (Option.isNone(routing)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { runtime, payer } = routing.value;
  if (!writesToAgent(userId, agent, payer)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  const missing =
    harnessOf(runtime) === undefined
      ? undefined
      : yield* hostedStoreOrUnavailable(messageCredentialMissing(agent, { payer }));
  if (missing !== undefined) return yield* Effect.fail(credentialMissing(missing));
  if (yield* Effect.fromResult(read.repeated)) return { outcome: STEER_OUTCOME.REPEATED };
  const held = yield* Effect.fromResult(read.task);
  if (held !== undefined && Option.isNone(held))
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const task = held === undefined ? undefined : Option.getOrUndefined(held);
  if (agent.archivedAt !== null) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const workspace = yield* Effect.fromResult(read.workspace);
  if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const reviewers = line.sender.kind === MESSAGE_SENDER.GITHUB;
  const pointed =
    line.metadata?.channel === MESSAGE_CHANNEL.AGENT_MESSAGE
      ? withoutMemberLinks(line.text)
      : line.text;
  const reached = yield* Effect.all(
    {
      repository: Effect.result(
        agent.repository === null
          ? Effect.void
          : workspaceRepository(
              workspace.value,
              agent.repository,
              agentMember(agent),
              task?.ownerId === userId ? userId : undefined,
            ),
      ),
      reads: Effect.result(
        reviewers
          ? Effect.succeed(NO_MENTIONED_READS)
          : hostedStoreOrUnavailable(
              readMentioned(userId, pointed, {
                task,
                agentId: agent.id,
                workspaceId: agent.organizationId,
              }),
            ),
      ),
    },
    { concurrency: "unbounded" },
  );
  yield* Effect.fromResult(reached.repository).pipe(
    Effect.catch((refusal) =>
      refusal.error === HOSTED_REFUSAL.GITHUB_UNANSWERED.error ? Effect.void : Effect.fail(refusal),
    ),
  );
  const sessionId =
    (yield* Effect.fromResult(read.sessionId)) ??
    (yield* hostedStoreOrUnavailable(recordedRuntimeSession(target)));
  if (sessionId === undefined && !(yield* opensUnclaimed(agent))) {
    return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
  }
  const reads = yield* Effect.fromResult(reached.reads);
  const mentioned = reviewers
    ? undefined
    : mentionedContext(
        pointed,
        task,
        reads,
        agent.id,
        yield* descriptionsOnFor(agent.userId, agent.kind),
      );
  const running = yield* Effect.fromResult(read.running);
  const label = yield* Effect.fromResult(read.label);
  const attachments = yield* hostedStoreOrUnavailable(
    keptHandedImages(target, line.attachments ?? []),
  );
  let refused: HostedRefusal | undefined;
  let ended = false;
  const message = {
    conversationId: agent.conversationId,
    turn: EVE_HOST_TURN.TYPED,
    message: eveContent(line.text, attachments, mentioned, label),
    lineId: sentLineId(line.clientKey),
  };
  const send = Effect.gen(function* () {
    if (sessionId !== undefined) {
      const sent = yield* eve
        .send(sessionId, message)
        .pipe(Effect.catchTag("EveUnreachable", unreached));
      if (sent.outcome === EVE_SEND_OUTCOME.ACCEPTED) return true;
      if (sent.outcome === EVE_SEND_OUTCOME.FAILED) {
        refused = failedCallRefusal(sent);
        return false;
      }
      if (sent.outcome !== EVE_SEND_OUTCOME.RETIRED) {
        refused = REFUSAL_OF_SEND_OUTCOME[sent.outcome];
        return false;
      }
      ended = true;
    }
    const opened = yield* eve.open(message).pipe(Effect.catchTag("EveUnreachable", unreached));
    if (opened.outcome !== EVE_SEND_OUTCOME.ACCEPTED) {
      refused = failedCallRefusal(opened);
      return false;
    }
    yield* claimedFor(target, opened.sessionId);
    return true;
  });
  const handOver = Effect.flatMap(refusalNow(userId, agent), (refusal) => {
    if (refusal === undefined) return send;
    refused = refusal;
    return Effect.succeed(false);
  });
  const services = yield* Effect.context<DatabaseServices>();
  const servers =
    line.sender.kind === MESSAGE_SENDER.AGENT || reviewers
      ? []
      : mentionedServers(line.serverWords ?? line.text, task?.repository ?? null);
  const dispatch = dispatchMentioningServers(userId, agent.id, servers, handOver).pipe(
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logWarning(
          `a message mentioning servers was not handed over, its servers unwritten: ${causeKind(cause)}`,
        ),
        false,
      ),
    ),
    Effect.provide(services),
  );
  const written = yield* hostedStoreOrUnavailable(
    Effect.flatMap(writer, (write) =>
      write.writeAwaitingLine(target, { ...line, attachments, mentioned }, dispatch),
    ),
  );
  if (Result.isFailure(written))
    return yield* Effect.fail(REFUSAL_OF_UNWRITTEN_LINE[written.failure.refusal]);
  if (ended && running !== undefined) yield* settledEnded(writer, agent, running);
  if (Option.isNone(written.success))
    return yield* Effect.fail(refused ?? HOSTED_REFUSAL.UNAVAILABLE);
  const { txid, effect } = written.success.value;
  const sent =
    effect === STORE_WRITE_EFFECT.WRITTEN
      ? { sent: { runtime, turnRunning: running !== undefined } }
      : undefined;
  return txid === undefined
    ? { outcome: STEER_OUTCOME.SENT, ...sent }
    : { outcome: STEER_OUTCOME.SENT, txid, ...sent };
});

export const agentTakingMessage = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agentId: string,
  read: (userId: string, agentId: string) => AgentStoreEffect<Option.Option<Agent>>,
) {
  const agent = yield* read(userId, agentId);
  if (Option.isNone(agent) || agent.value.archivedAt === null) return agent;
  yield* unarchiveAgentFrom(userId, agentId, agent.value.archivedAt);
  return yield* read(userId, agentId);
});

export const steerMemberWords = /* @__PURE__ */ Effect.fn("web/steerMemberWords")(function* (
  writer: Effect.Effect<StoreWriter>,
  userId: string,
  agent: Agent,
  line: Omit<SteerLine, "sender">,
) {
  const eve = yield* routedSessions<EveTypedTurn>(userId);
  const written = yield* steerAgentWritten(eve, writer, userId, agent, {
    ...line,
    sender: { kind: MESSAGE_SENDER.MEMBER, userId },
  });
  if (written.sent !== undefined) {
    yield* recordServerEvent(
      SERVER_EVENT.MESSAGE_SEND,
      { userId, workspaceId: agent.organizationId },
      {
        runtime: written.sent.runtime,
        machine: agent.machine ?? AGENT_MACHINE.VERCEL,
        agent_kind: agent.kind,
        turn_running: written.sent.turnRunning,
        queued: false,
      },
    );
  }
  return written;
});
