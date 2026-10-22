/**
 * task-skills.ts -- the skills a developer may choose of a task: its repository's, read from GitHub as it stands now, then the member's installed ones.
 *
 * A coding agent of the task is offered its repository's agent skills
 * (`repository-skills.ts`) and the member's enabled installed skills, and
 * the developer names one to load with a `/name`, so the desktop reads the
 * ones a developer may choose to offer them. The repository's are read
 * exactly where and as the File tab reads a file (`task-file.ts`): the task
 * is read under the account first, so a task another account owns reads as
 * no task, then the Luke GitHub App confirms the account reaches the task's
 * repository and mints a token for that one repository, used for the one
 * read and going nowhere else; the read is of the head of the repository's
 * default branch, and names it. The installed ones are the store's
 * (`installed-skill-store.ts`), the workspace's and then the member's own,
 * and they are offered on a task with no repository too. A name an earlier
 * source holds is left out of a later one, repository then workspace then
 * personal, as an agent's session merges them, so the list offers what a
 * `/name` loads. A desktop from before installed skills asks for none
 * (`TASK_SKILLS_INSTALLED`), and is answered the repository's alone, and a
 * task with no repository as refused, as it always was, since it reads an
 * installed skill's missing file as no answer at all. A skill whose
 * `SKILL.md` says the model alone loads it is
 * left out, as is an installed skill turned off, and what is answered of
 * each is its name, its description, its source, and, for a repository's,
 * where its `SKILL.md` stands, which the File tab opens, never its body.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import {
  type InstalledSkill,
  listInstalledSkills,
} from "@luke/database/models/installed-skill-store";
import { readTaskHeader, type TaskStoreFailure } from "@luke/database/models/task-store";
import { INSTALLED_SKILL_SCOPE } from "@luke/features/installed-skill-wire";
import {
  TASK_FILE_REFUSAL,
  TASK_SKILL_BOUNDS,
  TASK_SKILL_SOURCE,
  type TaskSkill,
  type TaskSkillsAnswer,
} from "@luke/features/task-wire";
import { Effect, Option } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { readRepositorySkills, skillFilePath } from "../agents/repository-skills.js";
import { type GitHubApp, markRefusedToken } from "../github/github-app.js";
import { logGitHubReadFailure } from "../github/github-refusal.js";
import { reachTaskRepository, refused } from "./task-file.js";

/** The source an installed skill is offered under, by its scope. */
const SOURCE_OF_SCOPE = {
  [INSTALLED_SKILL_SCOPE.WORKSPACE]: TASK_SKILL_SOURCE.WORKSPACE,
  [INSTALLED_SKILL_SCOPE.PERSONAL]: TASK_SKILL_SOURCE.PERSONAL,
} as const satisfies Record<InstalledSkill["scope"], TaskSkill["source"]>;

/** The order the installed sources are offered in, after the repository's. */
const INSTALLED_ORDER = [TASK_SKILL_SOURCE.WORKSPACE, TASK_SKILL_SOURCE.PERSONAL] as const;

/**
 * The installed skills a developer may choose beside the repository's: the
 * enabled ones a member may name, the workspace's and then their own, each
 * by name, any name an earlier one holds left out, as many as the list carries.
 */
function mergedSkills(
  repository: readonly TaskSkill[],
  installed: readonly InstalledSkill[],
): readonly TaskSkill[] {
  const offered = installed
    .filter((skill) => skill.enabled && skill.userInvocable)
    .map(
      (skill): TaskSkill => ({
        name: skill.name,
        description: skill.description.slice(0, TASK_SKILL_BOUNDS.MAX_DESCRIPTION_CHARS),
        source: SOURCE_OF_SCOPE[skill.scope],
      }),
    );
  const ordered = INSTALLED_ORDER.flatMap((source) =>
    offered
      .filter((skill) => skill.source === source)
      .toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
  );
  const taken = new Set<string>();
  const merged: TaskSkill[] = [];
  for (const skill of [...repository, ...ordered]) {
    if (taken.has(skill.name)) continue;
    taken.add(skill.name);
    merged.push(skill);
  }
  return merged.slice(0, TASK_SKILL_BOUNDS.MAX_SKILLS);
}

/** The repository's skills read through the App's reach, or the refusal the reach answers. */
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

/**
 * The skills a developer may choose of a task, its repository's as GitHub
 * holds it now and the member's installed ones, or why the repository's
 * are not read; nothing where the account owns no such task.
 */
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

/**
 * The skills a developer may choose in a workspace: the repository's, where
 * one is named, which the workspace's installation reaches, as GitHub holds
 * it now, then the member's installed ones; or why the repository's are not
 * read. A plan's read by the place its plan names, and the read of a place
 * no plan names, whose caller has already confirmed the account is a member
 * of the workspace.
 */
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
        ? { branch: null, skills: [] }
        : yield* readRepository(workspaceId, repository, member).pipe(
            Effect.catchTag("GitHubUnavailable", (failure) =>
              Effect.as(logGitHubReadFailure(failure), refused(TASK_FILE_REFUSAL.UNAVAILABLE)),
            ),
          );
    if ("refusal" in read) return read;
    const offered = installed ? yield* listInstalledSkills(member, workspaceId) : [];
    return {
      skills: { repository, branch: read.branch, skills: mergedSkills(read.skills, offered) },
    } satisfies TaskSkillsAnswer;
  });
}
