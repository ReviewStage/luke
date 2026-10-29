/**
 * state.ts -- an agent's state between turns, packed into one file and restored from it: its work in its repository, its harness's session files from an allowlist, and its attachments; the runner bundle's `state` command, run inside the agent's VM as its user.
 *
 * A device keeps nothing of an agent between turns but this pack, so what
 * the pack leaves out is lost. It holds the work (`state-work.ts`): a git
 * bundle of what no remote holds, with HEAD, every ref, the stashes and the
 * real index beside it. It holds the session files the harness resumes
 * from, by an allowlist alone (`CARRIED`), and the attachments. And it holds
 * a manifest: the format, the work's base commit and refs, the pinned
 * harnesses' versions, and each part's size and SHA-256. A harness's
 * credential file and the agent's `gh/` sign-in are never packed, wherever
 * they stand (`DENIED`), and neither is a link, which could name a file
 * outside the allowlist.
 *
 * `pack` refuses a state over `STATE_CAP_BYTES`, its parts summed before
 * compression, naming its largest parts, before it writes anything.
 * `verify` restores the pack into a scratch folder under the agent's `tmp/`,
 * its repository made from the agent's own at the pack's base, and fails on
 * any difference from the agent's folder: the refs, HEAD, the stashes, the
 * upstreams, `git status --porcelain=v2`, every file's kind, executable bit
 * and contents, and every carried file. `restore` applies a pack to an
 * agent's folder whose repository was made at the base commit, or which has
 * none where the base is none, and writes nothing until every part has
 * unpacked and matched the manifest.
 *
 * Its output is sizes and digests alone, never a path or a byte of what it
 * carries, since a pack holds the agent's work and conversation, which
 * never enter a trace, a counted event or a fixture.
 */

import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readdir, readFile, rename } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Console, Data, Effect, Option, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";
import type { CLAUDE_CODE_PIN, CODEX_PIN } from "./pins.js";
import { STATE_ACTION, STATE_CAP_BYTES, STATE_EXIT, type StateAction } from "./protocol.js";
import {
  readTar,
  TAR_ENTRY,
  type TarFile,
  type TarRead,
  type TarSource,
  writeTar,
} from "./state-tar.js";
import {
  applyWork,
  captureWork,
  StateFailed,
  scratchRepository,
  WORK_KIND,
  type WorkFiles,
  WorkSchema,
  workSnapshot,
} from "./state-work.js";

/** The pack's format, which a restore refuses any other of. */
const STATE_FORMAT = 1;

/** The folders of an agent's folder the state reads and writes, as a device lays it out (`@luke/features`' `DEVICE_AGENT_FOLDER`). */
const AGENT_FOLDER = { REPOSITORY: "repository", ATTACHMENTS: "attachments", TEMP: "tmp" } as const;

/** Who a carried entry is kept for. */
const CARRIED_FOR = { CLAUDE_CODE: "claude-code", CODEX: "codex", LUKE: "luke" } as const;

/**
 * What of the agent's folder is carried beside its work, by path under the
 * folder, a folder with all it holds or one file, and who it is kept for.
 * Nothing outside these is ever packed. What a harness keeps was found by
 * running the pinned releases (`CARRIED_CHECKED`) against a model of our
 * own from a home holding only these, on Oct 29, 2026:
 *
 * - Claude Code resumes, and cuts a rewind (`resumeSessionAt`), from its
 *   session's transcript under `projects/` alone, and its task tools
 *   (`CLAUDE_CODE_TOOLS.ADDED`) keep each session's list under `tasks/`,
 *   which a resume without it loses. It writes no `todos/` and, under the
 *   SDK with file checkpoints off, no `file-history/`, and needs no
 *   `.claude.json`; `todos/` is carried as the plan named it.
 * - Codex resumes a thread from its rollout files under `sessions/` alone,
 *   rebuilding its state database as it starts, but a `thread/turns/list`
 *   after a revert answers the turns before it only from
 *   `thread_history_1.sqlite`, which the runner's rewind reads
 *   (`codex.ts`' `revertedBefore`). It is carried with its `-wal` and
 *   `-shm` files, read once app-server, the runner's child, has exited.
 */
