/**
 * state-work.ts -- an agent's work in its repository as its state carries it: captured by git inside the agent's VM into one bundle of what no remote holds, with HEAD, the refs, the stashes and the index beside it; applied to a repository made at the bundle's base; and read back as a snapshot two repositories are compared by.
 *
 * The worktree is the agent's to rig, so every command here is the agent's
 * own git, run as the agent's user inside its VM, never the host's. The
 * working tree is written as a commit through a throwaway index started from
 * the real one, as `git stash` does: `git add -A` there takes tracked,
 * untracked and deleted files and leaves what Git ignores, and the commit's
 * parent is HEAD, so restoring it moves no ref. Blobs only the index holds,
 * staged and then edited again, or the sides of a conflict, ride in a
 * second commit of their own, so the real index, packed as its file, finds
 * every object it names. The bundle holds the local refs, both commits,
 * HEAD and every stash entry, less every commit a remote-tracking ref (or
 * the ref Luke's own checkout fetched, `refs/luke/`) already reaches, so
 * only what the remote lacks travels. Its base is the remote commit that
 * holds the most of the bundle's prerequisites; any it does not hold, and
 * any ref's commit the restored repository lacks, are fetched from its
 * `origin` by their ids.
 *
 * A folder with no repository, an agent's that works in none, is carried
 * the same way through a git folder of its own in the scratch folder, as one
 * commit of its files, with no base.
 */

import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { Data, Effect, Option, Schema, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import { ChildProcess } from "effect/process";

/** Why packing, verifying or restoring a state failed, in words that hold no file's contents. */
export class StateFailed extends Data.TaggedError("StateFailed")<{ readonly detail: string }> {}

/** The kinds of work a state carries: a repository, or a folder with none. */
export const WORK_KIND = { GIT: "git", FILES: "files" } as const;

/** Where the temporary refs the bundle is made from stand while it is made, which no other ref of the agent's is under. */
const STATE_REFS = "refs/luke-state/";

/** The refs that stand for a remote's state: remote-tracking refs, and the head Luke's checkout fetched (`@luke/host`'s `agentWorktreeScript`). */
const REMOTE_REFS = ["refs/remotes/", "refs/luke/"] as const;

/** The ref of the stash, whose entries are its reflog and travel as entries of their own. */
const STASH_REF = "refs/stash";

/** A gitlink's mode in an index or a tree: a submodule's commit, which no bundle of this repository holds. */
const GITLINK_MODE = "160000";

/**
 * A harness's credential file and the `gh` sign-in's, which no pack carries
 * in the work either: a pack whose work holds one, tracked, staged or
 * untracked, is refused, since taking it out would restore a repository
 * other than the agent's. Claude Code's is known by its name alone,
 * wherever it stands, since no other file is named so; Codex's and `gh`'s
 * names are common in repositories, so they are known by the folder they
 * stand under too.
 */
const CREDENTIAL_FILES = {
  NAMES: [".credentials.json"],
  PATHS: [".codex/auth.json", "gh/hosts.yml"],
} as const;

/** A git config key the state sets on a restore: a local branch's upstream, and nothing else. */
const UPSTREAM_KEY = /^branch\..+\.(remote|merge)$/u;

/**
 * Who the state's own commits are by, and when, so the same work makes the
 * same commits. Note that only `commit-tree` is given them, because a
 * reflog entry stamped at time zero, as a restored stash's would be, is one
 * `git stash list` does not show.
 */
const STATE_IDENTITY = {
  GIT_AUTHOR_NAME: "Luke",
  GIT_AUTHOR_EMAIL: "state@luke.invalid",
  GIT_AUTHOR_DATE: "@0 +0000",
  GIT_COMMITTER_NAME: "Luke",
  GIT_COMMITTER_EMAIL: "state@luke.invalid",
  GIT_COMMITTER_DATE: "@0 +0000",
} as const;

/**
 * What every git command here runs under: none of the variables that would
 * point it at another repository or index, no prompt for a credential, and
 * plain English, since its words are read.
 */
const GIT_ENV = {
  GIT_DIR: undefined,
  GIT_WORK_TREE: undefined,
  GIT_INDEX_FILE: undefined,
  GIT_OBJECT_DIRECTORY: undefined,
  GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
  GIT_COMMON_DIR: undefined,
  GIT_NAMESPACE: undefined,
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
} as const;

/** How much of git's last words a failure keeps. */
const FAILURE_CHARACTERS = 200;

const encoder = new TextEncoder();

/** An object id, SHA-1 or SHA-256. */
const OidSchema = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u));

