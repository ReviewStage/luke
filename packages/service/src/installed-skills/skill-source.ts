import type { DatabaseServices } from "@repo/database/core/query";
import {
  INSTALLED_SKILL_MAIN_FILE,
  INSTALLED_SKILL_REFUSAL,
} from "@repo/features/installed-skill-wire";
import { Effect, Option, type Redacted } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { GitHubApp } from "../github/github-app.js";
import { githubReachOrRefusal } from "../github/github-refusal.js";
import {
  ARCHIVE_UNREAD,
  type RepositoryArchive,
  readRepositoryArchive,
} from "../github/repository-archive.js";
import { repositorySegments } from "../github/repository-file.js";
import { HOSTED_REFUSAL, type HostedRefusal, installedSkillRefused } from "../http/http-effect.js";

const DEFAULT_REF = "HEAD";

const SKIPPED_FOLDERS: ReadonlySet<string> = new Set(["node_modules", ".git", "dist", "build"]);

export interface SkillRepository {
  readonly owner: string;
  readonly name: string;
  readonly fullName: string;
  readonly defaultBranch: string;
  readonly bearer: Redacted.Redacted | null;
  readonly public: boolean;
}

export interface SkillFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface SkillFolder {
  readonly path: string;
  readonly files: readonly SkillFile[];
}

export const reachSkillRepository = /* @__PURE__ */ Effect.fnUntraced(function* (
  workspaceId: string,
  owner: string,
  repo: string,
  member: string,
): Effect.fn.Return<
  SkillRepository,
  HostedRefusal,
  GitHubApp | HttpClient.HttpClient | DatabaseServices
> {
  const app = yield* GitHubApp;
  const reached = yield* githubReachOrRefusal(
    app.repositoryReadToken(workspaceId, `${owner}/${repo}`, member),
  );
  if (Option.isNone(reached)) {
    return {
      owner,
      name: repo,
      fullName: `${owner}/${repo}`,
      defaultBranch: DEFAULT_REF,
      bearer: null,
      public: true,
    };
  }
  const { repository, token } = reached.value;
  return {
    owner: repository.owner,
    name: repository.name,
    fullName: repository.fullName,
    defaultBranch: repository.defaultBranch,
    bearer: token,
    public: !repository.private,
  };
});

export function readSkillArchive(
  repository: SkillRepository,
  ref: string,
): Effect.Effect<RepositoryArchive, HostedRefusal, HttpClient.HttpClient> {
  return Effect.mapError(
    readRepositoryArchive(repository, repository.bearer, ref),
    ({ reason }): HostedRefusal => {
      switch (reason) {
        case ARCHIVE_UNREAD.NOT_FOUND:
          return HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE;
        case ARCHIVE_UNREAD.TOO_LARGE:
          return installedSkillRefused(
            HOSTED_REFUSAL.SKILL_FILES_REFUSED,
            repository.fullName,
            INSTALLED_SKILL_REFUSAL.TOO_LARGE,
          );
        case ARCHIVE_UNREAD.UNANSWERED:
          return HOSTED_REFUSAL.GITHUB_UNANSWERED;
      }
    },
  );
}

function skillFolderOf(path: string): string | undefined {
  if (path === INSTALLED_SKILL_MAIN_FILE) return "";
  return path.endsWith(`/${INSTALLED_SKILL_MAIN_FILE}`)
    ? path.slice(0, -INSTALLED_SKILL_MAIN_FILE.length - 1)
    : undefined;
}

function within(path: string, folder: string): boolean {
  return folder === "" || path.startsWith(`${folder}/`);
}

export function skillFolders(archive: RepositoryArchive, folder: string): readonly SkillFolder[] {
  const paths = [...archive.files.keys()].filter(
    (path) => !path.includes("\\") && repositorySegments(path) !== undefined,
  );
  const found = paths.flatMap((path) => {
    const skill = skillFolderOf(path);
    if (skill === undefined || !within(path, folder)) return [];
    return skill.split("/").some((segment) => SKIPPED_FOLDERS.has(segment)) ? [] : [skill];
  });
  const outermost = found.filter(
    (skill) => !found.some((other) => other !== skill && within(skill, other)),
  );
  return outermost.sort().map((skill) => ({
    path: skill,
    files: paths.flatMap((path) => {
      const bytes = archive.files.get(path);
      if (bytes === undefined || !within(path, skill)) return [];
      return [{ path: skill === "" ? path : path.slice(skill.length + 1), bytes }];
    }),
  }));
}