const CARRIED = [
  { path: "home/.claude/projects", for: CARRIED_FOR.CLAUDE_CODE },
  { path: "home/.claude/tasks", for: CARRIED_FOR.CLAUDE_CODE },
  { path: "home/.claude/todos", for: CARRIED_FOR.CLAUDE_CODE },
  { path: "home/.codex/sessions", for: CARRIED_FOR.CODEX },
  { path: "home/.codex/thread_history_1.sqlite", for: CARRIED_FOR.CODEX },
  { path: "home/.codex/thread_history_1.sqlite-wal", for: CARRIED_FOR.CODEX },
  { path: "home/.codex/thread_history_1.sqlite-shm", for: CARRIED_FOR.CODEX },
  { path: AGENT_FOLDER.ATTACHMENTS, for: CARRIED_FOR.LUKE },
] as const;

/**
 * The releases `CARRIED` was checked against, which must be the pinned
 * ones: a bump of either pin fails the type check here until what a resume
 * of the new release reads has been checked again, rather than a session
 * file it moved being quietly left behind.
 */
const CARRIED_CHECKED = {
  CLAUDE_CODE: "2.1.304",
  CODEX: "0.163.0",
} as const satisfies {
  CLAUDE_CODE: typeof CLAUDE_CODE_PIN.VERSION;
  CODEX: typeof CODEX_PIN.VERSION;
};

/** What is never packed, wherever under the allowlist it stands: a harness's credential file, and a `gh` sign-in. */
const DENIED = {
  FOLDERS: new Set(["gh"]),
  FILES: new Set([".credentials.json", "auth.json"]),
} as const;

/** The pack's own entries, beside the carried folders. */
const PACK_PATH = {
  MANIFEST: "manifest.json",
  BUNDLE: "work/state.bundle",
  INDEX: "work/index",
} as const;

/** What a pack may unpack into past its parts' cap: its manifest, which lists every part. */
const MANIFEST_ALLOWANCE_BYTES = 64_000_000;

/** How many of a refused state's largest parts its words name. */
const LARGEST_NAMED = 3;

/** The groups a pack's parts are summed in for what the command prints. */
const PART_GROUP = { WORK: "work", SESSIONS: "session files", ATTACHMENTS: "attachments" } as const;

type PartGroup = (typeof PART_GROUP)[keyof typeof PART_GROUP];

const PartSchema = Schema.Struct({
  path: Schema.String,
  bytes: Schema.Int,
  sha256: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u)),
});

/** A pack's manifest, its last entry. */
const ManifestSchema = Schema.Struct({
  format: Schema.Literal(STATE_FORMAT),
  /** The harnesses the session files were written by, as this runner pins them. */
  harnesses: Schema.Struct({ claudeCode: Schema.String, codex: Schema.String }),
  /** The allowlist the pack was written under, each entry and who it is kept for, which a verify holds to its own. */
  carried: Schema.Array(Schema.Struct({ path: Schema.String, for: Schema.String })),
  /** The work; none where the agent's folder had no repository folder. */
  work: Schema.NullOr(WorkSchema),
  /** Every file of the pack but the manifest, with its size and SHA-256. */
  parts: Schema.Array(PartSchema),
});

type Manifest = typeof ManifestSchema.Type;

const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(ManifestSchema));

/** The state is over what a pack may hold. */
class StateTooLarge extends Data.TaggedError("StateTooLarge")<{ readonly detail: string }> {}

/** One group of a pack's parts, as the command prints it. */
export interface StateGroup {
  readonly group: PartGroup;
  readonly files: number;
  readonly bytes: number;
}

