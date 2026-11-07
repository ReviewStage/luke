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
import { type LineFileRead, lineRead } from "@repo/database/models/attached-file-parts";
import { readConversationPicture } from "@repo/database/models/conversation-pictures";
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
  type LostLine,
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
import { keptHandedImages, senderLabel, turnContent } from "../attached-files.js";
import { descriptionsOnFor } from "../descriptions-on.js";
import { mentionedContext, mentionedServers, NO_MENTIONED_READS } from "../mentioned-context.js";
import { readMentioned } from "../mentioned-reads.js";
import {
  type AgentSessions,
  describeUnreachable,
  SESSION_SEND_OUTCOME,
  SESSION_TURN,
  type SessionMessage,
  type SessionUnreachable,
  type TypedTurn,
} from "../sessions/agent-sessions.js";
import { workspaceStepOf, writtenMention } from "../written-mentions.js";
import { messageCredentialMissing } from "./agent-runtime-choice.js";
import { harnessOf } from "./native-runtime.js";
import { failedCallRefusal, routedSessions } from "./runtime-sessions.js";
import { agentStatusOf } from "./status.js";

/**
 * steer.ts -- the developer's words handed to a coding agent: the one path a message takes, from the message box or any other sender.
 *
 * The words are handed to the session the agent runs in, where they steer
 * the turn under way or open one, and written as a line awaiting its turn
 * once the harness has taken them. The hand-over runs inside the conversation's
 * lock, so the turn the harness opens on the line finds the row standing when its
 * own first write takes the lock, and a harness that did not take the message
 * leaves the row withdrawn, read nowhere unless a turn the harness hands it to
 * after all takes it with its kind and sender. Files the developer
 * attached go with the words, to the harness and onto the row, each image kept beside the conversation first
 * and named to the harness by its id (`attached-files.ts`), and so does what the words
 * mention of the description, as it stands now (`mentioned-context.ts`), and a
 * server it mentions is handed to the agent's next turn, unless the words
 * are another coding agent's or a reviewer's, which hand none, or an
 * automation's run, which hands only those its automation's own prompt
 * mentions; the writer fences the write against the caller
 * going away between the two. A send repeated under its key finds the line
 * it already wrote and hands the harness nothing again: read once here, before
 * GitHub is asked, and once more by the writer under the lock, so two
 * sends racing under one key still send once. A hand-over that answered
 * nothing past its deadline, or whose store write failed after the harness took
 * the message, withdrew a line the harness may still hand a turn, which is why the
 * row is kept rather than deleted. The turn's checkout and
 * its credential renewals run on the developer's standing with GitHub, so
 * a sign-in that lapsed is refused here rather than failing the turn's
 * first step; a GitHub that could not be asked refuses nothing, since an
 * outage or a rate limit says nothing of that standing. The caller is any
 * member who reaches the agent and, for an agent on a task, its task too,
 * which together gate the send, and whose standing with GitHub is asked
 * (the starter alone, for an agent on its starter's own GitHub token),
 * while the line
 * lands in the agent's conversation under the member who started it,
 * naming what sent it: the member, the app from a call, or an automation's run.
 * A teammate's words, a member's other than the starter, are handed to the harness
 * behind a label naming them by their mention link (`attached-files.ts`'s
 * `senderLabel`), which the row leaves out, since its sender is its own
 * column, so the model never reads a teammate's words as the developer's.
 * Who reaches the agent is the caller's; the agent's harness answers the
 * message (`runtime-sessions.ts`). An archived agent takes
 * no message, and is refused as one that names nothing, since every list
 * leaves it out until it is brought back, which a member's words from Slack
 * or an inbox thread do first (`agentTakingMessage`); it is read again under the
 * conversation's dispatch claim just before the send, which is taken under
 * the row lock its archive takes, so a send claimed after the archive is
 * refused, and an archive after the claim finds the line awaiting. A
 * session its harness answers it no longer runs has ended for good, and nothing
 * will end the turn it was running, so that turn, as read before the harness was
 * asked, is settled failed for its session's end
 * (`@repo/database/models/abandoned-turns`'s `settleEndedSessionTurn`)
 * rather than running until the sweep's day-long bound. The words are then
 * no refusal: they open a fresh session over the same conversation, and so
 * does a message to an agent whose
 * session never claimed its record, past the grace its Start's session had
 * to come up in or where its Start opened none. The fresh session claims
 * the record forward, so the ended one is refused from then on, and its
 * harness starts afresh, holding none of what was said; Continue and fork
 * still start a new agent of their own.
 */

