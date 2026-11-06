import { isIP } from "node:net";
import {
  answerDeviceAgentRequest,
  claimDeviceAgentRequest,
  liveDeviceAgents,
  openDeviceAgentLaunches,
  stepDeviceAgentLaunch,
} from "@repo/database/models/device-agent-store";
import { beatDevice, machineColumns } from "@repo/database/models/device-store";
import {
  HOST_PAIRING,
  type HostPairingOpening,
  openHostPairing,
  pollHostPairing,
} from "@repo/database/models/host-pairing-store";
import { enrollOwnDevice, hostsOf, registerHost } from "@repo/database/models/host-store";
import type { DeviceAgentRelease } from "@repo/features/device-agent-wire";
import { HOST_RELEASE } from "@repo/features/host-release";
import {
  HOST_PAIRING_POLL_STATUS,
  HOST_WIRE,
  hostConnectPath,
  hostVersionMeets,
  type OwnDeviceEnrollRequest,
  shownHostUserCode,
} from "@repo/features/host-wire";
import { Duration, Effect, Option } from "effect";
import {
  admittedHostVersion,
  hostSecretHash,
  mintHostSecret,
  mintHostUserCode,
  presentedHostVersion,
} from "../auth/device-secret.js";
import { recordServerEvent, SERVER_EVENT, SERVER_HOST_KIND } from "../events/server-events.js";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { makeRateBrake } from "../http/rate-brake.js";
import {
  actsForDevice,
  bearerOnlyMiddleware,
  type DeviceCaller,
  deviceMiddleware,
  hosted,
  pairingHostMiddleware,
  pollSecretMiddleware,
} from "../orpc/base.js";
import {
  claimedDeviceAgentLine,
  deviceAgentDeviceOf,
  deviceAgentLinesFor,
  deviceAgentRequestsFor,
  settledDeviceAgentLine,
} from "./device-agent.js";
import { removeAccountHost } from "./hosts-procedures.js";
import { settleLostHostTurns } from "./lost-host-turns.js";

export interface DeviceAgentsProcedureSeams {
  resolveUserId: UserIdResolver;
}

const DONE = { done: true } as const;

const ADDRESS_HEADER = {
  REAL_IP: "x-real-ip",
  FORWARDED_FOR: "x-forwarded-for",
} as const;

const UNNAMED_ADDRESS = "unnamed";

const PAIRING_START_BRAKE = {
  windowMs: 10 * 60 * 1_000,
  maxRequestsPerWindow: 10,
  maxTrackedUsers: 10_000,
};

function requestAddressOf(request: Request): string | undefined {
  const named =
    request.headers.get(ADDRESS_HEADER.REAL_IP) ??
    request.headers.get(ADDRESS_HEADER.FORWARDED_FOR)?.split(",")[0];
  const address = named?.trim() ?? "";
  return isIP(address) === 0 ? undefined : address;
}

function connectUrlOf(request: Request, userCode: string): string {
  return new URL(hostConnectPath(userCode), new URL(request.url).origin).href;
}

const openedPairing = (opening: Omit<HostPairingOpening, "userCode">) =>
  Effect.gen(function* () {
    const userCode = mintHostUserCode();
    const opened = yield* hostedStoreOrUnavailable(openHostPairing({ ...opening, userCode }));
    if (Option.isSome(opened)) return userCode;
    yield* Effect.logError("the pairing code minted was already shown");
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  });

const ownDevice = (caller: DeviceCaller, deviceId: string) =>
  actsForDevice(caller, deviceId) ? Effect.void : Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

const followed = (caller: DeviceCaller, deviceId: string) =>
  Effect.gen(function* () {
    yield* ownDevice(caller, deviceId);
    const { userId } = caller;
    if (!(yield* hostedStoreOrUnavailable(deviceAgentDeviceOf(userId, deviceId)))) {
      return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    }
  });

