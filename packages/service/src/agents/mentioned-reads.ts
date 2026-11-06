import type { DatabaseServices } from "@repo/database/core/query";
import { listPublishedAgentsById, taskNamesOf } from "@repo/database/models/agent-store";
import { listPages } from "@repo/database/models/task-pages";
import { taskIdOfNumber } from "@repo/database/models/task-number-store";
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

export interface MentionPlace {
  readonly task: Task | undefined;
  readonly agentId?: string | undefined;
  readonly workspaceId: string;
}

const agentIdOf = Schema.decodeUnknownOption(wireUuidSchema);

const readPages = (userId: string, owner: PageOwner, named: readonly string[]) =>
  Effect.map(
    listPages(userId, owner),
    (lines) =>
      new Map<string, PageLine>(
        lines.filter((line) => named.includes(line.id)).map((line) => [line.id, line]),
      ),
  );

const readAgents = (userId: string, workspaceId: string, named: readonly string[]) =>
  Effect.gen(function* () {
    const found = new Map<string, MentionedAgent>();
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
