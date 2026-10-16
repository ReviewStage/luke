import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import { childTitlesOf } from "@luke/database/models/child-titles";
import {
  latestTurnsOf,
  listMessagesPast,
  type MessageCursor,
  messageCursorNow,
  runningChildTurns,
  type StoredTurnRecord,
  spokenAskRowsOf,
  turnsBefore,
  turnsNamed,
} from "@luke/database/models/message-reads";
import type { ConversationTarget } from "@luke/database/models/writer";
import {
  CODING_AGENT_BOUNDS,
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentStatus,
  type CodingAgentSubagentStanding,
  type CodingAgentSubagentTitle,
} from "@luke/features/coding-agent-wire";
import { TASK_WORK_BOUNDS, TASK_WORK_STATE, type TaskWorkTurn } from "@luke/features/tasks-view";
import { Clock, Duration, Effect, Option, Schedule, type Schema } from "effect";
import { CODER } from "../agents/coder-host/bounds.js";
import type { TitleAwaited } from "../agents/coder-host/transcript.js";
import { MESSAGE_ROLE, TURN_STATUS, type TurnOrigin } from "../core.js";
import { HOSTED_TOOL_SET } from "./brain-tool-set.js";
import { taskWorkOf, workerSessionCallsOf } from "./task-work.js";
import {
  brainDelegationJournalsOf,
  brainDelegationRowsOf,
  turnJournalOf,
} from "./task-work-store.js";

/**
 * brain-transcript.ts -- a plan's planning conversation read as a coding agent's transcript is: its turns' journals past a cursor, held open while a turn or a worker runs.
 *
 * The Call tab draws each planning turn with the agent tab's own component,
 * so it reads the planner's conversation on the agent tab's own wire
 * (`coder-host/transcript.ts`): a page of messages and the cursor to read on
 * from, held while more may land and answered the moment something does.
 * Three things are the planner's own. A planning conversation holds many
 * turns and the voice's rows between them, which the Call tab draws from
 * the call's transcript, so the page carries the turns' journals alone, each
 * as the plan's work projects it (`tasks/task-work.ts`): its newest parts,
 * every string cut to the bound and no page's HTML, with the spoken lines
 * the turn took as its ask. A plan may have planned on for a long time, so a
 * reader opens on its newest turns and pages back a turn page at a time
 * (`earlier`), then follows from the cursor its first page answered. And a
 * planner's workers are recorded in no delegation row, so each page says
 * where the workers of the turns it carries and of the newest turns stand,
 * read from each worker's own session; the hold waits on a running worker
 * too, since its call answered the moment it started. The poll is the
 * voice's own, so a call reads as live as the frame it replaces. The plan's
 * `task.work` frame and its work page stand beside this read, unchanged,
 * until no desktop reads them.
 */

/** How often a held read looks again: the voice's follow's own beat, so the Call tab hears a part as soon as the frame it replaces did. */
export const BRAIN_POLL = Duration.millis(250);

/** The newest turns whose workers a page a moving turn let go says the standing of, beside the page's own; a page no journal moved says every worker's (`withStandings`). */
const STANDING_TURNS = 3;

/** The most raw pages one look reads past a run of the voice's rows to find a turn's journal behind them. */
const DRAIN_PAGES = 10;

/** A page of the planner's conversation as the route answers it, the agent transcript's own shape with the turn the page before is read before. */
export interface BrainPage {
  readonly messages: readonly CodingAgentMessage[];
  readonly cursor: MessageCursor;
  readonly status: CodingAgentStatus;
  readonly earlier?: string;
  readonly subagents?: readonly CodingAgentSubagentStanding[];
  readonly subagentTitles?: readonly CodingAgentSubagentTitle[];
}

type BrainEffect<A> = Effect.Effect<A, QueryError | Schema.SchemaError, DatabaseServices>;

