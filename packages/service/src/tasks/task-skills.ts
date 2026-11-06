import type { DatabaseServices } from "@repo/database/core/query";
import {
  type InstalledSkill,
  listInstalledSkills,
} from "@repo/database/models/installed-skill-store";
import { readTaskHeader, type TaskStoreFailure } from "@repo/database/models/task-store";
import { INSTALLED_SKILL_SCOPE } from "@repo/features/installed-skill-wire";
import {
  TASK_FILE_REFUSAL,
  TASK_SKILL_BOUNDS,
  TASK_SKILL_SOURCE,
  type TaskSkill,
  type TaskSkillsAnswer,
} from "@repo/features/task-wire";
import { Effect, Option } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { readRepositorySkills, skillFilePath } from "../agents/repository-skills.js";
import { type GitHubApp, markRefusedToken } from "../github/github-app.js";
import { logGitHubReadFailure } from "../github/github-refusal.js";
import { reachTaskRepository, refused } from "./task-file.js";

const SOURCE_OF_SCOPE = {
  [INSTALLED_SKILL_SCOPE.WORKSPACE]: TASK_SKILL_SOURCE.WORKSPACE,
  [INSTALLED_SKILL_SCOPE.PERSONAL]: TASK_SKILL_SOURCE.PERSONAL,
} as const satisfies Record<InstalledSkill["scope"], TaskSkill["source"]>;

function mergedSkills(
  repository: readonly TaskSkill[],
  reserved: ReadonlySet<string>,
  installed: readonly InstalledSkill[],
): readonly TaskSkill[] {
  const offered = installed
    .filter((skill) => skill.userInvocable)
    .map(
      (skill): TaskSkill => ({
        name: skill.name,
        description: skill.description.slice(0, TASK_SKILL_BOUNDS.MAX_DESCRIPTION_CHARS),
        source: SOURCE_OF_SCOPE[skill.scope],
      }),
    );
  const taken = new Set<string>(reserved);
  const merged: TaskSkill[] = [...repository];
  for (const skill of repository) taken.add(skill.name);
  for (const skill of offered) {
    if (taken.has(skill.name)) continue;
    taken.add(skill.name);
    merged.push(skill);
  }
  return merged.slice(0, TASK_SKILL_BOUNDS.MAX_SKILLS);
}

const readRepository = /* @__PURE__ */ Effect.fn("web/taskSkillsRead")(function* (
  organizationId: string,
  repository: string,
  member: string,
) {
  const reach = yield* reachTaskRepository(organizationId, repository, member);
  if ("refused" in reach) return reach.refused;
  const { token, repository: confirmed, access } = reach.reached;
  const skills = yield* readRepositorySkills(token, confirmed).pipe(markRefusedToken(access));
  return {
    branch: confirmed.defaultBranch,
    reserved: new Set(skills.map((skill) => skill.name)),
    skills: skills
      .filter((skill) => skill.userInvocable)
      .map(
        (skill): TaskSkill => ({
          name: skill.name,
          description: skill.description,
          source: TASK_SKILL_SOURCE.REPOSITORY,
          path: skillFilePath(skill),
        }),
      ),
  };
});

export function readTaskSkills(
  userId: string,
  taskId: string,
  installed: boolean,
): Effect.Effect<
  Option.Option<TaskSkillsAnswer>,
  TaskStoreFailure,
  DatabaseServices | HttpClient.HttpClient | GitHubApp
> {
  return Effect.gen(function* () {
    const stored = yield* readTaskHeader(userId, taskId);
    if (Option.isNone(stored)) return Option.none();
    return Option.some(
      yield* readWorkspaceSkills(
        stored.value.workspaceId,
        stored.value.repository,
        userId,
        installed,
      ),
    );
  });
}

export function readWorkspaceSkills(
  workspaceId: string,
  repository: string | null,
  member: string,
  installed: boolean,
): Effect.Effect<
  TaskSkillsAnswer,
  TaskStoreFailure,
  DatabaseServices | HttpClient.HttpClient | GitHubApp
> {
  return Effect.gen(function* () {
    if (repository === null && !installed) return refused(TASK_FILE_REFUSAL.NO_REPOSITORY);
    const read =
      repository === null
        ? { branch: null, reserved: new Set<string>(), skills: [] }
        : yield* readRepository(workspaceId, repository, member).pipe(
            Effect.catchTag("GitHubUnavailable", (failure) =>
              Effect.as(logGitHubReadFailure(failure), refused(TASK_FILE_REFUSAL.UNAVAILABLE)),
            ),
          );
    if ("refusal" in read) return read;
    const offered = installed ? yield* listInstalledSkills(member, workspaceId) : [];
    return {
      skills: {
        repository,
        branch: read.branch,
        skills: mergedSkills(read.skills, read.reserved, offered),
      },
    } satisfies TaskSkillsAnswer;
  });
}
