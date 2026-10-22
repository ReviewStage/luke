/**
 * turn-opening.ts -- what a coding agent's turn opens with of the store, whichever runtime answers it: the turn's own message, and the conversation so far for a session opened afresh.
 *
 * eve hands both as user-role instructions of the coder project's own
 * (`apps/dev/instructions/turn-message.ts`, `seed.ts`), through the host
 * (`host.ts`'s `turnMessage` and `seed`). A native harness has no such hook,
 * so its sessions put the same text ahead of the message line they write
 * (`native-agent-sessions.ts`). What a turn's message holds and why is
 * `turn-context.ts`.
 */

import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import { chatEnabledFor } from "@luke/database/models/account-store";
import { readBoard } from "@luke/database/models/board-store";
import type { CodingAgent } from "@luke/database/models/coding-agent-store";
import {
  listRecentMessages,
  type StoredMessageRecord,
  turnsBefore,
} from "@luke/database/models/message-reads";
import { readPlanCommentThreads } from "@luke/database/models/plan-comments";
import { listRevisions } from "@luke/database/models/plan-revisions";
import { readTask } from "@luke/database/models/task-store";
import type { ConversationTarget } from "@luke/database/models/writer";
import { EMPTY_BOARD } from "@luke/features/board-wire";
import { MEMBER_KIND } from "@luke/features/chat-wire";
import { Effect, Option, type Schema } from "effect";
import { MESSAGE_ROLE } from "../../core.js";
import { logStoreFailure } from "../../http/store-failure.js";
import { type ChatSince, standingContext } from "../agent-runtime/standing-context.js";
import { BRAIN_HOST, BRAIN_HOST_TURN, type BrainHostTurn } from "../brain-host/bounds.js";
import { rotationSeedText } from "../brain-host/seed.js";
import { markDeskNoticesRead, type OperatorDesk, readOperatorDesk } from "../operator-desk.js";
import { isOperator } from "../steward.js";
import { chatDigest } from "./chat.js";
import { CODER_TOOL_SET } from "./tool-set.js";
import {
  contentKey,
  savedByAnotherSince,
  type TurnHanded,
  taskKey,
  taskWithLead,
  timeWithLead,
  turnKindWords,
} from "./turn-context.js";

/** The newest turns read to find the agent's previous one: the turn opening, where the relay queued it already, and the one before. */
const PREVIOUS_TURN_READ = 2;

/** No chat in the task as it stands: the agent's own digest of the chat follows it (`chatDigest`). */
const NO_CHAT: ChatSince = { messages: [], more: false };

/** Who a turn's message is read for: the account the turn acts for, the conversation, and the sender's time zone, none reading UTC. */
interface TurnReader {
  readonly caller: string;
  readonly target: ConversationTarget;
  readonly timeZone: string | undefined;
}

/** The turn opening: its kind, as its request named it, and its store id, where the turn has one yet. */
export interface CoderTurn {
  readonly kind: BrainHostTurn | undefined;
  readonly turnId: string | undefined;
}

/** A turn's own message, where there is one to hand, and what the session has handed once it is. */
export interface CoderTurnMessage {
  readonly text: string | undefined;
  readonly handed: TurnHanded;
}

/** Whether a stored row is a line awaiting its turn: a user's words no turn has taken yet (`writer.ts`'s `takeAwaitingLine`). */
function awaitsTurn(record: StoredMessageRecord): boolean {
  return record.message.role === MESSAGE_ROLE.USER && record.turnId === undefined;
}

/** What the agent has not read in its workspace's chat, as a turn opens with it (`chat.ts`); nothing where its starter has not turned Chat on, or the read failed. */
const digestOf = (reader: TurnReader, agent: CodingAgent) =>
  Effect.gen(function* () {
    // A turn opens with the chat only where the agent's starter turned Chat on.
    if (!(yield* chatEnabledFor(reader.target.userId))) return undefined;
    return yield* chatDigest(
      {
        userId: reader.target.userId,
        taskId: agent.taskId,
        self: { kind: MEMBER_KIND.AGENT, agentId: agent.id },
      },
      reader.target.conversationId,
    );
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(undefined)),
  );

/**
 * The operator's desk as its turn opens (`../operator-desk.ts`), its
 * member's open work as it stands; nothing for any other agent, or where
 * a read failed, which is logged, so the turn still opens.
 */
const deskOf = (
  agent: CodingAgent,
): Effect.Effect<OperatorDesk | undefined, never, DatabaseServices> =>
  isOperator(agent)
    ? readOperatorDesk(agent).pipe(
        Effect.tapError(logStoreFailure),
        Effect.orElseSucceed(() => undefined),
      )
    : Effect.succeed(undefined);

/**
 * When the agent's turn before the one opening started, or nothing for its
 * first turn: the newest of the conversation's turns but the one named,
 * which the relay may have queued already as this one opens.
 */
const previousTurnStart = (target: ConversationTarget, turnId: string | undefined) =>
  Effect.map(
    turnsBefore(target.userId, target.conversationId, PREVIOUS_TURN_READ, undefined),
    (page) => {
      const previous = page.turns.findLast((turn) => turn.id !== turnId);
      return previous === undefined
        ? undefined
        : (previous.startedAt ?? previous.queuedAt).getTime();
    },
  );

