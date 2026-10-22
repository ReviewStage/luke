/**
 * skill-source.ts -- a GitHub repository a member pasted as a skill source, read as an install takes it: reached, its ref pinned to a commit, its skill folders found, and one folder's files fetched within a skill's bounds.
 *
 * The repository is read on the workspace's GitHub App installation where
 * it reaches it, else on the member's own token, as a session reads a
 * repository's skills (`agents/agent-runtime/skills.ts`), and else
 * anonymously, which GitHub answers for a public repository alone. Every
 * read after the reach names the commit the ref stood at when it was
 * pinned, so a preview, the install after it, and every file of one skill
 * are read from one tree, whatever lands on the branch between.
 *
 * Skill folders are found as the `skills` tool finds them in a repository
 * it was not told about: a `SKILL.md` at the root, and each folder of
 * `skills/`, `.agents/skills/`, and `.claude/skills/` that holds one, in
 * that order, every copy of a name kept for its `SKILL.md` to settle which
 * stands (`skill-paste-install.ts`). A source naming a
 * folder looks there alone: at the folder, where it holds a `SKILL.md`, or
 * else at each folder in it that does. The whole tree is listed in one
 * read, which also gives every file's size, so a folder past a skill's
 * bounds is refused before any of its files is read.
 *
 * A GitHub that does not answer, or answers past its rate limit, is
 * refused as unanswered; a repository nobody reaches as not reachable.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { INSTALLED_SKILL_MAIN_FILE } from "@luke/features/installed-skill-wire";
import { TASK_SKILL_BOUNDS } from "@luke/features/task-wire";
import { Effect, Option, type Redacted, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { SKILL_ROOT } from "../agents/repository-skills.js";
import {
  GITHUB_HTTP_STATUS,
  GitHubApp,
  type GitHubTokenAccess,
  type GitHubUnavailable,
  githubRead,
  markRefusedToken,
  readBody,
  send,
} from "../github/github-app.js";
import { githubReachOrRefusal } from "../github/github-refusal.js";
import {
  readCommitSha,
  readRepositoryFile,
  repositorySegments,
} from "../github/repository-file.js";
import { GIT_ENTRY, readRepositoryFolder } from "../github/repository-folder.js";
import { HOSTED_REFUSAL, type HostedRefusal } from "../http/http-effect.js";

/** The most skill folders read: a repository's skills, twice over for a name two roots hold. */
const MAX_FOLDERS = TASK_SKILL_BOUNDS.MAX_SKILLS * 2;

/** How many files of one skill are read at once. */
const READ_CONCURRENCY = 8;

/** The header GitHub says how many requests are left in its rate limit window with. */
const RATE_LIMIT_REMAINING_HEADER = "x-ratelimit-remaining";

/** The roots a repository keeps skill folders under, in the order a name is looked for. */
const SKILL_FOLDER_ROOTS: readonly string[] = ["skills", SKILL_ROOT.AGENTS, SKILL_ROOT.CLAUDE];

/** A repository a skill is read from, and how: on a token, or anonymously (`bearer` null). */
export interface SkillRepository {
  readonly owner: string;
  readonly name: string;
  readonly fullName: string;
  readonly defaultBranch: string;
  readonly bearer: Redacted.Redacted | null;
  readonly access: GitHubTokenAccess | null;
}

/** One file of a skill folder, by its path from the folder, and its size as the tree says. */
interface SkillFolderFile {
  readonly path: string;
  readonly bytes: number;
}

/** One folder holding a `SKILL.md`: its path from the repository's root, empty for the root, and every file under it. */
export interface SkillFolder {
  readonly path: string;
  readonly files: readonly SkillFolderFile[];
}

/** What GitHub answers for a public repository read anonymously. */
const PublicRepositorySchema = Schema.Struct({
  name: Schema.String,
  full_name: Schema.String,
  owner: Schema.Struct({ login: Schema.String }),
  default_branch: Schema.String,
});

/** A read on the repository's bearer, a member's token marked invalid where GitHub refuses it, and a GitHub that did not answer refused as unanswered. */
function onRepository<A, R>(
  repository: SkillRepository,
  read: Effect.Effect<A, GitHubUnavailable, R>,
): Effect.Effect<A, HostedRefusal, R | DatabaseServices> {
  const marked = repository.access === null ? read : read.pipe(markRefusedToken(repository.access));
  return marked.pipe(
    Effect.tapError((failure) =>
      Effect.logWarning(`A skill source was not read: ${failure.message}`),
    ),
    Effect.mapError(() => HOSTED_REFUSAL.GITHUB_UNANSWERED),
  );
}

