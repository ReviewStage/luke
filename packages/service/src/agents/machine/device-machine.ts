import { randomUUID } from "node:crypto";
import type { DatabaseServices } from "@repo/database/core/query";
import { hasRepository, readAgent } from "@repo/database/models/agent-store";
import {
  type DeviceAgentPin,
  deviceAgentLineQueuedAfter,
  deviceAgentLineStanding,
  deviceAgentOfSession,
  deviceAgentPin,
  deviceAgentRequestAnswer,
  latestDeviceAgentLaunch,
  queueDeviceAgentLine,
  queueDeviceAgentRequest,
  withdrawDeviceAgentRequest,
} from "@repo/database/models/device-agent-store";
import { deviceLayout, devicesSeenSince } from "@repo/database/models/device-store";
import { hostRemoved } from "@repo/database/models/host-store";
import { parseKeyRing, sealMacLaunchSecrets } from "@repo/database/models/provider-key-seal";
import { type SyncTopic, TOPIC } from "@repo/database/sync/notification";
import { AGENT_MACHINE, MAC_PRESENCE } from "@repo/features/agent-wire";
import {
  DEVICE_AGENT_BOUNDS,
  DEVICE_AGENT_LINE_KIND,
  DEVICE_AGENT_REQUEST_KIND,
  DEVICE_CAPABILITY,
  DEVICE_GITHUB_ACCESS,
  type DeviceAgentAnswer,
  type DeviceAgentLaunchPayload,
  type DeviceAgentObject,
  deviceAgentFilesPayloadSchema,
  deviceAgentLaunchPayloadSchema,
  deviceAgentLaunchSecretsSchema,
  deviceAgentLayoutIn,
  deviceAgentsFolder,
} from "@repo/features/device-agent-wire";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
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
  Schema,
} from "effect";
import { HostedEnvironment } from "../../environment.js";
import { heldUntil } from "../../http/held-read.js";
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
  ANSWER_WAIT: Duration.seconds(30),
  POLL: Duration.millis(250),
  EXIT_WAIT: Duration.seconds(2),
} as const;

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

function macPlace(session: string, agentId: string): MachinePlace {
  return {
    machine: AGENT_MACHINE.DEVICE,
    session,
    name: nameOfAgent(agentId),
    running: runningOfAgent(agentId),
  };
}

function stdinLine(text: string) {
  return { kind: DEVICE_AGENT_LINE_KIND.MESSAGE, payload: { text } } as const;
}

function unavailable(): SandboxUnavailable {
  return new SandboxUnavailable({});
}

function deviceTopics(userId: string): readonly SyncTopic[] {
  return [[TOPIC.ACCOUNT, userId]];
}

function filesLines(files: readonly SandboxFile[]): readonly (readonly SandboxFile[])[] {
  const lines: SandboxFile[][] = [];
  let bytes = 0;
  for (const file of files) {
    const size = Buffer.byteLength(file.path) + file.contents.byteLength;
    const line = lines.at(-1);
    if (line === undefined || bytes + size > DEVICE_AGENT_BOUNDS.MAX_FILES_LINE_BYTES) {
      lines.push([file]);
      bytes = size;
    } else {
      line.push(file);
      bytes += size;
    }
  }
  return lines;
}

function objectOf(value: object): DeviceAgentObject {
  return value as DeviceAgentObject;
}

