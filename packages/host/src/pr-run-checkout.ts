import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect, Stream } from "effect";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";

/**
 * pr-run-checkout.ts -- Luke's own checkout of one coding agent's work on this Mac: where it lives, whether it may be refreshed, and the refresh.
 *
 * Every repository has one clone of Luke's own, a bare repository at
 * `<state root>/pr-runs/<account>/<workspace>/<owner>/<name>/repository.git`
 * whose `origin` is the repository's GitHub address, with no credential in
 * it; every agent whose work is run from it has a worktree beside it,
 * `agent-<id>`, on a branch named for the agent's own branch. The agent's
 * work arrives as a snapshot: the commit it starts from, fetched from
 * GitHub, and a patch of everything since, which is applied to that commit
 * in a scratch index of the clone and committed there, so no worktree file
 * moves until the refresh checks the snapshot out. Each segment is held to a
 * shape that cannot climb out of the folder, and nothing else on the Mac is
 * touched, the developer's own working trees least of all. A worktree is
 * kept from run to run, so what setup installed there is there next time.
 *
 * A refresh never discards anything the developer or a run left. A folder
 * Luke did not make, a worktree moved off the commit Luke last put there (a
 * commit made in it, another branch checked out), and one with edits to
 * tracked files are refused before anything is fetched; a snapshot that adds
 * a file the worktree already holds untracked or ignored is refused before
 * anything is checked out; and Git's own `reset --keep` refuses whatever
 * else it would overwrite. Each refusal says to delete the local checkout to
 * start over. The step that moves the worktree is never interrupted.
 *
 * Whether the run needs its setup is answered beside the commit: a worktree
 * never set up needs it, as does one last set up with another setup
 * command, and one set up before needs it again only where the newest
 * snapshot changes a lockfile or a package manifest since.
 *
 * Every Git this module runs reads no system or global configuration, no
 * hooks, no credential helper but the one a fetch is handed, and no
 * file-system monitor, so nothing configured elsewhere on the Mac runs in it
 * or sees what it fetches with. Submodules are not fetched and Git LFS
 * content is not smudged.
 */

/** The folder under the state root that every agent's checkout lives in. */
export const PR_RUNS_FOLDER = "pr-runs";

/** The clone's own folder beside the worktrees. */
const CLONE_FOLDER = "repository.git";

/** The most of a Git's output a step keeps, which is far past anything this module reads. */
const MAX_GIT_OUTPUT_BYTES = 4 * 1024 * 1024;

/** The most colliding file names a refusal lists. */
const MAX_LISTED_COLLISIONS = 5;

/** The files whose change means a checkout's setup is run again: lockfiles and the manifests they follow. */
const SETUP_FILES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
  "Gemfile.lock",
  "poetry.lock",
  "uv.lock",
  "Pipfile.lock",
  "requirements.txt",
  "Cargo.lock",
  "go.sum",
  "composer.lock",
  "mix.lock",
  "Podfile.lock",
]);

/** The shapes a checkout folder's segments are held to: none may be empty, `.`, `..`, or hold a separator. */
const SEGMENT = {
  /** An account's email, lowercased. */
  ACCOUNT: /^(?!\.{1,2}$)[a-z0-9._%+@-]{1,254}$/u,
  WORKSPACE: /^[A-Za-z0-9_-]{1,128}$/u,
  OWNER: /^[a-z0-9](?:-?[a-z0-9]){0,38}$/u,
  NAME: /^(?!\.{1,2}$)[a-z0-9_.-]{1,100}$/u,
  AGENT: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
} as const;

/** The agent a checkout is for, with its workspace and repository, under the account signed in. */
export interface CheckoutOwner {
  readonly accountEmail: string;
  readonly workspaceId: string;
  /** `owner/name`, as GitHub spells it. */
  readonly repository: string;
  /** The coding agent whose work is run. */
  readonly agentId: string;
}

/** Where an agent's checkout lives: the folder every checkout lives under, the repository's clone, and the agent's worktree. */
export interface CheckoutPlace {
  readonly root: string;
  readonly clone: string;
  readonly folder: string;
  /** The agent whose work the worktree holds, which names Luke's refs for it. */
  readonly agentId: string;
}

/** The Git this module runs, and the environment it runs under in place of the app's own. */
export interface GitTool {
  readonly path: string;
  readonly environment: Readonly<Record<string, string>>;
}