/**
 * The public repository as GitHub answers it with no token; not reachable
 * where GitHub says there is none, which is what it says of a private one,
 * and unanswered where it is past its anonymous rate limit or down.
 */
const publicRepository = /* @__PURE__ */ Effect.fnUntraced(function* (
  owner: string,
  repo: string,
): Effect.fn.Return<SkillRepository, HostedRefusal, HttpClient.HttpClient> {
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const read = Effect.scoped(
    Effect.gen(function* () {
      const response = yield* send(githubRead(path, null));
      const limited = response.headers[RATE_LIMIT_REMAINING_HEADER] === "0";
      if (
        response.status === GITHUB_HTTP_STATUS.NOT_FOUND ||
        (response.status === GITHUB_HTTP_STATUS.FORBIDDEN && !limited)
      ) {
        return Option.none<typeof PublicRepositorySchema.Type>();
      }
      return Option.some(yield* readBody(response, PublicRepositorySchema));
    }),
  );
  const answered = yield* read.pipe(
    Effect.tapError((failure) =>
      Effect.logWarning(`A public skill source was not read: ${failure.message}`),
    ),
    Effect.mapError(() => HOSTED_REFUSAL.GITHUB_UNANSWERED),
  );
  if (Option.isNone(answered)) return yield* Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
  return {
    owner: answered.value.owner.login,
    name: answered.value.name,
    fullName: answered.value.full_name,
    defaultBranch: answered.value.default_branch,
    bearer: null,
    access: null,
  };
});

/**
 * The repository as the workspace's installation reaches it, else the
 * member's own token, else anonymously where it is public.
 */
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
  if (Option.isNone(reached)) return yield* publicRepository(owner, repo);
  const { repository, token, access } = reached.value;
  return {
    owner: repository.owner,
    name: repository.name,
    fullName: repository.fullName,
    defaultBranch: repository.defaultBranch,
    bearer: token,
    access,
  };
});

/** The ref read, the default branch's name where none is given, and the commit it stands at now; refused as no such branch where GitHub names none. */
export const pinnedCommit = /* @__PURE__ */ Effect.fnUntraced(function* (
  repository: SkillRepository,
  ref: string | undefined,
): Effect.fn.Return<
  { readonly ref: string; readonly sha: string },
  HostedRefusal,
  HttpClient.HttpClient | DatabaseServices
> {
  const named = ref ?? repository.defaultBranch;
  const sha = yield* onRepository(repository, readCommitSha(repository.bearer, repository, named));
  if (sha === undefined) return yield* Effect.fail(HOSTED_REFUSAL.BRANCH_NOT_FOUND);
  return { ref: named, sha };
});

/** The folder's parent and the folder's own name: `skills/x` is `skills` and `x`. */
function splitFolder(path: string): { readonly parent: string; readonly name: string } {
  const at = path.lastIndexOf("/");
  return at === -1
    ? { parent: "", name: path }
    : { parent: path.slice(0, at), name: path.slice(at + 1) };
}

/** The folders holding a skill, in the order an install looks for them, as the module's header says. */
function skillFolderPaths(skillFiles: ReadonlySet<string>, within: string | undefined): string[] {
  const holding = (folder: string) =>
    skillFiles.has(
      folder === "" ? INSTALLED_SKILL_MAIN_FILE : `${folder}/${INSTALLED_SKILL_MAIN_FILE}`,
    );
  const childrenOf = (parent: string) =>
    [...skillFiles]
      .map((file) => splitFolder(file).parent)
      .filter((folder) => folder !== "" && splitFolder(folder).parent === parent)
      .sort((a, b) => a.localeCompare(b));
  if (within !== undefined) return holding(within) ? [within] : childrenOf(within);
  // Note that a name two roots hold is kept twice here, since which copy stands is its `SKILL.md`'s to say.
  return [...(holding("") ? [""] : []), ...SKILL_FOLDER_ROOTS.flatMap(childrenOf)];
}

/**
 * The skill folders the commit holds, as the module's header says, each
 * with every file under it; no more than a repository's skills are read.
 * A path naming a folder looks there alone.
 */