/** How a worker's standing on the plan's work reads as an agent's worker's does. */
const STATUS_OF_WORK_STATE = {
  [TASK_WORK_STATE.RUNNING]: CODING_AGENT_STATUS.RUNNING,
  [TASK_WORK_STATE.DONE]: CODING_AGENT_STATUS.COMPLETED,
  [TASK_WORK_STATE.FAILED]: CODING_AGENT_STATUS.FAILED,
} as const;

/** A turn's journal as the agent tab reads a message: its projected parts and whether older ones were left out, the turn it is, what opened it and the lines that asked for it, and its span and record. */
function messageOf(id: string, work: TaskWorkTurn, origin: TurnOrigin): CodingAgentMessage {
  const { turnId, journal, asked, askedAt, startedAt, endedAt } = work;
  const { model, effort, tokens, ending } = work;
  return {
    id,
    role: MESSAGE_ROLE.ASSISTANT,
    parts: journal ?? [],
    turnId,
    origin,
    ...(work.earlierOmitted ? { earlierOmitted: true } : undefined),
    ...(asked === undefined ? undefined : { asked }),
    ...(askedAt === undefined ? undefined : { askedAt }),
    startedAt,
    ...(endedAt === undefined ? undefined : { finishedAt: endedAt }),
    ...(model === undefined ? undefined : { model }),
    ...(effort === undefined ? undefined : { effort }),
    ...(tokens === undefined ? undefined : { tokens }),
    ...(ending === undefined ? undefined : { ending }),
  };
}

/** The turns' journals as messages, oldest first, and their works for the workers each started; a turn that wrote no journal, or one this build cannot read, is left out. */
const worksOf = (userId: string, conversationId: string, turns: readonly StoredTurnRecord[]) =>
  Effect.gen(function* () {
    const read = yield* Effect.forEach(turns, (turn) => turnJournalOf(userId, turn));
    const journaled = read.filter((each) => each !== undefined);
    const asked = yield* spokenAskRowsOf(
      userId,
      conversationId,
      journaled.map((each) => each.turn.id),
    );
    return journaled.map((each) => ({
      id: each.message.id,
      origin: each.turn.origin,
      work: taskWorkOf(
        each.turn,
        each.message,
        each.subagents,
        each.titles,
        each.records,
        asked.get(each.turn.id),
      ),
    }));
  });

/** Where every worker of the works stands and the title of each that has one, by the call that started it, each once. */
function standingsOf(works: readonly TaskWorkTurn[]) {
  const workers = new Map(
    works.flatMap((work) =>
      (work.workers ?? []).map((worker) => [worker.callId, { work, worker }] as const),
    ),
  );
  const subagents = [...workers.values()].map(({ work, worker }) => ({
    callId: worker.callId,
    status: STATUS_OF_WORK_STATE[worker.state],
    model: worker.model ?? "",
    effort: worker.effort ?? "",
    startedAt: worker.startedAt ?? work.startedAt,
  }));
  const subagentTitles = [...workers.values()].flatMap(({ worker }) =>
    worker.title === undefined ? [] : [{ callId: worker.callId, title: worker.title }],
  );
  return {
    ...(subagents.length === 0 ? undefined : { subagents }),
    ...(subagentTitles.length === 0 ? undefined : { subagentTitles }),
  };
}

/**
 * The planner's status as a page says it: running while its newest turn is
 * queued or runs, or while a worker's session does, since a worker in the
 * background outlives the turn that started it and a reader follows on
 * while it runs; failed where that turn failed, and completed otherwise, a
 * plan never planned on included.
 */
export const brainStatusNow = (target: ConversationTarget): BrainEffect<CodingAgentStatus> =>
  Effect.gen(function* () {
    const turns = yield* latestTurnsOf(target.userId, [target.conversationId]);
    const status = turns.get(target.conversationId)?.status;
    if (status === TURN_STATUS.QUEUED || status === TURN_STATUS.RUNNING) {
      return CODING_AGENT_STATUS.RUNNING;
    }
    const workers = yield* runningChildTurns(target.userId, target.conversationId);
    if (workers.length > 0) return CODING_AGENT_STATUS.RUNNING;
    return status === TURN_STATUS.FAILED
      ? CODING_AGENT_STATUS.FAILED
      : CODING_AGENT_STATUS.COMPLETED;
  });

