import type { DatabaseServices } from "@luke/database/core/query";
import { settleEndedSessionTurn } from "@luke/database/models/abandoned-turns";
import {
  type CodingAgent,
  type CodingAgentLatestTurn,
  dispatchMentioningServers,
  latestTurnsOfReached,
  RUNNING_TURN_STATUSES,
  readCodingAgent,
  readCodingAgentRouting,
  taskNamesOf,
} from "@luke/database/models/coding-agent-store";
import { sentLineStands } from "@luke/database/models/message-reads";
import {
  claimRuntimeSession,
  recordedRuntimeSession,
} from "@luke/database/models/recorded-session";
import { readTaskPlan } from "@luke/database/models/task-store";
import {
  type AwaitingLineMetadata,
  type ConversationTarget,
  type LineSender,
  STORE_WRITE_REFUSAL,
  type StoreWriter,
} from "@luke/database/models/writer";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import { withoutMemberLinks } from "@luke/features/chat-mentions";
import { CODING_AGENT_STATUS, type CodingAgentAttachment } from "@luke/features/coding-agent-wire";
import { causeKind } from "@luke/runtime/effect";
import { sentLineId } from "@luke/wire/host-ids";
import { Clock, Effect, Option, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { MESSAGE_CHANNEL } from "../../core.js";
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
import { eveContent, keptHandedImages } from "../attached-files.js";
import { BRAIN_HOST_TURN } from "../brain-host/bounds.js";
import {
  type AgentSessions,
  describeUnreachable,
  EVE_SEND_OUTCOME,
  type EveTypedTurn,
  type EveUnreachable,
} from "../brain-host/eve-sessions.js";
import { mentionedContext, mentionedServers, NO_MENTIONED_READS } from "../mentioned-context.js";
import { readMentioned } from "../mentioned-reads.js";
import { messageCredentialMissing } from "./agent-runtime-choice.js";
import { isNativeRuntime } from "./native-runtime.js";
import { failedCallRefusal } from "./runtime-sessions.js";
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
 * to eve and onto the row, each image kept beside the conversation first
 * and named to eve by its id (`attached-files.ts`), and so does what the words
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
 * workspace does, and whose standing with GitHub is asked (the starter
 * alone, for an agent on its starter's own GitHub token), while the line
 * lands in the agent's conversation under the member who started it,
 * naming what sent it: the member, Luke from a call, or an automation's run.
 * Who reaches eve is the caller's: the route holds the
 * developer's own bearer, and the voice brain's tool acts as the
 * deployment for the account, which the coder channel's table admits for
 * exactly this message (`coder-host/channel.ts`). An archived agent takes
 * no message, and is refused as one that names nothing, since every list
 * leaves it out until it is brought back; it is read again under the
 * conversation's dispatch lock just before the send, the lock its archive
 * waits out, so a send that waited on the archive is refused. A
 * session eve answers it no longer runs has ended for good, and nothing
 * will end the turn it was running, so that turn, as read before eve was
 * asked, is settled failed for its session's end
 * (`@luke/database/models/abandoned-turns`'s `settleEndedSessionTurn`)
 * rather than running until the sweep's day-long bound. The words are then
 * no refusal: they open a fresh session over the same conversation, as the
 * brain's ask opens one for a conversation whose session retired
 * (`brain-host/brain-ask.ts`), and so does a message to an agent whose
 * session never claimed its record, past the grace its Start's session had
 * to come up in or where its Start opened none. The fresh session claims
 * the record forward, so the ended one is refused from then on, and is
 * seeded with what was said (`host.ts`'s `seed`); Continue and fork still
 * start a new agent of their own.
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

type SteerOutcome = (typeof STEER_OUTCOME)[keyof typeof STEER_OUTCOME];

/** eve's answer to a message it did not take, in the route's words: a session still coming up is tried again, and a failure is read by `failedCallRefusal`, an outage unless a native harness said why. A session eve no longer runs is no refusal: the message opens a fresh one. */
const REFUSAL_OF_SEND_OUTCOME = {
  [EVE_SEND_OUTCOME.NOT_READY]: HOSTED_REFUSAL.AGENT_NOT_READY,
} as const;

/**
 * Why a line was not written, in the route's words: a conversation gone is
 * the agent gone, a conversation whose lock another write held past the
 * send's wait for it is an outage the same key may retry, since eve was told
 * nothing, and words the vocabulary refused are the request's own fault.
 */
const REFUSAL_OF_UNWRITTEN_LINE = {
  [STORE_WRITE_REFUSAL.NO_CONVERSATION]: HOSTED_REFUSAL.NOT_FOUND,
  [STORE_WRITE_REFUSAL.BUSY]: HOSTED_REFUSAL.UNAVAILABLE,
  [STORE_WRITE_REFUSAL.MESSAGE_REFUSED]: HOSTED_REFUSAL.INVALID_REQUEST,
} as const;

/**
 * Whether a message to an agent whose session has not claimed its record
 * opens one: where its Start opened none, as an agent started blank, with
 * neither the plan nor a prompt, has none until its first words; or past the
 * grace its first turn may land in, where the session its Start opened never
 * started. Inside the grace a Start's session is still coming up, and a
 * second opened beside it would only lose the record to it, so the developer
 * tries again.
 */
const opensUnclaimed = (agent: CodingAgent) =>
  Effect.map(
    Clock.currentTimeMillis,
    (now) =>
      (agent.planSnapshot === null && agent.prompt === null) ||
      codingAgentStatusOf(undefined, { createdAt: agent.createdAt, now }) ===
        CODING_AGENT_STATUS.FAILED,
  );

/** An eve the client never reached reads as an outage, said in the log by its kind alone. */
const unreached = (failure: EveUnreachable) =>
  Effect.as(
    Effect.logWarning(
      `eve could not be reached to message a coding agent: ${describeUnreachable(failure)}`,
    ),
    { outcome: EVE_SEND_OUTCOME.FAILED, status: HOSTED_HTTP_STATUS.BAD_GATEWAY } as const,
  );

/** The record claimed for the session just opened, forward only as its start would; a claim that fails is logged, and the session's own start claims it in time. */
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

/** The turn an ended session settles: the newest, where it still stood queued or running before eve was asked; none otherwise. */
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
 * its task gone, or the agent archived or gone; nothing while it still
 * takes one.
 */
const refusalNow = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agent: CodingAgent,
) {
  const tasks = agent.taskId === null ? undefined : yield* taskNamesOf(userId, [agent.taskId]);
  if (agent.taskId !== null && tasks?.has(agent.taskId) !== true) return HOSTED_REFUSAL.NOT_FOUND;
  const now = yield* readCodingAgent(userId, agent.id);
  return Option.isNone(now) || now.value.archivedAt !== null ? HOSTED_REFUSAL.NOT_FOUND : undefined;
});

/** A steer as its sender's route reads it: what it came to, and the transaction that wrote the line, where this steer wrote it. */
export interface SteerWritten {
  readonly outcome: SteerOutcome;
  readonly txid?: string;
}

/** Hands the line to an agent of the account's workspace, as above; every refusal is the hosted vocabulary's, which the route answers as it is and the voice tool says in words. */
export const steerCodingAgent = (
  eve: AgentSessions<EveTypedTurn>,
  writer: Effect.Effect<StoreWriter>,
  userId: string,
  agent: CodingAgent,
  line: SteerLine,
) =>
  Effect.map(
    steerCodingAgentWritten(eve, writer, userId, agent, line),
    (written) => written.outcome,
  );

/** As `steerCodingAgent`, with the transaction that wrote the line beside what it came to. */
export const steerCodingAgentWritten = /* @__PURE__ */ Effect.fn("web/steerCodingAgent")(function* (
  eve: AgentSessions<EveTypedTurn>,
  writer: Effect.Effect<StoreWriter>,
  userId: string,
  agent: CodingAgent,
  line: SteerLine,
): Effect.fn.Return<
  SteerWritten,
  HostedRefusal,
  DatabaseServices | HttpClient.HttpClient | GitHubApp
> {
  // An agent on its starter's own GitHub token takes words from its starter alone.
  if (!controlsAgent(userId, agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  // The line is written in the agent's conversation, which is its starter's whichever member sends it.
  const target = { userId: agent.userId, conversationId: agent.conversationId };
  // Note that the reads a refusal is decided by are made at once beside each other, since none waits on
  // another, and then judged one by one in the order below, so a send refused for two reasons is
  // refused for the same one it always was; a repeat reads them all for nothing, which is rare.
  const read = yield* Effect.all(
    {
      routing: Effect.result(hostedStoreOrUnavailable(readCodingAgentRouting(userId, agent.id))),
      repeated: Effect.result(
        hostedStoreOrUnavailable(
          sentLineStands(agent.userId, agent.conversationId, sentLineId(line.clientKey)),
        ),
      ),
      // An agent on a task answers to the task, read as the sender; one with no task, to its workspace.
      task: Effect.result(
        agent.taskId === null
          ? Effect.succeed(undefined)
          : hostedStoreOrUnavailable(readTaskPlan(userId, agent.taskId)),
      ),
      workspace: Effect.result(hostedStoreOrUnavailable(agentWorkspace(userId, agent))),
      sessionId: Effect.result(hostedStoreOrUnavailable(recordedRuntimeSession(target))),
      // Read before eve is asked, so an ended session settles the turn it was running and never one begun since.
      running: Effect.result(runningTurnOf(agent)),
    },
    { concurrency: "unbounded" },
  );
  // An agent its starter's plan pays for takes words from those the plan's policy admits, as `admitsPlanWriter` holds,
  // read off the one routing row the credential and the runtime below read too.
  const routing = yield* Effect.fromResult(read.routing);
  if (Option.isNone(routing)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { runtime, payer } = routing.value;
  if (!writesToAgent(userId, agent, payer)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  // Note that Luke's key pays for no coding agent, so one it paid for, or one on eve whose starter
  // keeps no API key for its model now, is refused by name and never moved to another payer.
  const missing = yield* hostedStoreOrUnavailable(
    messageCredentialMissing(agent, { runtime, payer }),
  );
  if (missing !== undefined) return yield* Effect.fail(credentialMissing(missing));
  if (yield* Effect.fromResult(read.repeated)) return { outcome: STEER_OUTCOME.REPEATED };
  const held = yield* Effect.fromResult(read.task);
  if (held !== undefined && Option.isNone(held))
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const task = held === undefined ? undefined : Option.getOrUndefined(held);
  // An archived agent names nothing.
  if (agent.archivedAt !== null) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const workspace = yield* Effect.fromResult(read.workspace);
  if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  // What the words mention goes with them: of the task this send read as its sender, and of the agent's workspace.
  // Note that GitHub's line carries a reviewer's words, which mention nothing on the developer's behalf, so it hands no note of what they mention;
  // and a chat notice's links to people, agents, and Lukes name who said it and whom it addresses, members the agent reads the chat by,
  // so only what else it mentions is noted.
  const reviewers = line.sender.kind === MESSAGE_SENDER.GITHUB;
  const pointed =
    line.metadata?.channel === MESSAGE_CHANNEL.CHAT ? withoutMemberLinks(line.text) : line.text;
  // GitHub is asked beside the mentions' read, each judged in turn as above.
  const reached = yield* Effect.all(
    {
      // An agent with no repository has none for GitHub to reach.
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
                workspaceId: agent.organizationId,
              }),
            ),
      ),
    },
    { concurrency: "unbounded" },
  );
  yield* Effect.fromResult(reached.repository);
  // Note that a session found unclaimed is read again now that GitHub has answered, because a Start's session
  // may have claimed its record meanwhile, and the stale read would refuse a send it now takes.
  const sessionId =
    (yield* Effect.fromResult(read.sessionId)) ??
    (yield* hostedStoreOrUnavailable(recordedRuntimeSession(target)));
  if (sessionId === undefined && !(yield* opensUnclaimed(agent))) {
    return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
  }
  const reads = yield* Effect.fromResult(reached.reads);
  const mentioned = reviewers ? undefined : mentionedContext(pointed, task, reads);
  const running = yield* Effect.fromResult(read.running);
  // Each image is kept beside the agent's conversation before eve is handed it, so eve is told its id and the
  // row names it; a repeat under the key was answered above, and the same bytes again keep nothing twice.
  const attachments = yield* hostedStoreOrUnavailable(
    keptHandedImages(target, line.attachments ?? []),
  );
  // eve's refusal is kept beside the dispatch, since the write answers only whether a row landed,
  // and so is whether the session the record named had ended, whose running turn nothing else ends.
  let refused: HostedRefusal | undefined;
  let ended = false;
  const message = {
    conversationId: agent.conversationId,
    turn: BRAIN_HOST_TURN.TYPED,
    message: eveContent(line.text, attachments, mentioned),
    // The line's own id, which a native harness's runner names back as it takes the message; eve is never handed it.
    lineId: sentLineId(line.clientKey),
  };
  // Note that a session eve no longer runs, or none at all, is no refusal: the words open a fresh
  // session over the same conversation, which claims its record forward from the one that ended and
  // is seeded with what was said in it (`host.ts`'s `seed`), so no developer has to press Continue.
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
    // Note that the fresh session claims the record here, still under the conversation's dispatch lock, rather
    // than only as its own start runs, because a message sent in between would read the ended session,
    // open a second fresh one, and the newer claim would refuse the first, words and all.
    yield* claimedFor(target, opened.sessionId);
    return true;
  });
  // Note that the archive is read again here, under the conversation's dispatch lock, because a plan's
  // archive waits that lock out to archive the agent, so the two never cross.
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
      : mentionedServers(line.serverWords ?? line.text, task?.repository ?? null);
  // Note that a native agent's servers are written just after its harness takes the words rather than
  // just before, still in this transaction, because a harness this function relays to (`native-relay.ts`)
  // writes the agent's row on its own connection as it launches, and would wait on this transaction's lock
  // on it until the hand-over gave up. Its runner's first events wait out the conversation's dispatch lock,
  // which this transaction holds, all the same, so the turn they are for still finds them.
  const native = isNativeRuntime(runtime);
  const handing = native
    ? Effect.flatMap(handOver, (taken) =>
        taken
          ? dispatchMentioningServers(userId, agent.id, servers, Effect.succeed(true))
          : Effect.succeed(false),
      )
    : dispatchMentioningServers(userId, agent.id, servers, handOver);
  const dispatch = handing.pipe(
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
  // The turn the ended session was running is settled whether or not the fresh session took the words.
  if (ended && running !== undefined) yield* settledEnded(writer, agent, running);
  if (Option.isNone(written.success))
    return yield* Effect.fail(refused ?? HOSTED_REFUSAL.UNAVAILABLE);
  const { txid } = written.success.value;
  return txid === undefined
    ? { outcome: STEER_OUTCOME.SENT }
    : { outcome: STEER_OUTCOME.SENT, txid };
});
