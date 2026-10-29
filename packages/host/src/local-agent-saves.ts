import {
  STATE_ACTION,
  STATE_COMMAND,
  STATE_EXIT,
  STATE_FAILED_LEAD,
  STATE_PACK_BASE,
  type StateAction,
} from "@luke/agent-runner/protocol";
import {
  DEVICE_AGENT_STATE_REFUSAL,
  type DeviceAgentStateRefused,
  type HostedDeviceAgentClient,
} from "@luke/features";
import type {
  DeviceAgentLaunchState,
  DeviceAgentLayout,
  DeviceAgentStateSaveAnswer,
} from "@luke/features/device-agent-wire";
import { Clock, Duration, Effect, Exit, Option, Path, Result, Semaphore, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";
import { LocalAgentPlatform } from "./effect/seams.js";
import {
  type AgentSave,
  type LocalAgentState,
  type PendingSave,
  UNSAVED_WHY_CHARACTERS,
} from "./local-agent-state.js";

/**
 * local-agent-saves.ts -- each local agent's state saved as its turn ends: packed and verified in its VM, sealed on the device under the agent's key once the VM is gone, uploaded straight to Luke's store and committed as the agent's next generation; a bundle that could not be committed kept in the device's state and tried again on the beat; and a saved generation restored into a folder the device holds none of.
 *
 * A runner's end (`compose-local-agents.ts`'s `turnLetGo`) runs the
 * runner bundle's `state pack` and then `state verify` in the agent's VM,
 * as the agent's user, every process of the agent's there asked to end
 * first, so nothing writes the folder while it is read; the pack lands in
 * the agent's `tmp/` and prints its work's base (`STATE_PACK_BASE`). The VM
 * is deleted next, with the GitHub token kept for it, and only then does
 * the device read the pack, since nothing of the agent's runs once it is
 * gone: it is sealed with AES-256-GCM under the agent's state key
 * (`LocalAgentPlatformSeam.stateSealed`) into a bundle in the device's own
 * state (`BUNDLES_FOLDER`), outside every folder a VM mounts. The key comes
 * from the service with each save, or with a launch of an agent that has
 * saved state, and is held in memory alone. The device asks the service
 * for a save from the generation the agent's folder stands at, PUTs the
 * bundle to the one upload it was granted, and commits it; the generation
 * kept is recorded (`local-agent-state.ts`' `AgentSave`), and the next save
 * starts from it. A launch naming a newer generation than the record, as
 * one queued after a save landed, moves the record up, and one naming none,
 * the agent's last save having expired, lets the record go; so does a save
 * refused as stale, so the next launch's names the newest.
 *
 * Whatever fails, the folder stays, and the agent is recorded as unsaved,
 * which keeps its folder from any sweep until a save commits. A pack or a
 * verify that fails, a pack over its cap among them, or a pack the device
 * refuses to seal, is said in the agent's record in plain words
 * (`AgentSave.unsaved.why`), which its next launch reads and clears, and
 * in the device's report; nothing is kept to try again, since the VM that
 * could pack again is gone, and the agent's next turn saves afresh. A
 * bundle sealed but not committed, the service unreachable, the upload or
 * the commit failing, waits in the device's state, its path and whether
 * its upload landed recorded beside it, and each beat tries the agents'
 * bundles that are due (`RETRY`), one at a time per agent, until one
 * commits or the service refuses it as stale, when a newer save stands;
 * the next turn's bundle supersedes it. A bundle no record names, as a run
 * whose record could not be written leaves one, is let go of as the gate
 * next opens, and its agent recorded as unsaved, so no sweep takes its
 * folder for saved.
 *
 * A launch that finds none of the agent's work on the device, and names a
 * generation Luke holds, restores it (`compose-local-agents.ts`' `launched`):
 * the restore is recorded as begun (`AgentSave.restoring`) before anything
 * of it is made, so a folder it did not finish is never taken for the
 * agent's work, nor saved at a turn's end. The bundle is downloaded through
 * the launch's read into the device's own state (`RESTORES_FOLDER`),
 * outside every folder a VM mounts, held to the size its save committed,
 * checked against its SHA-256, and opened under the agent's key, held in
 * memory alone, into the pack in its `tmp/`
 * (`LocalAgentPlatformSeam.stateOpened`); the runner bundle's `state
 * restore` applies it in the agent's VM as its user, onto a repository
 * made at the pack's base. A restore that fails at any step is said and
 * refused, and deletes nothing: the record still names it, so the agent's
 * next launch restores again rather than going on from what it left.
 *
 * The device's report names sizes, digests, generations, and seconds, and
 * the plain words a failed pack, verify, or restore gave; never a URL, the
 * key, or a byte of a pack, and no bundle enters a trace
 * (`HttpClient.TracerDisabledWhen`).
 */

/** The pack's file under the agent's `tmp/`, which the VM writes and the device seals. */
const PACK_FILE = "state.pack";
/** The folder in the device's state each agent's sealed bundle waits in until committed, named for the agent. */
const BUNDLES_FOLDER = "agent-state";
/** The folder in the device's state a restore downloads the agent's bundle into, named for the agent, until it is opened. */
const RESTORES_FOLDER = "agent-state-restores";
/** How long packing the agent's state in its VM, and then verifying it, may each take. */
const STATE_STEP_TIMEOUT = Duration.minutes(10);
/** How long a state command has to end after SIGTERM before it is sent SIGKILL. */
const KILL_GRACE = Duration.seconds(3);
/** How long one upload of a bundle may take: as long as its grant stands. */
const UPLOAD_TIMEOUT = Duration.minutes(15);
/** How long a restore's download of a bundle may take, as long as an upload may. */
const DOWNLOAD_TIMEOUT = Duration.minutes(15);
/** How long after its grant an uploaded bundle's commit is asked again under its path rather than a new save, well inside the hour the service takes one. */
const COMMIT_WITHIN = Duration.minutes(45);
/** How long a bundle that could not be committed waits before it is tried again: the first wait, doubled after each failed try up to the last. */
const RETRY = { FIRST: Duration.minutes(1), LAST: Duration.minutes(30) } as const;
/** A commit's id, as the pack prints its base. */
const COMMIT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;

/** How one try at committing an agent's bundle ended. */
const SENT = {
  /** It was committed, and the agent's record names its generation. */
  COMMITTED: "committed",
  /** It can never be committed, so it was let go of; the folder stays unsaved. */
  DROPPED: "dropped",
  /** It waits to be tried again. */
  LATER: "later",
} as const;

type Sent = (typeof SENT)[keyof typeof SENT];

/** The agent a state command runs in the VM of, its folder, and what a command there is started with of the device's own. */
interface InVm {
  readonly agentId: string;
  readonly layout: DeviceAgentLayout;
  readonly shellVariables: Readonly<Record<string, string>>;
}

/** One of the agent's turns as it ends: the account and device it ran under, its launch line, and the VM it ran in. */
interface EndingTurn extends InVm {
  readonly userId: string;
  readonly deviceId: string;
  readonly lineId: string;
}

/** A launch's restore of the agent's saved state: the account it runs under, the agent's VM, and the generation it restores. */
interface Restore extends InVm {
  readonly userId: string;
  readonly generation: number;
}

/** A state command's run in the VM: how it exited, and what it printed. */
interface StateRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface LocalAgentSavesDependencies {
  readonly stateRoot: string;
  readonly client: Pick<HostedDeviceAgentClient, "saveState" | "commitState">;
  /** The follower's state as it holds it now. */
  readonly state: Effect.Effect<LocalAgentState>;
  /** The follower's state changed and written, one change at a time. */
  readonly updated: (change: (current: LocalAgentState) => LocalAgentState) => Effect.Effect<void>;
  readonly report: (line: string) => void;
}

/** Whether a save's or commit's answer is a refusal. */
const isRefused = <A>(answer: A | DeviceAgentStateRefused): answer is DeviceAgentStateRefused =>
  typeof answer === "object" && answer !== null && "refusal" in answer;

/** The text given with each control character in it made a space, so what a record keeps reads as one plain line. */
function printable(text: string): string {
  return Array.from(text, (character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f ? " " : character;
  }).join("");
}

/** The words a state command said it failed with: its last line on stderr, its lead left off, cut short; none where it said nothing. */
function failureWords(stderr: string): string | undefined {
  const last = printable(stderr.trim().split("\n").at(-1) ?? "").trim();
  const words = last.startsWith(STATE_FAILED_LEAD) ? last.slice(STATE_FAILED_LEAD.length) : last;
  return words.length === 0 ? undefined : words.slice(0, UNSAVED_WHY_CHARACTERS);
}

/** The base a pack printed, none where its work needs none; nothing where it printed none this device reads. */
function baseOf(stdout: string): Option.Option<string | null> {
  const line = stdout
    .split("\n")
    .findLast((each) => each.startsWith(STATE_PACK_BASE.PREFIX))
    ?.slice(STATE_PACK_BASE.PREFIX.length)
    .trim();
  if (line === STATE_PACK_BASE.NONE) return Option.some(null);
  return line !== undefined && COMMIT_ID.test(line) ? Option.some(line) : Option.none();
}

/** The agent's save record changed, made fresh under the account given where it has none, and dropped where the change answers none. */
function withSave(
  current: LocalAgentState,
  agentId: string,
  userId: string,
  change: (save: AgentSave) => AgentSave | undefined,
): LocalAgentState {
  const next = change(current.saves?.[agentId] ?? { userId });
  const others = Object.entries(current.saves ?? {}).filter(([kept]) => kept !== agentId);
  return {
    ...current,
    saves: Object.fromEntries(next === undefined ? others : [...others, [agentId, next]]),
  };
}

/** The agents' saves on this device: each runner's turn saved as it ends, and the bundles left waiting tried again. */
export function localAgentSaves(dependencies: LocalAgentSavesDependencies) {
  return Effect.gen(function* () {
    const platform = yield* LocalAgentPlatform;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const services = yield* Effect.context<
      ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | HttpClient.HttpClient
    >();
    const { client, report, stateRoot } = dependencies;
    /** Each agent's state key as the service last answered it, held in memory alone. */
    const keys = new Map<string, string>();
    /** One lock per agent, held by a turn's seal and send and by each try of its waiting bundle, so neither runs beside the other. */
    const locks = new Map<string, Semaphore.Semaphore>();
    /** How many tries in a row of each agent's waiting bundle failed, and when it is due again (epoch milliseconds). */
    const retries = new Map<string, { readonly failed: number; readonly at: number }>();
    /** How many saves this device has committed since it started, and the count each agent's last one made, so a launch claimed before it can be told apart. */
    let commitsMade = 0;
    const committedAs = new Map<string, number>();

    const lockOf = (agentId: string) => {
      const kept = locks.get(agentId);
      if (kept !== undefined) return kept;
      const made = Semaphore.makeUnsafe(1);
      locks.set(agentId, made);
      return made;
    };
    const bundleOf = (agentId: string) => path.join(stateRoot, BUNDLES_FOLDER, agentId);
    const downloadOf = (agentId: string) => path.join(stateRoot, RESTORES_FOLDER, agentId);
    const packOf = (layout: DeviceAgentLayout) => path.join(layout.temp, PACK_FILE);
    const saveOf = (agentId: string) =>
      Effect.map(dependencies.state, (current) => current.saves?.[agentId]);
    const saveChanged = (
      userId: string,
      agentId: string,
      change: (save: AgentSave) => AgentSave | undefined,
    ) => dependencies.updated((current) => withSave(current, agentId, userId, change));

    /** The agent recorded as unsaved, with why where the failure was its folder's, and said; its generation and any bundle of an earlier turn's waiting stay, and that bundle's commit leaves it unsaved. */
    const notSaved = (userId: string, agentId: string, said: string, why?: string) =>
      Effect.gen(function* () {
        report(`a local agent's state was not saved, so its folder was kept: ${said}`);
        const unsaved = why === undefined ? {} : { why: why.slice(0, UNSAVED_WHY_CHARACTERS) };
        yield* saveChanged(userId, agentId, (save) => ({ ...save, unsaved }));
      });

    /** The agent recorded as unsaved where the turn of the launch line given ended with no bundle of its own sealed, as a runner that ended with the app or the gate did. */
    const unsavedMarked = (userId: string, agentId: string, lineId: string) =>
      saveChanged(userId, agentId, (save) =>
        save.pending?.lineId === lineId ? save : { ...save, unsaved: save.unsaved ?? {} },
      );

    /** One state command run in the agent's VM as its user, on the pack in its `tmp/`; none where it could not start or outlasted `STATE_STEP_TIMEOUT`. */
    const ranInVm = (turn: InVm, action: StateAction) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { agentId, layout } = turn;
          const run = platform.sandbox.exec({
            agentId,
            folder: layout.folder,
            cwd: layout.folder,
            command: platform.sandbox.tools.node,
            args: [platform.runnerBundle, STATE_COMMAND, action, layout.folder, packOf(layout)],
            env: turn.shellVariables,
          });
          const handle = yield* ChildProcess.make(run.command, [...run.args], {
            cwd: layout.folder,
            env: run.env,
            extendEnv: false,
            stdin: "ignore",
            forceKillAfter: KILL_GRACE,
          });
          const [stdout, stderr] = yield* Effect.all(
            [
              Stream.mkString(Stream.decodeText(handle.stdout)),
              Stream.mkString(Stream.decodeText(handle.stderr)),
            ],
            { concurrency: "unbounded" },
          );
          return { code: Number(yield* handle.exitCode), stdout, stderr } satisfies StateRun;
        }),
      ).pipe(
        Effect.timeoutOption(STATE_STEP_TIMEOUT),
        Effect.orElseSucceed(() => Option.none<StateRun>()),
        Effect.provideContext(services),
      );

    /**
     * The agent's state packed and verified in its VM, every process of the
     * agent's there asked to end first: the pack's base, which its commit
     * names. None where either step failed, which is recorded and said, in
     * the words the command gave where it gave any.
     */
    const packedInVm = (turn: EndingTurn) =>
      Effect.gen(function* () {
        const { userId, agentId } = turn;
        yield* Effect.provideContext(platform.sandbox.signalled(agentId), services);
        const packed = yield* ranInVm(turn, STATE_ACTION.PACK);
        if (Option.isNone(packed)) {
          yield* notSaved(userId, agentId, "its state could not be packed in time");
          return Option.none<string | null>();
        }
        if (packed.value.code !== STATE_EXIT.DONE) {
          const words =
            failureWords(packed.value.stderr) ??
            (packed.value.code === STATE_EXIT.TOO_LARGE
              ? "its state is over what a save may hold"
              : "its state could not be packed");
          yield* notSaved(userId, agentId, words, words);
          return Option.none<string | null>();
        }
        const base = baseOf(packed.value.stdout);
        if (Option.isNone(base)) {
          yield* notSaved(userId, agentId, "its pack named no base");
          return Option.none<string | null>();
        }
        const verified = yield* ranInVm(turn, STATE_ACTION.VERIFY);
        if (Option.isNone(verified) || verified.value.code !== STATE_EXIT.DONE) {
          const words = Option.flatMap(verified, (run) =>
            Option.fromUndefinedOr(failureWords(run.stderr)),
          ).pipe(Option.getOrElse(() => "its pack could not be verified against its folder"));
          yield* notSaved(userId, agentId, words, words);
          return Option.none<string | null>();
        }
        return base;
      });

    /** The bundle at its path PUT to the one upload granted for it; whether the store took it. Note that the upload's URL is its whole grant, so no span records it. */
    const uploaded = (bundle: string, upload: DeviceAgentStateSaveAnswer["upload"]) =>
      Effect.gen(function* () {
        const request = yield* HttpClientRequest.put(upload.url).pipe(
          HttpClientRequest.setHeaders(upload.headers),
          HttpClientRequest.bodyFile(bundle),
        );
        const response = yield* HttpClient.execute(request);
        return response.status >= 200 && response.status < 300;
      }).pipe(
        Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
        Effect.timeoutOption(UPLOAD_TIMEOUT),
        Effect.map(Option.getOrElse(() => false)),
        Effect.orElseSucceed(() => false),
        Effect.provideContext(services),
      );

    /** The agent's waiting bundle let go of, since it can never be committed: its file removed, its record's bundle dropped, and the agent recorded as unsaved and why said. */
    const dropped = (userId: string, agentId: string, said: string) =>
      Effect.gen(function* () {
        yield* Effect.ignore(fileSystem.remove(bundleOf(agentId), { force: true }));
        yield* saveChanged(userId, agentId, ({ pending: _pending, ...save }) => save);
        yield* notSaved(userId, agentId, said);
        return SENT.DROPPED;
      });

    /**
     * The path the agent's waiting bundle stands uploaded to: the one it was
     * granted and uploaded to within `COMMIT_WITHIN`, or a fresh one, the
     * grant handed in where the caller asked for it already, else asked for
     * now, and the bundle uploaded there. A refusal lets the bundle go; an
     * answer missing or an upload failing leaves it for the next try.
     */
    const uploadedPath = (
      userId: string,
      deviceId: string,
      agentId: string,
      pending: PendingSave,
      asked: DeviceAgentStateSaveAnswer | undefined,
    ) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const granted = pending.granted;
        if (
          granted?.uploaded === true &&
          now - granted.at < Duration.toMillis(COMMIT_WITHIN) &&
          asked === undefined
        ) {
          return Result.succeed(granted.path);
        }
        if (
          !(yield* fileSystem.exists(bundleOf(agentId)).pipe(Effect.orElseSucceed(() => false)))
        ) {
          return Result.fail(
            yield* dropped(userId, agentId, "its bundle is gone from this device"),
          );
        }
        const answer =
          asked ??
          (yield* Effect.provideContext(
            client.saveState(deviceId, agentId, pending.fromGeneration),
            services,
          ));
        if (answer === undefined) return Result.fail(SENT.LATER);
        if (isRefused(answer)) {
          return Result.fail(
            yield* dropped(
              userId,
              agentId,
              answer.refusal === DEVICE_AGENT_STATE_REFUSAL.STALE
                ? "a newer save of the agent's stands in Luke's store"
                : "Luke refused to save it",
            ),
          );
        }
        keys.set(agentId, answer.key);
        const marked = (uploaded: boolean) =>
          saveChanged(userId, agentId, (save) =>
            save.pending === undefined
              ? save
              : {
                  ...save,
                  pending: { ...save.pending, granted: { path: answer.path, at: now, uploaded } },
                },
          );
        yield* marked(false);
        if (pending.bytes > answer.upload.maxBytes) {
          return Result.fail(
            yield* dropped(userId, agentId, "its bundle is over what Luke's store takes"),
          );
        }
        if (!(yield* uploaded(bundleOf(agentId), answer.upload))) return Result.fail(SENT.LATER);
        yield* marked(true);
        return Result.succeed(answer.path);
      });

    /**
     * One try at committing the agent's waiting bundle, `since` when the
     * save began: uploaded where it is not yet, then committed, its
     * generation recorded, the folder no longer unsaved, and the bundle
     * removed; let go of where the service refuses it as stale, and left
     * for the next try otherwise.
     */
    const pendingSent = (
      userId: string,
      deviceId: string,
      agentId: string,
      since: number,
      asked?: DeviceAgentStateSaveAnswer,
    ) =>
      Effect.gen(function* () {
        const pending = (yield* saveOf(agentId))?.pending;
        if (pending === undefined) return SENT.DROPPED;
        const at = yield* uploadedPath(userId, deviceId, agentId, pending, asked);
        if (Result.isFailure(at)) return at.failure;
        const { fromGeneration, baseCommit, bytes, sha256 } = pending;
        const commit = { agentId, fromGeneration, path: at.success, bytes, sha256, baseCommit };
        const answer = yield* Effect.provideContext(client.commitState(deviceId, commit), services);
        if (answer === undefined) return SENT.LATER;
        if (isRefused(answer)) {
          if (answer.refusal === DEVICE_AGENT_STATE_REFUSAL.STALE) {
            return yield* dropped(
              userId,
              agentId,
              "a newer save of the agent's stands in Luke's store",
            );
          }
          // Note that a commit refused otherwise names a path whose grant lapsed, so the next try asks for a fresh one.
          yield* saveChanged(userId, agentId, ({ pending: waiting, ...save }) => {
            if (waiting === undefined) return save;
            const { granted: _granted, ...ungranted } = waiting;
            return { ...save, pending: ungranted };
          });
          return SENT.LATER;
        }
        commitsMade += 1;
        committedAs.set(agentId, commitsMade);
        // Note that the bundle goes before its record does, since a bundle no record names reads as a save that never landed (`straysLetGo`), while a record whose bundle is gone commits again under its path, which the service answers with the same generation.
        yield* Effect.ignore(fileSystem.remove(bundleOf(agentId), { force: true }));
        yield* saveChanged(userId, agentId, ({ pending: _pending, ...save }) => ({
          ...save,
          generation: answer,
        }));
        const seconds = ((yield* Clock.currentTimeMillis) - since) / 1000;
        report(
          `a local agent's state was saved as generation ${answer}: ${bytes} bytes, sha256 ${sha256}, in ${seconds.toFixed(1)} s`,
        );
        return SENT.COMMITTED;
      });

    /** The agent's waiting bundle due again after `RETRY`'s wait, doubled with each try in a row that ended `LATER`; due at once otherwise. */
    const retryAfter = (agentId: string, sent: Sent) =>
      Effect.gen(function* () {
        if (sent !== SENT.LATER) return void retries.delete(agentId);
        const failed = (retries.get(agentId)?.failed ?? 0) + 1;
        const wait = Math.min(
          Duration.toMillis(RETRY.FIRST) * 2 ** (failed - 1),
          Duration.toMillis(RETRY.LAST),
        );
        retries.set(agentId, { failed, at: (yield* Clock.currentTimeMillis) + wait });
      });

    /**
     * The pack the turn's VM wrote, read once the VM is gone: a save asked
     * for from the generation the agent's folder stands at, the pack sealed
     * under the agent's key, the key the answer carries or the one held,
     * into its bundle, superseding any an earlier turn left waiting, and the
     * bundle sent. A refusal, or no key to seal under, leaves the folder
     * unsaved with nothing waiting.
     */
    const sealedAndSent = (turn: EndingTurn, baseCommit: string | null, since: number) =>
      Effect.gen(function* () {
        const { userId, deviceId, agentId, layout } = turn;
        const fromGeneration = (yield* saveOf(agentId))?.generation ?? null;
        const answer = yield* Effect.provideContext(
          client.saveState(deviceId, agentId, fromGeneration),
          services,
        );
        if (answer !== undefined && isRefused(answer)) {
          const stale = answer.refusal === DEVICE_AGENT_STATE_REFUSAL.STALE;
          // Note that a stale save means the generation recorded is behind Luke's, so it is let go of, and the agent's next launch names the newest.
          if (stale) {
            yield* saveChanged(userId, agentId, ({ generation: _generation, ...save }) => save);
          }
          return yield* notSaved(
            userId,
            agentId,
            stale
              ? "a newer save of the agent's stands in Luke's store"
              : "Luke refused to save it",
          );
        }
        const key = answer?.key ?? keys.get(agentId);
        if (key === undefined) {
          return yield* notSaved(userId, agentId, "Luke could not be reached for the agent's key");
        }
        yield* fileSystem
          .makeDirectory(path.dirname(bundleOf(agentId)), { recursive: true, mode: 0o700 })
          .pipe(Effect.ignore);
        const sealed = yield* Effect.result(
          platform.stateSealed({
            from: packOf(layout),
            within: layout.temp,
            to: bundleOf(agentId),
            key,
          }),
        );
        if (Result.isFailure(sealed)) {
          return yield* notSaved(userId, agentId, sealed.failure.detail, sealed.failure.detail);
        }
        const pending: PendingSave = {
          lineId: turn.lineId,
          fromGeneration,
          baseCommit,
          ...sealed.success,
        };
        // Note that the turn's bundle holds the folder as it stands, so the agent is no longer unsaved while it waits, and it supersedes any bundle an earlier turn left.
        yield* saveChanged(userId, agentId, ({ unsaved: _unsaved, ...save }) => ({
          ...save,
          pending,
        }));
        retries.delete(agentId);
        // Note that a save the service did not answer is asked again on the beat rather than at once.
        const sent =
          answer === undefined
            ? SENT.LATER
            : yield* pendingSent(userId, deviceId, agentId, since, answer);
        if (sent === SENT.LATER) {
          report("a local agent's state is kept on this device, and its save is tried again");
        }
        yield* retryAfter(agentId, sent);
      });

    /**
     * One of the agent's turns saved as it ends, its VM let go of between
     * (`vmDeleted`): packed and verified in the VM, and once the VM is gone
     * sealed and sent. Whether the VM is gone. A VM left standing may still
     * run the agent's processes, so its pack is never read, and a folder a
     * restore did not finish holds no turn of the agent's, so its VM is let
     * go of with nothing packed. Note that the pack and the send are
     * interruptible and the delete is not, because a turn's end runs as its
     * runner's scope closes, which a quit or a gate shutting closes too:
     * there the save is cut short, or never begins, and the agent is
     * recorded as unsaved, while its VM still goes.
     */
    const turnEnded = (turn: EndingTurn, vmDeleted: Effect.Effect<boolean>) =>
      Effect.gen(function* () {
        const { userId, agentId } = turn;
        if ((yield* saveOf(agentId))?.restoring !== undefined) return yield* vmDeleted;
        const since = yield* Clock.currentTimeMillis;
        const base = yield* Effect.exit(Effect.interruptible(packedInVm(turn)));
        const gone = yield* vmDeleted;
        if (Exit.isFailure(base)) {
          yield* notSaved(
            userId,
            agentId,
            "its turn ended with the device before its state was packed",
          );
          return gone;
        }
        if (Option.isNone(base.value)) return gone;
        if (!gone) {
          yield* notSaved(userId, agentId, "its VM could not be deleted, so its pack was not read");
          return gone;
        }
        const sent = yield* Effect.exit(
          Effect.interruptible(
            lockOf(agentId).withPermit(sealedAndSent(turn, base.value.value, since)),
          ),
        );
        if (Exit.isFailure(sent)) yield* unsavedMarked(userId, agentId, turn.lineId);
        return gone;
      });

    /** Where this device's commits stand now, which a launch's claim notes (`launched`). */
    const commitMark = () => commitsMade;

    /**
     * What a launch of the agent's on a device that saves, claimed at
     * `claimedAt` (`commitMark`), says of its saved state: the generation it
     * restores, which the record moves up to, unless the record names a
     * newer one, a save of this device's that landed after the launch was
     * queued; or none, where Luke holds none of the agent's, its last save
     * having expired, which lets the record's go, so the next save starts
     * afresh, and any restore of it the record names with it, since there is
     * nothing left to restore. A save this device committed since the claim,
     * as the runner the launch replaces saved, is newer than whatever the
     * launch says, so the record stands. And the agent's state key, held for
     * its next seal.
     */
    const launched = (
      userId: string,
      agentId: string,
      generation: number | undefined,
      key: string | undefined,
      claimedAt: number,
    ) =>
      Effect.gen(function* () {
        if (key !== undefined) keys.set(agentId, key);
        if ((committedAs.get(agentId) ?? 0) > claimedAt) return;
        const record = yield* saveOf(agentId);
        const kept = record?.generation;
        if (generation === undefined) {
          if (kept === undefined && record?.restoring === undefined) return;
          return yield* saveChanged(
            userId,
            agentId,
            ({ generation: _generation, restoring: _restoring, ...rest }) => rest,
          );
        }
        if (kept !== undefined && kept >= generation) return;
        yield* saveChanged(userId, agentId, (save) => ({ ...save, userId, generation }));
      });

    /**
     * Every bundle in the device's state that no record names as waiting,
     * as a run whose record could not be written leaves one, let go of, and
     * its agent recorded as unsaved, since nothing will try it again and its
     * folder may hold state no save committed; a bundle cut off as it was
     * sealed, named for its agent with a suffix, is let go of alone.
     */
    const straysLetGo = (userId: string) =>
      Effect.gen(function* () {
        const folder = path.join(stateRoot, BUNDLES_FOLDER);
        const names = yield* fileSystem
          .readDirectory(folder)
          .pipe(Effect.orElseSucceed((): readonly string[] => []));
        const saves = (yield* dependencies.state).saves ?? {};
        for (const name of names) {
          if (saves[name]?.pending !== undefined) continue;
          yield* Effect.ignore(fileSystem.remove(path.join(folder, name), { force: true }));
          if (name.includes(".")) continue;
          report("a local agent's state waiting to be saved had no record, so its folder was kept");
          yield* saveChanged(saves[name]?.userId ?? userId, name, (save) => ({
            ...save,
            unsaved: save.unsaved ?? {},
          }));
        }
      });

    /** Whether the agent's folder holds a restore that did not finish, which its next launch restores again. */
    const restoring = (agentId: string) =>
      Effect.map(saveOf(agentId), (save) => save?.restoring !== undefined);

    /** The agent recorded as restoring the generation given into its folder, before anything of the restore is made. */
    const restoreBegun = (userId: string, agentId: string, generation: number) =>
      saveChanged(userId, agentId, (save) => ({ ...save, restoring: generation }));

    /** A restore refused, and why said with its generation: false. Nothing of the agent's is deleted and its record still names the restore, so its next launch tries again. */
    const notRestored = (generation: number, said: string) =>
      Effect.sync(() => {
        report(
          `a local agent's state of generation ${generation} was not restored, so its launch was refused: ${said}`,
        );
        return false;
      });

    /**
     * The launch's bundle downloaded through its read to `to`, held to the
     * size its save committed: why not, where it was not, in words naming
     * no URL. Note that the read's URL is its whole grant, so no span
     * records it.
     */
    const downloaded = (state: DeviceAgentLaunchState, to: string) =>
      Effect.gen(function* () {
        const response = yield* HttpClient.get(state.url);
        if (response.status < 200 || response.status >= 300) {
          return Option.some(`Luke's store answered its read with ${response.status}`);
        }
        let received = 0;
        yield* response.stream.pipe(
          Stream.map((chunk) => {
            received += chunk.length;
            return chunk;
          }),
          Stream.takeWhile(() => received <= state.bytes),
          Stream.run(fileSystem.sink(to, { flag: "w", mode: 0o600 })),
        );
        return received > state.bytes
          ? Option.some(`its bundle is over the ${state.bytes} bytes its save committed`)
          : Option.none<string>();
      }).pipe(
        Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
        Effect.timeoutOption(DOWNLOAD_TIMEOUT),
        Effect.map(Option.getOrElse(() => Option.some("its bundle's download outlasted its time"))),
        Effect.orElseSucceed(() => Option.some("its bundle could not be downloaded")),
        Effect.provideContext(services),
      );

    /**
     * The launch's saved state (`state`, from its secrets) made ready for a
     * restore of the generation it names: its bundle downloaded into the
     * device's own state, its size and SHA-256 checked against its save's,
     * and opened under the agent's key into the pack in its `tmp/`, which
     * the restore reads in its VM; the bundle let go of either way. The
     * state, where it is ready; where not, why is said (`notRestored`), as
     * it is where this device committed a newer save than the launch names,
     * which the agent's next launch names.
     */
    const fetched = (restore: Restore, state: DeviceAgentLaunchState | undefined) =>
      Effect.gen(function* () {
        const { agentId, layout, generation } = restore;
        const none = (said: string) => Effect.as(notRestored(generation, said), Option.none());
        if (state === undefined || state.generation !== generation) {
          return yield* none("Luke handed no read or key for it");
        }
        const kept = (yield* saveOf(agentId))?.generation;
        if (kept !== undefined && kept > generation) {
          return yield* none(`this device committed a newer save of it, generation ${kept}`);
        }
        const download = downloadOf(agentId);
        yield* fileSystem
          .makeDirectory(path.dirname(download), { recursive: true, mode: 0o700 })
          .pipe(Effect.ignore);
        return yield* Effect.gen(function* () {
          const failed = yield* downloaded(state, download);
          if (Option.isSome(failed)) return yield* none(failed.value);
          const opened = yield* Effect.result(
            platform.stateOpened({
              from: download,
              to: packOf(layout),
              within: layout.temp,
              key: state.key,
              bytes: state.bytes,
              sha256: state.sha256,
            }),
          );
          if (Result.isFailure(opened)) return yield* none(opened.failure.detail);
          return Option.some(state);
        }).pipe(Effect.ensuring(Effect.ignore(fileSystem.remove(download, { force: true }))));
      });

    /**
     * The pack in the agent's `tmp/` restored into its folder by the runner
     * bundle's `state restore`, in its VM as its user, which writes nothing
     * until every part of the pack matches its manifest; the pack let go of
     * either way. Once restored, the folder stands at the generation
     * restored, as its record says from then, which is said with the
     * bundle's size and digest and the seconds `since` the restore began;
     * where not, why is said in the command's own words (`notRestored`).
     */
    const restored = (restore: Restore, state: DeviceAgentLaunchState, since: number) =>
      Effect.gen(function* () {
        const { userId, agentId, layout, generation } = restore;
        const run = yield* ranInVm(restore, STATE_ACTION.RESTORE);
        yield* Effect.ignore(fileSystem.remove(packOf(layout), { force: true }));
        if (Option.isNone(run)) {
          return yield* notRestored(generation, "its restore could not run in its VM in time");
        }
        if (run.value.code !== STATE_EXIT.DONE) {
          return yield* notRestored(
            generation,
            failureWords(run.value.stderr) ?? "its pack could not be restored into its folder",
          );
        }
        yield* saveChanged(userId, agentId, ({ restoring: _restoring, ...save }) => ({
          ...save,
          generation,
        }));
        const seconds = ((yield* Clock.currentTimeMillis) - since) / 1000;
        report(
          `a local agent's state was restored from generation ${generation}: ${state.bytes} bytes, sha256 ${state.sha256}, in ${seconds.toFixed(1)} s`,
        );
        return true;
      });

    /** Why the agent's last save failed for a reason in its own folder, where its record says, which its next launch tells it. */
    const whyUnsaved = (agentId: string) =>
      Effect.map(saveOf(agentId), (save) => save?.unsaved?.why);

    /** Why the agent's last save failed let go of, once a launch has told it; its folder stays unsaved until a save commits. */
    const whySaid = (userId: string, agentId: string) =>
      saveChanged(userId, agentId, (save) =>
        save.unsaved?.why === undefined ? save : { ...save, unsaved: {} },
      );

    /** The account's agents whose waiting bundle is due to be tried again. */
    const due = (userId: string) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        return Object.entries((yield* dependencies.state).saves ?? {})
          .filter(
            ([agentId, save]) =>
              save.userId === userId &&
              save.pending !== undefined &&
              (retries.get(agentId)?.at ?? 0) <= now,
          )
          .map(([agentId]) => agentId);
      });

    /** One try at committing the agent's waiting bundle, holding its lock, and when it is due again. */
    const tried = (userId: string, deviceId: string, agentId: string) =>
      lockOf(agentId).withPermit(
        Effect.gen(function* () {
          const sent = yield* pendingSent(
            userId,
            deviceId,
            agentId,
            yield* Clock.currentTimeMillis,
          );
          yield* retryAfter(agentId, sent);
        }),
      );

    /** The agent's record and any bundle of its waiting let go of, once its folder is gone. */
    const forgotten = (userId: string, agentId: string) =>
      lockOf(agentId).withPermit(
        Effect.gen(function* () {
          keys.delete(agentId);
          retries.delete(agentId);
          yield* Effect.ignore(fileSystem.remove(bundleOf(agentId), { force: true }));
          if ((yield* saveOf(agentId)) !== undefined)
            yield* saveChanged(userId, agentId, () => undefined);
        }),
      );

    return {
      turnEnded,
      commitMark,
      launched,
      restoring,
      restoreBegun,
      notRestored,
      fetched,
      restored,
      whyUnsaved,
      whySaid,
      unsavedMarked,
      straysLetGo,
      due,
      tried,
      forgotten,
    };
  });
}