/** The work as a state's manifest records it. */
export const WorkSchema = Schema.Struct({
  kind: Schema.Literals([WORK_KIND.GIT, WORK_KIND.FILES]),
  /** The remote commit a repository is made at before the restore; none where the bundle needs none. */
  base: Schema.NullOr(OidSchema),
  /** Every commit the bundle needs the repository to hold. */
  prerequisites: Schema.Array(OidSchema),
  /** HEAD: the ref it names, born or not, or the commit it is detached at; none for a folder with no repository. */
  head: Schema.NullOr(
    Schema.Union([
      Schema.Struct({ ref: Schema.String.check(Schema.isPattern(/^refs\//u)) }),
      Schema.Struct({ oid: OidSchema }),
    ]),
  ),
  /** Every ref but the stash, remote-tracking ones among them, in name order. */
  refs: Schema.Array(
    Schema.Struct({ name: Schema.String.check(Schema.isPattern(/^refs\//u)), oid: OidSchema }),
  ),
  /** The local branches' upstreams, as their config keys and values. */
  upstreams: Schema.Array(
    Schema.Struct({
      key: Schema.String.check(Schema.isPattern(UPSTREAM_KEY)),
      value: Schema.String,
    }),
  ),
  /** The stash's entries, newest first, as `git stash list` names them. */
  stashes: Schema.Array(Schema.Struct({ oid: OidSchema, message: Schema.String })),
  /** The commit of the working tree, on HEAD. */
  worktree: OidSchema,
  /** The commit of the blobs only the index holds; none where it holds none. */
  staged: Schema.NullOr(OidSchema),
});

export type Work = typeof WorkSchema.Type;

/** Where a git command runs: in a repository, or with a git folder apart from the folder it tracks. */
interface GitPlace {
  readonly cwd: string;
  readonly gitDir?: string;
}

/** What one git command is given beyond its arguments. */
interface GitRun {
  readonly env?: Readonly<Record<string, string>>;
  readonly input?: string;
  /** Exit codes besides 0 that answer rather than fail. */
  readonly allow?: readonly number[];
}

/** One git command's exit code and what it printed. */
interface GitAnswer {
  readonly code: number;
  readonly out: string;
}

/** A work's bundle and index file, as captured or as unpacked. */
export interface WorkFiles {
  readonly bundle: string;
  /** The real index file; none where the repository has none, or for a folder with no repository. */
  readonly index: string | undefined;
}

/** A repository read back for a comparison: the same work reads the same. */
interface WorkSnapshot {
  readonly refs: string;
  readonly head: string;
  readonly stashes: string;
  readonly upstreams: string;
  readonly status: string;
  readonly files: readonly string[];
}

/** The last line git wrote on stderr, cut short. */
function lastWords(stderr: string): string {
  const lines = stderr.trim().split("\n");
  return (lines.at(-1) ?? "").slice(0, FAILURE_CHARACTERS);
}

/** Runs git where the place says, answering its exit code and stdout; a code not allowed fails with its last words. */
const runGit = (place: GitPlace, args: readonly string[], run: GitRun = {}) =>
  Effect.scoped(
    Effect.gen(function* () {
      const located =
        place.gitDir === undefined
          ? args
          : ["--git-dir", place.gitDir, "--work-tree", place.cwd, ...args];
      const handle = yield* ChildProcess.make("git", [...located], {
        cwd: place.cwd,
        env: { ...GIT_ENV, ...run.env },
        extendEnv: true,
        stdin: run.input === undefined ? "ignore" : Stream.make(encoder.encode(run.input)),
      });
      const [out, err, exit] = yield* Effect.all(
        [
          Stream.mkString(Stream.decodeText(handle.stdout)),
          Stream.mkString(Stream.decodeText(handle.stderr)),
          handle.exitCode,
        ],
        { concurrency: "unbounded" },
      );
      const code = Number(exit);
      if (code !== 0 && !(run.allow ?? []).includes(code)) {
        return yield* new StateFailed({
          detail: `git ${args[0]} failed (exit ${code}): ${lastWords(err)}`,
        });
      }
      return { code, out } satisfies GitAnswer;
    }),
  ).pipe(
    Effect.catchTag("PlatformError", (error) =>
      Effect.fail(new StateFailed({ detail: `git ${args[0]} could not run: ${error.message}` })),
    ),
  );

/** Git's stdout for a command that must succeed. */
const git = (place: GitPlace, args: readonly string[], run: GitRun = {}) =>
  Effect.map(runGit(place, args, run), (answer) => answer.out);

/** A file-system step as an Effect, its failure in words that name the step. */
const fileStep = <A>(step: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) =>
      new StateFailed({
        detail: `${step}: ${error instanceof Error ? error.message : String(error)}`,
      }),
  });

/** The NUL-separated records git printed, less the empty one after the last NUL. */
function records(out: string): string[] {
  return out.split("\0").filter((record) => record !== "");
}

/** The lines git printed, for output whose records hold no newline, as ref names and ids never do. */
function lines(out: string): string[] {
  return out.split("\n").filter((line) => line !== "");
}

/** The commit a revision names; none where it names none, as HEAD on an unborn branch. */
const commitOf = (place: GitPlace, revision: string) =>
  Effect.map(
    runGit(place, ["rev-parse", "-q", "--verify", `${revision}^{commit}`], { allow: [1] }),
    (answer) => (answer.code === 0 ? Option.some(answer.out.trim()) : Option.none<string>()),
  );

/** Every ref but the stash and the state's own, with the object each names, in name order. */
const refsOf = (place: GitPlace) =>
  Effect.map(git(place, ["for-each-ref", "--format=%(refname) %(objectname)"]), (out) =>
    lines(out)
      .map((line) => {
        const [name = "", oid = ""] = line.split(" ");
        return { name, oid };
      })
      .filter(({ name }) => name !== STASH_REF && !name.startsWith(STATE_REFS)),
  );

/** The local branches' upstreams as config keys and values, in the order git keeps them. */
const upstreamsOf = (place: GitPlace) =>
  Effect.map(
    runGit(place, ["config", "--local", "-z", "--get-regexp", UPSTREAM_KEY.source], { allow: [1] }),
    (answer) =>
      records(answer.out).map((record) => {
        const cut = record.indexOf("\n");
        return { key: record.slice(0, cut), value: record.slice(cut + 1) };
      }),
  );

/** The stash's entries, newest first. */
const stashesOf = (place: GitPlace) =>
  Effect.map(git(place, ["stash", "list", "--format=%H%x1f%gs"]), (out) =>
    lines(out).map((line) => {
      const cut = line.indexOf("\x1f");
      return { oid: line.slice(0, cut), message: line.slice(cut + 1) };
    }),
  );

/** HEAD as the manifest records it. */
const headOf = (place: GitPlace) =>
  Effect.gen(function* () {
    const symbolic = yield* runGit(place, ["symbolic-ref", "-q", "HEAD"], { allow: [1] });
    if (symbolic.code === 0) return { ref: symbolic.out.trim() };
    const detached = yield* commitOf(place, "HEAD");
    return Option.isSome(detached) ? { oid: detached.value } : null;
  });

/** The real index file's path. */
const indexPathOf = (place: GitPlace) =>
  Effect.map(git(place, ["rev-parse", "--path-format=absolute", "--git-path", "index"]), (out) =>
    out.trim(),
  );

/** A commit of the tree given, on the parent given where there is one. */
const commitTree = (
  place: GitPlace,
  tree: string,
  parent: Option.Option<string>,
  message: string,
) =>
  Effect.map(
    git(
      place,
      ["commit-tree", tree, ...(Option.isSome(parent) ? ["-p", parent.value] : []), "-m", message],
      {
        env: STATE_IDENTITY,
      },
    ),
    (out) => out.trim(),
  );

/** The commit of the folder's tracked and untracked files, less what Git ignores, written through a throwaway index started from `from`. */
const worktreeCommit = (
  place: GitPlace,
  from: string | undefined,
  scratch: string,
  parent: Option.Option<string>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const throwaway = join(scratch, "worktree-index");
    if (from !== undefined && (yield* fs.exists(from))) {
      yield* fs
        .copyFile(from, throwaway)
        .pipe(Effect.mapError(() => new StateFailed({ detail: "the index could not be copied" })));
    }
    const env = { GIT_INDEX_FILE: throwaway };
    yield* git(place, ["add", "-A"], { env });
    const tree = (yield* git(place, ["write-tree"], { env })).trim();
    return yield* commitTree(place, tree, parent, "Luke: the agent's working tree");
  });

/** The blobs a tree holds, every level down. */
const treeBlobs = (place: GitPlace, revision: string) =>
  Effect.map(git(place, ["ls-tree", "-r", "-z", revision]), (out) =>
    records(out).map((record) => record.split("\t")[0]?.split(" ")[2] ?? ""),
  );

/**
 * A commit of the blobs the index names that neither the worktree's commit
 * nor HEAD holds, one entry each, named by its id; none where there are none.
 */
const stagedCommit = (place: GitPlace, worktree: string, head: Option.Option<string>) =>
  Effect.gen(function* () {
    const indexed = records(yield* git(place, ["ls-files", "-s", "-z"]))
      .map((record) => {
        const [entry = "", path = ""] = record.split("\t");
        const [mode = "", oid = ""] = entry.split(" ");
        return { mode, oid, path };
      })
      .filter(({ mode }) => mode !== GITLINK_MODE);
    const held = new Set(yield* treeBlobs(place, worktree));
    if (Option.isSome(head)) for (const oid of yield* treeBlobs(place, head.value)) held.add(oid);
    const onlyHere = indexed.filter(({ oid }) => !held.has(oid));
    const only = [...new Set(onlyHere.map(({ oid }) => oid))].sort();
    // Note that the commit names each blob by its id, so the paths the index gives them are answered beside it.
    const paths = onlyHere.map(({ path }) => path);
    if (only.length === 0) return { commit: Option.none<string>(), paths };
    const tree = (yield* git(place, ["mktree"], {
      input: only.map((oid) => `100644 blob ${oid}\t${oid}\n`).join(""),
    })).trim();
    const commit = yield* commitTree(
      place,
      tree,
      Option.none(),
      "Luke: blobs only the index holds",
    );
    return { commit: Option.some(commit), paths };
  });

/** Whether a path in the work names a harness's credential file or the `gh` sign-in's. */
function credentialPath(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (CREDENTIAL_FILES.NAMES.some((file) => name === file)) return true;
  return CREDENTIAL_FILES.PATHS.some((file) => path === file || path.endsWith(`/${file}`));
}

/**
 * Refuses a bundle whose objects name a credential file at any path: what
 * `git rev-list --objects` walks from the revisions given, which is what the
 * bundle carries, and the paths the index gives the blobs only it holds.
 */
const refuseCredentials = (place: GitPlace, revisions: string, indexPaths: readonly string[]) =>
  Effect.gen(function* () {
    const walked = lines(
      yield* git(place, ["rev-list", "--objects", "--stdin"], { input: revisions }),
    );
    const paths = [...walked.map((line) => line.slice(line.indexOf(" ") + 1)), ...indexPaths];
    const found = paths.find(credentialPath);
    if (found === undefined) return;
    return yield* new StateFailed({
      detail: `the work holds ${found}, a credential file no pack carries; take it out of the repository, and out of every commit no remote holds, for the state to be saved`,
    });
  });

/** Deletes every ref under the state's own prefix, left by a pack that ended before it could. */
const dropStateRefs = (place: GitPlace) =>
  Effect.gen(function* () {
    const names = lines(yield* git(place, ["for-each-ref", "--format=%(refname)", STATE_REFS]));
    if (names.length === 0) return;
    yield* git(place, ["update-ref", "--stdin"], {
      input: names.map((name) => `delete ${name}\n`).join(""),
    });
  });

/** The commits a bundle needs its repository to hold, read off its header. */
const prerequisitesOf = (bundle: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const header = yield* fs.stream(bundle).pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.takeWhile((line) => line !== ""),
      Stream.runCollect,
    );
    return [...header]
      .filter((line) => line.startsWith("-"))
      .map((line) => line.slice(1).split(" ")[0] ?? "");
  }).pipe(
    Effect.mapError(() => new StateFailed({ detail: "the bundle's header could not be read" })),
  );

/** The remote commit holding the most of the prerequisites, the first by ref name among equals; none where none are needed. */
const baseOf = (
  place: GitPlace,
  prerequisites: readonly string[],
  remotes: readonly { readonly oid: string }[],
) =>
  Effect.gen(function* () {
    const first = prerequisites[0];
    if (first === undefined) return null;
    const held = new Map<string, number>();
    for (const prerequisite of prerequisites) {
      const holders = lines(
        yield* git(place, [
          "for-each-ref",
          "--format=%(objectname)",
          `--contains=${prerequisite}`,
          ...REMOTE_REFS,
        ]),
      );
      for (const oid of new Set(holders)) held.set(oid, (held.get(oid) ?? 0) + 1);
    }
    let base = first;
    let most = 0;
    for (const { oid } of remotes) {
      const count = held.get(oid) ?? 0;
      if (count > most) [base, most] = [oid, count];
    }
    return base;
  });

/** Whether a ref stands for a remote's state rather than the agent's own. */
function isRemoteRef(name: string): boolean {
  return REMOTE_REFS.some((prefix) => name.startsWith(prefix));
}

/** The work of a repository: its bundle in `scratch`, and what the manifest records of it. */
const captureRepository = (repository: string, scratch: string) =>
  Effect.gen(function* () {
    const place: GitPlace = { cwd: repository };
    yield* dropStateRefs(place);
    const head = yield* headOf(place);
    const headCommit = yield* commitOf(place, "HEAD");
    const refs = yield* refsOf(place);
    const upstreams = yield* upstreamsOf(place);
    const stashes = yield* stashesOf(place);
    const index = yield* indexPathOf(place);
    const worktree = yield* worktreeCommit(place, index, scratch, headCommit);
    const staged = yield* stagedCommit(place, worktree, headCommit);
    const carried = [
      { name: `${STATE_REFS}worktree`, oid: worktree },
      ...(Option.isSome(staged.commit)
        ? [{ name: `${STATE_REFS}staged`, oid: staged.commit.value }]
        : []),
      ...(Option.isSome(headCommit) ? [{ name: `${STATE_REFS}head`, oid: headCommit.value }] : []),
      ...stashes.map((stash, at) => ({ name: `${STATE_REFS}stash/${at}`, oid: stash.oid })),
    ];
    const remotes = refs.filter(({ name }) => isRemoteRef(name));
    const bundle = join(scratch, "state.bundle");
    yield* Effect.gen(function* () {
      yield* git(place, ["update-ref", "--stdin"], {
        input: carried.map(({ name, oid }) => `create ${name} ${oid}\n`).join(""),
      });
      const wanted = [
        ...refs.filter(({ name }) => !isRemoteRef(name)).map(({ name }) => name),
        ...carried.map(({ name }) => name),
        ...remotes.map(({ oid }) => `^${oid}`),
      ];
      yield* refuseCredentials(place, `${wanted.join("\n")}\n`, staged.paths);
      yield* git(place, ["bundle", "create", "-q", bundle, "--stdin"], {
        input: `${wanted.join("\n")}\n`,
      });
    }).pipe(Effect.ensuring(Effect.ignore(dropStateRefs(place))));
    const prerequisites = yield* prerequisitesOf(bundle);
    const fs = yield* FileSystem.FileSystem;
    const work: Work = {
      kind: WORK_KIND.GIT,
      base: yield* baseOf(place, prerequisites, remotes),
      prerequisites,
      head,
      refs,
      upstreams,
      stashes,
      worktree,
      staged: Option.getOrNull(staged.commit),
    };
    const hasIndex = yield* fs.exists(index).pipe(Effect.orElseSucceed(() => false));
    return { work, files: { bundle, index: hasIndex ? index : undefined } satisfies WorkFiles };
  });

/** The work of a folder with no repository: one commit of its files, less what its `.gitignore` files leave out. */
const captureFolder = (folder: string, scratch: string) =>
  Effect.gen(function* () {
    const place: GitPlace = { cwd: folder, gitDir: join(scratch, "files.git") };
    yield* git(place, ["init", "-q"]);
    const worktree = yield* worktreeCommit(place, undefined, scratch, Option.none());
    const ref = `${STATE_REFS}worktree`;
    yield* git(place, ["update-ref", ref, worktree]);
    yield* refuseCredentials(place, `${ref}\n`, []);
    const bundle = join(scratch, "state.bundle");
    yield* git(place, ["bundle", "create", "-q", bundle, ref]);
    const work: Work = {
      kind: WORK_KIND.FILES,
      base: null,
      prerequisites: [],
      head: null,
      refs: [],
      upstreams: [],
      stashes: [],
      worktree,
      staged: null,
    };
    return { work, files: { bundle, index: undefined } satisfies WorkFiles };
  });

/** The kind of work the folder given holds: a repository, a folder with none, or none where the folder does not exist. */
export const workKindOf = (folder: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = (path: string) => fs.exists(path).pipe(Effect.orElseSucceed(() => false));
    if (!(yield* exists(folder))) return null;
    return (yield* exists(join(folder, ".git"))) ? WORK_KIND.GIT : WORK_KIND.FILES;
  });

/** The work in the folder given, a repository or not, its bundle written into `scratch`; none where the folder does not exist. */
export const captureWork = (folder: string, scratch: string) =>
  Effect.gen(function* () {
    const kind = yield* workKindOf(folder);
    if (kind === null) return Option.none<{ work: Work; files: WorkFiles }>();
    const captured =
      kind === WORK_KIND.GIT
        ? yield* captureRepository(folder, scratch)
        : yield* captureFolder(folder, scratch);
    return Option.some(captured);
  });

/** The ids given that the repository does not hold, asked without fetching any. */
const lacking = (place: GitPlace, oids: readonly string[]) =>
  Effect.gen(function* () {
    if (oids.length === 0) return [];
    const out = yield* git(place, ["cat-file", "--batch-check"], {
      input: `${oids.join("\n")}\n`,
      env: { GIT_NO_LAZY_FETCH: "1" },
    });
    return lines(out)
      .filter((line) => line.endsWith(" missing"))
      .map((line) => line.split(" ")[0] ?? "");
  });

/** Fetches from `origin` every one of the ids the repository lacks; fails where one is still lacking after. */
const fetchLacking = (place: GitPlace, oids: readonly string[]) =>
  Effect.gen(function* () {
    const missing = yield* lacking(place, [...new Set(oids)]);
    if (missing.length === 0) return;
    const origin = yield* runGit(place, ["config", "--get", "remote.origin.url"], { allow: [1] });
    if (origin.code !== 0) {
      return yield* new StateFailed({
        detail: `the repository lacks ${missing.length} commits the state needs, and has no origin to fetch them from`,
      });
    }
    yield* git(place, ["fetch", "-q", "--no-tags", "--no-write-fetch-head", "origin", ...missing]);
    const still = yield* lacking(place, missing);
    if (still.length > 0) {
      return yield* new StateFailed({
        detail: `origin does not hold ${still.length} commits the state needs`,
      });
    }
  });

/** Sets the refs to exactly the manifest's, HEAD, the upstreams and the stash. */
const applyRefs = (place: GitPlace, work: Work) =>
  Effect.gen(function* () {
    const wanted = new Set(work.refs.map(({ name }) => name));
    const stale = (yield* refsOf(place)).filter(({ name }) => !wanted.has(name));
    // Note that the deletes go first and on their own, so a ref deleted never stands in the way of one made beneath its name.
    if (stale.length > 0) {
      yield* git(place, ["update-ref", "--stdin"], {
        input: stale.map(({ name }) => `delete ${name}\n`).join(""),
      });
    }
    if (work.refs.length > 0) {
      yield* git(place, ["update-ref", "--stdin"], {
        input: work.refs.map(({ name, oid }) => `update ${name} ${oid}\n`).join(""),
      });
    }
    if (work.head !== null && "ref" in work.head)
      yield* git(place, ["symbolic-ref", "HEAD", work.head.ref]);
    if (work.head !== null && "oid" in work.head)
      yield* git(place, ["update-ref", "--no-deref", "HEAD", work.head.oid]);
    for (const key of new Set((yield* upstreamsOf(place)).map(({ key }) => key))) {
      yield* git(place, ["config", "--local", "--unset-all", key]);
    }
    for (const { key, value } of work.upstreams)
      yield* git(place, ["config", "--local", "--add", key, value]);
    yield* git(place, ["update-ref", "-d", STASH_REF]);
    for (const stash of [...work.stashes].reverse()) {
      yield* git(place, ["stash", "store", "-m", stash.message, stash.oid]);
    }
  });

/** Writes the folder's files from the worktree's commit through a throwaway index started from the real one, so what that index tracks and the commit lacks goes. */
const writeWorktree = (place: GitPlace, index: string, worktree: string, scratch: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const throwaway = join(scratch, "restore-index");
    if (yield* fs.exists(index)) {
      yield* fs
        .copyFile(index, throwaway)
        .pipe(Effect.mapError(() => new StateFailed({ detail: "the index could not be copied" })));
    }
    yield* git(place, ["read-tree", "--reset", "-u", worktree], {
      env: { GIT_INDEX_FILE: throwaway },
    });
  });

/**
 * Applies the work to the folder given: for a repository, one made at the
 * work's base where it names one, or none, which is made empty; for a folder
 * with none, the folder, made where it is missing. Nothing here moves HEAD
 * but to set it as it was.
 */
export const applyWork = (folder: string, work: Work, files: WorkFiles, scratch: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const failed = (detail: string) => () => new StateFailed({ detail });
    if (work.kind === WORK_KIND.FILES) {
      yield* fs
        .makeDirectory(folder, { recursive: true })
        .pipe(Effect.mapError(failed("the folder could not be made")));
      const place: GitPlace = { cwd: folder, gitDir: join(scratch, "files.git") };
      yield* git(place, ["init", "-q"]);
      yield* git(place, ["bundle", "unbundle", files.bundle]);
      yield* git(place, ["read-tree", "--reset", "-u", work.worktree]);
      return;
    }
    const place: GitPlace = { cwd: folder };
    const made = yield* fs.exists(join(folder, ".git")).pipe(Effect.orElseSucceed(() => false));
    if (!made && work.base !== null) {
      return yield* new StateFailed({
        detail: `the repository was not made; it should hold ${work.base}`,
      });
    }
    if (!made) {
      yield* fs
        .makeDirectory(folder, { recursive: true })
        .pipe(Effect.mapError(failed("the folder could not be made")));
      yield* git(place, ["init", "-q"]);
    }
    if (work.base !== null && (yield* lacking(place, [work.base])).length > 0) {
      return yield* new StateFailed({
        detail: `the repository does not hold the state's base, ${work.base}`,
      });
    }
    yield* fetchLacking(place, work.prerequisites);
    yield* git(place, ["bundle", "unbundle", files.bundle]);
    yield* fetchLacking(place, [
      ...work.refs.map(({ oid }) => oid),
      ...(work.head !== null && "oid" in work.head ? [work.head.oid] : []),
    ]);
    yield* applyRefs(place, work);
    const index = yield* indexPathOf(place);
    yield* writeWorktree(place, index, work.worktree, scratch);
    if (files.index !== undefined) {
      yield* fs
        .copyFile(files.index, index)
        .pipe(Effect.mapError(failed("the index could not be put back")));
    } else {
      yield* fs
        .remove(index, { force: true })
        .pipe(Effect.mapError(failed("the index could not be taken away")));
    }
  });