const enrollingMachine = ({ name, platform, arch }: OwnDeviceEnrollRequest) => {
  if (name !== undefined && platform !== undefined && arch !== undefined) {
    return Effect.succeed({ name, platform, arch });
  }
  return name === undefined && platform === undefined && arch === undefined
    ? Effect.succeed(undefined)
    : Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
};

const keptOrNotFound = (kept: boolean) =>
  kept ? Effect.succeed(DONE) : Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

function newerReleaseFor(request: Request): DeviceAgentRelease | undefined {
  const version = presentedHostVersion(request);
  if (HOST_RELEASE === undefined || version === undefined) return undefined;
  if (hostVersionMeets(version, HOST_RELEASE.VERSION)) return undefined;
  return { version: HOST_RELEASE.VERSION, sha256: HOST_RELEASE.SHA256 };
}

export function deviceAgentsProcedures(seams: DeviceAgentsProcedureSeams) {
  const deviceAgents = hosted.deviceAgents.use(deviceMiddleware());
  const signedIn = hosted.deviceAgents.use(bearerOnlyMiddleware(seams.resolveUserId));
  const pairing = hosted.deviceAgents.use(pairingHostMiddleware);
  const polling = hosted.deviceAgents.use(pollSecretMiddleware);
  const startBrake = makeRateBrake(PAIRING_START_BRAKE);
  return {
    startPairing: pairing.startPairing.effect(function* ({ context, input }) {
      const ip = requestAddressOf(context.request);
      if (!(yield* startBrake.check(ip ?? UNNAMED_ADDRESS))) {
        return yield* Effect.fail(HOSTED_REFUSAL.QUOTA_EXHAUSTED);
      }
      const poll = mintHostSecret(HOST_WIRE.POLL_SECRET_PREFIX);
      const { name, platform, arch } = input;
      const userCode = yield* openedPairing({
        pollSecretHash: poll.hash,
        name,
        platform,
        arch,
        version: context.hostVersion,
        ip: ip ?? null,
      });
      return {
        pollSecret: poll.secret,
        userCode: shownHostUserCode(userCode),
        url: connectUrlOf(context.request, userCode),
        expiresInMs: Duration.toMillis(HOST_PAIRING.LIFETIME),
        intervalMs: Duration.toMillis(HOST_PAIRING.POLL_INTERVAL),
      };
    }),
    pollPairing: polling.pollPairing.effect(function* ({ context }) {
      const minted = mintHostSecret(HOST_WIRE.DEVICE_SECRET_PREFIX);
      const polled = yield* hostedStoreOrUnavailable(
        pollHostPairing(hostSecretHash(context.pollSecret), minted.hash),
      );
      if (polled.status !== HOST_PAIRING_POLL_STATUS.APPROVED) return { status: polled.status };
      yield* recordServerEvent(
        SERVER_EVENT.HOST_INSTALL,
        { userId: polled.userId },
        {
          kind: SERVER_HOST_KIND.BOX_HOST,
        },
      );
      return { status: polled.status, deviceId: polled.deviceId, deviceSecret: minted.secret };
    }),
    enrollOwn: signedIn.enrollOwn.effect(function* ({ context, input }) {
      const { userId } = context;
      const version = yield* admittedHostVersion(presentedHostVersion(context.request));
      const minted = mintHostSecret(HOST_WIRE.DEVICE_SECRET_PREFIX);
      const machine = yield* enrollingMachine(input);
      const before = yield* hostedStoreOrUnavailable(hostsOf(userId));
      const enrolled = yield* hostedStoreOrUnavailable(
        enrollOwnDevice(userId, {
          id: input.deviceId,
          version,
          secretHash: minted.hash,
          ...machineColumns(input),
          ...(machine === undefined ? undefined : { machine }),
        }),
      );
      if (Option.isNone(enrolled)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      yield* settleLostHostTurns(enrolled.value);
      if (!before.some((host) => host.id === input.deviceId)) {
        yield* recordServerEvent(
          SERVER_EVENT.HOST_INSTALL,
          { userId },
          {
            kind: SERVER_HOST_KIND.THIS_MAC,
          },
        );
      }
      return { deviceId: input.deviceId, deviceSecret: minted.secret };
    }),
    leave: deviceAgents.leave.effect(function* ({ context, input }) {
      yield* ownDevice(context, input.deviceId);
      yield* removeAccountHost(context.userId, input.deviceId);
      return DONE;
    }),
    register: deviceAgents.register.effect(function* ({ context, input }) {
      yield* ownDevice(context, input.deviceId);
      const { userId } = context;
      const { deviceId, ...device } = input;
      const registered = yield* hostedStoreOrUnavailable(
        registerHost(userId, { id: deviceId, ...device }),
      );
      if (Option.isNone(registered)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      yield* settleLostHostTurns(registered.value);
      return DONE;
    }),
    beat: deviceAgents.beat.effect(function* ({ context, input }) {
      yield* followed(context, input.deviceId);
      const { deviceId, update, updateFailure } = input;
      yield* keptOrNotFound(
        yield* hostedStoreOrUnavailable(
          beatDevice(context.userId, deviceId, { update, updateFailure }),
        ),
      );
      const openLaunches = yield* hostedStoreOrUnavailable(
        openDeviceAgentLaunches(context.userId, deviceId),
      );
      const release = newerReleaseFor(context.request);
      return { ...DONE, openLaunches, ...(release === undefined ? undefined : { release }) };
    }),
    liveAgents: deviceAgents.liveAgents.effect(function* ({ context, input }) {
      yield* followed(context, input.deviceId);
      const agentIds = yield* hostedStoreOrUnavailable(
        liveDeviceAgents(context.userId, input.deviceId),
      );
      return { agentIds };
    }),
    lines: deviceAgents.lines.effect(function* ({ context, input }) {
      yield* followed(context, input.deviceId);
      const lines = yield* hostedStoreOrUnavailable(
        deviceAgentLinesFor(context.userId, input.deviceId),
      );
      return { lines };
    }),
    claimLine: deviceAgents.claimLine.effect(function* ({ context, input }) {
      yield* followed(context, input.deviceId);
      const claimed = yield* hostedStoreOrUnavailable(
        claimedDeviceAgentLine(context.userId, input.deviceId, input.id, input.claimToken),
      );
      if (Option.isNone(claimed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return claimed.value;
    }),
    lineStep: deviceAgents.lineStep.effect(function* ({ context, input }) {
      yield* followed(context, input.deviceId);
      return yield* keptOrNotFound(
        yield* hostedStoreOrUnavailable(
          stepDeviceAgentLaunch(context.userId, input.deviceId, input.id, input.step),
        ),
      );
    }),
    settleLine: deviceAgents.settleLine.effect(function* ({ context, input }) {
      yield* followed(context, input.deviceId);
      return yield* keptOrNotFound(
        yield* hostedStoreOrUnavailable(
          settledDeviceAgentLine(
            context.userId,
            input.deviceId,
            input.id,
            input.exitCode,
            input.unstarted,
          ),
        ),
      );
    }),
    requests: deviceAgents.requests.effect(function* ({ context, input }) {
      yield* followed(context, input.deviceId);
      const requests = yield* hostedStoreOrUnavailable(
        deviceAgentRequestsFor(context.userId, input.deviceId),
      );
      return { requests };
    }),
    claimRequest: deviceAgents.claimRequest.effect(function* ({ context, input }) {
      yield* followed(context, input.deviceId);
      const claimed = yield* hostedStoreOrUnavailable(
        claimDeviceAgentRequest(context.userId, input.deviceId, input.id),
      );
      if (Option.isNone(claimed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { request: claimed.value };
    }),
    answerRequest: deviceAgents.answerRequest.effect(function* ({ context, input }) {
      yield* followed(context, input.deviceId);
      return yield* keptOrNotFound(
        yield* hostedStoreOrUnavailable(
          answerDeviceAgentRequest(context.userId, input.deviceId, input.id, input.answer),
        ),
      );
    }),
  };
}
