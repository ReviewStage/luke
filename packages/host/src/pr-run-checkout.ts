import { lstat, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Effect, Stream } from "effect";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";

/**
 * pr-run-checkout.ts -- Luke's own checkout of one pull request on this Mac: where it lives, whether it may be refreshed, and the refresh.
 *
 * Every pull request run on this Mac has one folder of its own, under
 * `<state root>/pr-runs/<account>/<workspace>/<owner>/<name>/pr-<number>`,
 * each segment held to a shape that cannot climb out of it; nothing else on
 * the Mac is touched, the developer's own working trees least of all. The
 * folder is a real Git repository, so a run command may use Git, kept from
 * run to run so what the command installed is there next time.
 *
 * A refresh never discards anything the developer or a run left. A folder
 * Luke did not make, a checkout moved off the commit Luke last put there (a
 * commit made in it, a branch checked out), and one with edits to tracked
 * files are refused before anything is fetched; a newest commit that adds a
 * file the checkout already holds untracked or ignored is refused before
 * anything is checked out; and Git's own checkout, never forced, refuses
 * whatever else it would overwrite. Each refusal says to delete the local
 * checkout to start over. The first checkout of a pull request is built in a
 * sibling staging folder and renamed into place only once whole, so a fetch
 * that fails, or a run stopped while it prepares, leaves no half-made
 * checkout behind; a later refresh fetches into the checkout's own object
 * store, which moves no file, and the checkout of the fetched commit is the
 * one step that is never interrupted.
 *
 * Every Git this module runs is told exactly which repository it works on
 * and reads no system or global configuration, no hooks, no credential
 * helper but the one a fetch is handed, and no file-system monitor, so
 * nothing configured elsewhere on the Mac runs in it or sees what it fetches
 * with. Submodules are not fetched and Git LFS content is not smudged: a
 * checkout holds the repository's own files and LFS pointer files.
 */

/** The folder under the state root that every pull request's checkout lives in. */
export const PR_RUNS_FOLDER = "pr-runs";

/** The ref a checkout's last fetched head is kept under, and the one naming the commit Luke last checked out. */
const LUKE_REF = {
  FETCHED: "refs/luke/fetched",
  HEAD: "refs/luke/head",
} as const;

/** The suffix of the sibling folder a first checkout is built in. */
const STAGING_SUFFIX = ".staging";

/** The most of a Git's output a step keeps, which is far past anything this module reads. */
const MAX_GIT_OUTPUT_BYTES = 4 * 1024 * 1024;

/** The most colliding file names a refusal lists. */
const MAX_LISTED_COLLISIONS = 5;

/** The shapes a checkout folder's segments are held to: none may be empty, `.`, `..`, or hold a separator. */
const SEGMENT = {
  /** An account's email, lowercased. */
  ACCOUNT: /^(?!\.{1,2}$)[a-z0-9._%+@-]{1,254}$/u,
  WORKSPACE: /^[A-Za-z0-9_-]{1,128}$/u,
  OWNER: /^[a-z0-9](?:-?[a-z0-9]){0,38}$/u,
  NAME: /^(?!\.{1,2}$)[a-z0-9_.-]{1,100}$/u,
} as const;

/** The pull request a checkout is for, under the account signed in. */
export interface CheckoutOwner {
  readonly accountEmail: string;
  readonly workspaceId: string;
  /** `owner/name`, as GitHub spells it. */
  readonly repository: string;
  readonly number: number;
}

/** Where a pull request's checkout lives: the folder every checkout lives under, and its own. */
export interface CheckoutPlace {
  readonly root: string;
  readonly folder: string;
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
    "The folder Luke keeps this pull request's checkout in holds something Luke did not put there. Delete the local checkout to start over.",
  MOVED:
    "The local checkout has commits or a branch of its own, which a refresh would leave behind. Delete the local checkout to start over.",
  EDITED:
    "The local checkout has edits to tracked files, which Luke never overwrites. Delete the local checkout to start over.",
  GIT_FAILED: "Git could not read the local checkout. Delete the local checkout to start over.",
} as const;

