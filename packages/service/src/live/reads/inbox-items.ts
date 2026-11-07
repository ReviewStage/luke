/**
 * inbox-items.ts -- every inbox item the account reaches bound (`INBOX_ITEMS_READ`): its statements, the tables they read, the topics that wake it, the instant it carries settled items since, and what a reader past a sync id is answered.
 *
 * Its statements are the inbox store's own (`accountItemsLiveStatements`,
 * `accountItemsDeltaStatements`), beside the held reads they mirror and
 * the SQL those share.
 */

import { TOPIC } from "@repo/database/sync/notification";
import { attachmentSync, inboxItemSync, inboxMessageSync } from "@repo/database/sync/tables";
import { INBOX_ITEMS_READ } from "@repo/features/inbox-live";
import { ACCOUNT_INBOX_ITEMS } from "@repo/features/live-wire";
import { Clock, Effect } from "effect";
import { HOSTED_REFUSAL } from "../../http/http-effect.js";
import {
  accountItemsDeltaStatements,
  accountItemsLiveStatements,
} from "../../inbox/inbox-store.js";
import { instantParam } from "../../sync/live-param.js";
import { readerAndWorkspaceTopics } from "../../sync/reader-topics.js";
import { bindLiveRead } from "../live-read-binding.js";
import { ITEM_GATES, SCOPE_INBOX_READS } from "./scope-inbox.js";

/**
 * Every inbox item the account reaches, where each stands and those
 * changed since the reader's instant whole, woken on the account's topic,
 * which an item written in any of its workspaces names for every member
 * (`inboxItemSync`), as do its own read marks and what admits it to a
 * workspace or a repository. Note that a message withdrawn names only its
 * item's task and agent, and a task or an agent written itself no account,
 * as for the account's inbox: either shows at the hold's end. The settled
 * items it carries are those changed since `settledSince`, which it binds
 * from the clock, since a live statement reads none, and those the reader
 * set a reminder on and has not read since. A `since` of no shape, epoch
 * milliseconds as text, is refused; none reads every item.
 *
 * A reader past a sync id is answered the items that moved alone, each
 * whole, taking the moved rows its workspaces' topics reach, since a task,
 * an agent, or a member names those rather than the account; a message or
 * a file names only its item's task and agent, so its rows are taken
 * whatever they name. An item that leaves by the clock, past thirty days
 * settled, logs nothing, and the reader drops it itself.
 */
export const inboxItemsRead = bindLiveRead(INBOX_ITEMS_READ, {
  reads: SCOPE_INBOX_READS,
  topics: ({ userId }) => [[TOPIC.ACCOUNT, userId]],
  statements: ({ userId, since, settledSince }) =>
    accountItemsLiveStatements(userId, instantParam(since), instantParam(settledSince)),
  serve: () =>
    Effect.map(Clock.currentTimeMillis, (now) => ({
      settledSince: String(now - ACCOUNT_INBOX_ITEMS.SETTLED_WINDOW_MILLIS),
    })),
  // Note that the query is read rather than the param, which binds a `since` left out as empty, and one named empty is refused.
  admit: (_params, query) => {
    const since = query[ACCOUNT_INBOX_ITEMS.SINCE];
    return since === undefined || /^\d{1,15}$/.test(since)
      ? Effect.void
      : Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  },
  delta: {
    whole: ITEM_GATES,
    anyTopic: [inboxMessageSync, attachmentSync],
    reach: ({ userId }) => readerAndWorkspaceTopics(userId),
    own: { stamps: inboxItemSync, items: inboxItemSync },
    statements: ({ userId, settledSince }, moved) =>
      accountItemsDeltaStatements(userId, instantParam(settledSince), moved),
  },
});
