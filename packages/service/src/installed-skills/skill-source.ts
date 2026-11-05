/**
 * skill-source.ts -- a GitHub repository a member pasted as a skill source, read as an install takes it: reached, its ref read whole at one commit from its archive, and its skill folders found there.
 *
 * The repository is read on the workspace's GitHub App installation where
 * it reaches it, else on the member's own token where it may push there,
 * as a session reads a repository's skills (`agents/agent-runtime/skills.ts`),
 * and anonymously otherwise. Note that an anonymous read costs no request
 * of GitHub's API, whose sixty an hour an anonymous caller shares: a
 * public repository's archive comes from codeload, which serves `HEAD` as
 * its default branch (`repository-archive.ts`).
 *
 * The archive names the commit it was read at, so a preview pins its ref
 * and an install reads that commit again. A skill is every folder holding
 * a `SKILL.md` within the folder named, below no other skill folder and
 * outside what a build or a checkout keeps, with every file under it.
 */

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

/** The ref codeload reads as a repository's default branch. */
const DEFAULT_REF = "HEAD";

/** The folders a build or a checkout keeps, which no skill is found in. */
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set(["node_modules", ".git", "dist", "build"]);

/** A repository a skill is read from, and how: on a token, or anonymously (`bearer` null). */
export interface SkillRepository {
  readonly owner: string;
  readonly name: string;
  readonly fullName: string;
  /** The ref read where none is named: its default branch, or `HEAD` where it was reached anonymously. */
  readonly defaultBranch: string;
  readonly bearer: Redacted.Redacted | null;
  readonly public: boolean;
}

/** One file of a skill, by its path from the skill's folder. */
export interface SkillFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** One folder holding a `SKILL.md`: its path from the repository's root, empty for the root, and every file under it. */
export interface SkillFolder {
  readonly path: string;
  readonly files: readonly SkillFile[];
}

/** The repository as the workspace's installation reaches it, else the member's own token, else anonymously as public. */
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

/**
 * The commit the ref names, read whole from its archive: refused as not
 * reachable where GitHub serves none, which is all it says of a private
 * repository or a ref it lacks; as too large past the archive's bound; and
 * as unanswered where GitHub did not answer.
 */
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

/** The folder a `SKILL.md` stands in, or nothing where the path is no `SKILL.md`. */
function skillFolderOf(path: string): string | undefined {
  if (path === INSTALLED_SKILL_MAIN_FILE) return "";
  return path.endsWith(`/${INSTALLED_SKILL_MAIN_FILE}`)
    ? path.slice(0, -INSTALLED_SKILL_MAIN_FILE.length - 1)
    : undefined;
}

/** Whether the path stands in the folder, the root holding every path. */
function within(path: string, folder: string): boolean {
  return folder === "" || path.startsWith(`${folder}/`);
}

/** The skill folders of the archive within the folder named, as the module's header says, in path order. */
export function skillFolders(archive: RepositoryArchive, folder: string): readonly SkillFolder[] {
  // A path holding a backslash or a step out of its folder is one no skill may keep (`installed_skill_file_relative`).
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