/**
 * The agent's task as the turn's message hands it (`turn-context.ts`), read
 * as the member whose turn this is, and what the session has handed of it
 * once this turn is (`taskKey`), or nothing for an agent on no task or one
 * whose task is gone. The task is handed where a revision of the plan
 * another writer made was saved after the agent's previous turn started,
 * so a save made while that turn ran, which none of its steps may have
 * read, is handed too; or where the rest of it is not what the session
 * last handed; never on a typed first turn, whose first message the plan,
 * or the prompt beside it, already is. The chat is left out, since the
 * agent's own digest of it follows (`digestOf`). A read that fails is
 * logged and hands nothing.
 */
const taskOf = (
  reader: TurnReader,
  agent: CodingAgent,
  turn: CoderTurn,
  handed: TurnHanded,
  now: number,
) =>
  Effect.gen(function* () {
    const { taskId } = agent;
    if (taskId === null) return undefined;
    const [stored, board, comments, since] = yield* Effect.all(
      [
        readTask(reader.caller, taskId),
        readBoard(reader.caller, taskId),
        readPlanCommentThreads(reader.caller, taskId),
        previousTurnStart(reader.target, turn.turnId),
      ],
      { concurrency: "unbounded" },
    );
    if (Option.isNone(stored)) return undefined;
    const drawn = Option.getOrElse(board, () => EMPTY_BOARD);
    const threads = Option.getOrElse(comments, () => []);
    const key = taskKey(stored.value, drawn, threads);
    const opening = since === undefined && turn.kind !== BRAIN_HOST_TURN.SPOKEN;
    const saved =
      since !== undefined &&
      savedByAnotherSince((yield* listRevisions(reader.caller, taskId)).revisions, since, agent.id);
    if (!saved && (opening || key === handed.task)) return { key: handed.task, text: undefined };
    const clock = { now, timeZone: reader.timeZone };
    const text = taskWithLead(standingContext(stored.value, drawn, NO_CHAT, clock, threads));
    return { key, text };
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(undefined)),
  );

/**
 * What a turn opens with as a user-role message of its own (`turn-context.ts`):
 * the call's words on a spoken turn where the turn before was not one, and
 * a line naming the turn's kind where it changed; the developer's time on
 * every turn; the task as it stands where someone other than the agent saved
 * the plan since its previous turn started, or the rest of it is not what
 * the session last handed (`handed`); what the agent has not read in its
 * workspace's chat, where its starter turned Chat on and the digest is not
 * the one last handed; and an operator's desk, where its standing work is
 * not what was last handed or it carries notices, which are marked read once
 * handed. Answers what the session has handed once this message is, for the
 * session to keep. A read that fails is logged and leaves its part out, so
 * the turn still opens.
 */
export const composeTurnMessage = (
  reader: TurnReader,
  agent: CodingAgent,
  turn: CoderTurn,
  handed: TurnHanded,
  now: number,
): Effect.Effect<CoderTurnMessage, never, DatabaseServices> =>
  Effect.gen(function* () {
    const [task, digest, desk] = yield* Effect.all(
      [taskOf(reader, agent, turn, handed, now), digestOf(reader, agent), deskOf(agent)],
      { concurrency: "unbounded" },
    );
    const clock = { now, timeZone: reader.timeZone };
    const standing =
      task?.text ?? timeWithLead(standingContext(undefined, EMPTY_BOARD, NO_CHAT, clock));
    // The digest is handed again only where it holds what the last one did not.
    const chatKey = digest === undefined ? handed.chat : contentKey(digest);
    const chat = digest !== undefined && chatKey !== handed.chat ? [digest] : [];
    // An operator's desk is handed again only where its standing work changed since the session
    // last handed it, or where it carries notices, which are marked read once handed.
    const deskKey = desk === undefined ? handed.desk : contentKey(desk.standing);
    const fresh = desk !== undefined && (desk.notices.length > 0 || deskKey !== handed.desk);
    const desked = fresh ? [desk.text] : [];
    if (fresh && desk.notices.length > 0) {
      yield* markDeskNoticesRead(agent, desk).pipe(
        Effect.tapError(logStoreFailure),
        Effect.orElseSucceed(() => undefined),
      );
    }
    const spoken = turn.kind === BRAIN_HOST_TURN.SPOKEN;
    const kind = turnKindWords(spoken, handed, agent.taskId !== null);
    const taskHanded = task === undefined ? handed.task : task.key;
    const next: TurnHanded = {
      ...(taskHanded === undefined ? undefined : { task: taskHanded }),
      ...(chatKey === undefined ? undefined : { chat: chatKey }),
      ...(deskKey === undefined ? undefined : { desk: deskKey }),
      ...(spoken ? { spoken: true, callWords: true } : undefined),
    };
    const parts = [...(kind === undefined ? [] : [kind]), standing, ...desked, ...chat];
    return { text: parts.join("\n\n"), handed: next };
  });

/**
 * The conversation so far, for a session opened afresh over a conversation
 * that already has words on record (`../brain-host/seed.ts`): its newest
 * messages but a line still awaiting its turn, which is the message the
 * session opens on; nothing where nothing else was said.
 */
export const conversationSeed = (
  target: ConversationTarget,
  now: number,
): Effect.Effect<string | undefined, QueryError | Schema.SchemaError, DatabaseServices> =>
  Effect.map(
    listRecentMessages(
      target.userId,
      target.conversationId,
      CODER_TOOL_SET,
      BRAIN_HOST.SEED_MESSAGES,
    ),
    (read) =>
      rotationSeedText(
        read.ok
          ? read.value.filter((record) => !awaitsTurn(record)).map((record) => record.message)
          : [],
        now,
      ),
  );
