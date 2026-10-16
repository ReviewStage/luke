import type { DatabaseServices } from "@luke/database/core/query";
import { askRecord } from "@luke/database/models/asks";
import { markNoticed, releaseNotice } from "@luke/database/models/chat-store";
import { chatNoticeKey } from "@luke/database/models/ids";
import { openTaskConversation } from "@luke/database/models/task-store";
import { Effect, Option, Result } from "effect";
import { ASK_ORIGIN } from "../../core.js";
import { logStoreFailure } from "../../http/store-failure.js";
import {
  type ChatNotice,
  type ChatNoticeDoor,
  type ChatNoticeDoors,
  type ChatTelling,
  HELD_DOORS,
  NOTICE_OUTCOME,
  noticeMetadata,
  senderOf,
} from "../coder-host/chat-notify.js";
import { acceptAsk } from "./brain-ask.js";
import type { EveSessions } from "./eve-sessions.js";

/**
 * chat-wake.ts -- a chat message to a plan's `@luke` wakes the plan's Luke: a turn on the plan's conversation whose line is the notice.
 *
 * The planner door of the chat's telling (`../coder-host/chat-notify.ts`).
 * A DM to `@luke`, a mention of it, or a reply in a thread it spoke in opens
 * a turn on the conversation the plan's planning model runs in, opened now
 * where the plan names none, whether or not anyone is on a call. The notice
 * is written there as a line awaiting its turn, marked as chat with its
 * poster, so the window draws it as the chat notice it is and never as the
 * developer typing; and it is handed to eve through the ask door
 * (`brain-ask.ts`) as the deployment acting for the account posting, under a
 * key named for the message, its place, and the member, so a notice handed
 * over twice lands once. Luke holds one notice at a time, as an agent does:
 * another while it has not read past the first is held for its next read. A
 * notice eve did not take, or the store could not write, is let go, so the
 * next one is told. A planner never leaves; a plan that no longer stands
 * holds the message unread.
 *
 * Note that this door rides the ask door's typed turn, which the
 * deployment may open only for this, because the rollout series' report
 * turn, which is what this door opens in the end, has not landed; it is the
 * try-it build of the chat plan's P2 and is replaced by `reportToPlan` then.
 */

/**
 * The words handed to eve where it took them, under the line written ahead
 * of the turn with the notice's chat metadata; false where eve did not take
 * them, the plan no longer stands, or the store refused the line.
 */
const wake = (
  eve: EveSessions,
  planId: string,
  key: string,
  notice: ChatNotice,
  telling: ChatTelling,
) =>
  Effect.gen(function* () {
    const conversation = yield* openTaskConversation(telling.userId, planId);
    if (Option.isNone(conversation)) return false;
    const { conversationId, ownerId } = conversation.value;
    const services = yield* Effect.context<DatabaseServices>();
    // The ask is the dispatch the line waits on, so the line stands only where eve took its words.
    const dispatch = acceptAsk(
      { asks: askRecord(), eve },
      {
        accountId: telling.userId,
        userId: ownerId,
        question: notice.text,
        origin: ASK_ORIGIN.TYPED,
        clientId: key,
        conversationId,
      },
    ).pipe(
      Effect.map(Result.isSuccess),
      Effect.tapError(logStoreFailure),
      Effect.orElseSucceed(() => false),
      Effect.provide(services),
    );
    const writer = yield* telling.writer;
    const written = yield* writer.writeAwaitingLine(
      { userId: ownerId, conversationId },
      {
        text: notice.text,
        clientKey: key,
        sender: senderOf(notice.from),
        metadata: noticeMetadata(notice),
      },
      dispatch,
    );
    return Result.isSuccess(written) && Option.isSome(written.success);
  });

/**
 * The planner door over the planning brain's eve as the deployment acting
 * for an account, nothing where the deployment reaches none: held where a
 * notice is outstanding or there is no eve, told where eve took the line,
 * otherwise let go and held.
 */
function plannerWakeDoor(
  brainEveFor: (accountId: string) => EveSessions | undefined,
): ChatNoticeDoor {
  return (member, notice, telling) =>
    Effect.gen(function* () {
      const { userId, organizationId } = telling;
      const planId = member.planId;
      const eve = brainEveFor(userId);
      if (planId === null || eve === undefined) return NOTICE_OUTCOME.HELD;
      const place = notice.message.touchedSeq;
      const claimed = yield* markNoticed(userId, organizationId, member.id, notice.message.channelId, place);
      if (!claimed) return NOTICE_OUTCOME.HELD;
      const key = chatNoticeKey(notice.message.id, place, member.id);
      const woke = yield* wake(eve, planId, key, notice, telling).pipe(
        Effect.tapError(logStoreFailure),
        Effect.orElseSucceed(() => false),
      );
      if (woke) return NOTICE_OUTCOME.TOLD;
      yield* releaseNotice(userId, organizationId, member.id, place);
      return NOTICE_OUTCOME.HELD;
    }).pipe(
      Effect.tapError(logStoreFailure),
      Effect.orElseSucceed(() => NOTICE_OUTCOME.HELD),
    );
}

/** The doors a host tells a post through: the plan's Luke woken, a person held for the window. */
export function wakingDoors(
  brainEveFor: (accountId: string) => EveSessions | undefined,
): ChatNoticeDoors {
  return { ...HELD_DOORS, planner: plannerWakeDoor(brainEveFor) };
}
