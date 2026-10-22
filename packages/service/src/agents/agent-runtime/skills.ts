/**
 * skills.ts -- the agent skills a session is offered: the ones the repository it works on keeps, then the ones its member installed into Luke.
 *
 * eve offers a session the skills its resolvers hand it, lists each by its
 * description, and loads one's body with `load_skill` when the developer
 * names it or the work matches it; it never looks in a checkout for skills
 * of its own. Two resolvers that hand eve the same name make it throw, so a
 * role has one resolver, and the skills are merged here before eve sees
 * them, in a fixed precedence: the repository's, then the workspace's
 * installed skills, then the member's personal ones. A name an earlier
 * source already offers is left out of a later one, which is logged, and
 * no more than `SESSION_SKILLS.MAX_SKILLS` are offered across every source.
 *
 * A repository's skills are read from GitHub as a session starts
 * (`../repository-skills.ts`), on a read token for that one repository
 * minted on the installation of the task's workspace, each one's body told
 * where the skill stands in the agent's own view of the repository, so the
 * files it names can be found; its body is handed as markdown alone, since
 * the checkout holds its files. An installed skill is read from the store
 * (`installed-skill-store.ts`'s `sessionInstalledSkills`): the enabled ones
 * of the workspace the agent works in, where its member is one of it, and
 * the member's own personal ones, which follow them into every workspace.
 * Its supporting files are handed to eve beside its body, and eve writes
 * them into the sandbox at `$HOME/.agents/skills/<name>/`, or
 * `/workspace/skills/<name>/` where the sandbox has no home, which the
 * body is led by. Which roles are offered skills is each role's profile
 * (`role.ts`). Read as the session starts, so a read that fails is logged
 * and offers none of that source's skills rather than failing the start.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import {
  type InstalledSkillWithFiles,
  sessionInstalledSkills,
} from "@luke/database/models/installed-skill-store";
import type { ConversationTarget } from "@luke/database/models/writer";
import { INSTALLED_SKILL_MAIN_FILE } from "@luke/features/installed-skill-wire";
import { readSkillFile } from "@luke/features/skill-file";
import { TASK_SKILL_BOUNDS } from "@luke/features/task-wire";
import { Effect, Option } from "effect";
import type { HttpClient } from "effect/http";
import { defineSkill, type SkillDefinition } from "eve/skills";
import { GitHubApp, markRefusedToken } from "../../github/github-app.js";
import type { StoreFailure } from "../../http/store-failure.js";
import { type RepositorySkill, readRepositorySkills } from "../repository-skills.js";

/** One skill as eve is handed it: its name, the description it routes on, the body `load_skill` answers, and the files beside it eve writes into the sandbox. */
export interface AgentSkill {
  readonly name: string;
  readonly description: string;
  readonly markdown: string;
  /** Its supporting files, by path from its folder, `SKILL.md` aside; none for a repository skill, whose files the checkout holds. */
  readonly files?: Readonly<Record<string, Uint8Array>>;
}

/** How many skills a session is offered. */
const SESSION_SKILLS = {
  /** The most offered across every source, as many as a repository's read carries. */
  MAX_SKILLS: TASK_SKILL_BOUNDS.MAX_SKILLS,
} as const;

/** Where eve writes a skill's supporting files in the sandbox: under the home, or the fallback where the sandbox has none. */
const SKILL_SANDBOX_ROOT = {
  HOME: "$HOME/.agents/skills",
  FALLBACK: "/workspace/skills",
} as const;

/** How a session's workspace is read, as the caller reaches it: none where the agent's member is no longer in it. */
type WorkspaceOf = Effect.Effect<Option.Option<string>, StoreFailure, DatabaseServices>;

