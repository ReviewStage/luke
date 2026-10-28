/**
 * device-machine.ts -- the agent machine over the starter's Mac: the runner launched there by a line the Mac follows, its stdin written as more lines, and Luke's doors read through requests the Mac answers.
 *
 * A local agent (`coding_agent.machine` is `mac`) runs its runner on the
 * Mac it is pinned to (`coding_agent.device_id`), which follows the rows the
 * service queues for it (`@luke/database/models/device-agent-store`, the wire
 * in `@luke/features/device-agent-wire`) and answers through its procedures
 * (`../device-agents-procedures.ts`). Nothing here reaches the Mac directly:
 * every call is a row, and the Mac's word is a row it settled or answered.
 *
 * `layout` and `open` answer at once, from the agent and the home folder its
 * Mac registered, with no round trip: the agent's folder in that home holds
 * its worktree, which the Mac makes as it takes the launch line, the files
 * a message carries, and the skills its member installed into Luke
 * (`deviceAgentLayout`). `launchRunner` queues the launch line, its runner's
 * environment and first lines sealed together under the deployment's key
 * ring (`sealMacLaunchSecrets`) and opened again only by the Mac's claim,
 * which clears the row's copy. `writeLine`, `writeFiles`, and `kill` queue a
 * message, files, or stop line; a runner whose launch line its Mac settled
 * has ended, and a write to it answers `NOT_FOUND_STATUS`, so a message
 * relaunches it. `runnerExit` reads the exit code the Mac settled the
 * launch line with.
 *
 * Note that every line of one agent is queued under its runner lease, which
 * every caller of `launchRunner`, `writeLine`, `writeFiles`, and `kill`
 * holds (`../coder-host/runner-sessions.ts`), because the lines' order is
 * their order of commit and only the lease keeps two from interleaving
 * (`device-agent-store.ts`'s header). The other calls queue no line: the Mac
 * has no firewall Luke sets, so `setCredential` does nothing, and nothing
 * to stop, resume, or throw away, since a warm runner ends by itself at its
 * idle cap, settling its line; the agent's folder goes from its device only
 * once the agent is archived (`../device-discard.ts`).
 *
 * Whether a runner runs is read off the agent's newest launch line, which
 * stands for the record a sandbox keeps in its tags: it runs while that
 * line is unsettled and no stop line was queued after it, so a Stop is
 * honoured the moment it is queued, whenever the Mac gets to it. A record
 * that no longer tells of a runner still running, as a retire's, queues a
 * stop line after it for the same reason, so a message sent next relaunches
 * rather than landing behind a line the runner ends on.
 *
 * `readFile` queues a request under an id it mints, waits for its answer
 * at most `MAC_MACHINE.ANSWER_WAIT`, and withdraws it however the wait ends; a Mac that has not beaten within
 * `MAC_PRESENCE.FRESH_MS` is away, and the call is unavailable at once, as a
 * stopped sandbox's is. `launchRunner`, `writeFiles`, and `writeLine` refuse
 * an away Mac at once too, as a Start on it is refused
 * (`LOCAL_AGENT_REFUSAL.MAC_AWAY`), and a host its account removed by name,
 * rather than queue a line no one may take for hours: a message to it fails
 * in words, and its open run is taken from it once its lease lapses
 * (`../../maintenance/device-lease-sweep.ts`).
 */

