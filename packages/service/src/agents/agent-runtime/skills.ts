/**
 * skills.ts -- the agent skills a session is offered: the ones the repository it works on keeps.
 *
 * eve offers a session the skills its resolvers hand it, lists each by its
 * description, and loads one's body with `load_skill` when the developer
 * names it or the work matches it; it never looks in a checkout for skills
 * of its own. So a repository's skills are read from GitHub as a session
 * starts (`../repository-skills.ts`), on a read token for that one
 * repository minted on the installation of the task's workspace, and handed to eve as skills of the session, each one's body
 * told where the skill stands in the agent's own view of the repository, so
 * the files it names can be found. A skill's body is handed as markdown
 * alone, so eve writes nothing into a sandbox and opens none for it. Which
 * roles are offered skills is each role's profile (`role.ts`). Read as the
 * session starts, so a read that fails is logged and offers no skills rather
 * than failing the start.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import type { ConversationTarget } from "@luke/database/models/writer";
import { Effect, Option } from "effect";
import type { HttpClient } from "effect/http";
import { defineSkill } from "eve/skills";
import { GitHubApp, markRefusedToken } from "../../github/github-app.js";
import type { StoreFailure } from "../../http/store-failure.js";
import { type RepositorySkill, readRepositorySkills } from "../repository-skills.js";

/** One skill as eve is handed it: its name, the description it routes on, and the body `load_skill` answers. */
export interface AgentSkill {
  readonly name: string;
  readonly description: string;
  readonly markdown: string;
}

/**
 * The skills the repository keeps on its default branch, as eve is handed
 * them, each body led by where it stands for the agent reading it; none
 * where the installation of the task's workspace does not reach the
 * repository or GitHub could not be read, which is logged.
 */
export const repositorySkills = /* @__PURE__ */ Effect.fn("web/repositorySkills")(function* (
  target: ConversationTarget,
  /** The workspace whose installation reads the repository, as the caller reaches it. */
  workspaceOf: Effect.Effect<Option.Option<string>, StoreFailure, DatabaseServices>,
  repository: string,
  /** The member whose own token reads the repository where no installation reaches it; none for an automation. */
  member: string | undefined,
  loaded: (skill: RepositorySkill) => string,
): Effect.fn.Return<
  readonly AgentSkill[],
  never,
  GitHubApp | HttpClient.HttpClient | DatabaseServices
> {
  const app = yield* GitHubApp;
  const read = Effect.gen(function* () {
    const workspace = yield* workspaceOf;
    if (Option.isNone(workspace)) return [];
    const reached = yield* app.repositoryReadToken(workspace.value, repository, member);
    if (Option.isNone(reached)) return [];
    return yield* readRepositorySkills(reached.value.token, reached.value.repository).pipe(
      markRefusedToken(reached.value.access),
    );
  });
  const skills = yield* read.pipe(
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(
          `The skills of conversation ${target.conversationId} were not read: ${failure._tag}`,
        ),
        [],
      ),
    ),
  );
  return skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    markdown: loaded(skill),
  }));
});

/** The skills as eve's map of them, by name, for a role's \`skills/repository.ts\`; nothing where there are none. */
export function offeredSkills(skills: readonly AgentSkill[]) {
  if (skills.length === 0) return null;
  return Object.fromEntries(
    skills.map((skill) => [
      skill.name,
      defineSkill({ description: skill.description, markdown: skill.markdown }),
    ]),
  );
}