/** What a pack came to. */
interface StatePacked {
  readonly groups: readonly StateGroup[];
  /** How many entries under the allowlist were left out: credential files, `gh/` folders, links and anything not a file or a folder. */
  readonly leftOut: number;
  readonly bytes: number;
  readonly sha256: string;
}

/** A carried entry found under the agent's folder, by its path there. */
interface CarriedEntries {
  readonly sources: readonly TarSource[];
  readonly leftOut: number;
}

/** A pack unpacked into a staging folder and checked against its manifest. */
interface Unpacked {
  readonly manifest: Manifest;
  readonly staging: string;
  readonly entries: readonly TarRead[];
}

/** A file-system step as an Effect, its failure in words that name the step. */
const fileStep = <A>(step: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) =>
      new StateFailed({
        detail: `${step}: ${error instanceof Error ? error.message : String(error)}`,
      }),
  });

/** Whether `path` is the root given or stands under it. */
function under(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/** The carried root a path stands under; none for one outside the allowlist. */
function carriedRootOf(path: string): string | undefined {
  return CARRIED.find((root) => under(path, root.path))?.path;
}

/** Whether a path names something never packed: a denied folder anywhere along it, or a denied file at its end. */
function denied(path: string, type: (typeof TAR_ENTRY)[keyof typeof TAR_ENTRY]): boolean {
  const parts = path.split("/");
  const folders = type === TAR_ENTRY.DIRECTORY ? parts : parts.slice(0, -1);
  if (folders.some((part) => DENIED.FOLDERS.has(part))) return true;
  return type === TAR_ENTRY.FILE && DENIED.FILES.has(parts.at(-1) ?? "");
}

/** Whether a pack may hold the entry given: its own files, or a carried one that is not denied. */
function packHolds(path: string, type: (typeof TAR_ENTRY)[keyof typeof TAR_ENTRY]): boolean {
  if (path === PACK_PATH.MANIFEST || path === PACK_PATH.BUNDLE || path === PACK_PATH.INDEX) {
    return type === TAR_ENTRY.FILE;
  }
  return carriedRootOf(path) !== undefined && !denied(path, type);
}

/** The group a part is summed in. */
function groupOf(path: string): PartGroup {
  if (path.startsWith("work/")) return PART_GROUP.WORK;
  return under(path, AGENT_FOLDER.ATTACHMENTS) ? PART_GROUP.ATTACHMENTS : PART_GROUP.SESSIONS;
}

/** The parts summed by group, in the groups' order. */
function groupsOf(
  parts: readonly { readonly path: string; readonly bytes: number }[],
): StateGroup[] {
  return Object.values(PART_GROUP).map((group) => {
    const mine = parts.filter((part) => groupOf(part.path) === group);
    return {
      group,
      files: mine.length,
      bytes: mine.reduce((total, part) => total + part.bytes, 0),
    };
  });
}

/** Whether each folder along `relative` under `folder` is a real folder, not a link; none where one is missing. */
async function realFolders(folder: string, relative: string): Promise<boolean | undefined> {
  let at = folder;
  for (const part of relative.split("/")) {
    at = join(at, part);
    const info = await lstat(at).catch(() => undefined);
    if (info === undefined) return undefined;
    if (!info.isDirectory()) return false;
  }
  return true;
}

/**
 * Every carried file and folder under the agent's folder, in name order,
 * each folder before what it holds. A link, anything not a file or a
 * folder, a denied entry, and a carried root reached through a link, are
 * counted and left out.
 */
async function carriedEntries(folder: string): Promise<CarriedEntries> {
  const sources: TarSource[] = [];
  let leftOut = 0;
  const walk = async (relative: string, mode: number): Promise<void> => {
    sources.push({ type: TAR_ENTRY.DIRECTORY, path: relative, mode });
    const children = (await readdir(join(folder, relative), { withFileTypes: true })).sort(
      (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );
    for (const child of children) {
      const path = `${relative}/${child.name}`;
      const type = child.isDirectory()
        ? TAR_ENTRY.DIRECTORY
        : child.isFile()
          ? TAR_ENTRY.FILE
          : undefined;
      if (type === undefined || denied(path, type)) {
        leftOut += 1;
        continue;
      }
      const info = await lstat(join(folder, path));
      if (type === TAR_ENTRY.DIRECTORY) await walk(path, info.mode & 0o777);
      else
        sources.push({
          type,
          path,
          mode: info.mode & 0o777,
          size: info.size,
          from: join(folder, path),
        });
    }
  };
  for (const { path } of CARRIED) {
    const real = await realFolders(folder, dirname(path));
    const info = real === true ? await lstat(join(folder, path)).catch(() => undefined) : undefined;
    if (real === false || (info !== undefined && !info.isDirectory() && !info.isFile()))
      leftOut += 1;
    if (info === undefined) continue;
    if (info.isDirectory()) await walk(path, info.mode & 0o777);
    else if (info.isFile()) {
      sources.push({
        type: TAR_ENTRY.FILE,
        path,
        mode: info.mode & 0o777,
        size: info.size,
        from: join(folder, path),
      });
    }
  }
  return { sources, leftOut };
}

/** Each carried entry under the agent's folder as a comparison reads it: its path, kind, mode, and a file's size and digest. */
async function carriedSnapshot(folder: string): Promise<string[]> {
  const { sources } = await carriedEntries(folder);
  const described: string[] = [];
  for (const source of sources) {
    if (source.type === TAR_ENTRY.DIRECTORY) {
      described.push(`${source.path} directory ${source.mode.toString(8)}`);
      continue;
    }
    const digest = createHash("sha256")
      .update(await readFile(join(folder, source.path)))
      .digest("hex");
    described.push(`${source.path} file ${source.mode.toString(8)} ${source.size} ${digest}`);
  }
  return described;
}

/** A size in megabytes, as the refusal says it. */
function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** Refuses a state whose parts sum past the cap, naming its largest parts: the work, and each folder just under a carried root. */
const refuseOverCap = (parts: readonly { readonly path: string; readonly bytes: number }[]) =>
  Effect.gen(function* () {
    const total = parts.reduce((sum, part) => sum + part.bytes, 0);
    if (total <= STATE_CAP_BYTES) return;
    const sized = new Map<string, number>();
    for (const part of parts) {
      const root = carriedRootOf(part.path);
      const depth = root === undefined ? 0 : root.split("/").length + 1;
      const name =
        root === undefined
          ? "the repository's work"
          : part.path.split("/").slice(0, depth).join("/");
      sized.set(name, (sized.get(name) ?? 0) + part.bytes);
    }
    const largest = [...sized]
      .sort(([, a], [, b]) => b - a)
      .slice(0, LARGEST_NAMED)
      .map(([name, bytes]) => `${name} (${megabytes(bytes)})`);
    return yield* new StateTooLarge({
      detail: `the agent's state holds ${megabytes(total)}, over the ${megabytes(STATE_CAP_BYTES)} a pack may hold. Its largest parts: ${largest.join(", ")}.`,
    });
  });

/** A scratch folder under the agent's own `tmp/`, removed with everything in it as the scope closes. */
const scratchFolder = (folder: string, prefix: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const temp = join(folder, AGENT_FOLDER.TEMP);
    yield* fs.makeDirectory(temp, { recursive: true, mode: 0o700 });
    return yield* fs.makeTempDirectoryScoped({ directory: temp, prefix });
  }).pipe(
    Effect.mapError(
      () => new StateFailed({ detail: "no scratch folder could be made under the agent's tmp/" }),
    ),
  );

/** The work's bundle and index as tar entries, under the pack's own paths. */
const workSources = (files: WorkFiles) =>
  fileStep("the work could not be read", async () => {
    const sources: TarSource[] = [];
    const add = async (path: string, from: string) =>
      sources.push({
        type: TAR_ENTRY.FILE,
        path,
        mode: 0o600,
        size: (await lstat(from)).size,
        from,
      });
    await add(PACK_PATH.BUNDLE, files.bundle);
    if (files.index !== undefined) await add(PACK_PATH.INDEX, files.index);
    return sources;
  });

/** Writes the state of the agent's folder given into `file`, through a `.partial` file beside it, so `file` stands only once whole. */
export const packState = (folder: string, file: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const scratch = yield* scratchFolder(folder, "state-pack-");
      const captured = yield* captureWork(join(folder, AGENT_FOLDER.REPOSITORY), scratch);
      const work = Option.isSome(captured) ? yield* workSources(captured.value.files) : [];
      const carried = yield* fileStep("the session files could not be read", () =>
        carriedEntries(folder),
      );
      const sources = [...work, ...carried.sources];
      yield* refuseOverCap(
        sources
          .flatMap((source) => (source.type === TAR_ENTRY.FILE ? [source] : []))
          .map((source) => ({ path: source.path, bytes: source.size })),
      );
      const manifestOf = (parts: readonly TarFile[]): TarSource => {
        const manifest: Manifest = {
          format: STATE_FORMAT,
          harnesses: { claudeCode: CARRIED_CHECKED.CLAUDE_CODE, codex: CARRIED_CHECKED.CODEX },
          carried: CARRIED.map((entry) => ({ path: entry.path, for: entry.for })),
          work: Option.isSome(captured) ? captured.value.work : null,
          parts,
        };
        const bytes = new TextEncoder().encode(JSON.stringify(manifest));
        return {
          type: TAR_ENTRY.FILE,
          path: PACK_PATH.MANIFEST,
          mode: 0o600,
          size: bytes.length,
          from: bytes,
        };
      };
      const partial = `${file}.partial`;
      const written = yield* fileStep("the pack could not be written", () =>
        writeTar(partial, sources, manifestOf),
      ).pipe(Effect.onError(() => Effect.ignore(fs.remove(partial, { force: true }))));
      yield* fs
        .rename(partial, file)
        .pipe(
          Effect.mapError(() => new StateFailed({ detail: "the pack could not be put in place" })),
        );
      return {
        groups: groupsOf(written.files),
        leftOut: carried.leftOut,
        bytes: written.bytes,
        sha256: written.sha256,
      } satisfies StatePacked;
    }),
  );