/** A step's result: where it got to, or why it stopped, in the developer's words. */
export type CheckoutStep<A> = { readonly ok: A } | { readonly refused: string };

/** How a fetch into a repository folder came out: the commit fetched, or why there is none. */
export type FetchInto = (
  repositoryFolder: string,
) => Effect.Effect<CheckoutStep<string>, never, ChildProcessSpawner.ChildProcessSpawner>;

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

/** The checkout's folder for the pull request, or nothing where a segment is not of its shape. */
export function checkoutPlace(stateRoot: string, owner: CheckoutOwner): CheckoutPlace | undefined {
  const account = owner.accountEmail.toLowerCase();
  const [repositoryOwner = "", name = "", extra] = owner.repository.toLowerCase().split("/");
  const shaped =
    SEGMENT.ACCOUNT.test(account) &&
    SEGMENT.WORKSPACE.test(owner.workspaceId) &&
    SEGMENT.OWNER.test(repositoryOwner) &&
    SEGMENT.NAME.test(name) &&
    extra === undefined &&
    Number.isSafeInteger(owner.number) &&
    owner.number >= 1;
  if (!shaped) return undefined;
  const root = path.join(stateRoot, PR_RUNS_FOLDER);
  const folder = path.join(
    root,
    account,
    owner.workspaceId,
    repositoryOwner,
    name,
    `pr-${owner.number}`,
  );
  return { root, folder };
}

/** What a path is, without following a link: nothing, a folder, or something else. */
function entryKind(at: string): Effect.Effect<"none" | "folder" | "other"> {
  return Effect.tryPromise(() => lstat(at)).pipe(
    Effect.map((stats) => (stats.isDirectory() ? ("folder" as const) : ("other" as const))),
    Effect.catch(() => Effect.succeed("none" as const)),
  );
}

/**
 * Whether every folder from the root down to `folder` is a real folder, none
 * of them a link: what lets a removal or a reveal trust the path it was
 * built from. Note that the root itself is under the state root Luke made.
 */
export function placeContained(place: CheckoutPlace): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    const relative = path.relative(place.root, place.folder);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return false;
    let at = place.root;
    for (const segment of ["", ...relative.split(path.sep)]) {
      at = segment === "" ? at : path.join(at, segment);
      if ((yield* entryKind(at)) !== "folder") return false;
    }
    return true;
  });
}