export const skillFolders = /* @__PURE__ */ Effect.fnUntraced(function* (
  repository: SkillRepository,
  sha: string,
  within: string | undefined,
): Effect.fn.Return<
  readonly SkillFolder[],
  HostedRefusal,
  HttpClient.HttpClient | DatabaseServices
> {
  // Note that a commit's sha names its tree as a branch's name would, so the listing is of the pinned commit.
  const tree = yield* onRepository(
    repository,
    readRepositoryFolder(
      repository.bearer,
      { fullName: repository.fullName, defaultBranch: sha },
      "",
      true,
    ),
  );
  if (!tree.found) return [];
  if (tree.truncated) {
    yield* Effect.logWarning(
      `The tree of ${repository.fullName} was cut short; skills past it are not found`,
    );
  }
  // A path holding a backslash or a step out of its folder is one no skill may keep (`installed_skill_file_relative`).
  const blobs = tree.entries.filter(
    (entry) =>
      entry.type === GIT_ENTRY.BLOB &&
      !entry.name.includes("\\") &&
      repositorySegments(entry.name) !== undefined,
  );
  const skillFiles = new Set(
    blobs
      .map((blob) => blob.name)
      .filter((path) => splitFolder(path).name === INSTALLED_SKILL_MAIN_FILE),
  );
  const folders = skillFolderPaths(skillFiles, within).slice(0, MAX_FOLDERS);
  return folders.map((folder) => ({
    path: folder,
    files: blobs.flatMap((blob) => {
      if (folder !== "" && !blob.name.startsWith(`${folder}/`)) return [];
      return [
        {
          path: folder === "" ? blob.name : blob.name.slice(folder.length + 1),
          bytes: blob.size ?? 0,
        },
      ];
    }),
  }));
});

/** The name a folder suggests for its skill: its own, or the repository's for a skill at the root. */
export function folderName(repository: SkillRepository, folder: SkillFolder): string {
  return folder.path === "" ? repository.name.toLowerCase() : splitFolder(folder.path).name;
}

/** One file of the folder at the commit, as bytes; nothing where GitHub holds no regular file there or carries no bytes for it. */
export const readSkillFolderFile = /* @__PURE__ */ Effect.fnUntraced(function* (
  repository: SkillRepository,
  sha: string,
  folder: SkillFolder,
  path: string,
): Effect.fn.Return<
  Uint8Array | undefined,
  HostedRefusal,
  HttpClient.HttpClient | DatabaseServices
> {
  const fullPath = folder.path === "" ? path : `${folder.path}/${path}`;
  const file = yield* onRepository(
    repository,
    readRepositoryFile(repository.bearer, repository, sha, fullPath),
  );
  return file.regular ? file.content : undefined;
});

/**
 * Every file of the folder at the commit, read a few at once, in the
 * folder's order; a file GitHub holds as no regular file there, as a link
 * may read, is left out, and nothing is answered where one carries no
 * bytes. The caller holds the folder to a skill's bounds first, so no
 * folder past them costs a read.
 */
export const readSkillFolder = /* @__PURE__ */ Effect.fnUntraced(function* (
  repository: SkillRepository,
  sha: string,
  folder: SkillFolder,
): Effect.fn.Return<
  readonly { readonly path: string; readonly bytes: Uint8Array }[],
  HostedRefusal,
  HttpClient.HttpClient | DatabaseServices
> {
  const read = yield* Effect.forEach(
    folder.files,
    (file) =>
      Effect.map(readSkillFolderFile(repository, sha, folder, file.path), (bytes) => ({
        path: file.path,
        bytes,
      })),
    { concurrency: READ_CONCURRENCY },
  );
  return read.flatMap((file) =>
    file.bytes === undefined ? [] : [{ path: file.path, bytes: file.bytes }],
  );
});

/** The folder's tree at the commit, as GitHub names it: what changes with any file under it; nothing where the folder is gone. */
export const folderTreeSha = /* @__PURE__ */ Effect.fnUntraced(function* (
  repository: SkillRepository,
  sha: string,
  path: string,
): Effect.fn.Return<string | undefined, HostedRefusal, HttpClient.HttpClient | DatabaseServices> {
  const folder = yield* onRepository(
    repository,
    readRepositoryFolder(
      repository.bearer,
      { fullName: repository.fullName, defaultBranch: sha },
      path,
    ),
  );
  return folder.found ? folder.sha : undefined;
});