/**
 * The developer's words, the files they attached where they did, the key the
 * send is made under, which a repeat carries again, and what sent them, which
 * the row keeps and the harness is not told; and what the row says carried it, the
 * developer's typed ask unless the caller names another agent's message, a
 * thread, a description comment, GitHub, the app, or an automation's run, which the harness is
 * not told either.
 */
export interface SteerLine {
  readonly text: string;
  readonly clientKey: string;
  readonly attachments?: readonly AgentAttachment[] | undefined;
  readonly sender: LineSender;
  readonly metadata?: AwaitingLineMetadata | undefined;
  /** The words the servers handed to the next turn are read from where they are not all of `text`: an automation's own prompt, never a webhook body or a GitHub event's words beside it; `text` otherwise. */
  readonly serverWords?: string | undefined;
}

/** Another coding agent as the row of a line it sends keeps it: by its name, id, and model. */
export function agentLineSender(agent: Agent): LineSender {
  return {
    kind: MESSAGE_SENDER.AGENT,
    agentId: agent.id,
    name: agentName(agent),
    model: agent.model,
  };
}

/** What a steer came to: the line sent and written, or found already sent under its key. */
export const STEER_OUTCOME = {
  SENT: "sent",
  REPEATED: "repeated",
} as const;

type SteerOutcome = (typeof STEER_OUTCOME)[keyof typeof STEER_OUTCOME];

/** The harness's answer to a message it did not take, in the route's words: a session still coming up is tried again, and a failure is read by `failedCallRefusal`, an outage unless the harness said why. A session the harness no longer runs is no refusal: the message opens a fresh one. */
const REFUSAL_OF_SEND_OUTCOME = {
  [SESSION_SEND_OUTCOME.NOT_READY]: HOSTED_REFUSAL.AGENT_NOT_READY,
} as const;

/**
 * Why a line was not written, in the route's words: a conversation gone is
 * the agent gone, a conversation whose lock another write held past the
 * send's wait for it is an outage the same key may retry, since the harness was told
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
 * neither the description nor a prompt, has none until its first words; or past the
 * grace its first turn may land in, where the session its Start opened never
 * started. Inside the grace a Start's session is still coming up, and a
 * second opened beside it would only lose the record to it, so the developer
 * tries again.
 */
const opensUnclaimed = (agent: Agent) =>
  Effect.map(
    Clock.currentTimeMillis,
    (now) =>
      (agent.descriptionSnapshot === null && agent.prompt === null) ||
      agentStatusOf(undefined, { createdAt: agent.createdAt, now }) === AGENT_STATUS.FAILED,
  );

/** A runtime the client never reached reads as an outage, said in the log by its kind alone. */
const unreached = (failure: SessionUnreachable) =>
  Effect.as(
    Effect.logWarning(
      `the agent's runtime could not be reached to message a coding agent: ${describeUnreachable(failure)}`,
    ),
    { outcome: SESSION_SEND_OUTCOME.FAILED, status: HOSTED_HTTP_STATUS.BAD_GATEWAY } as const,
  );

/** What a teammate's mention link names them by where their account is gone. */
const FORMER_MEMBER = "A former member";

/**
 * The label naming the teammate who sent the line, by their mention link
 * under the agent's workspace; nothing for the starter's own words or any
 * other sender's, whose line already says who sent it.
 */
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

/** The turn an ended session settles: the newest, where it still stood queued or running before the harness was asked; none otherwise. */
const runningTurnOf = (agent: Agent) =>
  Effect.map(
    hostedStoreOrUnavailable(latestTurnsOfReached([agent.conversationId])),
    (turns): AgentLatestTurn | undefined => {
      const turn = turns.get(agent.conversationId);
      return turn !== undefined && RUNNING_TURN_STATUSES.has(turn.status) ? turn : undefined;
    },
  );

/**
 * The turn read before the send settled failed for its session's end, now
 * that the harness said it runs the session no more; a write that fails is logged
 * and the refusal stands all the same, since the sweep's bound still ends
 * the turn in time.
 */
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