/** What one Git step did. */
interface GitRun {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Why a checkout cannot be refreshed, as the developer reads it. */
export const CHECKOUT_REFUSAL = {
  NOT_LUKES:
    "The folder Luke keeps this agent's checkout in holds something Luke did not put there. Delete the local checkout to start over.",
  MOVED:
    "The local checkout has commits or a branch of its own, which a refresh would leave behind. Delete the local checkout to start over.",
  EDITED:
    "The local checkout has edits to tracked files, which Luke never overwrites. Delete the local checkout to start over.",
  GIT_FAILED: "Git could not read the local checkout. Delete the local checkout to start over.",
} as const;

/** A step's result: where it got to, or why it stopped, in the developer's words. */
export type CheckoutStep<A> = { readonly ok: A } | { readonly refused: string };

/** The agent's work as a snapshot made it: its commit in the clone, and the agent's branch's name. */
export interface FetchedHead {
  readonly sha: string;
  readonly headRef: string;
  /** Whether `headRef` is the agent's own branch, which its worktree's branch then follows on `origin`. */
  readonly ownBranch: boolean;
}

/** A snapshot of the agent's work made in the clone. */
export type FetchInto = (
  clone: string,
) => Effect.Effect<CheckoutStep<FetchedHead>, never, ChildProcessSpawner.ChildProcessSpawner>;

/** The checkout as a refresh left it: the commit it stands on, and whether its setup must run before the run. */
export interface PreparedCheckout {
  readonly sha: string;
  readonly setupNeeded: boolean;
}

/** The flags every Git step is run with, which keep configuration from elsewhere on the Mac out of it. */
const HARDENED_FLAGS = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "credential.helper=",
  "-c",
  "core.askPass=",
  "-c",
  "submodule.recurse=false",
  "-c",
  "fetch.recurseSubmodules=false",
  "-c",
  "filter.lfs.process=",
  "-c",
  "filter.lfs.smudge=",
  "-c",
  "filter.lfs.required=false",
] as const;

/** What every Git step's environment holds beside the tool's own: no system or global configuration, no prompt, no trace. */
const HARDENED_ENVIRONMENT = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "",
  SSH_ASKPASS: "",
  GIT_LFS_SKIP_SMUDGE: "1",
  GIT_PAGER: "cat",
  LC_ALL: "C",
} as const;

/** Where the clone's configuration keeps the setup command an agent's setup last finished with. */
function setupKey(agentId: string): string {
  return `luke.agent-${agentId}.setup`;
}

/** The refs Luke keeps in the clone for one agent. */
function lukeRefs(agentId: string) {
  const base = `refs/luke/agent/${agentId}`;
  return {
    /** The commit its last snapshot starts from. */
    BASE: `${base}/base`,
    /** The commit Luke last put its worktree on. */
    HEAD: `${base}/head`,
    /** The commit its setup last finished on. */
    SET_UP: `${base}/set-up`,
  } as const;
}

/** The checkout's folders for the agent, or nothing where a segment is not of its shape. */
export function checkoutPlace(stateRoot: string, owner: CheckoutOwner): CheckoutPlace | undefined {
  const account = owner.accountEmail.toLowerCase();
  const [repositoryOwner = "", name = "", extra] = owner.repository.toLowerCase().split("/");
  const shaped =
    SEGMENT.ACCOUNT.test(account) &&
    SEGMENT.WORKSPACE.test(owner.workspaceId) &&
    SEGMENT.OWNER.test(repositoryOwner) &&
    SEGMENT.NAME.test(name) &&
    extra === undefined &&
    SEGMENT.AGENT.test(owner.agentId);
  if (!shaped) return undefined;
  const root = path.join(stateRoot, PR_RUNS_FOLDER);
  const repositoryFolder = path.join(root, account, owner.workspaceId, repositoryOwner, name);
  return {
    root,
    clone: path.join(repositoryFolder, CLONE_FOLDER),
    folder: path.join(repositoryFolder, `agent-${owner.agentId}`),
    agentId: owner.agentId,
  };
}

/** What a path is, without following a link: nothing, a folder, a file, or something else. */
function entryKind(at: string): Effect.Effect<"none" | "folder" | "file" | "other"> {
  return Effect.tryPromise(() => lstat(at)).pipe(
    Effect.map((stats) =>
      stats.isDirectory()
        ? ("folder" as const)
        : stats.isFile()
          ? ("file" as const)
          : ("other" as const),
    ),
    Effect.catch(() => Effect.succeed("none" as const)),
  );
}