/** Unpacks the pack into `staging` and checks every part against the manifest: the same paths, sizes and digests, and no other. */
const unpack = (file: string, staging: string) =>
  Effect.gen(function* () {
    const entries = yield* fileStep("the pack could not be read", () =>
      readTar(file, staging, packHolds, STATE_CAP_BYTES + MANIFEST_ALLOWANCE_BYTES),
    );
    if (!entries.some((entry) => entry.path === PACK_PATH.MANIFEST)) {
      return yield* new StateFailed({ detail: "the pack holds no manifest" });
    }
    const text = yield* fileStep("the manifest could not be read", () =>
      readFile(join(staging, PACK_PATH.MANIFEST), "utf8"),
    );
    const manifest = yield* decodeManifest(text).pipe(
      Effect.mapError(
        () =>
          new StateFailed({
            detail: `the pack's manifest is not format ${STATE_FORMAT}, which this runner reads`,
          }),
      ),
    );
    const listed = (parts: readonly TarFile[]) =>
      JSON.stringify(parts.map(({ path, bytes, sha256 }) => [path, bytes, sha256]).sort());
    const files = entries.flatMap((entry) =>
      entry.file === undefined || entry.path === PACK_PATH.MANIFEST ? [] : [entry.file],
    );
    if (listed(files) !== listed(manifest.parts)) {
      return yield* new StateFailed({ detail: "the pack's parts do not match its manifest" });
    }
    const bundled = files.some((part) => part.path === PACK_PATH.BUNDLE);
    if (bundled !== (manifest.work !== null)) {
      return yield* new StateFailed({ detail: "the pack's work does not match its manifest" });
    }
    return { manifest, staging, entries } satisfies Unpacked;
  });

