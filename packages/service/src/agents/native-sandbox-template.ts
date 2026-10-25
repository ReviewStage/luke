/**
 * native-sandbox-template.ts -- Luke's own template of the coding agent's image, which a native harness's sandbox opens from: found, built once, snapshotted, and swept.
 *
 * eve prepares the coding agent's image into a snapshot of its own and hands
 * no code of Luke's its id, so a sandbox Luke opens itself for Claude Code or
 * Codex opens from a template Luke prepares from the same preparation
 * (`agent-runtime/sandbox-image.ts`'s `prepareImage`) on eve's own base
 * image, as eve's template is. The preparation is recorded rather than run:
 * `prepareImage` is handed a session that keeps the files it writes and the
 * commands it runs, and the template's key is the digest of all of it with
 * the base image. So the key moves whenever `PREPARE_SCRIPT`, a pin in it,
 * `prepareImage`, eve's tooling, or eve's image does, and is the same in
 * every bundle that computes it, which a digest of a function's source would
 * not be.
 *
 * The template is a persistent sandbox named for its key, and its name is
 * the lock: of launches that find no template at once, Vercel lets one
 * create it and refuses the rest with a 409, which wait for it. The one that
 * created it uploads the recorded preparation and starts it as a detached
 * command, so no function waits out a build that takes minutes; the
 * command's id is kept in the template's tags. Whoever reads the template
 * after that command exited 0 marks it built in a tag, then snapshots it;
 * a template marked built, stopped, and holding a snapshot is ready, and
 * that snapshot is the one a launch opens from. The mark is what tells a
 * whole image apart, because a persistent sandbox also snapshots itself as
 * it stops, a half-built one included, and only a reader that saw the build
 * end well writes it. A snapshot stops the session it is taken of, so of
 * readers racing to take it Vercel takes the first and refuses the rest,
 * and a mark one of them writes over another's changes nothing. A preparation that failed is stopped and marked, and answers
 * failed until a retry window passes, when it is deleted and built again; a
 * template its builder left behind unstarted, or stopped unready, is
 * deleted and built again at once.
 *
 * The scheduled sweep reads the template too, so a build finishes and is
 * snapshotted whether or not a launch is waiting on it, and a new image's
 * template is built within a minute of its deploy rather than on its first
 * launch. It also deletes the templates of every other key, once
 * they are old enough that a Preview of another image is done with its own.
 */

import { createHash } from "node:crypto";
import { Clock, Data, Duration, Effect, Result } from "effect";
import type { SandboxSession } from "eve/sandbox";
import { prepareImage } from "./agent-runtime/sandbox-image.js";
import { CODER } from "./coder-host/bounds.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "./repository-sandbox-contract.js";
import {
  deploymentOidcToken,
  type ListedSandbox,
  SANDBOX_STATUS,
  SandboxUnavailable,
  type VercelSandboxApi,
  vercelSandboxApi,
} from "./vercel-sandbox-api.js";

/**
 * The image eve's own template starts from (eve 0.74.0's
 * `resolveVercelEveSandboxImage`), which this one starts from too; it moves
 * with eve's pin, and a test holds it to the installed eve.
 */
export const EVE_BASE_IMAGE = "vcr.vercel.com/vercel/eve/base:0.74.0";

export const NATIVE_TEMPLATE = {
  /** Every template's name starts with this, its key after it. */
  NAME_PREFIX: "luke-native-template-",
  /** How long a template's sandbox may run: a build is minutes, and one cut off is built again. */
  BUILD_TIMEOUT: Duration.minutes(45),
  /** How long a template may stand created with no build started before its builder is taken for gone. */
  START_GRACE: Duration.minutes(5),
  /** How long a failed preparation answers failed before it is built again. */
  RETRY_AFTER: Duration.minutes(30),
  /**
   * How long a launch waiting on a template with no build of its own to wait
   * on, one another launch is still uploading or one being snapshotted, waits
   * before it reads the template again; a running build is waited on to its
   * exit instead.
   */
  POLL: Duration.seconds(10),
  /** How long a launch waits on a build before it answers that the image is still being prepared. */
  WAIT: Duration.minutes(3),
  /** How old another key's template must be before the sweep deletes it, so a Preview's lasts its testing. */
  SWEEP_AFTER: Duration.days(1),
  /** How often the sweep asks Vercel whether a ready template's snapshot still stands. */
  SNAPSHOT_CHECK: Duration.minutes(10),
  /** How often the sweep runs (`MAINTENANCE_SWEEP.CRONTAB`): the window of each `SNAPSHOT_CHECK` one sweep falls in. */
  SWEEP_PERIOD: Duration.minutes(1),
} as const;