/**
 * Whether every folder from the root down to `folder` is a real folder, none
 * of them a link: what lets a removal or a reveal trust the path it was
 * built from. Note that the root itself is under the state root Luke made.
 */
function placeContained(root: string, folder: string): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    const relative = path.relative(root, folder);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return false;
    let at = root;
    for (const segment of ["", ...relative.split(path.sep)]) {
      at = segment === "" ? at : path.join(at, segment);
      if ((yield* entryKind(at)) !== "folder") return false;
    }
    return true;
  });
}

/** A stream's bytes as they are kept: the chunks, and how many bytes they hold. */
interface Collected {
  readonly chunks: Uint8Array[];
  readonly bytes: number;
}

/** The bytes a stream wrote, kept up to the bound and the rest drained. */
function collected(stream: Stream.Stream<Uint8Array, unknown>): Effect.Effect<string> {
  return Stream.runFold(
    stream,
    (): Collected => ({ chunks: [], bytes: 0 }),
    (held, chunk) => {
      if (held.bytes >= MAX_GIT_OUTPUT_BYTES) return held;
      held.chunks.push(chunk);
      return { chunks: held.chunks, bytes: held.bytes + chunk.length };
    },
  ).pipe(
    Effect.map((held) => Buffer.concat(held.chunks).toString("utf8")),
    Effect.catch(() => Effect.succeed("")),
  );
}

/**
 * One Git step, run whole: on the clone where `at` names it (`--git-dir`), or
 * in a worktree's folder, where Git is kept from looking past it for a
 * repository. One that could not start answers a null status.
 */
function git(
  tool: GitTool,
  at: { readonly clone: string } | { readonly worktree: string },
  args: readonly string[],
  extra: Readonly<Record<string, string>> = {},
): Effect.Effect<GitRun, never, ChildProcessSpawner.ChildProcessSpawner> {
  const onClone = "clone" in at;
  const cwd = onClone ? at.clone : at.worktree;
  const pinned = onClone ? [`--git-dir=${at.clone}`] : [];
  // Note that a worktree's Git is held to the worktree, because a folder above it that is a repository must never be read instead.
  const ceiling = onClone ? {} : { GIT_CEILING_DIRECTORIES: path.dirname(at.worktree) };
  return Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(tool.path, [...pinned, ...HARDENED_FLAGS, ...args], {
        cwd,
        env: { ...tool.environment, ...HARDENED_ENVIRONMENT, ...ceiling, ...extra },
        extendEnv: false,
        stdin: "ignore",
      });
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [collected(handle.stdout), collected(handle.stderr), handle.exitCode],
        { concurrency: 3 },
      );
      return { exitCode: Number(exitCode), stdout, stderr };
    }),
  ).pipe(
    Effect.catch((error) =>
      Effect.succeed({
        exitCode: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      }),
    ),
  );
}

/** The last line Git wrote to its error stream, for a refusal to quote. */
function lastLine(text: string): string {
  const lines = text.trim().split("\n");
  return (lines.at(-1) ?? "").trim();
}

/** The commit a ref names in the clone, or nothing where it names none. */
function commitOf(tool: GitTool, clone: string, ref: string) {
  return Effect.map(
    git(tool, { clone }, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]),
    (run) => (run.exitCode === 0 ? run.stdout.trim() : undefined),
  );
}

/** The repository's GitHub address, which the clone's `origin` names; no credential is ever in it. */
function githubAddress(repository: string): string {
  return `https://github.com/${repository}.git`;
}

/** The clone made where there is none, its `origin` the repository's GitHub address; answers whether it stands. */
function ensureClone(tool: GitTool, clone: string, repository: string) {
  return Effect.gen(function* () {
    const kind = yield* entryKind(clone);
    if (kind === "folder") {
      const bare = yield* git(tool, { clone }, ["rev-parse", "--is-bare-repository"]);
      return bare.exitCode === 0 && bare.stdout.trim() === "true";
    }
    if (kind !== "none") return false;
    const made = yield* Effect.tryPromise(() => mkdir(clone, { recursive: true })).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false)),
    );
    if (!made) return false;
    const steps: readonly (readonly string[])[] = [
      ["init", "--bare", "--quiet", "--template="],
      ["config", "remote.origin.url", githubAddress(repository)],
      ["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"],
    ];
    for (const step of steps) {
      if ((yield* git(tool, { clone }, step)).exitCode !== 0) return false;
    }
    return true;
  });
}