/** Makes each folder along `relative` under `folder` where it is missing, and refuses one that is a link or not a folder, so nothing is written through a link. */
async function ensureFolder(folder: string, relative: string): Promise<void> {
  let at = folder;
  for (const part of relative.split("/")) {
    at = join(at, part);
    const info = await lstat(at).catch(() => undefined);
    if (info === undefined) await mkdir(at, { mode: 0o700 });
    else if (!info.isDirectory())
      throw new Error("a folder of the state's is not a folder in the agent's");
  }
}

/** Moves the carried files out of the staging folder into the agent's, then sets each carried folder's mode, deepest first. */
const placeCarried = (folder: string, unpacked: Unpacked) =>
  fileStep("the session files could not be restored", async () => {
    const carried = unpacked.entries.filter((entry) => carriedRootOf(entry.path) !== undefined);
    for (const entry of carried) {
      if (entry.type === TAR_ENTRY.DIRECTORY) {
        await ensureFolder(folder, entry.path);
        continue;
      }
      await ensureFolder(folder, dirname(entry.path));
      await rename(join(unpacked.staging, entry.path), join(folder, entry.path));
    }
    const folders = carried.filter((entry) => entry.type === TAR_ENTRY.DIRECTORY).reverse();
    for (const entry of folders) await chmod(join(folder, entry.path), entry.mode);
  });