/** The bytes a stream wrote, kept up to the bound and the rest drained. */
function collected(stream: Stream.Stream<Uint8Array, unknown>): Effect.Effect<string> {
  return Stream.runFold(
    stream,
    () => ({ chunks: [] as Uint8Array[], bytes: 0 }),
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

/** One Git step on the repository whose working tree is `folder`, run whole; one that could not start answers a null status. */
function git(
  tool: GitTool,
  folder: string,
  args: readonly string[],
): Effect.Effect<GitRun, never, ChildProcessSpawner.ChildProcessSpawner> {
  const pinned = [`--git-dir=${path.join(folder, ".git")}`, `--work-tree=${folder}`];
  return Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(tool.path, [...pinned, ...HARDENED_FLAGS, ...args], {
        cwd: folder,
        env: { ...tool.environment, ...HARDENED_ENVIRONMENT },
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

/** The commit a ref names, or nothing where it names none. */
function commitOf(tool: GitTool, folder: string, ref: string) {
  return Effect.map(
    git(tool, folder, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]),
    (run) => (run.exitCode === 0 ? run.stdout.trim() : undefined),
  );
}

/**
 * How the checkout stands: none yet, or the commit Luke last checked out with
 * nothing of the developer's or a run's that a refresh would lose, or why it
 * may not be refreshed.
 */
function checkoutStanding(
  tool: GitTool,
  folder: string,
): Effect.Effect<CheckoutStep<string | undefined>, never, ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.gen(function* () {
    const kind = yield* entryKind(folder);
    if (kind === "none") return { ok: undefined };
    if (kind !== "folder" || (yield* entryKind(path.join(folder, ".git"))) !== "folder") {
      return { refused: CHECKOUT_REFUSAL.NOT_LUKES };
    }
    const placed = yield* commitOf(tool, folder, LUKE_REF.HEAD);
    if (placed === undefined) return { refused: CHECKOUT_REFUSAL.NOT_LUKES };
    const head = yield* commitOf(tool, folder, "HEAD");
    const onBranch = yield* git(tool, folder, ["symbolic-ref", "--quiet", "HEAD"]);
    if (head !== placed || onBranch.exitCode === 0) return { refused: CHECKOUT_REFUSAL.MOVED };
    const status = yield* git(tool, folder, [
      "status",
      "--porcelain=v1",
      "--untracked-files=no",
      "-z",
    ]);
    if (status.exitCode !== 0) return { refused: CHECKOUT_REFUSAL.GIT_FAILED };
    if (status.stdout !== "") return { refused: CHECKOUT_REFUSAL.EDITED };
    return { ok: placed };
  });
}

/** The files `to` adds over `from` that the folder already holds, untracked or ignored, as many as a refusal lists. */
function collisions(tool: GitTool, folder: string, from: string, to: string) {
  return Effect.gen(function* () {
    const added = yield* git(tool, folder, [
      "diff",
      "--name-only",
      "--no-renames",
      "--diff-filter=A",
      "-z",
      from,
      to,
    ]);
    if (added.exitCode !== 0) return undefined;
    const found: string[] = [];
    for (const file of added.stdout.split("\0")) {
      if (file === "" || found.length >= MAX_LISTED_COLLISIONS) continue;
      if ((yield* entryKind(path.join(folder, file))) !== "none") found.push(file);
    }
    return found;
  });
}

/** The fetched commit checked out, detached, and named as the one Luke placed; never interrupted halfway. */
function placeCommit(tool: GitTool, folder: string, sha: string) {
  return Effect.uninterruptible(
    Effect.gen(function* () {
      const checkout = yield* git(tool, folder, ["checkout", "--quiet", "--detach", sha]);
      if (checkout.exitCode !== 0) {
        return {
          refused: `Git would not check the newest commit out over the local checkout (${lastLine(checkout.stderr)}). Delete the local checkout to start over.`,
        };
      }
      const named = yield* git(tool, folder, ["update-ref", LUKE_REF.HEAD, sha]);
      if (named.exitCode !== 0) return { refused: CHECKOUT_REFUSAL.GIT_FAILED };
      return { ok: sha };
    }),
  );
}

/** The staging folder removed, where it is a folder of its own and not a link. */
function removeStaging(staging: string): Effect.Effect<void> {
  return Effect.gen(function* () {
    if ((yield* entryKind(staging)) === "none") return;
    yield* Effect.ignore(Effect.tryPromise(() => rm(staging, { recursive: true, force: true })));
  });
}

/** A first checkout: a repository made in the staging folder, fetched into, checked out, and renamed into place whole. */
function firstCheckout(tool: GitTool, folder: string, fetchInto: FetchInto) {
  const staging = `${folder}${STAGING_SUFFIX}`;
  const built = Effect.gen(function* () {
    yield* removeStaging(staging);
    const made = yield* Effect.tryPromise(() => mkdir(staging, { recursive: true })).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false)),
    );
    if (!made) return { refused: "Luke could not make a folder for the local checkout." };
    const init = yield* git(tool, staging, ["init", "--quiet", "--template="]);
    if (init.exitCode !== 0) {
      return { refused: `Git could not make the local checkout (${lastLine(init.stderr)}).` };
    }
    const fetched = yield* fetchInto(staging);
    if ("refused" in fetched) return fetched;
    const placed = yield* placeCommit(tool, staging, fetched.ok);
    if ("refused" in placed) return placed;
    const moved = yield* Effect.tryPromise(() => rename(staging, folder)).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false)),
    );
    return moved ? placed : { refused: "Luke could not move the local checkout into place." };
  });
  // Note that the staging folder goes however the build ended, a stop included, because a finished build has already renamed it away.
  return Effect.ensuring(built, removeStaging(staging));
}