/** Whether the clone holds a branch of that name. */
function branchStands(tool: GitTool, clone: string, branch: string) {
  return Effect.map(
    git(tool, { clone }, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]),
    (run) => run.exitCode === 0,
  );
}

/**
 * A branch name for the agent's worktree that the clone holds no
 * branch of yet: the agent's own branch's name where Git takes it, else
 * `agent-<id>`, else that with the commit's short id. Note that an existing branch is
 * never taken over, because the worktree is made with `-b`, which moves no
 * branch that already points somewhere.
 */
function branchFor(tool: GitTool, clone: string, agentId: string, fetched: FetchedHead) {
  return Effect.gen(function* () {
    const formed = yield* git(tool, { clone }, ["check-ref-format", "--branch", fetched.headRef]);
    // The last name carries the commit itself, which no branch of an earlier checkout can already hold.
    const candidates = [
      ...(formed.exitCode === 0 ? [fetched.headRef] : []),
      `agent-${agentId.slice(0, 8)}`,
      `agent-${agentId.slice(0, 8)}-${fetched.sha.slice(0, 12)}`,
    ];
    for (const candidate of candidates) {
      if (!(yield* branchStands(tool, clone, candidate))) return candidate;
    }
    return undefined;
  });
}

/**
 * How the worktree stands: none yet, or the commit Luke last put it on, on
 * its branch, with nothing of the developer's or a run's that a refresh
 * would lose; or why it may not be refreshed.
 */
function worktreeStanding(
  tool: GitTool,
  place: CheckoutPlace,
): Effect.Effect<
  CheckoutStep<{ readonly placed: string; readonly branch: string } | undefined>,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> {
  return Effect.gen(function* () {
    const kind = yield* entryKind(place.folder);
    if (kind === "none") return { ok: undefined };
    // A worktree's `.git` is a file naming its clone; a folder there is a repository Luke did not make.
    if (kind !== "folder" || (yield* entryKind(path.join(place.folder, ".git"))) !== "file") {
      return { refused: CHECKOUT_REFUSAL.NOT_LUKES };
    }
    const placed = yield* commitOf(tool, place.clone, lukeRefs(place.agentId).HEAD);
    if (placed === undefined) return { refused: CHECKOUT_REFUSAL.NOT_LUKES };
    const head = yield* git(tool, { worktree: place.folder }, ["rev-parse", "--verify", "HEAD"]);
    const branch = yield* git(tool, { worktree: place.folder }, [
      "symbolic-ref",
      "--quiet",
      "--short",
      "HEAD",
    ]);
    if (head.stdout.trim() !== placed || branch.exitCode !== 0) {
      return { refused: CHECKOUT_REFUSAL.MOVED };
    }
    const status = yield* git(tool, { worktree: place.folder }, [
      "status",
      "--porcelain=v1",
      "--untracked-files=no",
      "-z",
    ]);
    if (status.exitCode !== 0) return { refused: CHECKOUT_REFUSAL.GIT_FAILED };
    if (status.stdout !== "") return { refused: CHECKOUT_REFUSAL.EDITED };
    return { ok: { placed, branch: branch.stdout.trim() } };
  });
}

/** The files `to` changes over `from`, as named in the tree; nothing where Git could not say. */
function changedFiles(tool: GitTool, clone: string, from: string, to: string, filter: string) {
  return Effect.map(
    git(tool, { clone }, [
      "diff",
      "--name-only",
      "--no-renames",
      `--diff-filter=${filter}`,
      "-z",
      from,
      to,
    ]),
    (run) =>
      run.exitCode === 0 ? run.stdout.split("\0").filter((file) => file !== "") : undefined,
  );
}

/** The files `to` adds over `from` that the worktree already holds, untracked or ignored, as many as a refusal lists. */
function collisions(tool: GitTool, place: CheckoutPlace, from: string, to: string) {
  return Effect.gen(function* () {
    const added = yield* changedFiles(tool, place.clone, from, to, "A");
    if (added === undefined) return undefined;
    const found: string[] = [];
    for (const file of added) {
      if (found.length >= MAX_LISTED_COLLISIONS) break;
      if ((yield* entryKind(path.join(place.folder, file))) !== "none") found.push(file);
    }
    return found;
  });
}