/** What a repository fetching from the agent's own runs on the agent's side: one that answers a filter and a commit by its id, as GitHub does. */
const OWN_UPLOAD_PACK =
  "git -c uploadpack.allowFilter=true -c uploadpack.allowAnySHA1InWant=true upload-pack";

/**
 * Makes a repository at `target` as a device makes an agent's from the
 * shared clone, for a verify: `origin` the agent's own repository, partial
 * where the agent's is, and checked out at the work's base where it names
 * one, so a restore into it needs what a restore into a fresh one needs.
 */
export const scratchRepository = (source: string, target: string, work: Work) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs
      .makeDirectory(target, { recursive: true })
      .pipe(
        Effect.mapError(
          () => new StateFailed({ detail: "the scratch repository could not be made" }),
        ),
      );
    const place: GitPlace = { cwd: target };
    yield* git(place, ["init", "-q"]);
    yield* git(place, ["remote", "add", "origin", source]);
    yield* git(place, ["config", "remote.origin.uploadpack", OWN_UPLOAD_PACK]);
    const partial = yield* runGit({ cwd: source }, ["config", "--get", "extensions.partialClone"], {
      allow: [1],
    });
    if (partial.code === 0) {
      yield* git(place, ["config", "core.repositoryformatversion", "1"]);
      yield* git(place, ["config", "extensions.partialClone", "origin"]);
      yield* git(place, ["config", "remote.origin.promisor", "true"]);
      yield* git(place, ["config", "remote.origin.partialCloneFilter", "blob:none"]);
    }
    if (work.base === null) return;
    yield* git(place, ["fetch", "-q", "--no-tags", "origin", `+${work.base}:refs/luke/base`]);
    yield* git(place, ["checkout", "-q", "--detach", work.base]);
  });