function deviceMachineOver(
  context: Context.Context<DatabaseServices>,
  environment: Option.Option<typeof HostedEnvironment.Service>,
): DeviceMachineService {
  const stored = <A, E>(effect: Effect.Effect<A, E, DatabaseServices>) =>
    effect.pipe(
      Effect.provideContext(context),
      Effect.mapError(() => unavailable()),
    );

  const pinOfPlace = (place: MachinePlace) =>
    Effect.flatMap(stored(deviceAgentPin(place.running)), (pin) =>
      Option.isSome(pin) ? Effect.succeed(pin.value) : Effect.fail(unavailable()),
    );

  const pinOfSession = (session: string) => stored(deviceAgentOfSession(session));

  const layoutOf = (userId: string, agentId: string, deviceId: string | null | undefined) =>
    Effect.gen(function* () {
      if (deviceId === null || deviceId === undefined) {
        return yield* new LaunchRefused({ reason: "no mac" });
      }
      const device = yield* stored(deviceLayout(userId, deviceId));
      if (Option.isNone(device)) {
        return yield* (yield* stored(hostRemoved(userId, deviceId)))
          ? new LaunchRefused({ reason: "host removed", deviceRemoved: true })
          : new LaunchRefused({ reason: "no mac" });
      }
      const folders = deviceAgentLayoutIn(
        device.value.agentsFolder ?? deviceAgentsFolder(device.value.home),
        agentId,
      );
      const layout: MachineLayout = {
        checkoutPath: folders.checkoutPath,
        installedSkills: folders.installedSkills,
        skillsUpload: folders.installedSkills,
        attachments: folders.attachments,
        sharedFiles: folders.temp,
        claudeExecutable: device.value.claudeExecutable,
        codexExecutable: device.value.codexExecutable ?? undefined,
        linesRead: false,
      };
      return layout;
    });

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

  const runnerEnded = (pin: DeviceAgentPin, handle: RunnerHandle) =>
    Effect.map(
      stored(deviceAgentLineStanding(pin.userId, handle.command)),
      (standing) => Option.isNone(standing) || standing.value.settled,
    );

  const present = (pin: DeviceAgentPin) =>
    Effect.gen(function* () {
      if (pin.deviceId === null) return false;
      const now = yield* Clock.currentTimeMillis;
      const since = new Date(now - MAC_PRESENCE.FRESH_MS);
      const seen = yield* stored(devicesSeenSince(pin.userId, since));
      return seen.some((device) => device.id === pin.deviceId);
    });

  const refuseAway = (pin: DeviceAgentPin) =>
    Effect.gen(function* () {
      if (yield* present(pin)) return;
      if (pin.deviceId !== null && (yield* stored(hostRemoved(pin.userId, pin.deviceId)))) {
        return yield* new LaunchRefused({ reason: "host removed", deviceRemoved: true });
      }
      return yield* new LaunchRefused({ reason: "mac away", deviceAway: true });
    });

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
        const held = yield* heldUntil(
          stored(deviceAgentRequestAnswer(userId, id)),
          Option.isSome,
          deviceTopics(userId),
          MAC_MACHINE.POLL,
          MAC_MACHINE.ANSWER_WAIT,
        );
        return Option.flatMap(held, ({ read }) => read);
      }).pipe(Effect.ensuring(Effect.ignore(stored(withdrawDeviceAgentRequest(userId, id)))));
      if (Option.isNone(answer) || answer.value.kind !== kind) return yield* unavailable();
      return answer.value;
    });

  const exitOf = (pin: DeviceAgentPin, handle: RunnerHandle) =>
    Effect.map(
      stored(deviceAgentLineStanding(pin.userId, handle.command)),
      (standing): CommandExit => {
        if (Option.isNone(standing)) return COMMAND_GONE;
        if (!standing.value.settled) return null;
        return standing.value.exitCode ?? COMMAND_GONE;
      },
    );

  const signsInOwnGithub = (pin: DeviceAgentPin) =>
    pin.deviceId === null
      ? Effect.succeed(false)
      : Effect.map(stored(deviceLayout(pin.userId, pin.deviceId)), (standing) =>
          Option.exists(standing, (device) =>
            device.capabilities.includes(DEVICE_CAPABILITY.GITHUB_SIGN_IN),
          ),
        );

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

    findPlaces: (_userId, session) =>
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
          kept: pin.value as unknown as MachineKept,
        };
        return [found];
      }),

    recordRunner: (place, record) =>
      Effect.gen(function* () {
        if (record.kind === RUNNER_RECORD.RUNNING) return;
        const pin = yield* pinOfPlace(macPlace(place.session, place.agentId));
        const launch = yield* stored(latestDeviceAgentLaunch(pin.userId, pin.agentId));
        if (Option.isNone(launch) || launch.value.settled || launch.value.stopped) return;
        yield* queued(pin, { kind: DEVICE_AGENT_LINE_KIND.STOP, payload: {} });
      }),

    firewall: {
      write: () => Effect.void,
      keepLaunch: () => Effect.void,
      endLaunch: () => Effect.void,
      clear: () => Effect.void,
    },

    resume: (found) =>
      found.running === undefined ? Effect.fail(unavailable()) : Effect.succeed(found.running),

    stop: () => Effect.void,

    discard: () => Effect.void,

    writeFiles: (place, files: readonly SandboxFile[]) =>
      Effect.flatMap(pinOfPlace(place), (pin) =>
        Effect.andThen(
          refuseAway(pin),
          Effect.forEach(
            filesLines(files),
            (line) =>
              queued(pin, {
                kind: DEVICE_AGENT_LINE_KIND.FILES,
                payload: objectOf(
                  encodeFilesPayload({
                    files: line.map((file) => ({
                      path: file.path,
                      mode: file.mode,
                      contents: file.contents,
                    })),
                  }),
                ),
              }),
            { discard: true },
          ),
        ),
      ),

    checkOutExtras: () => Effect.void,
    launchRunner: (place, launch) =>
      Effect.gen(function* () {
        const pin = yield* pinOfPlace(place);
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
        const onOwnSignIn =
          hasRepository(agent.value) && agent.value.githubAccess === GITHUB_ACCESS.TOKEN;
        if (onOwnSignIn && !(yield* signsInOwnGithub(pin))) {
          yield* Effect.ignore(launch.abandon(ready));
          return yield* new LaunchRefused({ reason: "host predates its own github sign-in" });
        }
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
            ...(commitsBy === undefined ? {} : { identity: commitsBy }),
            ...(onOwnSignIn ? { githubAccess: DEVICE_GITHUB_ACCESS.TOKEN } : {}),
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
        yield* refuseAway(pin);
        yield* queued(pin, stdinLine(text));
      }),

    wrote: (handle, text) =>
      Effect.flatMap(pinOfPlace(handle), (pin) =>
        stored(deviceAgentLineQueuedAfter(pin.userId, handle.command, stdinLine(text))),
      ),

    runnerExit: (handle, within = MAC_MACHINE.EXIT_WAIT) =>
      Effect.gen(function* () {
        const pin = yield* pinOfPlace(handle);
        const settled = yield* heldUntil(
          exitOf(pin, handle),
          (exit) => exit !== null,
          deviceTopics(pin.userId),
          MAC_MACHINE.POLL,
          within,
        );
        return Option.match(settled, { onNone: () => null, onSome: ({ read }) => read });
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

export const deviceMachine: Effect.Effect<DeviceMachineService, never, DatabaseServices> =
  Effect.gen(function* () {
    const context = yield* Effect.context<DatabaseServices>();
    const environment = yield* Effect.serviceOption(HostedEnvironment);
    return deviceMachineOver(context, environment);
  });