/** Applies an unpacked pack to the agent's folder: its work, then its carried files. */
const applyUnpacked = (folder: string, unpacked: Unpacked, scratch: string) =>
  Effect.gen(function* () {
    const { work } = unpacked.manifest;
    if (work !== null) {
      const index = unpacked.entries.some((entry) => entry.path === PACK_PATH.INDEX);
      const files: WorkFiles = {
        bundle: join(unpacked.staging, PACK_PATH.BUNDLE),
        index: index ? join(unpacked.staging, PACK_PATH.INDEX) : undefined,
      };
      yield* applyWork(join(folder, AGENT_FOLDER.REPOSITORY), work, files, scratch);
    }
    yield* placeCarried(folder, unpacked);
  });

/** Restores the pack in `file` into the agent's folder given, whose repository was made at the pack's base commit. */
export const restoreState = (folder: string, file: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const scratch = yield* scratchFolder(folder, "state-restore-");
      const unpacked = yield* unpack(file, join(scratch, "pack"));
      yield* applyUnpacked(folder, unpacked, scratch);
      return groupsOf(unpacked.manifest.parts);
    }),
  );

/** The first of the snapshots' fields that differ, by the words that name it; none where they read the same. */
function firstDifference(
  agent: Readonly<Record<string, unknown>>,
  restored: Readonly<Record<string, unknown>>,
  names: Readonly<Record<string, string>>,
): string | undefined {
  const differing = Object.keys(names).find(
    (key) => JSON.stringify(agent[key]) !== JSON.stringify(restored[key]),
  );
  return differing === undefined ? undefined : names[differing];
}

/** What each field of a work's snapshot is called where it differs. */
const SNAPSHOT_NAMES = {
  refs: "its refs",
  head: "its HEAD",
  stashes: "its stashes",
  upstreams: "its branches' upstreams",
  status: "its git status",
  files: "its files",
} as const;