/**
 * The runtime of an agent the member may write to, read off its routing row,
 * or why they may not: the agent gone, a plan whose policy does not admit
 * them (`writesToAgent`), or an agent on its starter's API key whose starter
 * keeps none for its model now, refused by name and never moved to another
 * payer, since our key pays for no coding agent. Note that one on no harness
 * has ended for good whatever paid for it, which the router refuses it as.
 */
const admittedRuntime = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agent: Agent,
  routing: Effect.Success<ReturnType<typeof readAgentRouting>>,
) {
  if (Option.isNone(routing)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { runtime, payer } = routing.value;
  if (!writesToAgent(userId, agent, payer)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  const missing =
    harnessOf(runtime) === undefined
      ? undefined
      : yield* hostedStoreOrUnavailable(messageCredentialMissing(agent, { payer }));
  if (missing !== undefined) return yield* Effect.fail(credentialMissing(missing));
  return runtime;
});

/** What a hand-over to the agent's harness came to past whether it took the words: why it did not, and whether the session the record named had ended. */
interface HandOverOutcome {
  refused: HostedRefusal | undefined;
  ended: boolean;
}

/**
 * The words handed to the agent's harness, answering whether it took them,
 * and writing into `outcome` why it did not and whether the session the
 * record named had ended. Note that a session that no longer runs, or none
 * at all, is no refusal: the words open a fresh session over the same
 * conversation, which claims its record forward from the one that ended, so
 * no developer has to press Continue.
 */
const handedToHarness = (
  agentSessions: AgentSessions<TypedTurn>,
  target: ConversationTarget,
  sessionId: string | undefined,
  message: SessionMessage<TypedTurn>,
  outcome: HandOverOutcome,
) =>
  Effect.gen(function* () {
    if (sessionId !== undefined) {
      const sent = yield* agentSessions
        .send(sessionId, message)
        .pipe(Effect.catchTag("SessionUnreachable", unreached));
      if (sent.outcome === SESSION_SEND_OUTCOME.ACCEPTED) return true;
      if (sent.outcome === SESSION_SEND_OUTCOME.FAILED) {
        outcome.refused = failedCallRefusal(sent);
        return false;
      }
      if (sent.outcome !== SESSION_SEND_OUTCOME.RETIRED) {
        outcome.refused = REFUSAL_OF_SEND_OUTCOME[sent.outcome];
        return false;
      }
      outcome.ended = true;
    }
    const opened = yield* agentSessions
      .open(message)
      .pipe(Effect.catchTag("SessionUnreachable", unreached));
    if (opened.outcome !== SESSION_SEND_OUTCOME.ACCEPTED) {
      outcome.refused = failedCallRefusal(opened);
      return false;
    }
    // Note that the fresh session claims the record here, still under the conversation's dispatch claim, rather
    // than only as its own start runs, because a message sent in between would read the ended session,
    // open a second fresh one, and the newer claim would refuse the first, words and all.
    yield* claimedFor(target, opened.sessionId);
    return true;
  });

/**
 * Why the agent takes no message now, read again as the hand-over runs:
 * its task out of the sender's reach, or the agent archived or gone;
 * nothing while it still takes one.
 */
const refusalNow = /* @__PURE__ */ Effect.fnUntraced(function* (userId: string, agent: Agent) {
  const tasks = agent.taskId === null ? undefined : yield* taskNamesOf(userId, [agent.taskId]);
  if (agent.taskId !== null && tasks?.has(agent.taskId) !== true) return HOSTED_REFUSAL.NOT_FOUND;
  const now = yield* readAgent(userId, agent.id);
  return Option.isNone(now) || now.value.archivedAt !== null ? HOSTED_REFUSAL.NOT_FOUND : undefined;
});

/** A steer as its sender's route reads it: what it came to, and the transaction that wrote the line, where this steer wrote it. */
export interface SteerWritten {
  readonly outcome: SteerOutcome;
  readonly txid?: string;
  /** What a line this send wrote found: the runtime that answers the agent and whether a turn of its was running; none for a repeat. */
  readonly sent?: { readonly runtime: ConversationRuntime; readonly turnRunning: boolean };
}

/** Hands the line to an agent of the account's workspace, as above; every refusal is the hosted vocabulary's, which the route answers as it is. */
export const steerAgent = (
  agentSessions: AgentSessions<TypedTurn>,
  writer: Effect.Effect<StoreWriter>,
  userId: string,
  agent: Agent,
  line: SteerLine,
) =>
  Effect.map(
    steerAgentWritten(agentSessions, writer, userId, agent, line),
    (written) => written.outcome,
  );

/** As `steerAgent`, with the transaction that wrote the line beside what it came to. */
export const steerAgentWritten = /* @__PURE__ */ Effect.fn("web/steerAgent")(function* (
  agentSessions: AgentSessions<TypedTurn>,
  writer: Effect.Effect<StoreWriter>,
  userId: string,
  agent: Agent,
  line: SteerLine,
): Effect.fn.Return<
  SteerWritten,
  HostedRefusal,
  DatabaseServices | HttpClient.HttpClient | GitHubApp
> {
  // An agent on its starter's own GitHub token, or on its starter's Mac, takes words from its starter alone.
  if (!controlsAgent(userId, agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  // The line is written in the agent's conversation, which is its starter's whichever member sends it.
  const target = { userId: agent.userId, conversationId: agent.conversationId };
  // Note that the reads a refusal is decided by are made at once beside each other, since none waits on
  // another, and then judged one by one in the order below, so a send refused for two reasons is
  // refused for the same one it always was; a repeat reads them all for nothing, which is rare.
  const read = yield* Effect.all(
    {
      routing: Effect.result(hostedStoreOrUnavailable(readAgentRouting(userId, agent.id))),
      repeated: Effect.result(
        hostedStoreOrUnavailable(
          sentLineStands(agent.userId, agent.conversationId, sentLineId(line.clientKey)),
        ),
      ),
      // The sender reaches the agent, as the routing read holds, and an agent on a task its task too, read as the sender.
      task: Effect.result(
        agent.taskId === null
          ? Effect.succeed(undefined)
          : hostedStoreOrUnavailable(readTaskDescription(userId, agent.taskId)),
      ),
      workspace: Effect.result(hostedStoreOrUnavailable(agentWorkspace(userId, agent))),
      sessionId: Effect.result(hostedStoreOrUnavailable(recordedRuntimeSession(target))),
      // Read before the harness is asked, so an ended session settles the turn it was running and never one begun since.
      running: Effect.result(runningTurnOf(agent)),
      label: Effect.result(hostedStoreOrUnavailable(teammateLabel(agent, line.sender))),
    },
    { concurrency: "unbounded" },
  );
  const runtime = yield* admittedRuntime(userId, agent, yield* Effect.fromResult(read.routing));
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
  // and another agent's message links its sender to name who said it, so only what else it mentions is noted.
  const reviewers = line.sender.kind === MESSAGE_SENDER.GITHUB;
  const pointed =
    line.metadata?.channel === MESSAGE_CHANNEL.AGENT_MESSAGE
      ? withoutMemberLinks(line.text)
      : line.text;
  // GitHub is asked beside the mentions' read, each judged in turn as above.
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
  // Note that a GitHub that did not answer, or that holds our calls for its rate limit, lets the words through,
  // because the agent's checkout already stands and only GitHub's definite no is a reason to keep them from it.
  yield* Effect.fromResult(reached.repository).pipe(
    Effect.catch((refusal) =>
      refusal.error === HOSTED_REFUSAL.GITHUB_UNANSWERED.error ? Effect.void : Effect.fail(refusal),
    ),
  );
  // Note that a session found unclaimed is read again now that GitHub has answered, because a Start's session
  // may have claimed its record meanwhile, and the stale read would refuse a send it now takes.
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
  // Each image is kept beside the agent's conversation before the harness is handed it, so the harness is told its id and the
  // row names it; a repeat under the key was answered above, and the same bytes again keep nothing twice.
  const attachments = yield* hostedStoreOrUnavailable(
    keptHandedImages(target, line.attachments ?? []),
  );
  // The harness's refusal is kept beside the dispatch, since the write answers only whether a row landed,
  // and so is whether the session the record named had ended, whose running turn nothing else ends.
  const outcome: HandOverOutcome = { refused: undefined, ended: false };
  const message = {
    conversationId: agent.conversationId,
    turn: SESSION_TURN.TYPED,
    message: turnContent(line.text, attachments, mentioned, label),
    // The line's own id, which a native harness's runner names back as it takes the message.
    lineId: sentLineId(line.clientKey),
  };
  const send = handedToHarness(agentSessions, target, sessionId, message, outcome);
  // Note that the archive is read again here, under the conversation's dispatch claim, because a plan's
  // archive takes the conversation's row lock the claim was taken under, and reads the line the claim
  // wrote as work under way, so the two never cross.
  const handOver = Effect.flatMap(refusalNow(userId, agent), (refusal) => {
    if (refusal === undefined) return send;
    outcome.refused = refusal;
    return Effect.succeed(false);
  });
  // The servers the words mention stand for the agent's next turn from just before the harness hears them, and
  // only where the harness took them; a store failure on the way is read as the harness hearing nothing, which writes
  // nothing and is answered as an outage, since what failed may have been before the hand-over.
  const services = yield* Effect.context<DatabaseServices>();
  // Note that another coding agent's line, or GitHub's carrying a reviewer's words, hands no server, and an automation's
  // run hands only what its own prompt mentions, because which servers an agent is handed is its developer's to switch,
  // never another agent's, a reviewer's, or a webhook caller's.
  const servers =
    line.sender.kind === MESSAGE_SENDER.AGENT || reviewers
      ? []
      : mentionedServers(line.serverWords ?? line.text, task?.repository ?? null);
  // Note that a native agent's are written before its harness hears the words too, so the turn its runner
  // opens on them takes them: the hand-over runs in no transaction, so the agent's row a launch writes
  // on its own connection is held by nothing meanwhile.
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
  // The turn the ended session was running is settled whether or not the fresh session took the words.
  if (outcome.ended && running !== undefined) yield* settledEnded(writer, agent, running);
  if (Option.isNone(written.success))
    return yield* Effect.fail(outcome.refused ?? HOSTED_REFUSAL.UNAVAILABLE);
  const { txid, effect } = written.success.value;
  // A send that raced another under its key found the line standing under the lock, so it sent nothing new.
  const sent =
    effect === STORE_WRITE_EFFECT.WRITTEN
      ? { sent: { runtime, turnRunning: running !== undefined } }
      : undefined;
  return txid === undefined
    ? { outcome: STEER_OUTCOME.SENT, ...sent }
    : { outcome: STEER_OUTCOME.SENT, txid, ...sent };
});

/**
 * The agent a member's words are about to reach, as `read` reads it under
 * the member: brought back first where it stands archived, from the very
 * archive read (`unarchiveAgentFrom`), as the Archive agent menu's undo
 * brings it back, so a member who writes to an archived agent, from Slack
 * or on one of its inbox threads, reopens it as a chat tool reopens a
 * conversation; nothing where it is gone. Note that it is read again after
 * and answered as it then stands, because one brought back by someone else
 * meanwhile takes the words too, and one archived again since takes none,
 * which the steer refuses. Only a member's words bring an agent back:
 * another agent's message, GitHub's, and an automation's are refused.
 */
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

/**
 * A file of a lost line as its harness is handed it again: its bytes from
 * the row, or for an image kept beside the conversation, whose row carries
 * none, from the kept picture; nothing where those are gone.
 */
const handedFileOf = (conversationId: string, file: LineFileRead) =>
  Effect.gen(function* () {
    const { name, mediaType, kept } = file;
    if (file.data !== undefined) return [{ name, mediaType, data: file.data, kept }];
    if (kept === undefined || !("id" in kept)) return [];
    const picture = yield* readConversationPicture(conversationId, kept.id);
    return Option.isNone(picture)
      ? []
      : [{ name, mediaType, data: Buffer.from(picture.value.bytes).toString("base64"), kept }];
  });

/**
 * A lost line as its harness is handed it again, as `steerAgentWritten`
 * handed it first: its words, what it mentioned as it stood then, its files,
 * and a teammate's label where a teammate sent it, under the id its row
 * keeps, which the runner names back as it takes it.
 */
const lostLineMessage = (target: ConversationTarget, agent: Agent, line: LostLine) =>
  Effect.gen(function* () {
    const read = lineRead(line.parts);
    const files = yield* Effect.forEach(read.files, (file) =>
      handedFileOf(target.conversationId, file),
    );
    const label =
      line.sender === MESSAGE_SENDER.MEMBER && line.senderUserId !== null
        ? yield* teammateLabel(agent, { kind: MESSAGE_SENDER.MEMBER, userId: line.senderUserId })
        : undefined;
    const message: SessionMessage<TypedTurn> = {
      conversationId: target.conversationId,
      turn: SESSION_TURN.TYPED,
      message: turnContent(read.text, files.flat(), read.mentioned, label),
      lineId: line.clientId,
    };
    return message;
  });

/**
 * The lines of the developer's that the agent's failed turn never took,
 * handed to its harness again in the order they were written, each as it
 * was first handed (`lostLineMessage`), so a launch that failed before its
 * runner read its first message loses none of it: the writer moves each to
 * the end of the transcript as it goes and puts back one the harness did
 * not take (`StoreWriter`'s `resendLostLines`). Each hand-over is admitted
 * as a send is, read as it runs, and only where a line was lost, so a send
 * to an agent that lost none reads nothing past the one read of its lines.
 * Answers how many went; fails with the refusal that stopped one, or as an
 * outage where none was said.
 */
export const resendLostLines = /* @__PURE__ */ Effect.fn("web/resendLostLines")(function* (
  agentSessions: AgentSessions<TypedTurn>,
  writer: Effect.Effect<StoreWriter>,
  userId: string,
  agent: Agent,
): Effect.fn.Return<number, HostedRefusal, DatabaseServices> {
  // The member who may not steer the agent resends nothing, and their own words are refused as they go.
  if (!controlsAgent(userId, agent)) return 0;
  const target = { userId: agent.userId, conversationId: agent.conversationId };
  const outcome: HandOverOutcome = { refused: undefined, ended: false };
  const services = yield* Effect.context<DatabaseServices>();
  const dispatch = (line: LostLine) =>
    Effect.gen(function* () {
      const routing = yield* hostedStoreOrUnavailable(readAgentRouting(userId, agent.id));
      yield* admittedRuntime(userId, agent, routing);
      const refusal = yield* hostedStoreOrUnavailable(refusalNow(userId, agent));
      if (refusal !== undefined) return yield* Effect.fail(refusal);
      // Read for each line, because the first line's hand-over may open the session the next is sent to.
      const sessionId = yield* hostedStoreOrUnavailable(recordedRuntimeSession(target));
      if (sessionId === undefined && !(yield* opensUnclaimed(agent))) {
        return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
      }
      const message = yield* hostedStoreOrUnavailable(lostLineMessage(target, agent, line));
      return yield* handedToHarness(agentSessions, target, sessionId, message, outcome);
    }).pipe(
      Effect.catch((refusal: HostedRefusal) =>
        Effect.sync(() => {
          outcome.refused = refusal;
          return false;
        }),
      ),
      Effect.catchCause((cause) =>
        Effect.as(
          Effect.logWarning(`a lost line was not handed over again: ${causeKind(cause)}`),
          false,
        ),
      ),
      Effect.provide(services),
    );
  const resent = yield* hostedStoreOrUnavailable(
    Effect.flatMap(writer, (write) => write.resendLostLines(target, dispatch)),
  );
  if (Result.isFailure(resent)) {
    return yield* Effect.fail(REFUSAL_OF_UNWRITTEN_LINE[resent.failure.refusal]);
  }
  // Note that a resend stopped with no refusal said, as a hand-over past its deadline, is an outage,
  // because words sent after it would reach the agent ahead of the line it still lost.
  if (resent.success.stopped) {
    return yield* Effect.fail(outcome.refused ?? HOSTED_REFUSAL.UNAVAILABLE);
  }
  return resent.success.taken.length;
});

/**
 * A member's own words to an agent they reach, as their message box sends
 * them: handed over on the sessions the deployment reaches acting for them,
 * written under their name (`MESSAGE_SENDER.MEMBER`), so a teammate's carry
 * their label, and counted under them once the line is written; a repeat
 * under its key is not counted again. The member MCP server's
 * `message_agent` sends the same way. The lines the agent's failed turn
 * never took go ahead of the words (`resendLostLines`), so the agent reads
 * them in the order they were sent; a retry, the failed turn's Try again,
 * sends its own words only where none was lost, since the lines are what it
 * asks to send again.
 */
export const steerMemberWords = /* @__PURE__ */ Effect.fn("web/steerMemberWords")(function* (
  writer: Effect.Effect<StoreWriter>,
  userId: string,
  agent: Agent,
  line: Omit<SteerLine, "sender">,
  retry = false,
) {
  const agentSessions = yield* routedSessions<TypedTurn>(userId);
  const resent = yield* resendLostLines(agentSessions, writer, userId, agent);
  if (retry && resent > 0) {
    const sent: SteerWritten = { outcome: STEER_OUTCOME.SENT };
    return sent;
  }
  const written = yield* steerAgentWritten(agentSessions, writer, userId, agent, {
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
