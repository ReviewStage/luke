/**
 * task-skills.ts -- the skills a developer may choose of a task's repository, read from GitHub as it stands now.
 *
 * A coding agent of the task is offered its repository's agent skills
 * (`repository-skills.ts`), and the developer names one to load with a
 * `/name`, so the desktop reads the ones a developer may choose to offer
 * them. They are read exactly where and as the File tab reads a file
 * (`task-file.ts`): the task is read under the account first, so a task
 * another account owns reads as no task, then the Luke GitHub App confirms
 * the account reaches the task's repository and mints a token for that one
 * repository, used for the one read and going nowhere else; the read is of
 * the head of the repository's default branch, and names it. A skill whose
 * `SKILL.md` says the model alone loads it is left out, and what is
 * answered of each is its name, its description, and where its `SKILL.md`
 * stands, which the File tab opens, never its body.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { readTask, type TaskStoreFailure } from "@luke/database/models/task-store";
import { TASK_FILE_REFUSAL, type TaskSkillsAnswer } from "@luke/features/task-wire";
import { Effect, Option } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { readRepositorySkills, skillFilePath } from "../agents/repository-skills.js";
import { type GitHubApp, markRefusedToken } from "../github/github-app.js";
import { logGitHubReadFailure } from "../github/github-refusal.js";
import { reachTaskRepository, refused } from "./task-file.js";

/** The skills read through the App's reach, or the refusal the reach answers. */
const readSkills = /* @__PURE__ */ Effect.fn("web/taskSkillsRead")(function* (
  organizationId: string,
  repository: string,
  member: string,
) {
  const reach = yield* reachTaskRepository(organizationId, repository, member);
  if ("refused" in reach) return reach.refused;
  const { token, repository: confirmed, access } = reach.reached;
  const skills = yield* readRepositorySkills(token, confirmed).pipe(markRefusedToken(access));
  return {
    skills: {
      repository,
      branch: confirmed.defaultBranch,
      skills: skills
        .filter((skill) => skill.userInvocable)
        .map((skill) => ({
          name: skill.name,
          description: skill.description,
          path: skillFilePath(skill),
        })),
    },
  } satisfies TaskSkillsAnswer;
});

/**
 * The skills a developer may choose of the task's repository as GitHub
 * holds it now, or why they are not read; nothing where the account owns
 * no such task.
 */
export function readTaskSkills(
  userId: string,
  taskId: string,
): Effect.Effect<
  Option.Option<TaskSkillsAnswer>,
  TaskStoreFailure,
  DatabaseServices | HttpClient.HttpClient | GitHubApp
> {
  return Effect.gen(function* () {
    const stored = yield* readTask(userId, taskId);
    if (Option.isNone(stored)) return Option.none();
    const repository = stored.value.task.repository;
    if (repository === null) return Option.some(refused(TASK_FILE_REFUSAL.NO_REPOSITORY));
    return Option.some(
      yield* readWorkspaceSkills(stored.value.task.workspaceId, repository, userId),
    );
  });
}

/**
 * The skills a developer may choose of a repository the workspace's
 * installation reaches, as GitHub holds it now, or why they are not read: a
 * plan's read by the place its plan names, and the read of a place no plan
 * names, whose caller has already confirmed the account is a member of the
 * workspace.
 */
export function readWorkspaceSkills(
  workspaceId: string,
  repository: string,
  member: string,
): Effect.Effect<TaskSkillsAnswer, never, DatabaseServices | HttpClient.HttpClient | GitHubApp> {
  return readSkills(workspaceId, repository, member).pipe(
    Effect.catchTag("GitHubUnavailable", (failure) =>
      Effect.as(logGitHubReadFailure(failure), refused(TASK_FILE_REFUSAL.UNAVAILABLE)),
    ),
  );
}
