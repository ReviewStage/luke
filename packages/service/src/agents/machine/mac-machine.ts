/**
 * mac-machine.ts -- the agent machine over the starter's Mac: the runner launched there by a line the Mac follows, its stdin written as more lines, and Luke's doors read through requests the Mac answers.
 *
 * A local agent (`coding_agent.machine` is `mac`) runs its runner on the
 * Mac it is pinned to (`coding_agent.device_id`), which follows the rows the
 * service queues for it (`@luke/database/models/mac-agent-store`, the wire
 * in `@luke/features/mac-agent-wire`) and answers through its procedures
 * (`../mac-agents-procedures.ts`). Nothing here reaches the Mac directly:
 * every call is a row, and the Mac's word is a row it settled or answered.
 *
 * `layout` and `open` answer at once, from the agent and the home folder its
 * Mac registered, with no round trip: the agent's folder in that home holds
 * its worktree, which the Mac makes as it takes the launch line, the files
 * a message carries, and the skills its member installed into Luke
 * (`macAgentLayout`). `launchRunner` queues the launch line, its runner's
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
 * (`mac-agent-store.ts`'s header). The other calls queue no line: the Mac
 * has no firewall Luke sets, so `setCredential` does nothing, and nothing
 * to stop, resume, or throw away, since its worktree is the developer's own
 * and a warm runner ends by itself at its idle cap, settling its line.
 *
 * Whether a runner runs is read off the agent's newest launch line, which
 * stands for the record a sandbox keeps in its tags: it runs while that
 * line is unsettled and no stop line was queued after it, so a Stop is
 * honoured the moment it is queued, whenever the Mac gets to it. A record
 * that no longer tells of a runner still running, as a retire's, queues a
 * stop line after it for the same reason, so a message sent next relaunches
 * rather than landing behind a line the runner ends on.
 *
 * `readFile` and `runRepositoryCommand` queue a request under an id they
 * mint, wait for its answer at most `MAC_MACHINE.ANSWER_WAIT`, and withdraw
 * it however the wait ends; a Mac that has not beaten within
 * `MAC_MACHINE.PRESENCE` is away, and the call is unavailable at once, as a
 * stopped sandbox's is.
 */

import { randomUUID } from "node:crypto";
import type { DatabaseServices } from "@luke/database/core/query";
import { readCodingAgent } from "@luke/database/models/coding-agent-store";
import {
  latestMacAgentLaunch,
  type MacAgentPin,
  macAgentLineStanding,
  macAgentOfSession,
  macAgentPin,
  macAgentRequestAnswer,
  queueMacAgentLine,
  queueMacAgentRequest,
  withdrawMacAgentRequest,
} from "@luke/database/models/mac-agent-store";
import { macDeviceLayout, macDevicesSeenSince } from "@luke/database/models/mac-device-store";
import { parseKeyRing, sealMacLaunchSecrets } from "@luke/database/models/provider-key-seal";
import { CODING_AGENT_MACHINE } from "@luke/features/coding-agent-wire";
import {
  MAC_AGENT_BOUNDS,
  MAC_AGENT_LINE_KIND,
  MAC_AGENT_REQUEST_KIND,
  type MacAgentAnswer,
  type MacAgentLaunchPayload,
  type MacAgentObject,
  macAgentFilesPayloadSchema,
  macAgentLaunchPayloadSchema,
  macAgentLaunchSecretsSchema,
  macAgentLayout,
} from "@luke/features/mac-agent-wire";
import {
  Brand,
  Clock,
  type Context,
  Duration,
  Effect,
  Option,
  Redacted,
  Result,
  Schedule,
  Schema,
} from "effect";
import { HostedEnvironment } from "../../environment.js";
import {
  COMMAND_GONE,
  type CommandExit,
  type CommandRun,
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
  /** How lately a Mac must have beaten to be there: one beat, and room for the next to arrive. */
  PRESENCE: Duration.seconds(45),
} as const;

/**
 * The machine over the Mac, and whether a session is a local agent's, which
 * the router asks first (`agent-machines.ts`). Its open and its launch reach
 * none of the services a sandbox's do, only the store it was made over.
 */
export interface MacMachineService extends AgentMachineService {
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
    R | RL
  >;
}

const runningOfAgent = Brand.nominal<MachineRunning>();
const nameOfAgent = Brand.nominal<MachineName>();

const encodeFilesPayload = Schema.encodeSync(macAgentFilesPayloadSchema);
const encodeLaunchPayload = Schema.encodeSync(macAgentLaunchPayloadSchema);
const encodeSecrets = Schema.encodeSync(Schema.fromJsonString(macAgentLaunchSecretsSchema));

/** A local agent's place on its Mac, under Luke's session given: the agent itself, since it has one place. */
function macPlace(session: string, agentId: string): MachinePlace {
  return { machine: CODING_AGENT_MACHINE.MAC, session, running: runningOfAgent(agentId) };
}

/** A failure the store or the seal answered, as a machine's own: unavailable, with no words of the cause. */
function unavailable(): SandboxUnavailable {
  return new SandboxUnavailable({});
}