/**
 * The pull request's checkout brought to the commit `fetchInto` fetches:
 * made where there is none, refreshed where it stands with nothing a
 * refresh would lose, refused otherwise. Answers the commit checked out.
 */
export function refreshCheckout(
  tool: GitTool,
  place: CheckoutPlace,
  fetchInto: FetchInto,
): Effect.Effect<CheckoutStep<string>, never, ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.gen(function* () {
    const madeRoot = yield* Effect.tryPromise(() =>
      mkdir(path.dirname(place.folder), { recursive: true }),
    ).pipe(
      Effect.andThen(placeContained({ root: place.root, folder: path.dirname(place.folder) })),
      Effect.catch(() => Effect.succeed(false)),
    );
    if (!madeRoot) return { refused: CHECKOUT_REFUSAL.NOT_LUKES };
    const standing = yield* checkoutStanding(tool, place.folder);
    if ("refused" in standing) return standing;
    if (standing.ok === undefined) return yield* firstCheckout(tool, place.folder, fetchInto);
    const placed = standing.ok;
    const fetched = yield* fetchInto(place.folder);
    if ("refused" in fetched) return fetched;
    if (fetched.ok === placed) return { ok: placed };
    const colliding = yield* collisions(tool, place.folder, placed, fetched.ok);
    if (colliding === undefined) return { refused: CHECKOUT_REFUSAL.GIT_FAILED };
    if (colliding.length > 0) {
      return {
        refused: `The pull request's newest commit adds files the local checkout already holds (${colliding.join(", ")}), which Luke never overwrites. Delete the local checkout to start over.`,
      };
    }
    return yield* placeCommit(tool, place.folder, fetched.ok);
  });
}

/**
 * The pull request's head fetched from `url` into the repository folder and
 * read back: the commit fetched under `refs/luke/fetched`, whatever it is,
 * which the caller holds to the commit it was told to expect. `configArgs`
 * are the credential's own flags, placed after the hardened ones.
 */
export function fetchPullRequestHead(
  tool: GitTool,
  repositoryFolder: string,
  source: { readonly url: string; readonly ref: string; readonly configArgs: readonly string[] },
): Effect.Effect<CheckoutStep<string>, never, ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.gen(function* () {
    const fetched = yield* git(tool, repositoryFolder, [
      ...source.configArgs,
      "fetch",
      "--quiet",
      "--no-tags",
      "--no-write-fetch-head",
      "--no-recurse-submodules",
      source.url,
      `+${source.ref}:${LUKE_REF.FETCHED}`,
    ]);
    if (fetched.exitCode !== 0) {
      const why = fetched.exitCode === null ? "Git could not be started" : lastLine(fetched.stderr);
      return { refused: `Luke could not fetch the pull request (${why}).` };
    }
    const sha = yield* commitOf(tool, repositoryFolder, LUKE_REF.FETCHED);
    return sha === undefined
      ? { refused: "Luke fetched the pull request but found no commit at its head." }
      : { ok: sha };
  });
}

/** Removes a pull request's checkout, where every folder down to it is a real one; answers whether nothing is left there. */
export function removeCheckout(place: CheckoutPlace): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    if ((yield* entryKind(place.folder)) === "none") return true;
    if (!(yield* placeContained(place))) return false;
    // Note that a recursive removal deletes a link inside the checkout rather than following it.
    return yield* Effect.tryPromise(() => rm(place.folder, { recursive: true, force: true })).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false)),
    );
  });
}

/** The checkout's folder where it stands as a real folder under the root, for a reveal; nothing otherwise. */
export function locateCheckout(place: CheckoutPlace): Effect.Effect<string | undefined> {
  return Effect.map(placeContained(place), (contained) => (contained ? place.folder : undefined));
}