/**
 * Whether the run needs its setup on `sha`: never where there is no setup
 * command; otherwise where it never finished, finished with another command,
 * or a lockfile or manifest changed since it last finished.
 */
function setupNeeded(
  tool: GitTool,
  place: CheckoutPlace,
  sha: string,
  setupCommand: string | null,
) {
  return Effect.gen(function* () {
    if (setupCommand === null) return false;
    const setUp = yield* commitOf(tool, place.clone, lukeRefs(place.agentId).SET_UP);
    if (setUp === undefined) return true;
    const ranWith = yield* git(tool, { clone: place.clone }, [
      "config",
      "--get",
      setupKey(place.agentId),
    ]);
    if (ranWith.exitCode !== 0 || ranWith.stdout.replace(/\n$/u, "") !== setupCommand) return true;
    if (setUp === sha) return false;
    const changed = yield* changedFiles(tool, place.clone, setUp, sha, "ACDMRT");
    return (
      changed === undefined || changed.some((file) => SETUP_FILES.has(path.posix.basename(file)))
    );
  });
}

/** The worktree made on the snapshot's commit, on a branch of its own following the agent's on `origin`; never interrupted halfway. */
function addWorktree(
  tool: GitTool,
  place: CheckoutPlace,
  fetched: FetchedHead,
): Effect.Effect<CheckoutStep<string>, never, ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.uninterruptible(
    Effect.gen(function* () {
      const branch = yield* branchFor(tool, place.clone, place.agentId, fetched);
      if (branch === undefined) return { refused: CHECKOUT_REFUSAL.GIT_FAILED };
      // A worktree whose folder went away without Git hearing of it would hold its branch, so the clone's list is pruned first.
      yield* git(tool, { clone: place.clone }, ["worktree", "prune"]);
      const added = yield* git(tool, { clone: place.clone }, [
        "worktree",
        "add",
        "--quiet",
        "-b",
        branch,
        place.folder,
        fetched.sha,
      ]);
      if (added.exitCode !== 0) {
        yield* Effect.ignore(
          Effect.tryPromise(() => rm(place.folder, { recursive: true, force: true })),
        );
        yield* git(tool, { clone: place.clone }, ["worktree", "prune"]);
        return {
          refused: `Git could not make the local checkout (${lastLine(added.stderr)}).`,
        };
      }
      // Note that the branch follows the agent's own on `origin`, so `git pull` there brings what the agent pushed.
      const upstream: readonly (readonly string[])[] = [
        ...(fetched.ownBranch
          ? [
              ["config", `branch.${branch}.remote`, "origin"],
              ["config", `branch.${branch}.merge`, `refs/heads/${fetched.headRef}`],
            ]
          : []),
        ["update-ref", lukeRefs(place.agentId).HEAD, fetched.sha],
      ];
      for (const step of upstream) {
        if ((yield* git(tool, { clone: place.clone }, step)).exitCode !== 0) {
          return { refused: CHECKOUT_REFUSAL.GIT_FAILED };
        }
      }
      return { ok: fetched.sha };
    }),
  );
}

/** The worktree's branch moved to the fetched commit with Git's own `reset --keep`, which loses nothing; never interrupted halfway. */
function moveWorktree(
  tool: GitTool,
  place: CheckoutPlace,
  sha: string,
): Effect.Effect<CheckoutStep<string>, never, ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.uninterruptible(
    Effect.gen(function* () {
      const moved = yield* git(tool, { worktree: place.folder }, [
        "reset",
        "--quiet",
        "--keep",
        sha,
      ]);
      if (moved.exitCode !== 0) {
        return {
          refused: `Git would not move the local checkout to the newest commit (${lastLine(moved.stderr)}). Delete the local checkout to start over.`,
        };
      }
      const named = yield* git(tool, { clone: place.clone }, [
        "update-ref",
        lukeRefs(place.agentId).HEAD,
        sha,
      ]);
      if (named.exitCode !== 0) return { refused: CHECKOUT_REFUSAL.GIT_FAILED };
      return { ok: sha };
    }),
  );
}

/**
 * The agent's worktree brought to the snapshot `fetchInto` makes:
 * made where there is none, refreshed where it stands with nothing a
 * refresh would lose, refused otherwise. Answers the commit it stands on and
 * whether its setup must run.
 */