import { randomUUID } from "node:crypto";
import { INPUT_LINE, InputLineSchema } from "@luke/agent-runner/protocol";
import type { DatabaseServices } from "@luke/database/core/query";
import { hasRepository, readAgent } from "@luke/database/models/agent-store";
import {
  type DeviceAgentPin,
  deviceAgentLineStanding,
  deviceAgentOfSession,
  deviceAgentPin,
  deviceAgentRequestAnswer,
  latestDeviceAgentLaunch,
  queueDeviceAgentLine,
  queueDeviceAgentRequest,
  withdrawDeviceAgentRequest,
} from "@luke/database/models/device-agent-store";
import { deviceLayout, devicesSeenSince } from "@luke/database/models/device-store";
import { hostRemoved } from "@luke/database/models/host-store";
import { parseKeyRing, sealMacLaunchSecrets } from "@luke/database/models/provider-key-seal";
import { AGENT_MACHINE, MAC_PRESENCE } from "@luke/features/agent-wire";
import {
  DEVICE_AGENT_BOUNDS,
  DEVICE_AGENT_LINE_KIND,
  DEVICE_AGENT_REQUEST_KIND,
  type DeviceAgentAnswer,
  type DeviceAgentLaunchPayload,
  type DeviceAgentObject,
  deviceAgentFilesPayloadSchema,
  deviceAgentLaunchPayloadSchema,
  deviceAgentLaunchSecretsSchema,
  deviceAgentLayout,
} from "@luke/features/device-agent-wire";
import {
  Brand,
  Clock,
  type Context,
  Duration,
  Effect,
  Exit,
  Option,
  Redacted,
  Result,
  Schedule,
  Schema,
} from "effect";
import { HostedEnvironment } from "../../environment.js";
import { agentCommitIdentity, type CheckoutServices } from "../coder-host/checkout.js";
import {
  COMMAND_GONE,
  type CommandExit,
  NOT_FOUND_STATUS,
  type SandboxFile,
  SandboxUnavailable,
} from "../vercel-sandbox-api.js";
import {
  type AgentMachineService,
  type FoundPlace,
  LaunchRefused,
  type MachineKept,
  type MachineLayout,
  type MachineName,
  type MachineOpen,
  type MachinePlace,
  type MachineRunning,
  type OpenedPlace,
  RUNNER_RECORD,
  type RunnerHandle,
  type RunnerLaunch,
} from "./agent-machine.js";

export const MAC_MACHINE = {
  /** How long a tool's request waits for its Mac's answer before the call is unavailable. */
  ANSWER_WAIT: Duration.seconds(30),
  /** How often a waiting request, or a runner's exit, is read again. */
  POLL: Duration.millis(250),
  /** How long a read of a runner's exit waits where its caller names no wait, as a sandbox's does. */
  EXIT_WAIT: Duration.seconds(2),
} as const;

/**
 * The machine over the Mac, and whether a session is a local agent's, which
 * the router asks first (`agent-machines.ts`). Its open reaches none of the
 * services a sandbox's does, only the store it was made over; its launch
 * reads GitHub too, for who the agent's commits are by.
 */
