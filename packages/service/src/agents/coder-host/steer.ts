import type { DatabaseServices } from "@luke/database/core/query";
import { settleEndedSessionTurn } from "@luke/database/models/abandoned-turns";
import {
  type CodingAgent,
  type CodingAgentLatestTurn,
  dispatchMentioningServers,
  latestTurnsOfReached,
  RUNNING_TURN_STATUSES,
  readCodingAgent,
  taskNamesOf,
} from "@luke/database/models/coding-agent-store";
import { sentLineId } from "@luke/database/models/ids";
import { sentLineStands } from "@luke/database/models/message-reads";
import { recordedRuntimeSession } from "@luke/database/models/recorded-session";
import { readTask } from "@luke/database/models/task-store";
import {
  type AwaitingLineMetadata,
  type LineSender,
  STORE_WRITE_REFUSAL,
  type StoreWriter,
} from "@luke/database/models/writer";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import { withoutMemberLinks } from "@luke/features/chat-mentions";
import { CODING_AGENT_STATUS, type CodingAgentAttachment } from "@luke/features/coding-agent-wire";
import { causeKind } from "@luke/runtime/effect";
import { Clock, Effect, Option, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { MESSAGE_CHANNEL } from "../../core.js";
import type { GitHubApp } from "../../github/github-app.js";
import { agentWorkspace, workspaceRepository } from "../../github/workspace-repository.js";
import { HOSTED_HTTP_STATUS } from "../../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../../http/http-effect.js";
import { eveContent } from "../attached-files.js";
import { BRAIN_HOST_TURN } from "../brain-host/bounds.js";
import {
  describeUnreachable,
  EVE_SEND_OUTCOME,
  type EveSessions,
} from "../brain-host/eve-sessions.js";
import { mentionedContext, mentionedServers, NO_MENTIONED_READS } from "../mentioned-context.js";
import { readMentioned } from "../mentioned-reads.js";
import { codingAgentStatusOf } from "./status.js";

/**
 * steer.ts -- the developer's words handed to a coding agent: the one path a message takes, from the message box or from Luke's voice.
 *
 * The words are handed to the session the agent runs in, where they steer
 * the turn under way or open one, and written as a line awaiting its turn
 * once eve has taken them. The hand-over runs inside the conversation's
 * lock, so the turn eve opens on the line finds the row standing when its
 * own first write takes the lock, and an eve that did not take the message
 * leaves no row behind. Files the developer attached go with the words,
 * to eve and onto the row (`attached-files.ts`), and so does what the words
 * mention of the plan, as it stands now (`mentioned-context.ts`), and a
 * server it mentions is handed to the agent's next turn, unless the words
 * are another coding agent's or a reviewer's, which hand none, or an
 * automation's run, which hands only those its automation's own prompt
 * mentions; the writer fences the write against the caller
 * going away between the two. A send repeated under its key finds the line
 * it already wrote and hands eve nothing again: read once here, before
 * GitHub is asked, and once more by the writer under the lock, so two
 * sends racing under one key still send once. A row the store failed to
 * write after eve took the message is the one gap left, and the relay
 * still writes the line when the turn receives it. The turn's checkout and
 * its credential renewals run on the developer's standing with GitHub, so
 * a sign-in that lapsed is refused here rather than failing the turn's
 * first step. The caller is any member of the agent's workspace, whose task
 * read gates the send, or for an agent with no task whose membership of its
 * workspace does, and whose standing with GitHub is asked, while the
 * line lands in the agent's conversation under the member who started it,
 * naming what sent it: the member, Luke from a call, or an automation's run.
 * Who reaches eve is the caller's: the route holds the
 * developer's own bearer, and the voice brain's tool acts as the
 * deployment for the account, which the coder channel's table admits for
 * exactly this message (`coder-host/channel.ts`). An archived task's agents
 * take no message, so a send to one is refused before eve is asked, and
 * read again under the conversation's lock just before, the lock a task's
 * archive takes to archive the agent with it: a send that waited on the
 * archive is refused, and an archive that waited on a send finds the line
 * awaiting its turn and is refused instead. An agent archived on its own
 * takes none either, and is refused as one that names nothing, since every
 * list leaves it out until it is brought back. A
 * session eve answers it no longer runs has ended for good, and nothing
 * will end the turn it was running, so that turn, as read before eve was
 * asked, is settled failed for its session's end
 * (`@luke/database/models/abandoned-turns`'s `settleEndedSessionTurn`):
 * the agent then reads as failed, idle for an archive or a Stop, rather
 * than running until the sweep's day-long bound.
 */

/**
 * The developer's words, the files they attached where they did, the key the
 * send is made under, which a repeat carries again, and what sent them, which
 * the row keeps and eve is not told; and who the row says wrote it, the
 * developer's typed ask unless a chat notice names its poster.
 */
export interface SteerLine {
  readonly text: string;
  readonly clientKey: string;
  readonly attachments?: readonly CodingAgentAttachment[] | undefined;
  readonly sender: LineSender;
  readonly metadata?: AwaitingLineMetadata | undefined;
  /** The words the servers handed to the next turn are read from where they are not all of `text`: an automation's own prompt, never a webhook body or a GitHub event's words beside it; `text` otherwise. */
  readonly serverWords?: string | undefined;
}

/** What a steer came to: the line sent and written, or found already sent under its key. */
export const STEER_OUTCOME = {
  SENT: "sent",
  REPEATED: "repeated",
} as const;

export type SteerOutcome = (typeof STEER_OUTCOME)[keyof typeof STEER_OUTCOME];

/** eve's answer to a message it did not take, in the route's words: a session still coming up is tried again, one eve no longer runs is gone for good, and anything else is an outage. */
const REFUSAL_OF_SEND_OUTCOME = {
  [EVE_SEND_OUTCOME.NOT_READY]: HOSTED_REFUSAL.AGENT_NOT_READY,
  [EVE_SEND_OUTCOME.RETIRED]: HOSTED_REFUSAL.AGENT_RETIRED,
  [EVE_SEND_OUTCOME.FAILED]: HOSTED_REFUSAL.UNAVAILABLE,
} as const;

/**
 * The refusal for an agent whose session has not claimed its record: still
 * coming up inside the grace its first turn may land in, so the developer
 * tries again, and past it a session that never started, which the agent's
 * tab reads as failed, so the developer starts a new one.
 */
const unstartedRefusal = (agent: CodingAgent) =>
  Effect.map(Clock.currentTimeMillis, (now) =>
    codingAgentStatusOf(undefined, { createdAt: agent.createdAt, now }) ===
    CODING_AGENT_STATUS.FAILED
      ? HOSTED_REFUSAL.AGENT_RETIRED
      : HOSTED_REFUSAL.AGENT_NOT_READY,
  );

/** The turn a refusal as ended for good settles: the newest, where it still stood queued or running before eve was asked; none otherwise. */
const runningTurnOf = (agent: CodingAgent) =>
  Effect.map(
    hostedStoreOrUnavailable(latestTurnsOfReached([agent.conversationId])),
    (turns): CodingAgentLatestTurn | undefined => {
      const turn = turns.get(agent.conversationId);
      return turn !== undefined && RUNNING_TURN_STATUSES.has(turn.status) ? turn : undefined;
    },
  );

/**
 * The turn read before the send settled failed for its session's end, now
 * that eve said it runs the session no more; a write that fails is logged
 * and the refusal stands all the same, since the sweep's bound still ends
 * the turn in time.
 */
const settledEnded = (
  writer: Effect.Effect<StoreWriter>,
  agent: CodingAgent,
  turn: CodingAgentLatestTurn,
) =>
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

/**
 * Why the agent takes no message now, read again as the hand-over runs:
 * its task archived, or the agent archived on its own or gone; nothing
 * while it still takes one.
 */
const refusalNow = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agent: CodingAgent,
) {
  const tasks = agent.taskId === null ? undefined : yield* taskNamesOf(userId, [agent.taskId]);
  if (agent.taskId !== null && tasks?.get(agent.taskId)?.archived !== false) {
    return tasks?.has(agent.taskId) ? HOSTED_REFUSAL.TASK_ARCHIVED : HOSTED_REFUSAL.NOT_FOUND;
  }
  const now = yield* readCodingAgent(userId, agent.id);
  return Option.isNone(now) || now.value.archivedAt !== null ? HOSTED_REFUSAL.NOT_FOUND : undefined;
});