export function refreshCheckout(
  tool: GitTool,
  place: CheckoutPlace,
  repository: string,
  fetchInto: FetchInto,
  setupCommand: string | null,
): Effect.Effect<CheckoutStep<PreparedCheckout>, never, ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.gen(function* () {
    const repositoryFolder = path.dirname(place.folder);
    const madeRoot = yield* Effect.tryPromise(() =>
      mkdir(repositoryFolder, { recursive: true }),
    ).pipe(
      Effect.andThen(placeContained(place.root, repositoryFolder)),
      Effect.catch(() => Effect.succeed(false)),
    );
    if (!madeRoot || !(yield* ensureClone(tool, place.clone, repository))) {
      return { refused: CHECKOUT_REFUSAL.NOT_LUKES };
    }
    const standing = yield* worktreeStanding(tool, place);
    if ("refused" in standing) return standing;
    const fetched = yield* fetchInto(place.clone);
    if ("refused" in fetched) return fetched;
    const sha = fetched.ok.sha;
    if (standing.ok === undefined) {
      const added = yield* addWorktree(tool, place, fetched.ok);
      if ("refused" in added) return added;
    } else if (standing.ok.placed !== sha) {
      const colliding = yield* collisions(tool, place, standing.ok.placed, sha);
      if (colliding === undefined) return { refused: CHECKOUT_REFUSAL.GIT_FAILED };
      if (colliding.length > 0) {
        return {
          refused: `The agent's newest work adds files the local checkout already holds (${colliding.join(", ")}), which Luke never overwrites. Delete the local checkout to start over.`,
        };
      }
      const moved = yield* moveWorktree(tool, place, sha);
      if ("refused" in moved) return moved;
    }
    return { ok: { sha, setupNeeded: yield* setupNeeded(tool, place, sha, setupCommand) } };
  });
}

/** The commit the setup just finished on, kept so the next run skips it until a lockfile changes. */
export function markSetUp(
  tool: GitTool,
  place: CheckoutPlace,
  sha: string,
  setupCommand: string,
): Effect.Effect<void, never, ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.gen(function* () {
    // Note that the commit is marked only once the command is, so a mark that failed halfway asks for setup again rather than skipping it.
    const noted = yield* git(tool, { clone: place.clone }, [
      "config",
      setupKey(place.agentId),
      setupCommand,
    ]);
    if (noted.exitCode !== 0) return;
    yield* git(tool, { clone: place.clone }, ["update-ref", lukeRefs(place.agentId).SET_UP, sha]);
  });
}

/** What every snapshot commit is made under, so the same work on the same base is always the same commit. */
const SNAPSHOT_COMMIT_ENVIRONMENT = {
  GIT_AUTHOR_NAME: "Luke",
  GIT_AUTHOR_EMAIL: "luke@tryluke.dev",
  GIT_AUTHOR_DATE: "@0 +0000",
  GIT_COMMITTER_NAME: "Luke",
  GIT_COMMITTER_EMAIL: "luke@tryluke.dev",
  GIT_COMMITTER_DATE: "@0 +0000",
} as const;

/**
 * The agent's work made a commit in the clone: the base fetched from `url`
 * by its id, then `patch` (a binary patch, already unzipped) applied to it in
 * a scratch index and committed on top. No worktree is touched, and the
 * patch and the scratch index go once the commit stands. `configArgs` are
 * the credential's own flags, placed after the hardened ones.
 */
export function snapshotCommit(
  tool: GitTool,
  clone: string,
  agentId: string,
  source: {
    readonly url: string;
    readonly configArgs: readonly string[];
    readonly base: string;
    readonly patch: Uint8Array;
  },
): Effect.Effect<CheckoutStep<string>, never, ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.gen(function* () {
    const baseRef = lukeRefs(agentId).BASE;
    const fetched = yield* git(tool, { clone }, [
      ...source.configArgs,
      "fetch",
      "--quiet",
      "--no-tags",
      "--no-write-fetch-head",
      "--no-recurse-submodules",
      source.url,
      `+${source.base}:${baseRef}`,
    ]);
    if (fetched.exitCode !== 0) {
      const why = fetched.exitCode === null ? "Git could not be started" : lastLine(fetched.stderr);
      return { refused: `Luke could not fetch the agent's starting commit (${why}).` };
    }
    if ((yield* commitOf(tool, clone, baseRef)) !== source.base) {
      return { refused: "Luke fetched the agent's starting commit but found another." };
    }
    return yield* Effect.acquireUseRelease(
      Effect.tryPromise(() => mkdtemp(path.join(tmpdir(), "luke-snapshot-"))).pipe(Effect.orDie),
      (scratch) => applied(tool, clone, scratch, source),
      (scratch) =>
        Effect.ignore(Effect.tryPromise(() => rm(scratch, { recursive: true, force: true }))),
    );
  });
}