/**
 * The page with the standing of the workers of its own turns and of the
 * newest turns beside it, read once for the page that is answered: the
 * newest few while a turn moves, and every worker the conversation ever
 * delegated to where no journal moved, which is a page a worker's start or
 * end, or the hold's end, let go, so a worker under however old a turn is
 * heard as it ends.
 */
const withStandings = (
  target: ConversationTarget,
  page: Omit<BrainPage, "subagents" | "subagentTitles">,
  works: readonly TaskWorkTurn[],
): BrainEffect<BrainPage> =>
  Effect.gen(function* () {
    const shown = new Set(works.map((work) => work.turnId));
    const newest = yield* turnsBefore(
      target.userId,
      target.conversationId,
      STANDING_TURNS,
      undefined,
    );
    const delegated =
      works.length > 0 ? [] : yield* brainDelegationRowsOf(target.userId, target.conversationId);
    const named = yield* turnsNamed(target.userId, [
      ...new Set(delegated.flatMap((row) => row.turnId ?? [])),
    ]);
    const unread = [...newest.turns, ...named].filter(
      (turn, index, all) =>
        !shown.has(turn.id) && all.findIndex((each) => each.id === turn.id) === index,
    );
    const more = yield* worksOf(target.userId, target.conversationId, unread);
    return { ...page, ...standingsOf([...works, ...more.map((each) => each.work)]) };
  });

/**
 * A page of the newest turns, or of the turns queued before the one
 * `before` names: their journals oldest first, the turn the page before
 * this one is read before where one stands, and the cursor a reader follows
 * on from, read before the journals so a turn that moves meanwhile is heard
 * again rather than missed.
 */
export function brainTurnsPage(
  target: ConversationTarget,
  before: string | undefined,
): BrainEffect<BrainPage> {
  return Effect.gen(function* () {
    const cursor = yield* messageCursorNow(target.userId, target.conversationId);
    const page = yield* turnsBefore(
      target.userId,
      target.conversationId,
      TASK_WORK_BOUNDS.TURNS,
      before,
    );
    const works = yield* worksOf(target.userId, target.conversationId, page.turns);
    const status = yield* brainStatusNow(target);
    const oldest = page.turns[0];
    return yield* withStandings(
      target,
      {
        messages: works.map((each) => messageOf(each.id, each.work, each.origin)),
        cursor,
        status,
        ...(page.earlier && oldest !== undefined ? { earlier: oldest.id } : undefined),
      },
      works.map((each) => each.work),
    );
  });
}

/**
 * The turns whose journals moved past the cursor, and the cursor past every
 * row read. Note that the voice's rows are read and passed over, so a run of
 * them longer than a page is read on through, up to `DRAIN_PAGES`, rather
 * than answered as a page with nothing on it while a journal stands behind.
 */
const movedPast = (target: ConversationTarget, after: MessageCursor) =>
  Effect.gen(function* () {
    let cursor = after;
    for (let page = 0; page < DRAIN_PAGES; page += 1) {
      const past = yield* listMessagesPast(
        target.userId,
        target.conversationId,
        HOSTED_TOOL_SET,
        cursor,
        CODING_AGENT_BOUNDS.MESSAGES_PAGE,
      );
      const records = past.read.ok ? past.read.value : [];
      const moved = [
        ...new Set(
          records.flatMap((record) =>
            record.message.role === MESSAGE_ROLE.ASSISTANT && record.turnId !== undefined
              ? [record.turnId]
              : [],
          ),
        ),
      ];
      const full = records.length === CODING_AGENT_BOUNDS.MESSAGES_PAGE;
      cursor = past.cursor;
      if (moved.length > 0 || !full) return { moved, cursor };
    }
    return { moved: [], cursor };
  });