/** Restores the pack in `file` into a scratch folder and compares it with the agent's folder given; fails on any difference. */
export const verifyState = (folder: string, file: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const scratch = yield* scratchFolder(folder, "state-verify-");
      const unpacked = yield* unpack(file, join(scratch, "pack"));
      if (JSON.stringify(unpacked.manifest.carried) !== JSON.stringify(CARRIED)) {
        return yield* new StateFailed({
          detail: "the pack was written under another allowlist than this runner's",
        });
      }
      const restored = join(scratch, "agent");
      const { work } = unpacked.manifest;
      const repository = join(folder, AGENT_FOLDER.REPOSITORY);
      if (work !== null && work.kind === WORK_KIND.GIT) {
        yield* scratchRepository(repository, join(restored, AGENT_FOLDER.REPOSITORY), work);
      }
      yield* applyUnpacked(restored, unpacked, scratch);
      if (work !== null) {
        const made = (name: string) =>
          fs.makeDirectory(join(scratch, name)).pipe(
            Effect.mapError(() => new StateFailed({ detail: "no scratch folder could be made" })),
            Effect.as(join(scratch, name)),
          );
        const agent = yield* workSnapshot(repository, work.kind, yield* made("agent-snapshot"));
        const back = yield* workSnapshot(
          join(restored, AGENT_FOLDER.REPOSITORY),
          work.kind,
          yield* made("restored-snapshot"),
        );
        const differs = firstDifference(agent, back, SNAPSHOT_NAMES);
        if (differs !== undefined) {
          return yield* new StateFailed({
            detail: `the pack does not restore the agent's repository: ${differs} differ`,
          });
        }
      }
      const carried = yield* fileStep(
        "the session files could not be compared",
        async () =>
          JSON.stringify(await carriedSnapshot(folder)) ===
          JSON.stringify(await carriedSnapshot(restored)),
      );
      if (!carried) {
        return yield* new StateFailed({
          detail: "the pack does not restore the agent's session files and attachments",
        });
      }
      return groupsOf(unpacked.manifest.parts);
    }),
  );

/** One printed line per group of parts. */
const printGroups = (action: StateAction, groups: readonly StateGroup[]) =>
  Effect.forEach(groups, ({ group, files, bytes }) =>
    Console.log(`agent-runner state ${action}: ${group}: ${files} files, ${bytes} bytes`),
  );

/** The usage line the command answers a command line it does not take with. */
const USAGE = `usage: agent-runner state ${Object.values(STATE_ACTION).join("|")} <agent folder> <pack file>`;

/**
 * The runner's `state` command: the action and its two paths, the agent's
 * folder and the pack file, run, and the process's exit code answered
 * (`STATE_EXIT`). Sizes and digests go to stdout, why it failed to stderr.
 */
export const stateCommand = (args: readonly string[]) =>
  Effect.gen(function* () {
    const [action, folder, file, ...rest] = args;
    const actions: readonly string[] = Object.values(STATE_ACTION);
    if (
      action === undefined ||
      !actions.includes(action) ||
      folder === undefined ||
      file === undefined ||
      rest.length > 0
    ) {
      yield* Console.error(USAGE);
      return STATE_EXIT.USAGE;
    }
    const named = action as StateAction;
    const [agentFolder, packFile] = [resolve(folder), resolve(file)];
    if (named === STATE_ACTION.PACK) {
      const packed = yield* packState(agentFolder, packFile);
      yield* printGroups(named, packed.groups);
      yield* Console.log(`agent-runner state pack: left out ${packed.leftOut} entries`);
      yield* Console.log(
        `agent-runner state pack: wrote ${packed.bytes} bytes, sha256 ${packed.sha256}`,
      );
    } else {
      const groups = yield* (named === STATE_ACTION.VERIFY ? verifyState : restoreState)(
        agentFolder,
        packFile,
      );
      yield* printGroups(named, groups);
      yield* Console.log(`agent-runner state ${named}: done`);
    }
    return STATE_EXIT.DONE;
  }).pipe(
    Effect.catchTags({
      StateTooLarge: (refusal) =>
        Effect.as(Console.error(`agent-runner state: ${refusal.detail}`), STATE_EXIT.TOO_LARGE),
      StateFailed: (failure) =>
        Effect.as(Console.error(`agent-runner state: ${failure.detail}`), STATE_EXIT.FAILED),
    }),
    Effect.catch(() => Effect.as(Console.error("agent-runner state: failed"), STATE_EXIT.FAILED)),
  );
