import type { DatabaseServices } from "@luke/database/core/query";
import {
  listPublishedCodingAgentsById,
  planNamesOf,
} from "@luke/database/models/coding-agent-store";
import { listPages, readPageVersion } from "@luke/database/models/plan-pages";
import type { PageVersion } from "@luke/features/page-wire";
import type { Task } from "@luke/features/task-wire";
import { Effect, Option, Schema } from "effect";
import { wireUuidSchema } from "../core.js";
import type { StoreFailure } from "../http/store-failure.js";
import {
  type MentionedAgent,
  type MentionedReads,
  mentionedIds,
  NO_MENTIONED_READS,
} from "./mentioned-context.js";

/**
 * mentioned-reads.ts -- the pages a message mentions on its agent's own plan, and the coding agents it mentions anywhere in its agent's workspace, read as the sender at the send, for `mentioned-context.ts` to hand.
 *
 * A page is read at its newest version, through the read the plan's side
 * panel draws from, so the sender is handed nothing of the plan they could
 * not open themselves. An agent is read by its id, on any task or none,
 * archived or not, with what it published and its task's name, through the
 * read opening its tab makes (`listPublishedCodingAgentsById`), so the
 * sender is handed only an agent they could open; and only one of the
 * workspace the message's agent stands in, so an agent of another
 * workspace, even one the sender is also in, is handed nothing. Nothing is
 * read where the words mention no page of the plan and no agent, which is
 * nearly every message.
 */

/** Where a message lands: the plan its agent works on, if any, and the workspace its agent stands in. */
export interface MentionPlace {
  readonly task: Task | undefined;
  readonly workspaceId: string;
}

/** An agent's id as a mention spells it, read as the store holds it: a UUID in lower case; nothing for one that is no UUID. */
const agentIdOf = Schema.decodeUnknownOption(wireUuidSchema);

/** The newest version of each page named that the plan holds, by id. */
const readPages = (userId: string, taskId: string, named: readonly string[]) =>
  Effect.gen(function* () {
    const found = new Map<string, PageVersion>();
    if (named.length === 0) return found;
    const lines = yield* listPages(userId, taskId);
    for (const line of lines.filter((each) => named.includes(each.id))) {
      const version = yield* readPageVersion(userId, taskId, line.id, line.version);
      if (Option.isSome(version)) found.set(line.id, version.value);
    }
    return found;
  });

/** Each agent named that the sender can open in the workspace, by id, with its task and where its work stands on GitHub. */
const readAgents = (userId: string, workspaceId: string, named: readonly string[]) =>
  Effect.gen(function* () {
    const found = new Map<string, MentionedAgent>();
    // Note that an id that is no UUID names no agent, and is not asked of a store that would refuse it.
    const ids = named.flatMap((id) => Option.toArray(agentIdOf(id)));
    if (ids.length === 0) return found;
    const read = yield* listPublishedCodingAgentsById(userId, ids);
    const standing = read.filter(({ agent }) => agent.organizationId === workspaceId);
    const tasks = yield* planNamesOf(
      userId,
      standing.flatMap(({ agent }) => agent.taskId ?? []),
    );
    for (const { agent, published } of standing) {
      const task = agent.taskId === null ? undefined : tasks.get(agent.taskId);
      found.set(agent.id, {
        id: agent.id,
        name: agent.title ?? agent.model,
        task:
          agent.taskId === null || task === undefined
            ? null
            : { id: agent.taskId, name: task.name, archived: task.archived },
        repository: agent.repository,
        branch: agent.branch,
        pullRequest: published === null ? null : { number: published.number, url: published.url },
        archived: agent.archivedAt !== null,
      });
    }
    return found;
  });

/** What the words mention of the plan's pages and the workspace's agents, read as `userId`; nothing read where they mention none. */
export function readMentioned(
  userId: string,
  words: string,
  place: MentionPlace,
): Effect.Effect<MentionedReads, StoreFailure, DatabaseServices> {
  const { task } = place;
  const named = mentionedIds(words, task);
  if (named.pages.length === 0 && named.agents.length === 0) {
    return Effect.succeed(NO_MENTIONED_READS);
  }
  return Effect.all({
    pages:
      task === undefined
        ? Effect.succeed(new Map<string, PageVersion>())
        : readPages(userId, task.id, named.pages),
    agents: readAgents(userId, place.workspaceId, named.agents),
  });
}