/** A file as a comparison reads it: its kind, and its executable bit and digest, or a link's target. */
const describe = (path: string) =>
  fileStep("a file could not be read", async () => {
    const info = await lstat(path).catch(() => undefined);
    if (info === undefined) return "missing";
    if (info.isSymbolicLink()) return `link ${await readlink(path)}`;
    if (info.isDirectory()) return "directory";
    if (!info.isFile()) return "other";
    const executable = (info.mode & 0o111) === 0 ? "-" : "x";
    return `${executable} ${createHash("sha256")
      .update(await readFile(path))
      .digest("hex")}`;
  });

/** Each file of the folder's work, as `path` and how it reads: tracked or untracked, less what Git ignores. */
const filesOf = (place: GitPlace, listing: readonly string[]) =>
  Effect.gen(function* () {
    const paths = [...new Set(records(yield* git(place, ["ls-files", "-z", ...listing])))].sort();
    const described: string[] = [];
    for (const path of paths) described.push(`${path} ${yield* describe(join(place.cwd, path))}`);
    return described;
  });

/** The work in the folder given, read back as a comparison compares it. */
export const workSnapshot = (folder: string, kind: Work["kind"], scratch: string) =>
  Effect.gen(function* () {
    if (kind === WORK_KIND.FILES) {
      const place: GitPlace = { cwd: folder, gitDir: join(scratch, "snapshot.git") };
      yield* git(place, ["init", "-q"]);
      const files = yield* filesOf(place, ["--others", "--exclude-standard"]);
      return {
        refs: "",
        head: "",
        stashes: "",
        upstreams: "",
        status: "",
        files,
      } satisfies WorkSnapshot;
    }
    const place: GitPlace = { cwd: folder };
    const head = yield* headOf(place);
    return {
      refs: JSON.stringify(yield* refsOf(place)),
      head: JSON.stringify(head),
      stashes: JSON.stringify(yield* stashesOf(place)),
      upstreams: JSON.stringify(yield* upstreamsOf(place)),
      status: yield* git(place, [
        "status",
        "--porcelain=v2",
        "--branch",
        "-z",
        "--untracked-files=all",
      ]),
      files: yield* filesOf(place, ["--cached", "--others", "--exclude-standard"]),
    } satisfies WorkSnapshot;
  });