/** The template's tags beside its key: where its build runs, and how the build ended. */
const TEMPLATE_TAG = {
  KEY: "lukeTemplate",
  SESSION: "lukeTemplateSession",
  BUILD: "lukeTemplateBuild",
  /** Set, to the instant, once a reader found the build ended well, before it snapshots it. */
  BUILT: "lukeTemplateBuilt",
  FAILED_AT: "lukeTemplateFailedAt",
} as const;

/** Where the recorded preparation is uploaded and run from: the default user's own `/tmp`. */
const BUILD_DIRECTORY = "/tmp/luke-template";

/** Where eve's session resolves a relative path, as its template's preparation saw it. */
const WORKSPACE = REPOSITORY_SANDBOX_CONTRACT.PATH.WORKSPACE;

/**
 * What eve's base setup does before it prepares a template: the workspace
 * made, here owned by the default user, who writes the checkout into it.
 */
const BASE_SETUP = [
  `if ! mkdir -p ${WORKSPACE} 2>/dev/null || [ ! -w ${WORKSPACE} ]; then`,
  `  sudo -n install -d -o "$(id -u)" -g "$(id -g)" ${WORKSPACE}`,
  "fi",
].join("\n");

export const TEMPLATE_STATE = {
  READY: "ready",
  PREPARING: "preparing",
  FAILED: "failed",
} as const;

/** The build command a template being prepared runs, which a launch waiting on it waits on to its exit. */
interface RunningBuild {
  readonly session: string;
  readonly commandId: string;
}

type TemplateState =
  | { readonly state: typeof TEMPLATE_STATE.READY; readonly snapshotId: string }
  | { readonly state: typeof TEMPLATE_STATE.PREPARING; readonly building?: RunningBuild }
  | { readonly state: typeof TEMPLATE_STATE.FAILED };

const PREPARING: TemplateState = { state: TEMPLATE_STATE.PREPARING };
const FAILED: TemplateState = { state: TEMPLATE_STATE.FAILED };

/** The preparation as recorded: the template's key, its name, and the files that run it. */
export interface ImageBuild {
  readonly key: string;
  readonly name: string;
  readonly files: readonly { readonly path: string; readonly contents: Uint8Array }[];
  /** The script that runs the preparation, whose path the files hold. */
  readonly entry: string;
}

/** `prepareImage` threw while it was being recorded, which a recording that answers every command as passed never makes it do. */
class ImageBuildUnrecorded extends Data.TaggedError("ImageBuildUnrecorded") {}

/** The template's state where it is ready, preparing, or failed, or Vercel could not be asked. */
type TemplateRead = Effect.Effect<TemplateState, SandboxUnavailable>;

/** `prepareImage` run against a session that keeps what it is asked to do, and the files that do it again in a sandbox. */
export const recordImageBuild = Effect.fn("web/recordImageBuild")(function* () {
  const writes: { path: string; content: string }[] = [];
  const commands: string[] = [];
  const resolvePath = (path: string) => (path.startsWith("/") ? path : `${WORKSPACE}/${path}`);
  const recording: Pick<SandboxSession, "resolvePath" | "writeTextFile" | "run"> = {
    resolvePath,
    writeTextFile: async (options) => {
      writes.push({ path: resolvePath(options.path), content: String(options.content) });
    },
    run: async (options) => {
      commands.push(options.command);
      return { exitCode: 0, stdout: "", stderr: "" } as Awaited<ReturnType<SandboxSession["run"]>>;
    },
  };
  yield* Effect.tryPromise({
    // SAFETY: `prepareImage` and the code tooling it installs call only `resolvePath`,
    // `writeTextFile` and `run` (eve 0.74.0's `installCodeTooling`), as `tools/codex-probe` relies on too.
    try: () => prepareImage(recording as SandboxSession),
    catch: () => new ImageBuildUnrecorded(),
  });
  const files = writes.map((write, index) => ({
    path: `${BUILD_DIRECTORY}/file-${index}`,
    contents: Buffer.from(write.content, "utf8"),
  }));
  const steps = commands.map((command, index) => ({
    path: `${BUILD_DIRECTORY}/step-${index}.sh`,
    contents: Buffer.from(command, "utf8"),
  }));
  // Each file is put where the preparation wrote it, then each command runs in order, as `prepareImage` ran them.
  const entry = [
    "set -e",
    BASE_SETUP,
    ...writes.map(
      (write, index) =>
        `mkdir -p "$(dirname '${write.path}')" && cp ${BUILD_DIRECTORY}/file-${index} '${write.path}'`,
    ),
    ...steps.map((step) => `bash ${step.path}`),
  ].join("\n");
  const digest = createHash("sha256").update(EVE_BASE_IMAGE).update("\0");
  for (const write of writes)
    digest.update(write.path).update("\0").update(write.content).update("\0");
  for (const command of commands) digest.update(command).update("\0");
  // The entry is how they are replayed, so a change to the replay moves the key too.
  digest.update(entry).update("\0");
  const key = digest.digest("hex").slice(0, 16);
  const entryFile = { path: `${BUILD_DIRECTORY}/build.sh`, contents: Buffer.from(entry, "utf8") };
  return {
    key,
    name: `${NATIVE_TEMPLATE.NAME_PREFIX}${key}`,
    files: [...files, ...steps, entryFile],
    entry: entryFile.path,
  } satisfies ImageBuild;
});