/**
 * The skills the repository keeps on its default branch, as eve is handed
 * them, each body led by where it stands for the agent reading it; none
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

/** Whether eve takes the path as a file of a skill's folder: relative, with no empty, `.`, or `..` segment, as eve holds it to. */
function sandboxPath(path: string): boolean {
  return (
    path !== "" &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !/^[A-Za-z]:/u.test(path) &&
    path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

/** The body an installed skill loads as: where eve wrote its files, where it has any, so its relative paths resolve, and then its own words. */
function installedMarkdown(name: string, body: string, hasFiles: boolean): string {
  if (!hasFiles) return body;
  const folder = `${SKILL_SANDBOX_ROOT.HOME}/${name}`;
  const fallback = `${SKILL_SANDBOX_ROOT.FALLBACK}/${name}`;
  return `This skill's files are in \`${folder}/\` in the sandbox (\`${fallback}/\` where the sandbox has no home); resolve the files it names relative to that folder.\n\n${body}`;
}

/** One installed skill as eve is handed it; nothing where it holds no `SKILL.md` or a path eve would refuse. */
function installedAgentSkill(skill: InstalledSkillWithFiles): AgentSkill | undefined {
  const main = skill.files.find((file) => file.path === INSTALLED_SKILL_MAIN_FILE);
  if (main === undefined) return undefined;
  const siblings = skill.files.filter((file) => file.path !== INSTALLED_SKILL_MAIN_FILE);
  // Note that eve throws on a path it refuses, which would drop every skill of the session, so the skill is left out instead.
  if (!siblings.every((file) => sandboxPath(file.path))) return undefined;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(main.bytes);
  // The body is handed without its frontmatter, as a repository skill's is.
  const body = readSkillFile(text)?.body ?? text.replace(/^\uFEFF/u, "").trim();
  const markdown = installedMarkdown(skill.name, body, siblings.length > 0);
  if (siblings.length === 0) return { name: skill.name, description: skill.description, markdown };
  return {
    name: skill.name,
    description: skill.description,
    markdown,
    files: Object.fromEntries(siblings.map((file) => [file.path, file.bytes])),
  };
}

/**
 * The enabled skills the member installed into Luke, as eve is handed them:
 * the workspace's, where the agent's workspace is one the member is still
 * in, then the member's own personal ones, each with its supporting files.
 * None where the store could not be read, which is logged, and a skill eve
 * could not take is left out, which is logged too.
 */
export const installedSkills = /* @__PURE__ */ Effect.fn("web/installedSkills")(function* (
  target: ConversationTarget,
  /** The workspace whose skills the session is offered, as the caller reaches it. */
  workspaceOf: WorkspaceOf,
): Effect.fn.Return<readonly AgentSkill[], never, DatabaseServices> {
  const read = Effect.flatMap(workspaceOf, (workspace) =>
    sessionInstalledSkills(target.userId, Option.getOrNull(workspace)),
  );
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
        `The installed skill ${skill.id} of conversation ${target.conversationId} was left out: its files are not a skill eve takes`,
      );
    } else {
      skills.push(offered);
    }
  }
  return skills;
});

/**
 * The skills of every source as one session is offered them, in the order
 * the sources are given, earliest first: a name an earlier source offers is
 * left out of a later one, and none past `SESSION_SKILLS.MAX_SKILLS`, each
 * of which is logged.
 */
export const mergedSkills = /* @__PURE__ */ Effect.fn("web/mergedSkills")(function* (
  target: ConversationTarget,
  sources: readonly (readonly AgentSkill[])[],
): Effect.fn.Return<readonly AgentSkill[]> {
  const offered = new Map<string, AgentSkill>();
  for (const skill of sources.flat()) {
    if (offered.has(skill.name)) {
      yield* Effect.logInfo(
        `The skill ${skill.name} of conversation ${target.conversationId} is shadowed by an earlier source's of the same name and left out`,
      );
    } else if (offered.size >= SESSION_SKILLS.MAX_SKILLS) {
      yield* Effect.logWarning(
        `The skill ${skill.name} of conversation ${target.conversationId} is past the session's ${SESSION_SKILLS.MAX_SKILLS} and left out`,
      );
    } else {
      offered.set(skill.name, skill);
    }
  }
  return [...offered.values()];
});

/** Whether eve opens the session's sandbox to take the skills: it writes the files of any that carry them as the session starts. */
export function skillsOpenSandbox(skills: readonly AgentSkill[]): boolean {
  return skills.some((skill) => skill.files !== undefined);
}

/** The skills as eve's map of them, by name, for a role's \`skills/repository.ts\`, each with its supporting files where it has any; nothing where there are none. */
export function offeredSkills(skills: readonly AgentSkill[]) {
  if (skills.length === 0) return null;
  return Object.fromEntries(
    skills.map((skill) => [
      skill.name,
      defineSkill<SkillDefinition>(
        skill.files === undefined
          ? { description: skill.description, markdown: skill.markdown }
          : { description: skill.description, markdown: skill.markdown, files: skill.files },
      ),
    ]),
  );
}