/** One look past the cursor: the journals of the turns whose rows moved, as messages oldest first, the cursor past every row read, and the status as it stood. */
const pagePast = (target: ConversationTarget, after: MessageCursor) =>
  Effect.gen(function* () {
    const { moved, cursor } = yield* movedPast(target, after);
    const turns = yield* turnsNamed(target.userId, moved);
    const works = yield* worksOf(target.userId, target.conversationId, turns);
    const status = yield* brainStatusNow(target);
    return { works, cursor, status };
  });

/** Whether two reads of the running worker turns name the same turns. */
function sameTurns(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => right[index] === id);
}

/**
 * The planner's conversation past the cursor: the turns whose journals
 * moved, or, while a turn runs or a worker does and nothing moved yet, the
 * first look inside the hold that finds one or finds a worker started or
 * ended since the hold began, so a worker that ends beside one still
 * running is heard at once; or the empty page and the cursor to read on
 * from once the hold is out.
 */
export function brainPagePast(
  target: ConversationTarget,
  after: MessageCursor,
): BrainEffect<BrainPage> {
  return Effect.gen(function* () {
    const began = yield* runningChildTurns(target.userId, target.conversationId);
    const once = Effect.gen(function* () {
      const look = yield* pagePast(target, after);
      if (look.works.length > 0) return Option.some(look);
      const running = yield* runningChildTurns(target.userId, target.conversationId);
      if (!sameTurns(began, running)) return Option.some(look);
      return look.status === CODING_AGENT_STATUS.RUNNING || running.length > 0
        ? Option.none()
        : Option.some(look);
    });
    const held = yield* once.pipe(
      Effect.repeat({ schedule: Schedule.spaced(BRAIN_POLL), until: Option.isSome }),
      Effect.timeoutOption(CODER.MESSAGES_HOLD),
    );
    const read = Option.flatten(held);
    const { works, cursor, status } = Option.isSome(read)
      ? read.value
      : yield* pagePast(target, after);
    return yield* withStandings(
      target,
      { messages: works.map((each) => messageOf(each.id, each.work, each.origin)), cursor, status },
      works.map((each) => each.work),
    );
  });
}

/**
 * The call whose child conversation records the session of the worker a
 * planning call names: its own where it started the worker, and the call
 * that started the task where it sent the task more work, as the plan's work
 * reads it (`workerSessionCallsOf`); nothing where no delegation of the
 * conversation's made the call, so no other child of it is read through one.
 */
export function brainWorkerSession(
  target: ConversationTarget,
  callId: string,
): BrainEffect<string | undefined> {
  return Effect.map(brainDelegationJournalsOf(target.userId, target.conversationId), (journals) => {
    for (const journal of journals) {
      const session = workerSessionCallsOf(journal, journals).get(callId);
      if (session !== undefined) return session;
    }
    return undefined;
  });
}

/**
 * Whether a planning worker's title may still land: the worker untitled,
 * and its newest turn settled inside the title call's bound, past which the
 * call that would fill it has given up. A worker's title is generated as it
 * starts, so a short one can settle first.
 */
export function brainTitleAwaited(parent: ConversationTarget, child: string): TitleAwaited {
  return Effect.gen(function* () {
    const titles = yield* childTitlesOf(parent, [child]);
    if (titles.has(child)) return false;
    const turns = yield* latestTurnsOf(parent.userId, [child]);
    const settledAt = turns.get(child)?.settledAt;
    const now = yield* Clock.currentTimeMillis;
    return (
      settledAt !== undefined &&
      settledAt !== null &&
      settledAt.getTime() >= now - Duration.toMillis(CODER.TITLE_TIMEOUT)
    );
  });
}