/** Hands the line to an agent of the account's workspace, as above; every refusal is the hosted vocabulary's, which the route answers as it is and the voice tool says in words. */
export const steerCodingAgent = /* @__PURE__ */ Effect.fn("web/steerCodingAgent")(function* (
  eve: EveSessions,
  writer: Effect.Effect<StoreWriter>,
  userId: string,
  agent: CodingAgent,
  line: SteerLine,
): Effect.fn.Return<
  SteerOutcome,
  HostedRefusal,
  DatabaseServices | HttpClient.HttpClient | GitHubApp
> {
  // The line is written in the agent's conversation, which is its starter's whichever member sends it.
  const target = { userId: agent.userId, conversationId: agent.conversationId };
  const repeated = yield* hostedStoreOrUnavailable(
    sentLineStands(agent.userId, agent.conversationId, sentLineId(line.clientKey)),
  );
  if (repeated) return STEER_OUTCOME.REPEATED;
  // An agent on a task answers to the task, read as the sender; one with no task, to its workspace.
  const held =
    agent.taskId === null
      ? undefined
      : yield* hostedStoreOrUnavailable(readTask(userId, agent.taskId));
  if (held !== undefined && Option.isNone(held))
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const task = held === undefined ? undefined : Option.getOrUndefined(held);
  if (task?.task.archivedAt !== undefined) return yield* Effect.fail(HOSTED_REFUSAL.TASK_ARCHIVED);
  // An agent archived with its task is refused as its task is, above; one archived on its own names nothing.
  if (agent.archivedAt !== null) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const workspace = yield* hostedStoreOrUnavailable(agentWorkspace(userId, agent));
  if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  yield* workspaceRepository(
    workspace.value,
    agent.repository,
    task?.ownerId === userId ? userId : undefined,
  );
  const sessionId = yield* hostedStoreOrUnavailable(recordedRuntimeSession(target));
  if (sessionId === undefined) return yield* Effect.fail(yield* unstartedRefusal(agent));
  // What the words mention goes with them: of the task this send read as its sender, and of the agent's workspace.
  // Note that GitHub's line carries a reviewer's words, which mention nothing on the developer's behalf, so it hands no note of what they mention;
  // and a chat notice's links to people, agents, and Lukes name who said it and whom it addresses, members the agent reads the chat by,
  // so only what else it mentions is noted.
  const reviewers = line.sender.kind === MESSAGE_SENDER.GITHUB;
  const pointed =
    line.metadata?.channel === MESSAGE_CHANNEL.CHAT ? withoutMemberLinks(line.text) : line.text;
  const reads = reviewers
    ? NO_MENTIONED_READS
    : yield* hostedStoreOrUnavailable(
        readMentioned(userId, pointed, { task: task?.task, workspaceId: agent.organizationId }),
      );
  const mentioned = reviewers ? undefined : mentionedContext(pointed, task?.task, reads);
  // Read before eve is asked, so a refusal settles the turn the session was running and never one begun since.
  const running = yield* runningTurnOf(agent);
  // eve's refusal is kept beside the dispatch, since the write answers only whether a row landed.
  let refused: HostedRefusal | undefined;
  const send = eve
    .send(sessionId, {
      conversationId: agent.conversationId,
      turn: BRAIN_HOST_TURN.TYPED,
      message: eveContent(line.text, line.attachments ?? [], mentioned),
    })
    .pipe(
      Effect.catchTag("EveUnreachable", (failure) =>
        Effect.as(
          Effect.logWarning(
            `eve could not be reached to message a coding agent: ${describeUnreachable(failure)}`,
          ),
          { outcome: EVE_SEND_OUTCOME.FAILED, status: HOSTED_HTTP_STATUS.BAD_GATEWAY } as const,
        ),
      ),
      Effect.map((sent) => {
        if (sent.outcome === EVE_SEND_OUTCOME.ACCEPTED) return true;
        refused = REFUSAL_OF_SEND_OUTCOME[sent.outcome];
        return false;
      }),
    );
  // Note that the archive is read again here, under the conversation's lock, because a plan's archive
  // takes that lock to archive the agent, so the two never cross.
  const handOver = Effect.flatMap(refusalNow(userId, agent), (refusal) => {
    if (refusal === undefined) return send;
    refused = refusal;
    return Effect.succeed(false);
  });
  // The servers the words mention stand for the agent's next turn from just before eve hears them, and
  // only where eve took them; a store failure on the way is read as eve hearing nothing, which writes
  // nothing and is answered as an outage, since what failed may have been before the hand-over.
  const services = yield* Effect.context<DatabaseServices>();
  // Note that another coding agent's line, or GitHub's carrying a reviewer's words, hands no server, and an automation's
  // run hands only what its own prompt mentions, because which servers an agent is handed is its developer's to switch,
  // never another agent's, a reviewer's, or a webhook caller's.
  const servers =
    line.sender.kind === MESSAGE_SENDER.AGENT || reviewers
      ? []
      : mentionedServers(line.serverWords ?? line.text, task?.task.repository ?? null);
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
      write.writeAwaitingLine(target, { ...line, mentioned }, dispatch),
    ),
  );
  if (Result.isFailure(written)) {
    return yield* Effect.fail(
      written.failure.refusal === STORE_WRITE_REFUSAL.NO_CONVERSATION
        ? HOSTED_REFUSAL.NOT_FOUND
        : HOSTED_REFUSAL.INVALID_REQUEST,
    );
  }
  if (Option.isNone(written.success)) {
    if (refused === HOSTED_REFUSAL.AGENT_RETIRED && running !== undefined) {
      yield* settledEnded(writer, agent, running);
    }
    return yield* Effect.fail(refused ?? HOSTED_REFUSAL.UNAVAILABLE);
  }
  return STEER_OUTCOME.SENT;
});
