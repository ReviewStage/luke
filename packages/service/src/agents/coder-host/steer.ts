import type { DatabaseServices } from "@luke/database/core/query";
import {
  type CodingAgent,
  dispatchMentioningServers,
} from "@luke/database/models/coding-agent-store";
import { sentLineId } from "@luke/database/models/ids";
import { sentLineStands } from "@luke/database/models/message-reads";
import { recordedRuntimeSession } from "@luke/database/models/recorded-session";
import { readTask } from "@luke/database/models/task-store";
import {
  type LineSender,
  STORE_WRITE_REFUSAL,
  type StoreWriter,
} from "@luke/database/models/writer";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import { CODING_AGENT_STATUS, type CodingAgentAttachment } from "@luke/features/coding-agent-wire";
import { causeKind } from "@luke/runtime/effect";
import { Clock, Effect, Option, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
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
 * are another coding agent's, which hand none; the writer fences the write against the caller
 * going away between the two. A send repeated under its key finds the line
 * it already wrote and hands eve nothing again: read once here, before
 * GitHub is asked, and once more by the writer under the lock, so two
 * sends racing under one key still send once. A row the store failed to
 * write after eve took the message is the one gap left, and the relay
 * still writes the line when the turn receives it. The turn's checkout and
 * its credential renewals run on the developer's standing with GitHub, so
 * a sign-in that lapsed is refused here rather than failing the turn's
 * first step. The caller is any member of the agent's workspace, whose plan
 * read gates the send, or for an agent with no plan whose membership of its
 * workspace does, and whose standing with GitHub is asked, while the
 * line lands in the agent's conversation under the member who started it,
 * naming what sent it: the member, Luke from a call, or an automation's run.
 * Who reaches eve is the caller's: the route holds the
 * developer's own bearer, and the voice brain's tool acts as the
 * deployment for the account, which the coder channel's table admits for
 * exactly this message (`coder-host/channel.ts`). An archived plan's agents
 * take no message, so a send to one is refused before eve is asked; a turn
 * already running when the plan was archived runs on to its end. An agent
 * archived on its own takes none either, and is refused as one that names
 * nothing, since every list leaves it out until it is brought back.
 */

/** The developer's words, the files they attached where they did, the key the send is made under, which a repeat carries again, and what sent them, which the row keeps and eve is not told. */
export interface SteerLine {
  readonly text: string;
  readonly clientKey: string;
  readonly attachments?: readonly CodingAgentAttachment[] | undefined;
  readonly sender: LineSender;
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
  if (agent.archivedAt !== null) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  // An agent on a plan answers to the plan, read as the sender; one with no plan, to its workspace.
  const held =
    agent.taskId === null
      ? undefined
      : yield* hostedStoreOrUnavailable(readTask(userId, agent.taskId));
  if (held !== undefined && Option.isNone(held))
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const task = held === undefined ? undefined : Option.getOrUndefined(held);
  if (task?.task.archivedAt !== undefined) return yield* Effect.fail(HOSTED_REFUSAL.TASK_ARCHIVED);
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
  // Note that GitHub's line carries a reviewer's words, which mention nothing on the developer's behalf, so it hands no note of what they mention.
  const reviewers = line.sender.kind === MESSAGE_SENDER.GITHUB;
  const reads = reviewers
    ? NO_MENTIONED_READS
    : yield* hostedStoreOrUnavailable(
        readMentioned(userId, line.text, { task: task?.task, workspaceId: agent.organizationId }),
      );
  const mentioned = reviewers ? undefined : mentionedContext(line.text, task?.task, reads);
  // eve's refusal is kept beside the dispatch, since the write answers only whether a row landed.
  let refused: HostedRefusal | undefined;
  const handOver = eve
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
  // The servers the words mention stand for the agent's next turn from just before eve hears them, and
  // only where eve took them; a store failure on the way is read as eve hearing nothing, which writes
  // nothing and is answered as an outage, since what failed may have been before the hand-over.
  const services = yield* Effect.context<DatabaseServices>();
  // Note that another coding agent's line, or GitHub's carrying a reviewer's words, hands no server, because which servers an agent is handed is its developer's to switch, never another agent's or a reviewer's.
  const servers =
    line.sender.kind === MESSAGE_SENDER.AGENT || reviewers
      ? []
      : mentionedServers(line.text, task?.task.repository ?? null);
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
    return yield* Effect.fail(refused ?? HOSTED_REFUSAL.UNAVAILABLE);
  }
  return STEER_OUTCOME.SENT;
});
