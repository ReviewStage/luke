import type { DatabaseServices } from "@repo/database/core/query";
import { listPublishedAgentsById, taskNamesOf } from "@repo/database/models/agent-store";
import { taskIdOfNumber } from "@repo/database/models/task-number-store";
import { listPages } from "@repo/database/models/task-pages";
import { numberedTasksIn } from "@repo/features/mention-link";
import { agentName } from "@repo/features/model-label";
import type { PageLine, PageOwner } from "@repo/features/page-wire";
import type { Task } from "@repo/features/task-wire";
import { Effect, Option, Schema } from "effect";
import { listMembers } from "../accounts/workspace-members.js";
import { wireUuidSchema } from "../core.js";
import type { StoreFailure } from "../http/store-failure.js";
import {
  type MentionedAgent,
  type MentionedPerson,
  type MentionedReads,
  mentionedIds,
  NO_MENTIONED_READS,
  pagesOwnerOf,
} from "./mentioned-context.js";

/**
 * mentioned-reads.ts -- the pages a message mentions on its agent's own plan, or, for an agent on no plan, among those it showed itself, and the coding agents and people it mentions anywhere in its agent's workspace, read as the sender at the send, for `mentioned-context.ts` to hand.
 *
 * A page is read as its newest version names it, title and number and no
 * HTML, through the read the plan's side panel lists them by, so the sender is handed nothing of the plan they could
 * not open themselves. An agent is read by its id, on any task or none,
 * archived or not, with what it published and its task's name, through the
 * read opening its tab makes (`listPublishedAgentsById`), so the
 * sender is handed only an agent they could open; and only one of the
 * workspace the message's agent stands in, so an agent of another
 * workspace, even one the sender is also in, is handed nothing. A person is
 * read among the members of that same workspace, through the read its
 * Members list makes, so someone of another workspace is handed nothing
 * either. A task a link names by its number, `/<slug>/task/42`, is found by
 * its id for the sender alone, so a link into a workspace they are no
 * member of finds nothing and is handed nothing. Nothing is read where the words mention no page of the plan, no
 * agent, and no person, which is nearly every message.
 */

/** Where a message lands: the plan its agent works on, if any, the agent itself where it stands yet, whose own pages it holds on no plan, and the workspace its agent stands in. */
export interface MentionPlace {
  readonly task: Task | undefined;
  readonly agentId?: string | undefined;
  readonly workspaceId: string;
}

/** An agent's id as a mention spells it, read as the store holds it: a UUID in lower case; nothing for one that is no UUID. */
const agentIdOf = Schema.decodeUnknownOption(wireUuidSchema);

/** Each page named that its owner holds, by id, as its newest version names it. */
const readPages = (userId: string, owner: PageOwner, named: readonly string[]) =>
  Effect.map(
    listPages(userId, owner),
    (lines) =>
      new Map<string, PageLine>(
        lines.filter((line) => named.includes(line.id)).map((line) => [line.id, line]),
      ),
  );

/** Each agent named that the sender can open in the workspace, by id, with its task and where its work stands on GitHub. */
const readAgents = (userId: string, workspaceId: string, named: readonly string[]) =>
  Effect.gen(function* () {
    const found = new Map<string, MentionedAgent>();
    // Note that an id that is no UUID names no agent, and is not asked of a store that would refuse it.
    const ids = named.flatMap((id) => Option.toArray(agentIdOf(id)));
    if (ids.length === 0) return found;
    const read = yield* listPublishedAgentsById(userId, ids);
    const standing = read.filter(({ agent }) => agent.organizationId === workspaceId);
    const tasks = yield* taskNamesOf(
      userId,
      standing.flatMap(({ agent }) => agent.taskId ?? []),
    );
    for (const { agent, published } of standing) {
      const task = agent.taskId === null ? undefined : tasks.get(agent.taskId);
      found.set(agent.id, {
        id: agent.id,
        name: agentName(agent),
        task:
          agent.taskId === null || task === undefined
            ? null
            : { id: agent.taskId, name: task.name },
        repository: agent.repository,
        branch: agent.branch,
        pullRequest: published === null ? null : { number: published.number, url: published.url },
        archived: agent.archivedAt !== null,
      });
    }
    return found;
  });

/** Each person named who is a member of the workspace, by their account's id, with their name and role. */
const readPeople = (workspaceId: string, named: readonly string[]) =>
  Effect.map(
    listMembers(workspaceId),
    (members) =>
      new Map<string, MentionedPerson>(
        members
          .filter((member) => named.includes(member.userId))
          .map(({ userId, name, role }) => [userId, { userId, name, role }]),
      ),
  );

/**
 * Each task the words name by its number, by its id, under the workspace
 * step and the number its link spells: found by the slug, current or
 * former, or the id, and the number, held now or before the task moved,
 * only in a workspace the sender is a member of and only for a task they
 * reach (`taskIdOfNumber`).
 */
const readNumberedTasks = (userId: string, words: string) =>
  Effect.gen(function* () {
    const found = new Map<string, Map<number, string>>();
    for (const { workspace, number } of numberedTasksIn(words)) {
      const taskId = yield* taskIdOfNumber(userId, workspace, number);
      if (Option.isNone(taskId)) continue;
      const numbers = found.get(workspace) ?? new Map<number, string>();
      found.set(workspace, numbers.set(number, taskId.value));
    }
    return found;
  });

/** What the words mention of the plan's pages and the workspace's agents and people, and the tasks they name by their number, read as `userId`; nothing read where they mention none. */
export function readMentioned(
  userId: string,
  words: string,
  place: MentionPlace,
): Effect.Effect<MentionedReads, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const { task, agentId } = place;
    const tasks = yield* readNumberedTasks(userId, words);
    const named = mentionedIds(words, task, agentId, tasks);
    const owner = pagesOwnerOf(task, agentId);
    if (named.pages.length === 0 && named.agents.length === 0 && named.people.length === 0) {
      return { ...NO_MENTIONED_READS, tasks };
    }
    return yield* Effect.all({
      pages:
        owner === undefined || named.pages.length === 0
          ? Effect.succeed(new Map<string, PageLine>())
          : readPages(userId, owner, named.pages),
      agents: readAgents(userId, place.workspaceId, named.agents),
      people:
        named.people.length === 0
          ? Effect.succeed(new Map<string, MentionedPerson>())
          : readPeople(place.workspaceId, named.people),
      tasks: Effect.succeed(tasks),
    });
  });
}
