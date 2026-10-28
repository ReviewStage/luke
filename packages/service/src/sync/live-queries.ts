/**
 * live-queries.ts -- every live read Luke Sync wakes, by its name, as one registry the registry test reads.
 *
 * A read is moved onto Luke Sync by defining it (`defineLiveQuery`), adding
 * it here, and answering its procedure from the definition
 * (`liveQueryParts`). Each view's own change defines its read, and a read
 * with no definition is looked at on its clock.
 */
import { macCommandsLiveStatement } from "@luke/database/models/mac-command-store";
import { repositoryPinsLiveStatement } from "@luke/database/models/repository-pin-store";
import { taskSectionsLiveStatements } from "@luke/database/models/task-section-store";
import { TOPIC } from "@luke/database/sync/notification";
import {
  agentSectionEntrySync,
  codingAgentSync,
  githubPersonalTokenSync,
  githubRepositoryReadSync,
  macCommandSync,
  memberSync,
  repositoryPinSync,
  taskSectionEntrySync,
  taskSectionSync,
  taskSync,
} from "@luke/database/sync/tables";
import { macCommandKindsRead } from "@luke/features/mac-command-wire";
import { Option } from "effect";
import { defineLiveQuery, LIVE_MODE, liveQueryRegistry } from "./live-query.js";

/**
 * The account's sidebar: its sections, the tasks and agents it keeps in
 * them, and its pinned repositories, woken by a write to any of them or to
 * what admits the account to a workspace or a repository, all of which name
 * the account. Note that a task or an agent written itself wakes no
 * sidebar, because a plan's save rewrites its task every few seconds and
 * every member keeping it would read again for nothing: a task moved or
 * deleted leaves its sections by its entries' own delete, and the rare
 * change that hides an entry without one shows at the hold's end.
 */
export const sidebarLive = defineLiveQuery({
  name: "sidebar",
  params: ["userId"],
  reads: [
    taskSectionSync,
    taskSectionEntrySync,
    agentSectionEntrySync,
    repositoryPinSync,
    taskSync,
    codingAgentSync,
    memberSync,
    githubPersonalTokenSync,
    githubRepositoryReadSync,
  ],
  topics: ({ userId }) => [[TOPIC.ACCOUNT, userId]],
  statements: ({ userId }) =>
    Option.zipWith(
      taskSectionsLiveStatements(userId),
      repositoryPinsLiveStatement(userId),
      (sections, pins) => ({ ...sections, pins }),
    ),
  mode: LIVE_MODE.SNAPSHOT,
});

/**
 * The commands of the kinds a Mac runs that no Mac of the account has
 * claimed yet, woken by a command queued, claimed, settled, or taken back,
 * each of which names the account. The kinds are the read's query as the
 * Mac spelled them, read here as its held read always read them.
 */
export const macCommandsLive = defineLiveQuery({
  name: "macCommands",
  params: ["userId", "kinds"],
  reads: [macCommandSync],
  topics: ({ userId }) => [[TOPIC.ACCOUNT, userId]],
  statements: ({ userId, kinds }) =>
    Option.map(macCommandsLiveStatement(userId, macCommandKindsRead(kinds)), (commands) => ({
      commands,
    })),
  mode: LIVE_MODE.SNAPSHOT,
});

export const LIVE_QUERIES = liveQueryRegistry([sidebarLive, macCommandsLive]);