/** A line's payload as the row holds it: a JSON object. */
function objectOf(value: object): MacAgentObject {
  // SAFETY: every payload is a struct's encoded form, a JSON object of string keys.
  return value as MacAgentObject;
}

/**
 * The machine over the account's Macs, its store calls made on the services
 * given and its launches sealed under the deployment's key ring, where the
 * services carry one.
 */
function macMachineOver(
  context: Context.Context<DatabaseServices>,
  environment: Option.Option<typeof HostedEnvironment.Service>,
): MacMachineService {
  /** One store call on the services given, a failure of it unavailable. */
  const stored = <A, E>(effect: Effect.Effect<A, E, DatabaseServices>) =>
    effect.pipe(
      Effect.provideContext(context),
      Effect.mapError(() => unavailable()),
    );

  /** The local agent a place names, by its id. */
  const pinOfPlace = (place: MachinePlace) =>
    Effect.flatMap(stored(macAgentPin(place.running)), (pin) =>
      Option.isSome(pin) ? Effect.succeed(pin.value) : Effect.fail(unavailable()),
    );

  /** The local agent running in the session, where one does. */
  const pinOfSession = (session: string) => stored(macAgentOfSession(session));

  /** Where the agent's things stand on its Mac, from the home folder that Mac registered; refused where it is pinned to no Mac of its starter's. */
  const layoutOf = (userId: string, agentId: string, deviceId: string | null | undefined) =>
    Effect.gen(function* () {
      if (deviceId === null || deviceId === undefined) {
        return yield* new LaunchRefused({ reason: "no mac" });
      }
      const device = yield* stored(macDeviceLayout(userId, deviceId));
      if (Option.isNone(device)) return yield* new LaunchRefused({ reason: "no mac" });
      const folders = macAgentLayout(device.value.home, agentId);
      const layout: MachineLayout = {
        checkoutPath: folders.checkoutPath,
        installedSkills: folders.installedSkills,
        // Note that the Mac writes the skills where they are installed, since no root installs them after.
        skillsUpload: folders.installedSkills,
        attachments: folders.attachments,
        claudeExecutable: device.value.claudeExecutable,
        codexExecutable: device.value.codexExecutable ?? undefined,
        writableRoots: [folders.folder],
        signedIn: device.value.signedIn,
      };
      return layout;
    });

  /** One line queued for the agent; unavailable where the store holds no such agent on a Mac. */
  const queued = (
    pin: MacAgentPin,
    line: {
      readonly id?: string;
      readonly kind: (typeof MAC_AGENT_LINE_KIND)[keyof typeof MAC_AGENT_LINE_KIND];
      readonly payload: MacAgentObject;
      readonly sealedSecrets?: string;
    },
  ) =>
    Effect.flatMap(
      stored(queueMacAgentLine(pin.userId, { agentId: pin.agentId, ...line })),
      (row) => (Option.isSome(row) ? Effect.void : Effect.fail(unavailable())),
    );

  /** Whether the runner a handle names has ended: its launch line settled, or gone. */
  const runnerEnded = (pin: MacAgentPin, handle: RunnerHandle) =>
    Effect.map(
      stored(macAgentLineStanding(pin.userId, handle.command)),
      (standing) => Option.isNone(standing) || standing.value.settled,
    );

  /** Whether the agent's Mac has beaten lately. */
  const present = (pin: MacAgentPin) =>
    Effect.gen(function* () {
      if (pin.deviceId === null) return false;
      const now = yield* Clock.currentTimeMillis;
      const since = new Date(now - Duration.toMillis(MAC_MACHINE.PRESENCE));
      const seen = yield* stored(macDevicesSeenSince(pin.userId, since));
      return seen.some((device) => device.id === pin.deviceId);
    });

  /**
   * One request asked of the agent's Mac and its answer waited for, the row
   * withdrawn however the wait ends; unavailable where the Mac is away, or
   * did not answer in time.
   */
  const asked = (
    session: string,
    kind: (typeof MAC_AGENT_REQUEST_KIND)[keyof typeof MAC_AGENT_REQUEST_KIND],
    args: MacAgentObject,
  ) =>
    Effect.gen(function* () {
      const pin = yield* pinOfSession(session);
      if (Option.isNone(pin) || !(yield* present(pin.value))) return yield* unavailable();
      const { userId, agentId } = pin.value;
      const id = randomUUID();
      const answer = yield* Effect.gen(function* () {
        if (!(yield* stored(queueMacAgentRequest(userId, { id, agentId, kind, args })))) {
          return Option.none<MacAgentAnswer>();
        }
        return yield* stored(macAgentRequestAnswer(userId, id)).pipe(
          Effect.repeat({ schedule: Schedule.spaced(MAC_MACHINE.POLL), until: Option.isSome }),
          Effect.timeoutOption(MAC_MACHINE.ANSWER_WAIT),
          Effect.map(Option.flatten),
        );
      }).pipe(Effect.ensuring(Effect.ignore(stored(withdrawMacAgentRequest(userId, id)))));
      if (Option.isNone(answer) || answer.value.kind !== kind) return yield* unavailable();
      return answer.value;
    });

  /** The runner's exit as its launch line was settled: its code, gone where it settled with none or the line is gone, null while it runs. */
  const exitOf = (pin: MacAgentPin, handle: RunnerHandle) =>
    Effect.map(
      stored(macAgentLineStanding(pin.userId, handle.command)),
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
        const launch = yield* stored(latestMacAgentLaunch(userId, agentId));
        const place = macPlace(session, agentId);
        const payload = Option.flatMap(launch, (line) =>
          Option.getSuccess(Schema.decodeUnknownResult(macAgentLaunchPayloadSchema)(line.payload)),
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
          machine: CODING_AGENT_MACHINE.MAC,
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
        const launch = yield* stored(latestMacAgentLaunch(pin.userId, pin.agentId));
        if (Option.isNone(launch) || launch.value.settled || launch.value.stopped) return;
        yield* queued(pin, { kind: MAC_AGENT_LINE_KIND.STOP, payload: {} });
      }),

    setCredential: () => Effect.void,

    // A local agent's place never stops, so it runs where it stands, and a runner that ended is launched again.
    resume: (found) =>
      found.running === undefined ? Effect.fail(unavailable()) : Effect.succeed(found.running),

    stop: () => Effect.void,

    // The worktree is the developer's own, so nothing is thrown away; a retired bearer shuts its runner out.
    discard: () => Effect.void,

    writeFiles: (place, files: readonly SandboxFile[]) =>
      Effect.flatMap(pinOfPlace(place), (pin) =>
        queued(pin, {
          kind: MAC_AGENT_LINE_KIND.FILES,
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

    // The secrets and the first lines are sealed together, bound to the agent, before the line is
    // queued; a launch whose line was not queued undoes what its caller recorded of it.
    launchRunner: (place, launch) =>
      Effect.gen(function* () {
        const pin = yield* pinOfPlace(place);
        const [ready, agent, ring] = yield* Effect.all(
          [launch.ready, stored(readCodingAgent(pin.userId, pin.agentId)), keyRing],
          { concurrency: "unbounded" },
        );
        if (Option.isNone(agent)) return yield* new LaunchRefused({ reason: "no agent" });
        const id = randomUUID();
        const handle: RunnerHandle = { ...place, command: id };
        yield* Effect.gen(function* () {
          const layout = yield* layoutOf(pin.userId, pin.agentId, pin.deviceId);
          const { lines, mark } = yield* launch.firstLines(ready, handle);
          const sealedSecrets = sealMacLaunchSecrets(
            ring,
            { userId: pin.userId, agentId: pin.agentId },
            Redacted.make(encodeSecrets({ env: launch.env, stdin: lines })),
          );
          const payload: MacAgentLaunchPayload = {
            checkoutPath: layout.checkoutPath,
            repository: agent.value.repository,
            startBranch: agent.value.startBranch,
            firstSequence: mark.firstSequence,
            ...(mark.fingerprint === undefined ? {} : { fingerprint: mark.fingerprint }),
            ...(mark.ownLogin === true ? { ownLogin: true } : {}),
          };
          yield* queued(pin, {
            id,
            kind: MAC_AGENT_LINE_KIND.LAUNCH,
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
        yield* queued(pin, { kind: MAC_AGENT_LINE_KIND.MESSAGE, payload: { text } });
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
        yield* queued(pin, { kind: MAC_AGENT_LINE_KIND.STOP, payload: {} });
      }),

    readFile: (session, path, bound) =>
      Effect.map(
        asked(session, MAC_AGENT_REQUEST_KIND.READ_FILE, {
          path,
          maxBytes: Math.min(bound, MAC_AGENT_BOUNDS.MAX_ANSWER_BYTES) + 1,
        }),
        (answer) =>
          answer.kind === MAC_AGENT_REQUEST_KIND.READ_FILE && answer.bytes !== null
            ? answer.bytes
            : undefined,
      ),

    // Note that the command runs in the agent's worktree whatever folder it names, because a
    // repository's command names the folder its sandbox keeps the checkout in.
    runRepositoryCommand: (session, command) =>
      Effect.flatMap(
        asked(session, MAC_AGENT_REQUEST_KIND.RUN_COMMAND, {
          command: command.command,
          ...(command.env === undefined ? {} : { env: command.env }),
        }),
        (answer): Effect.Effect<CommandRun, SandboxUnavailable> =>
          answer.kind === MAC_AGENT_REQUEST_KIND.RUN_COMMAND
            ? Effect.succeed({
                exitCode: answer.exitCode,
                stdout: answer.stdout,
                stderr: answer.stderr,
              })
            : Effect.fail(unavailable()),
      ),
  };
}

/** The machine over the account's Macs, on the calling fiber's store and, where it has one, the deployment's key ring. */
export const macMachine: Effect.Effect<MacMachineService, never, DatabaseServices> = Effect.gen(
  function* () {
    const context = yield* Effect.context<DatabaseServices>();
    const environment = yield* Effect.serviceOption(HostedEnvironment);
    return macMachineOver(context, environment);
  },
);
