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

export interface AgentSkill {
  readonly name: string;
  readonly description: string;
  readonly markdown: string;
  readonly files?: Readonly<Record<string, Uint8Array>>;
  readonly skillFile?: Uint8Array;
}

type WorkspaceOf = Effect.Effect<Option.Option<string>, StoreFailure, DatabaseServices>;

export const repositorySkills = /* @__PURE__ */ Effect.fn("web/repositorySkills")(function* (
  target: ConversationTarget,
  workspaceOf: WorkspaceOf,
  repository: string,
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

function installedAgentSkill(skill: InstalledSkillWithFiles): AgentSkill | undefined {
  const main = skill.files.find((file) => file.path === INSTALLED_SKILL_MAIN_FILE);
  if (main === undefined) return undefined;
  const siblings = skill.files.filter((file) => file.path !== INSTALLED_SKILL_MAIN_FILE);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(main.bytes);
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

export const installedSkills = /* @__PURE__ */ Effect.fn("web/installedSkills")(function* (
  target: ConversationTarget,
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

export function mergedSkills(sources: readonly (readonly AgentSkill[])[]): readonly AgentSkill[] {
  const offered = new Map<string, AgentSkill>();
  for (const skill of sources.flat()) {
    if (!offered.has(skill.name)) offered.set(skill.name, skill);
  }
  return [...offered.values()];
}