/** The template created and its build started; a name another launch took first is that launch's build. */
const startBuild = (api: VercelSandboxApi, build: ImageBuild): TemplateRead =>
  Effect.gen(function* () {
    const created = yield* api
      .createFromImage({
        name: build.name,
        image: EVE_BASE_IMAGE,
        tags: { [TEMPLATE_TAG.KEY]: build.key },
        timeoutMs: Duration.toMillis(NATIVE_TEMPLATE.BUILD_TIMEOUT),
        vcpus: CODER.SANDBOX_VCPUS,
      })
      .pipe(
        Effect.map((sandbox): ListedSandbox | undefined => sandbox),
        Effect.catchIf(
          (failure) => failure.status === CONFLICT_STATUS,
          () => Effect.succeed(undefined),
        ),
      );
    if (created === undefined) return PREPARING;
    const building = yield* Effect.gen(function* () {
      const running = created.currentSessionId;
      if (running === undefined) return yield* new SandboxUnavailable({});
      yield* api.writeFiles(
        running,
        build.files.map((file) => ({ ...file, mode: 0o644 })),
      );
      const commandId = yield* api.start(running, {
        command: "bash",
        args: [build.entry],
        sudo: false,
      });
      yield* api.updateTags(build.name, {
        [TEMPLATE_TAG.KEY]: build.key,
        [TEMPLATE_TAG.SESSION]: running,
        [TEMPLATE_TAG.BUILD]: commandId,
      });
      yield* Effect.logInfo(`the native agents' image ${build.key} is being prepared`);
      return { session: running, commandId } satisfies RunningBuild;
    }).pipe(Effect.tapError(() => Effect.ignore(api.deleteSandbox(build.name))));
    return { state: TEMPLATE_STATE.PREPARING, building } as const;
  });

/** Vercel's refusal of a name already taken. */
const CONFLICT_STATUS = 409;

/**
 * The template deleted, and built again from nothing: only the one read as
 * left behind, read again just before, so a reader that read it too finds
 * the one another reader built in its place and leaves it be.
 */
const rebuild = (api: VercelSandboxApi, build: ImageBuild, stale: ListedSandbox): TemplateRead =>
  Effect.gen(function* () {
    const now = yield* api.getNamed(build.name);
    if (now === undefined) return yield* startBuild(api, build);
    if (now.createdAt !== stale.createdAt || now.currentSessionId !== stale.currentSessionId) {
      return PREPARING;
    }
    yield* api.deleteSandbox(build.name);
    return yield* startBuild(api, build);
  });

/** Whether the instant the tag holds is longer ago than the bound. */
function olderThan(now: number, at: number | undefined, bound: Duration.Duration): boolean {
  return at !== undefined && Number.isFinite(at) && now - at >= Duration.toMillis(bound);
}

/**
 * The template read once and moved on as far as one read moves it: built
 * where there is none, snapshotted where its build ended well, marked where
 * it ended badly, and built again where it was left behind.
 */