/** The patch applied to the base in a scratch index of the clone, and the commit of the tree it makes. */
function applied(
  tool: GitTool,
  clone: string,
  scratch: string,
  source: { readonly base: string; readonly patch: Uint8Array },
) {
  return Effect.gen(function* () {
    const index = { GIT_INDEX_FILE: path.join(scratch, "index") };
    const patchFile = path.join(scratch, "work.patch");
    const written = yield* Effect.tryPromise(() => writeFile(patchFile, source.patch)).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false)),
    );
    if (!written)
      return {
        refused: "Luke could not hold the agent's work to apply it.",
      } satisfies CheckoutStep<string>;
    const read = yield* git(tool, { clone }, ["read-tree", source.base], index);
    if (read.exitCode !== 0)
      return { refused: CHECKOUT_REFUSAL.GIT_FAILED } satisfies CheckoutStep<string>;
    // An agent that changed nothing sends an empty patch, which Git would refuse as no patch at all.
    if (source.patch.length > 0) {
      const patched = yield* git(
        tool,
        { clone },
        ["apply", "--cached", "--binary", patchFile],
        index,
      );
      if (patched.exitCode !== 0) {
        return {
          refused: `Luke could not apply the agent's work (${lastLine(patched.stderr)}).`,
        } satisfies CheckoutStep<string>;
      }
    }
    const tree = yield* git(tool, { clone }, ["write-tree"], index);
    if (tree.exitCode !== 0)
      return { refused: CHECKOUT_REFUSAL.GIT_FAILED } satisfies CheckoutStep<string>;
    const committed = yield* git(
      tool,
      { clone },
      [
        "commit-tree",
        tree.stdout.trim(),
        "-p",
        source.base,
        "-m",
        "The coding agent's work, as Luke took it to run",
      ],
      SNAPSHOT_COMMIT_ENVIRONMENT,
    );
    if (committed.exitCode !== 0)
      return { refused: CHECKOUT_REFUSAL.GIT_FAILED } satisfies CheckoutStep<string>;
    return { ok: committed.stdout.trim() } satisfies CheckoutStep<string>;
  });
}

/**
 * Removes an agent's checkout, where every folder down to it is a real one,
 * and lets the clone forget it: its worktree, its branch, and Luke's refs
 * for it. The clone stays for the repository's next agent.
 * Answers whether nothing is left there.
 */
export function removeCheckout(
  tool: GitTool,
  place: CheckoutPlace,
): Effect.Effect<boolean, never, ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.gen(function* () {
    if ((yield* entryKind(place.folder)) !== "none") {
      if (!(yield* placeContained(place.root, place.folder))) return false;
      const branch = yield* git(tool, { worktree: place.folder }, [
        "symbolic-ref",
        "--quiet",
        "--short",
        "HEAD",
      ]);
      // Note that a recursive removal deletes a link inside the checkout rather than following it.
      const removed = yield* Effect.tryPromise(() =>
        rm(place.folder, { recursive: true, force: true }),
      ).pipe(
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false)),
      );
      if (!removed) return false;
      if ((yield* entryKind(place.clone)) === "folder" && branch.exitCode === 0) {
        yield* git(tool, { clone: place.clone }, ["worktree", "prune"]);
        yield* git(tool, { clone: place.clone }, ["branch", "-D", branch.stdout.trim()]);
      }
    }
    if ((yield* entryKind(place.clone)) === "folder") {
      const refs = lukeRefs(place.agentId);
      for (const ref of [refs.BASE, refs.HEAD, refs.SET_UP]) {
        yield* git(tool, { clone: place.clone }, ["update-ref", "-d", ref]);
      }
      yield* git(tool, { clone: place.clone }, ["config", "--unset", setupKey(place.agentId)]);
    }
    return true;
  });
}

/** The checkout's folder where it stands as a real folder under the root, for a reveal; nothing otherwise. */
export function locateCheckout(place: CheckoutPlace): Effect.Effect<string | undefined> {
  return Effect.map(placeContained(place.root, place.folder), (contained) =>
    contained ? place.folder : undefined,
  );
}
