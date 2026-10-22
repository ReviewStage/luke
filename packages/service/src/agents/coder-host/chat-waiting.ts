import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import { chatEnabledFor } from "@luke/database/models/account-store";
import {
  type ChatMemberRow,
  type ChatMessageRow,
  channelsOf,
  messageAt,
  roster,
  waitingOn,
  waitingStamps,
} from "@luke/database/models/chat-store";
import { listWorkspaces } from "@luke/database/models/workspace-store";
import { ACCOUNT_CHAT_REASON, type AccountChatEntry } from "@luke/features/account-inbox-wire";
import { ASK_STATUS, CHANNEL_KIND, CHAT_MEMBER_LABEL, MEMBER_KIND } from "@luke/features/chat-wire";
import { Effect, Option, type Schema } from "effect";
import type { CursorStamp } from "../../http/held-read.js";
import { chatMemberNamesOf } from "./chat-names.js";

/**
 * chat-waiting.ts -- what waits on a person in their workspaces' chat, as the account's held read carries it beside the inbox: the asks open to them, and the message their member was last told of.
 *
 * Two things wait. Every open ask someone else posted in a workspace the
 * account is in (`waitingOn`), which stands until it is answered or its
 * poster resolves it. And the one direct message or mention the person's
 * member was told of and has not read past: the chat stamps a person's
 * member with the place of the message that addressed them, one at a time
 * (`chat-notify.ts`'s human door), and a read past it lets it go, so this
 * reads each of the account's members and the message at its stamp. Each
 * carries who posted it by what they are called (`chat-names.ts`) and the
 * plan of its channel, and none of its words. The stamps the held read looks at between reads say where
 * each stands and nothing more, so a look reads no message, only the
 * asks' places and each member's two cursors.
 */

/** What reading what waits may fail with: the store's own failures. */
type ChatWaitingFailure = QueryError | Schema.SchemaError;

/** The account's own member of each workspace it is in, and that workspace's roster, by workspace. */
interface Rosters {
  readonly workspaceId: string;
  readonly own: ChatMemberRow | undefined;
  readonly members: ReadonlyMap<string, ChatMemberRow>;
}

/** Whether a member holds a notice it has not read past. */
function noticed(member: ChatMemberRow): member is ChatMemberRow & { readonly noticeSeq: number } {
  return member.noticeSeq !== null && member.noticeSeq > member.readSeq;
}

/** Every workspace's roster the account sees, with its own member of each. */
function rostersOf(userId: string) {
  return Effect.gen(function* () {
    const workspaces = yield* listWorkspaces(userId);
    return yield* Effect.forEach(workspaces, (workspace) =>
      Effect.map(
        roster(userId, workspace.id),
        (rows): Rosters => ({
          workspaceId: workspace.id,
          own: rows.find((row) => row.kind === MEMBER_KIND.HUMAN && row.userId === userId),
          members: new Map(rows.map((row) => [row.id, row])),
        }),
      ),
    );
  });
}

/**
 * Where what waits stands, as the held read's cursor digests it: each open
 * ask's place, and each member's notice and cursor, so an ask posted,
 * changed, or settled, a notice stamped, and a read past one each move it.
 */
export function chatWaitingStamps(
  userId: string,
): Effect.Effect<readonly CursorStamp[], ChatWaitingFailure, DatabaseServices> {
  return Effect.gen(function* () {
    // Chat is an experiment: an account with it off has nothing waiting in it.
    if (!(yield* chatEnabledFor(userId))) return [];
    const asks = yield* waitingStamps(userId);
    const rosters = yield* rostersOf(userId);
    const notices = rosters.flatMap(({ own }) =>
      own === undefined || !noticed(own)
        ? []
        : [
            {
              id: own.id,
              revision: own.noticeSeq,
              status: ASK_STATUS.OPEN,
              updatedAt: own.readSeq,
            },
          ],
    );
    return [
      ...asks.map((ask) => ({
        id: ask.id,
        revision: ask.revision,
        status: ask.status,
        updatedAt: ask.touchedSeq,
      })),
      ...notices,
    ];
  });
}

/** One message that waits on the account, before its author is named: the message, why it waits, its channel's plan, and its workspace's roster. */
interface Waiting {
  readonly message: ChatMessageRow;
  readonly reason: AccountChatEntry["reason"];
  readonly taskId: string | null;
  readonly rosters: Rosters;
}

/** One message as an entry carries it, its author by what they are called. */
function entryOf(waiting: Waiting, nameOf: (member: ChatMemberRow) => string): AccountChatEntry {
  const { message, reason, taskId, rosters } = waiting;
  const author = rosters.members.get(message.authorMemberId);
  return {
    messageId: message.id,
    seq: message.seq,
    workspaceId: rosters.workspaceId,
    reason,
    from: author === undefined ? CHAT_MEMBER_LABEL.FORMER_PERSON : nameOf(author),
    planId: taskId,
    touchedSeq: message.touchedSeq,
    updatedAt: message.touchedAt.getTime(),
  };
}

/** The message a member's notice stands at, waiting: a direct message where its channel is one, else a mention; none where the account no longer sees it. */
function noticeWaiting(userId: string, rosters: Rosters) {
  return Effect.gen(function* () {
    const { own } = rosters;
    if (own === undefined || !noticed(own)) return [];
    const message = yield* messageAt(userId, rosters.workspaceId, own.id, own.noticeSeq);
    if (Option.isNone(message)) return [];
    const channels = yield* channelsOf(userId, rosters.workspaceId);
    const channel = channels.find((each) => each.id === message.value.channelId);
    const reason =
      channel?.kind === CHANNEL_KIND.DM ? ACCOUNT_CHAT_REASON.DIRECT : ACCOUNT_CHAT_REASON.MENTION;
    return [{ message: message.value, reason, taskId: channel?.taskId ?? null, rosters }];
  });
}

/**
 * What waits on the account in chat: the open asks, then each member's
 * notice, the latest changed first. Each author is named once per
 * workspace, and only in a workspace where something waits.
 */
export function chatWaitingEntries(
  userId: string,
): Effect.Effect<readonly AccountChatEntry[], ChatWaitingFailure, DatabaseServices> {
  return Effect.gen(function* () {
    if (!(yield* chatEnabledFor(userId))) return [];
    const rosters = yield* rostersOf(userId);
    const byWorkspace = new Map(rosters.map((each) => [each.workspaceId, each]));
    const asks: readonly Waiting[] = (yield* waitingOn(userId)).flatMap(({ message, taskId }) => {
      const of = byWorkspace.get(message.organizationId);
      return of === undefined
        ? []
        : [{ message, reason: ACCOUNT_CHAT_REASON.ASK, taskId, rosters: of }];
    });
    const notices = (yield* Effect.forEach(rosters, (each) => noticeWaiting(userId, each))).flat();
    // A notice of an ask is the ask already, so it is said once.
    const asked = new Set(asks.map((each) => each.message.id));
    const waiting = [...asks, ...notices.filter((each) => !asked.has(each.message.id))];
    const named = new Map<string, (member: ChatMemberRow) => string>();
    for (const each of new Set(waiting.map((one) => one.rosters))) {
      named.set(
        each.workspaceId,
        yield* chatMemberNamesOf(userId, each.workspaceId, each.members.values()),
      );
    }
    return waiting
      .map((each) =>
        entryOf(
          each,
          named.get(each.rosters.workspaceId) ?? (() => CHAT_MEMBER_LABEL.FORMER_PERSON),
        ),
      )
      .toSorted((one, other) => other.updatedAt - one.updatedAt);
  });
}