export const advanceTemplate = (api: VercelSandboxApi, build: ImageBuild): TemplateRead =>
  Effect.gen(function* () {
    const found = yield* api.getNamed(build.name);
    if (found === undefined) return yield* startBuild(api, build);
    const tags = found.tags ?? {};
    const built = tags[TEMPLATE_TAG.BUILT] !== undefined;
    // Any snapshot taken once the build ended well holds the whole image, and a stopped
    // template's current snapshot is the last one taken.
    if (built && found.status === SANDBOX_STATUS.STOPPED && found.currentSnapshotId !== undefined) {
      return { state: TEMPLATE_STATE.READY, snapshotId: found.currentSnapshotId } as const;
    }
    const now = yield* Clock.currentTimeMillis;
    const failedAt = tags[TEMPLATE_TAG.FAILED_AT];
    if (failedAt !== undefined) {
      return olderThan(now, Number(failedAt), NATIVE_TEMPLATE.RETRY_AFTER)
        ? yield* rebuild(api, build, found)
        : FAILED;
    }
    const session = tags[TEMPLATE_TAG.SESSION];
    const commandId = tags[TEMPLATE_TAG.BUILD];
    const running = found.status === SANDBOX_STATUS.RUNNING && found.currentSessionId === session;
    if (session === undefined || commandId === undefined) {
      // Its builder is still uploading, or never got as far as starting the build.
      return found.status === SANDBOX_STATUS.RUNNING &&
        !olderThan(now, found.createdAt, NATIVE_TEMPLATE.START_GRACE)
        ? PREPARING
        : yield* rebuild(api, build, found);
    }
    if (!running) {
      // A snapshot under way stops the session; anything else stopped unready was left behind.
      return found.status === SANDBOX_STATUS.SNAPSHOTTING ||
        found.status === SANDBOX_STATUS.STOPPING
        ? PREPARING
        : yield* rebuild(api, build, found);
    }
    const exit = yield* api.commandExit(session, commandId);
    if (exit === null) {
      return { state: TEMPLATE_STATE.PREPARING, building: { session, commandId } } as const;
    }
    if (exit !== 0) {
      yield* Effect.logWarning(
        `the native agents' image ${build.key} failed to prepare (exit ${exit})`,
      );
      yield* api.updateTags(build.name, { ...tags, [TEMPLATE_TAG.FAILED_AT]: String(now) });
      yield* Effect.ignore(api.stopSession(session));
      return FAILED;
    }
    // The mark goes up before the snapshot, so the snapshot it leaves is known for a whole image
    // and one Vercel took of a sandbox it stopped mid-build never is. Of readers racing here,
    // Vercel snapshots for the first and refuses the rest, which read on and find it ready.
    yield* api.updateTags(build.name, { ...tags, [TEMPLATE_TAG.BUILT]: String(now) });
    const taken = yield* Effect.result(api.snapshot(session, Duration.infinity));
    if (Result.isFailure(taken)) return PREPARING;
    yield* Effect.logInfo(`the native agents' image ${build.key} is ready`);
    return { state: TEMPLATE_STATE.READY, snapshotId: taken.success } as const;
  });

/**
 * The template built again because the snapshot it answered is gone: only
 * where it still holds that snapshot, so a reader that finds one another
 * reader built since moves that one on instead.
 */
export const forgetSnapshot = (
  api: VercelSandboxApi,
  build: ImageBuild,
  snapshotId: string,
): TemplateRead =>
  Effect.gen(function* () {
    const found = yield* api.getNamed(build.name);
    if (found?.currentSnapshotId !== snapshotId) return yield* advanceTemplate(api, build);
    yield* Effect.logWarning(
      `the native agents' image ${build.key} lost its snapshot, so it is prepared again`,
    );
    return yield* rebuild(api, build, found);
  });

/** Whether this sweep is the one of its `SNAPSHOT_CHECK` window that asks after the snapshot. */
function checksSnapshot(now: number): boolean {
  return (
    now % Duration.toMillis(NATIVE_TEMPLATE.SNAPSHOT_CHECK) <
    Duration.toMillis(NATIVE_TEMPLATE.SWEEP_PERIOD)
  );
}

/** The current template moved on, and, where it is ready and this sweep checks, built again if its snapshot is gone. */
const sweepCurrent = (api: VercelSandboxApi, build: ImageBuild): TemplateRead =>
  Effect.gen(function* () {
    const read = yield* advanceTemplate(api, build);
    if (read.state !== TEMPLATE_STATE.READY || !checksSnapshot(yield* Clock.currentTimeMillis)) {
      return read;
    }
    return (yield* api.snapshotExists(read.snapshotId))
      ? read
      : yield* forgetSnapshot(api, build, read.snapshotId);
  });

