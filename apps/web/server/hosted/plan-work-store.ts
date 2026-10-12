import {
  PLAN_WORK_BOUNDS,
  type PlanShownCode,
  type PlanWorkAnswer,
} from "@sidecar/hosted/planning-view";
import { Effect, Option } from "effect";
import { isStoredToolPart, storedToolName } from "../core.js";
import {
  callsSendingToEarlierTasks,
  planWorkOf,
  SUBAGENT_JOURNALS,
  type SubagentJournal,
  workerSessionCallsOf,
} from "../voice/plan-work.js";
import { childConversationId } from "./brain-host/ids.js";
import { EVE_DELEGATION_TOOL } from "./brain-host/planning.js";
import { HOSTED_TOOL_SET } from "./brain-tool-set.js";
import { type PlanStoreEffect, readPlan } from "./plan-store.js";
import { SHOW_CODE_TOOL, shownCodeOf } from "./show-code.js";
import {
  listJournals,
  listJournalsCalling,
  readMessageByClientId,
  type StoredMessageRecord,
  type StoredTurnRecord,
  turnsBefore,
} from "./store/message-reads.js";

/**
 * plan-work-store.ts -- a plan's Work tab read back from the record, a page of turns at a time, and every code Luke showed on it.
 *
 * Every planning turn runs in the conversation the plan names, and the
 * relay journals each as eve runs it, so the plan's work is that
 * conversation's turns, newest first a page at a time, each projected from
 * its row and its journal exactly as a call tells it live
 * (`voice/plan-work.ts`), a worker's session read from its child
 * conversation beside it. The code is every answered `show_code` call in
 * the conversation's journals, oldest first, read by the same rule that puts
 * a call's code on screen (`show-code.ts`), so nothing the call refused,
 * and no secret file, is read back. The plan is read under the account
 * first, so a plan another account owns reads as no plan, exactly as in
 * `plan-store.ts`. Nothing is written here.
 */

/** The conversation's journals that call the worker, where a task a later turn sent work to was started; none where they do not read. */
const workerJournalsOf = Effect.fnUntraced(function* (userId: string, conversationId: string) {
  const read = yield* listJournalsCalling(
    userId,
    conversationId,
    HOSTED_TOOL_SET,
    EVE_DELEGATION_TOOL.WORKER,
  );
  return read.ok ? read.value.map((row) => row.message) : [];
});

/** One turn's journal and the sessions of the subagents it started or sent work to, or nothing where the turn wrote none or it does not read. */
const journalOf = Effect.fnUntraced(function* (userId: string, turn: StoredTurnRecord) {
  const read = yield* readMessageByClientId(userId, turn.conversationId, HOSTED_TOOL_SET, turn.id);
  const message = read.ok ? read.value[0]?.message : undefined;
  if (message === undefined) return undefined;
  const earlier =
    callsSendingToEarlierTasks(message).length === 0
      ? []
      : yield* workerJournalsOf(userId, turn.conversationId);
  const subagents = new Map<string, readonly SubagentJournal[]>();
  for (const [callId, sessionCallId] of workerSessionCallsOf(message, earlier)) {
    const session = yield* listJournals(
      userId,
      childConversationId(turn.conversationId, sessionCallId),
      HOSTED_TOOL_SET,
      SUBAGENT_JOURNALS,
    );
    if (session.ok) subagents.set(callId, session.value);
  }
  return { turn, message, subagents };
});

/** Every code the journals' answered `show_code` calls put on screen, in the order the calls were made, the journals oldest first. */
function shownCodeIn(journals: readonly StoredMessageRecord[]): PlanShownCode[] {
  return journals.flatMap((journal) =>
    journal.message.parts.filter(isStoredToolPart).flatMap((part) => {
      const code = storedToolName(part) === SHOW_CODE_TOOL.name ? shownCodeOf(part) : undefined;
      return code === undefined
        ? []
        : [
            {
              callId: part.toolCallId,
              turnId: journal.clientId,
              shownAt: journal.createdAt.getTime(),
              code,
            },
          ];
    }),
  );
}

/** Every code shown in the conversation; none where a journal holding a call of it does not read. */
const allShownCode = Effect.fnUntraced(function* (userId: string, conversationId: string) {
  const read = yield* listJournalsCalling(
    userId,
    conversationId,
    HOSTED_TOOL_SET,
    SHOW_CODE_TOOL.name,
  );
  return read.ok ? shownCodeIn(read.value) : [];
});

/**
 * A page of the plan's work as the Work and Code tabs draw it: the newest
 * turns queued before the turn `before` names, or the newest of all, those
 * that wrote anything, oldest first, with the turn the next older page is
 * read before where one stands; and on the newest page, every code shown on
 * the plan. No turn for a plan whose planning model never ran, and nothing
 * where the account owns no such plan. A journal this build cannot read
 * leaves its turn out rather than the whole page.
 */
export function readPlanWork(
  userId: string,
  planId: string,
  before: string | undefined,
): PlanStoreEffect<Option.Option<PlanWorkAnswer>> {
  return Effect.gen(function* () {
    const plan = yield* readPlan(userId, planId);
    if (Option.isNone(plan)) return Option.none();
    const { conversationId } = plan.value;
    const newest = before === undefined;
    if (conversationId === undefined) {
      return Option.some({ turns: [], ...(newest ? { code: [] } : undefined) });
    }
    const page = yield* turnsBefore(userId, conversationId, PLAN_WORK_BOUNDS.TURNS, before);
    const read = yield* Effect.forEach(page.turns, (turn) => journalOf(userId, turn));
    const journaled = read.filter((each) => each !== undefined);
    const code = newest ? yield* allShownCode(userId, conversationId) : undefined;
    const oldest = page.turns[0];
    return Option.some({
      turns: journaled.map((each) => planWorkOf(each.turn, each.message, each.subagents)),
      ...(page.earlier && oldest !== undefined ? { earlier: oldest.id } : undefined),
      ...(code === undefined ? undefined : { code }),
    });
  });
}
