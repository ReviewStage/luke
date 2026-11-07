/**
 * skills.ts -- the agent skills a session is offered: the ones the repository it works on keeps, then the ones its member installed into the app.
 *
 * The skills are merged here in a fixed precedence: the repository's, then
 * the workspace's installed skills, then the member's personal ones. A name
 * an earlier source already offers is left out of a later one, since two
 * skills of one name would write the same folder.
 *
 * A repository's skills are read from GitHub as a session starts
 * (`../repository-skills.ts`), on a read token for that one repository
 * minted on the installation of the task's workspace, each one's body told
 * where the skill stands in the agent's own view of the repository, so the
 * files it names can be found; its body is handed as markdown alone, since
 * the checkout holds its files. An installed skill is read from the store
 * (`installed-skill-store.ts`'s `sessionInstalledSkills`), while the member
 * has the Skills experiment on (`EXPERIMENT.SKILLS`): the ones
 * of the workspace the agent works in, where its member is one of it, and
 * the member's own personal ones, which follow them into every workspace.
 * Its supporting files are handed beside its body, for the launch to write
 * (`../coder-host/native-skills.ts`). Read as the session starts, so a read
 * that fails is logged and offers none of that source's skills rather than
 * failing the start.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { accountExperimentOn } from "@repo/database/models/account-store";
import {
  type InstalledSkillWithFiles,
  sessionInstalledSkills,
} from "@repo/database/models/installed-skill-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { INSTALLED_SKILL_MAIN_FILE } from "@repo/features/installed-skill-wire";
import { readSkillFile } from "@repo/features/skill-file";
import { EXPERIMENT } from "@repo/settings";
import { Effect, Option } from "effect";
import type { HttpClient } from "effect/http";
import { GitHubApp, markRefusedToken } from "../../github/github-app.js";
import type { StoreFailure } from "../../http/store-failure.js";
import { type RepositorySkill, readRepositorySkills } from "../repository-skills.js";

/** One skill as a session is offered it: its name, the description it routes on, its body, and the files beside it. */
export interface AgentSkill {
  readonly name: string;
  readonly description: string;
  readonly markdown: string;
  /** Its supporting files, by path from its folder, `SKILL.md` aside; none for a repository skill, whose files the checkout holds. */
  readonly files?: Readonly<Record<string, Uint8Array>>;
  /** Its own `SKILL.md` as installed, frontmatter and all, for a native harness that reads the folder whole; none for a repository skill. */
  readonly skillFile?: Uint8Array;
}

/** How a session's workspace is read, as the caller reaches it: none where the agent's member is no longer in it. */
type WorkspaceOf = Effect.Effect<Option.Option<string>, StoreFailure, DatabaseServices>;

/**
 * The skills the repository keeps on its default branch, as a session is
 * offered them, each body led by where it stands for the agent reading it; none
 * where the installation of the task's workspace does not reach the
 * repository or GitHub could not be read, which is logged.
 */
export const repositorySkills = /* @__PURE__ */ Effect.fn("web/repositorySkills")(function* (
  target: ConversationTarget,
  /** The workspace whose installation reads the repository, as the caller reaches it. */
  workspaceOf: WorkspaceOf,
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

/** One installed skill as a session is offered it; nothing where it holds no `SKILL.md`. */
function installedAgentSkill(skill: InstalledSkillWithFiles): AgentSkill | undefined {
  const main = skill.files.find((file) => file.path === INSTALLED_SKILL_MAIN_FILE);
  if (main === undefined) return undefined;
  const siblings = skill.files.filter((file) => file.path !== INSTALLED_SKILL_MAIN_FILE);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(main.bytes);
  // The body is handed without its frontmatter, as a repository skill's is.
  const body = readSkillFile(text)?.body ?? text.replace(/^\uFEFF/u, "").trim();
  const offered = {
    name: skill.name,
    description: skill.description,
    markdown: body,
    skillFile: main.bytes,
  };
  if (siblings.length === 0) return offered;
  return { ...offered, files: Object.fromEntries(siblings.map((file) => [file.path, file.bytes])) };
}

/**
 * The skills the member installed into the app, as a session is offered them:
 * the workspace's, where the agent's workspace is one the member is still
 * in, then the member's own personal ones, each with its supporting files.
 * None while the member has the Skills experiment off, and none where the
 * store could not be read, which is logged; a skill with no `SKILL.md` is
 * left out, which is logged too.
 */
export const installedSkills = /* @__PURE__ */ Effect.fn("web/installedSkills")(function* (
  target: ConversationTarget,
  /** The workspace whose skills the session is offered, as the caller reaches it. */
  workspaceOf: WorkspaceOf,
): Effect.fn.Return<readonly AgentSkill[], never, DatabaseServices> {
  const read = Effect.gen(function* () {
    if (!(yield* accountExperimentOn(target.userId, EXPERIMENT.SKILLS))) return [];
    const workspace = yield* workspaceOf;
    return yield* sessionInstalledSkills(target.userId, Option.getOrNull(workspace));
  });
  const installed = yield* read.pipe(
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(
          `The installed skills of conversation ${target.conversationId} were not read: ${failure._tag}`,
        ),
        [],
      ),
    ),
  );
  const skills: AgentSkill[] = [];
  for (const skill of installed) {
    const offered = installedAgentSkill(skill);
    if (offered === undefined) {
      yield* Effect.logWarning(
        `The installed skill ${skill.id} of conversation ${target.conversationId} was left out: it holds no SKILL.md`,
      );
    } else {
      skills.push(offered);
    }
  }
  return skills;
});

/** The skills of every source as one session is offered them, in the order the sources are given, earliest first: a name an earlier source offers is left out of a later one. */
export function mergedSkills(sources: readonly (readonly AgentSkill[])[]): readonly AgentSkill[] {
  const offered = new Map<string, AgentSkill>();
  for (const skill of sources.flat()) {
    if (!offered.has(skill.name)) offered.set(skill.name, skill);
  }
  return [...offered.values()];
}