/**
 * Whether a launch waiting on a template being prepared until `until` reads
 * it again, once it has waited for what would change it: its build's exit,
 * where the read named a running build, or `POLL` where it named none. Note
 * that a read of the exit Vercel answers early with none, which a waiting
 * read never does unless something between cut it short, waits out `POLL`,
 * because reading again at once would ask Vercel in a loop.
 */
const settled = (
  api: VercelSandboxApi,
  read: TemplateState,
  until: number,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const left = until - (yield* Clock.currentTimeMillis);
    if (read.state !== TEMPLATE_STATE.PREPARING || left <= 0) return false;
    const pause = Effect.sleep(Duration.min(NATIVE_TEMPLATE.POLL, Duration.millis(left)));
    if (read.building === undefined) {
      yield* pause;
      return true;
    }
    const exit = yield* api
      .commandExit(read.building.session, read.building.commandId, Duration.millis(left))
      .pipe(Effect.orElseSucceed(() => null));
    if (exit === null && (yield* Clock.currentTimeMillis) < until) yield* pause;
    return true;
  });

/**
 * The template as a launch waits on it: read again each time its build
 * exits or, with no build of its own to wait on, every `POLL`, while it is
 * being prepared, for at most `wait` (`WAIT` unless the caller names less),
 * and answered as it then stands.
 */
export const awaitTemplate = (
  api: VercelSandboxApi,
  build: ImageBuild,
  wait: Duration.Duration = NATIVE_TEMPLATE.WAIT,
): TemplateRead =>
  Effect.gen(function* () {
    const until = (yield* Clock.currentTimeMillis) + Duration.toMillis(wait);
    return yield* Effect.repeat(advanceTemplate(api, build), {
      while: (read) => settled(api, read, until),
    });
  });

/** What one sweep of the templates came to: the current one's state where it was read, and how many others went. */
export interface TemplateSweepOutcome {
  readonly current: TemplateState["state"] | "unread";
  readonly deleted: number;
  /** The current image's template, by name, which the launches look for too; none where it was not read. */
  readonly template?: string;
  /** How many templates Vercel listed, the current one's among them. */
  readonly listed?: number;
}

/**
 * The sweep's turn at the templates: the current one moved on, built where
 * it is missing, its snapshot checked every `SNAPSHOT_CHECK`,
 * and every other key's deleted once it is old enough, with the snapshots
 * only it kept.
 */
export const sweepTemplates = (
  api: VercelSandboxApi,
  build: ImageBuild,
): Effect.Effect<TemplateSweepOutcome, SandboxUnavailable> =>
  Effect.gen(function* () {
    const current = (yield* sweepCurrent(api, build)).state;
    const now = yield* Clock.currentTimeMillis;
    const listed = yield* api.listNamed(NATIVE_TEMPLATE.NAME_PREFIX);
    let deleted = 0;
    for (const sandbox of listed) {
      if (sandbox.name === build.name || !sandbox.name.startsWith(NATIVE_TEMPLATE.NAME_PREFIX))
        continue;
      if (!olderThan(now, sandbox.createdAt, NATIVE_TEMPLATE.SWEEP_AFTER)) continue;
      yield* api.deleteSandbox(sandbox.name);
      deleted += 1;
    }
    return { current, deleted, template: build.name, listed: listed.length };
  });

/**
 * The scheduled sweep's turn, over the deployment's own credentials: a
 * Vercel that could not be asked is logged by its status alone and left for
 * the next minute's sweep.
 */
export const sweepNativeTemplates = Effect.fn("web/sweepNativeTemplates")(function* () {
  const api = yield* vercelSandboxApi(deploymentOidcToken);
  const build = yield* Effect.orDie(recordImageBuild());
  const swept: TemplateSweepOutcome = yield* sweepTemplates(api, build).pipe(
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(`the native agents' templates were not swept: ${failure.message}`),
        { current: "unread", deleted: 0 } satisfies TemplateSweepOutcome,
      ),
    ),
  );
  // Note that the sweep says which template it moved on, so one a launch looks for under another
  // name, or older ones never deleted, show in the log rather than only in Vercel's list.
  yield* Effect.logInfo(
    `the native agents' template ${build.name} is ${swept.current}; ${swept.deleted} older deleted of ${swept.listed ?? 0} listed`,
  );
  return swept;
});