export interface DeviceMachineService extends AgentMachineService {
  readonly owns: (session: string) => Effect.Effect<boolean, SandboxUnavailable>;
  readonly open: <A, E, R, B, EB, RB>(
    ask: MachineOpen<B, EB, RB>,
    use: (opened: OpenedPlace, beside: B) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | EB | LaunchRefused | { readonly _tag: string }, R | RB>;
  readonly launchRunner: <A, E, R, EL, RL>(
    place: MachinePlace,
    launch: RunnerLaunch<A, E, R, EL, RL>,
  ) => Effect.Effect<
    { readonly handle: RunnerHandle; readonly ready: A },
    E | EL | SandboxUnavailable | { readonly _tag: string },
    R | RL | CheckoutServices
  >;
}

const runningOfAgent = Brand.nominal<MachineRunning>();
const nameOfAgent = Brand.nominal<MachineName>();

const encodeFilesPayload = Schema.encodeSync(deviceAgentFilesPayloadSchema);
const encodeLaunchPayload = Schema.encodeSync(deviceAgentLaunchPayloadSchema);
const encodeSecrets = Schema.encodeSync(Schema.fromJsonString(deviceAgentLaunchSecretsSchema));
const decodeInputLine = Schema.decodeUnknownOption(Schema.fromJsonString(InputLineSchema));

/** The runner's lines that only end what it does, which an away Mac is still sent. */
const ENDING_LINES: ReadonlySet<string> = new Set([INPUT_LINE.STOP, INPUT_LINE.RETIRE]);

/** Whether every line of a write only stops or retires the runner, carrying no message and no model. */
function onlyEnds(text: string): boolean {
  return text
    .split("\n")
    .filter((each) => each.length > 0)
    .every((each) => Option.exists(decodeInputLine(each), (input) => ENDING_LINES.has(input.type)));
}

/** A local agent's place on its Mac, under Luke's session given: the agent itself, since it has one place. */
function macPlace(session: string, agentId: string): MachinePlace {
  return { machine: AGENT_MACHINE.DEVICE, session, running: runningOfAgent(agentId) };
}

/** A failure the store or the seal answered, as a machine's own: unavailable, with no words of the cause. */
function unavailable(): SandboxUnavailable {
  return new SandboxUnavailable({});
}

/** A line's payload as the row holds it: a JSON object. */
function objectOf(value: object): DeviceAgentObject {
  // SAFETY: every payload is a struct's encoded form, a JSON object of string keys.
  return value as DeviceAgentObject;
}

/**
 * The machine over the account's Macs, its store calls made on the services
 * given and its launches sealed under the deployment's key ring, where the
 * services carry one.
 */
function deviceMachineOver(
  context: Context.Context<DatabaseServices>,
  environment: Option.Option<typeof HostedEnvironment.Service>,
): DeviceMachineService {
  /** One store call on the services given, a failure of it unavailable. */
  const stored = <A, E>(effect: Effect.Effect<A, E, DatabaseServices>) =>
    effect.pipe(
      Effect.provideContext(context),
      Effect.mapError(() => unavailable()),
    );

  /** The local agent a place names, by its id. */
  const pinOfPlace = (place: MachinePlace) =>
    Effect.flatMap(stored(deviceAgentPin(place.running)), (pin) =>
      Option.isSome(pin) ? Effect.succeed(pin.value) : Effect.fail(unavailable()),
    );

  /** The local agent running in the session, where one does. */
  const pinOfSession = (session: string) => stored(deviceAgentOfSession(session));

  /** Where the agent's things stand on its Mac, from the home folder that Mac registered; refused where it is pinned to no Mac of its starter's. */
  const layoutOf = (userId: string, agentId: string, deviceId: string | null | undefined) =>
    Effect.gen(function* () {
      if (deviceId === null || deviceId === undefined) {
        return yield* new LaunchRefused({ reason: "no mac" });
      }
      const device = yield* stored(deviceLayout(userId, deviceId));
      if (Option.isNone(device)) {
        // Note that a removed host is refused by name, so the member is told it is gone rather than to try again.
        return yield* (yield* stored(hostRemoved(userId, deviceId)))
          ? new LaunchRefused({ reason: "host removed", deviceRemoved: true })
          : new LaunchRefused({ reason: "no mac" });
      }
      const folders = deviceAgentLayout(device.value.home, agentId);
      const layout: MachineLayout = {
        checkoutPath: folders.checkoutPath,
        installedSkills: folders.installedSkills,
        // Note that the Mac writes the skills where they are installed, since no root installs them after.
        skillsUpload: folders.installedSkills,
        attachments: folders.attachments,
        // Note that the Mac answers reads inside the agent's folder alone, so what Luke reads back is saved in its temp folder, never `/tmp`, which its VM keeps to itself.
        sharedFiles: folders.temp,
        claudeExecutable: device.value.claudeExecutable,
        codexExecutable: device.value.codexExecutable ?? undefined,
        writableRoots: [folders.folder],
        signedIn: device.value.signedIn,
        isolation: device.value.isolation,
      };
      return layout;
    });

  /** One line queued for the agent; unavailable where the store holds no such agent on a Mac. */
  const queued = (
    pin: DeviceAgentPin,
    line: {
      readonly id?: string;
      readonly kind: (typeof DEVICE_AGENT_LINE_KIND)[keyof typeof DEVICE_AGENT_LINE_KIND];
      readonly payload: DeviceAgentObject;
      readonly sealedSecrets?: string;
    },
  ) =>
    Effect.flatMap(
      stored(queueDeviceAgentLine(pin.userId, { agentId: pin.agentId, ...line })),
      (row) => (Option.isSome(row) ? Effect.void : Effect.fail(unavailable())),
    );

  /** Whether the runner a handle names has ended: its launch line settled, or gone. */
  const runnerEnded = (pin: DeviceAgentPin, handle: RunnerHandle) =>
    Effect.map(
      stored(deviceAgentLineStanding(pin.userId, handle.command)),
      (standing) => Option.isNone(standing) || standing.value.settled,
    );

  /** Whether the agent's Mac has beaten lately. */
  const present = (pin: DeviceAgentPin) =>
    Effect.gen(function* () {
      if (pin.deviceId === null) return false;
      const now = yield* Clock.currentTimeMillis;
      const since = new Date(now - MAC_PRESENCE.FRESH_MS);
      const seen = yield* stored(devicesSeenSince(pin.userId, since));
      return seen.some((device) => device.id === pin.deviceId);
    });

  /**
   * Refused as a Start on an away Mac is, where the agent's Mac has not
   * beaten lately; refused by name where it is a host its account removed,
   * which no presence read lists and no message brings back.
   */
  const refuseAway = (pin: DeviceAgentPin) =>
    Effect.gen(function* () {
      if (yield* present(pin)) return;
      if (pin.deviceId !== null && (yield* stored(hostRemoved(pin.userId, pin.deviceId)))) {
        return yield* new LaunchRefused({ reason: "host removed", deviceRemoved: true });
      }
      return yield* new LaunchRefused({ reason: "mac away", deviceAway: true });
    });

  /**
   * One request asked of the agent's Mac and its answer waited for, the row
   * withdrawn however the wait ends; unavailable where the Mac is away, or
   * did not answer in time.
   */
  const asked = (
    session: string,
    kind: (typeof DEVICE_AGENT_REQUEST_KIND)[keyof typeof DEVICE_AGENT_REQUEST_KIND],
    args: DeviceAgentObject,
  ) =>
    Effect.gen(function* () {
      const pin = yield* pinOfSession(session);
      if (Option.isNone(pin) || !(yield* present(pin.value))) return yield* unavailable();
      const { userId, agentId } = pin.value;
      const id = randomUUID();
      const answer = yield* Effect.gen(function* () {
        if (!(yield* stored(queueDeviceAgentRequest(userId, { id, agentId, kind, args })))) {
          return Option.none<DeviceAgentAnswer>();
        }
        return yield* stored(deviceAgentRequestAnswer(userId, id)).pipe(
          Effect.repeat({ schedule: Schedule.spaced(MAC_MACHINE.POLL), until: Option.isSome }),
          Effect.timeoutOption(MAC_MACHINE.ANSWER_WAIT),
          Effect.map(Option.flatten),
        );
      }).pipe(Effect.ensuring(Effect.ignore(stored(withdrawDeviceAgentRequest(userId, id)))));
      if (Option.isNone(answer) || answer.value.kind !== kind) return yield* unavailable();
      return answer.value;
    });

  /** The runner's exit as its launch line was settled: its code, gone where it settled with none or the line is gone, null while it runs. */
  const exitOf = (pin: DeviceAgentPin, handle: RunnerHandle) =>
    Effect.map(
      stored(deviceAgentLineStanding(pin.userId, handle.command)),
      (standing): CommandExit => {
        if (Option.isNone(standing)) return COMMAND_GONE;
        if (!standing.value.settled) return null;
        return standing.value.exitCode ?? COMMAND_GONE;
      },
    );

  /** The deployment's key ring, which a launch's secrets are sealed under; refused where it has none. */
  const keyRing = Effect.gen(function* () {
    const keys = Option.getOrUndefined(environment)?.providerKeyEncryptionKeys;
    const ring = keys === undefined ? undefined : parseKeyRing(keys);
    if (ring === undefined || Result.isFailure(ring)) {
      return yield* new LaunchRefused({ reason: "no key ring" });
    }
    return ring.success;
  });

  return {
    owns: (session) => Effect.map(pinOfSession(session), Option.isSome),

    layout: (agent) => layoutOf(agent.userId, agent.id, agent.deviceId),

    // The worktree is the Mac's to make as it takes the launch line, under the developer's own git
    // credentials, so the open asks the Mac nothing and leaves nothing to finish.
    open: (ask, use) =>
      Effect.gen(function* () {
        const [layout, beside] = yield* Effect.all(
          [layoutOf(ask.agent.userId, ask.agent.id, ask.agent.deviceId), ask.beside],
          { concurrency: "unbounded" },
        );
        return yield* use(
          {
            place: macPlace(ask.session, ask.agent.id),
            name: nameOfAgent(ask.agent.id),
            checkoutPath: layout.checkoutPath,
            finishCheckout: Effect.void,
          },
          beside,
        );
      }),

    findPlaces: (session) =>
      Effect.gen(function* () {
        const pin = yield* pinOfSession(session);
        if (Option.isNone(pin)) return [];
        const { userId, agentId } = pin.value;
        const launch = yield* stored(latestDeviceAgentLaunch(userId, agentId));
        const place = macPlace(session, agentId);
        const payload = Option.flatMap(launch, (line) =>
          Option.getSuccess(
            Schema.decodeUnknownResult(deviceAgentLaunchPayloadSchema)(line.payload),
          ),
        );
        const mark = Option.map(payload, (read) => ({
          firstSequence: read.firstSequence,
          ...(read.fingerprint === undefined ? {} : { fingerprint: read.fingerprint }),
        }));
        const live =
          Option.isSome(launch) &&
          Option.isSome(mark) &&
          !launch.value.settled &&
          !launch.value.stopped
            ? { handle: { ...place, command: launch.value.id }, mark: mark.value }
            : undefined;
        const found: FoundPlace = {
          machine: AGENT_MACHINE.DEVICE,
          session,
          agentId,
          name: nameOfAgent(agentId),
          running: place,
          runner: live,
          launch: Option.getOrUndefined(mark),
          // SAFETY: the pin is this machine's own to read back; no caller reads it.
          kept: pin.value as unknown as MachineKept,
        };
        return [found];
      }),

    // The record is the agent's launch and stop lines themselves, which `findPlaces` reads: a
    // runner the record no longer tells of is stopped, and one it tells of was recorded by its launch.
    recordRunner: (place, record) =>
      Effect.gen(function* () {
        if (record.kind === RUNNER_RECORD.RUNNING) return;
        const pin = yield* pinOfPlace(macPlace(place.session, place.agentId));
        const launch = yield* stored(latestDeviceAgentLaunch(pin.userId, pin.agentId));
        if (Option.isNone(launch) || launch.value.settled || launch.value.stopped) return;
        yield* queued(pin, { kind: DEVICE_AGENT_LINE_KIND.STOP, payload: {} });
      }),

    setCredential: () => Effect.void,

    // A local agent's place never stops, so it runs where it stands, and a runner that ended is launched again.
    resume: (found) =>
      found.running === undefined ? Effect.fail(unavailable()) : Effect.succeed(found.running),

    stop: () => Effect.void,

    // The worktree is the developer's own, so nothing is thrown away; a retired bearer shuts its runner out.
    discard: () => Effect.void,

    // Note that files go to an away Mac no more than the message naming them does, so a message
    // refused while it is away leaves nothing behind for it to write when it is back.
    writeFiles: (place, files: readonly SandboxFile[]) =>
      Effect.flatMap(pinOfPlace(place), (pin) =>
        Effect.andThen(
          refuseAway(pin),
          queued(pin, {
            kind: DEVICE_AGENT_LINE_KIND.FILES,
            payload: objectOf(
              encodeFilesPayload({
                files: files.map((file) => ({
                  path: file.path,
                  mode: file.mode,
                  contents: file.contents,
                })),
              }),
            ),
          }),
        ),
      ),

    // The secrets and the first lines are sealed together, bound to the agent, before the line is
    // queued; a launch whose line was not queued undoes what its caller recorded of it. Who the
    // agent's commits are by is read beside the caller's steps, as a sandbox's deepen reads it
    // (`agentCommitIdentity`), and kept as it ended, so a read that failed fails the launch where
    // its caller's record is undone; the Mac sets it in the agent's repository on every launch,
    // so an agent whose repository was made before the field gets it too.
    launchRunner: (place, launch) =>
      Effect.gen(function* () {
        const pin = yield* pinOfPlace(place);
        // Note that the refusal comes before the caller's steps run, so it has nothing to undo.
        yield* refuseAway(pin);
        const read = Effect.gen(function* () {
          const agent = yield* stored(readAgent(pin.userId, pin.agentId));
          if (Option.isNone(agent) || !hasRepository(agent.value))
            return { agent, identity: Exit.succeed(undefined) };
          const target = { userId: pin.userId, conversationId: agent.value.conversationId };
          return { agent, identity: yield* Effect.exit(agentCommitIdentity(target, agent.value)) };
        });
        const [ready, { agent, identity }, ring] = yield* Effect.all(
          [launch.ready, read, keyRing],
          { concurrency: "unbounded" },
        );
        if (Option.isNone(agent)) return yield* new LaunchRefused({ reason: "no agent" });
        const id = randomUUID();
        const handle: RunnerHandle = { ...place, command: id };
        yield* Effect.gen(function* () {
          const commitsBy = yield* identity;
          const layout = yield* layoutOf(pin.userId, pin.agentId, pin.deviceId);
          const { lines, mark } = yield* launch.firstLines(ready, handle);
          const sealedSecrets = sealMacLaunchSecrets(
            ring,
            { userId: pin.userId, agentId: pin.agentId },
            Redacted.make(encodeSecrets({ env: launch.env, stdin: lines })),
          );
          const payload: DeviceAgentLaunchPayload = {
            checkoutPath: layout.checkoutPath,
            repository: agent.value.repository,
            startBranch: agent.value.startBranch,
            firstSequence: mark.firstSequence,
            ...(mark.fingerprint === undefined ? {} : { fingerprint: mark.fingerprint }),
            ...(mark.ownLogin === true ? { ownLogin: true } : {}),
            ...(commitsBy === undefined ? {} : { identity: commitsBy }),
          };
          yield* queued(pin, {
            id,
            kind: DEVICE_AGENT_LINE_KIND.LAUNCH,
            payload: objectOf(encodeLaunchPayload(payload)),
            sealedSecrets,
          });
        }).pipe(Effect.tapError(() => Effect.ignore(launch.abandon(ready))));
        return { handle, ready };
      }),

    writeLine: (handle, text) =>
      Effect.gen(function* () {
        const pin = yield* pinOfPlace(handle);
        if (yield* runnerEnded(pin, handle)) {
          return yield* new SandboxUnavailable({ status: NOT_FOUND_STATUS });
        }
        // Note that a line that only stops or retires the runner still goes, because a Stop on an
        // away Mac is honoured when it is back, and its lease's own stop stands for it if it never is.
        if (!onlyEnds(text)) yield* refuseAway(pin);
        yield* queued(pin, { kind: DEVICE_AGENT_LINE_KIND.MESSAGE, payload: { text } });
      }),

    runnerExit: (handle, within = MAC_MACHINE.EXIT_WAIT) =>
      Effect.gen(function* () {
        const pin = yield* pinOfPlace(handle);
        const settled = yield* exitOf(pin, handle).pipe(
          Effect.repeat({
            schedule: Schedule.spaced(MAC_MACHINE.POLL),
            until: (exit) => exit !== null,
          }),
          Effect.timeoutOption(within),
        );
        return Option.getOrNull(settled);
      }),

    kill: (handle) =>
      Effect.gen(function* () {
        const pin = yield* pinOfPlace(handle);
        if (yield* runnerEnded(pin, handle)) return;
        yield* queued(pin, { kind: DEVICE_AGENT_LINE_KIND.STOP, payload: {} });
      }),

    readFile: (session, path, bound) =>
      Effect.map(
        asked(session, DEVICE_AGENT_REQUEST_KIND.READ_FILE, {
          path,
          maxBytes: Math.min(bound, DEVICE_AGENT_BOUNDS.MAX_ANSWER_BYTES) + 1,
        }),
        (answer) =>
          answer.kind === DEVICE_AGENT_REQUEST_KIND.READ_FILE && answer.bytes !== null
            ? answer.bytes
            : undefined,
      ),
  };
}

/** The machine over the account's Macs, on the calling fiber's store and, where it has one, the deployment's key ring. */
export const deviceMachine: Effect.Effect<DeviceMachineService, never, DatabaseServices> =
  Effect.gen(function* () {
    const context = yield* Effect.context<DatabaseServices>();
    const environment = yield* Effect.serviceOption(HostedEnvironment);
    return deviceMachineOver(context, environment);
  });
