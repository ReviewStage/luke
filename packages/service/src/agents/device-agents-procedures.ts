/**
 * device-agents-procedures.ts -- a local agent's Mac registers and beats, takes its agents' lines and its tools' requests, and says what came of each; a box pairs with a code.
 *
 * Every procedure but the own enroll and the pairing's reads the device's
 * bearer alone, never a browser's session cookie (`deviceMiddleware`), since
 * a line carries a runner's secrets and an answer is the word of the device
 * that ran it, and names the device's id: the machine's device secret, which
 * acts for its own device alone and answers not found for any other. A
 * desktop's own sign-in, which released desktop builds followed the queue
 * on, is refused there as needing an upgrade. The own enroll's bearer is the
 * desktop's sign-in alone (`bearerOnlyMiddleware`, never a browser's cookie,
 * since it mints a credential), and it converts a device the member's account registered in place under its id, or creates one
 * under the account with the name, platform and architecture the enroll
 * sends where the account never registered the id, answering its new
 * secret this once; it answers not found for another account's id, and
 * for an id the account never registered where the enroll sent no
 * machine, and refuses an enroll naming only some of the machine's fields
 * as invalid. A host's every call,
 * the enroll's included, is refused as needing an upgrade where its daemon
 * is below the floor (`auth/device-secret.ts`). Every one but the enroll
 * and the register answers not found where the account holds no such Mac
 * (`agents/device-agent.ts`); a
 * register under an id another account holds writes nothing and answers
 * not found too, and a register keeps only the capabilities this service
 * knows (`DEVICE_CAPABILITY`), so a newer follower's list is never refused.
 * A beat keeps where the host's update stands, cleared by one naming none,
 * and answers the release published (`HOST_RELEASE`) where the host's
 * daemon is below it, which the host updates itself to.
 * The live agents' read answers the ids of the account's agents pinned to
 * that Mac and not archived (`GET /api/device-agents/live-agents`), which
 * the Mac keeps and removes everything else of Luke's it holds against.
 * A held read answers what waits for that Mac (`GET /api/device-agents/lines`,
 * `GET /api/device-agents/requests`), a claim takes one row by its id, a
 * launch line's secrets with it, a line's claim asked again under the
 * token it first carried answers that line again, and a settle or an answer keeps what the
 * Mac said of a row it claimed.
 *
 * A box pairs with a code. Its start
 * (`POST /api/device-agents/pairing`) reads no credential, only its
 * daemon's version against the floor (`pairingHostMiddleware`), and is
 * braked per address in this instance, since a start costs little and
 * lapses; it opens a pairing under a fresh code and answers the poll
 * secret, answered this once and kept as a hash, the code, and the link
 * on the origin the request reached that opens it. Its poll
 * (`POST /api/device-agents/pairing/poll`) reads the poll secret as its
 * bearer alone (`pollSecretMiddleware`), and answers where the pairing
 * stands (`@luke/database/models/host-pairing-store`): once a member
 * approved it, the host's id and a device secret minted for it, this once,
 * counted as an install as an own enroll is.
 */

import { isIP } from "node:net";
import {
  answerDeviceAgentRequest,
  claimDeviceAgentRequest,
  liveDeviceAgents,
  openDeviceAgentLaunches,
} from "@luke/database/models/device-agent-store";
import { beatDevice, registerDevice } from "@luke/database/models/device-store";
import {
  HOST_PAIRING,
  type HostPairingOpening,
  openHostPairing,
  pollHostPairing,
} from "@luke/database/models/host-pairing-store";
import { enrollOwnDevice, hostsOf } from "@luke/database/models/host-store";
import { type DeviceAgentRelease, knownDeviceCapabilities } from "@luke/features/device-agent-wire";
import { HOST_RELEASE } from "@luke/features/host-release";
import {
  HOST_PAIRING_POLL_STATUS,
  HOST_WIRE,
  hostConnectPath,
  hostVersionMeets,
  type OwnDeviceEnrollRequest,
  shownHostUserCode,
} from "@luke/features/host-wire";
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

export interface DeviceAgentsProcedureSeams {
  /** The account behind a desktop's request, read from its bearer alone: the own enroll's caller, and a released desktop build's, refused elsewhere as needing an upgrade (`deviceMiddleware`). */
  resolveUserId: UserIdResolver;
}

const DONE = { done: true } as const;

/** The headers the platform names a request's address in: Vercel sets both and overwrites any a caller sent, so no caller names its own. */
const ADDRESS_HEADER = {
  REAL_IP: "x-real-ip",
  FORWARDED_FOR: "x-forwarded-for",
} as const;

/** The brake's key for every start whose address the platform did not name, as on a machine of a developer's own. */
const UNNAMED_ADDRESS = "unnamed";

/** How many pairings one address may start: ten in ten minutes, a box started again several times over with room to spare. */
const PAIRING_START_BRAKE = {
  windowMs: 10 * 60 * 1_000,
  maxRequestsPerWindow: 10,
  maxTrackedUsers: 10_000,
};

/** How many fresh codes a start tries, each one a standing pairing already showed, before it is answered unavailable. */
const USER_CODE_TRIES = 3;

/** The address a request came from as the platform named it, or nothing where it named none that reads as one. */
function requestAddressOf(request: Request): string | undefined {
  const named =
    request.headers.get(ADDRESS_HEADER.REAL_IP) ??
    request.headers.get(ADDRESS_HEADER.FORWARDED_FOR)?.split(",")[0];
  const address = named?.trim() ?? "";
  return isIP(address) === 0 ? undefined : address;
}

/** The link that opens the code given on the origin the request reached, so a Preview's box links its own. */
function connectUrlOf(request: Request, userCode: string): string {
  return new URL(hostConnectPath(userCode), new URL(request.url).origin).href;
}

/** A pairing opened under a fresh code, answering the code; another is minted where a standing pairing shows the one tried. */
const openedPairing = (opening: Omit<HostPairingOpening, "userCode">) =>
  Effect.gen(function* () {
    for (let tried = 0; tried < USER_CODE_TRIES; tried += 1) {
      const userCode = mintHostUserCode();
      const opened = yield* hostedStoreOrUnavailable(openHostPairing({ ...opening, userCode }));
      if (Option.isSome(opened)) return userCode;
    }
    yield* Effect.logError("no fresh pairing code was free after every try");
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  });

/** The device named, where the caller may act for it (`actsForDevice`); not found otherwise. */
const ownDevice = (caller: DeviceCaller, deviceId: string) =>
  actsForDevice(caller, deviceId) ? Effect.void : Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

/** The caller's own device, or not found. */
const followed = (caller: DeviceCaller, deviceId: string) =>
  Effect.gen(function* () {
    yield* ownDevice(caller, deviceId);
    const { userId } = caller;
    if (!(yield* hostedStoreOrUnavailable(deviceAgentDeviceOf(userId, deviceId)))) {
      return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    }
  });

/** The machine an own enroll names, all of its name, platform and architecture or none; refused as invalid where it names only some. */
const enrollingMachine = ({ name, platform, arch }: OwnDeviceEnrollRequest) => {
  if (name !== undefined && platform !== undefined && arch !== undefined) {
    return Effect.succeed({ name, platform, arch });
  }
  return name === undefined && platform === undefined && arch === undefined
    ? Effect.succeed(undefined)
    : Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
};

/** Kept, or not found where the account holds no such row. */
const keptOrNotFound = (kept: boolean) =>
  kept ? Effect.succeed(DONE) : Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

/**
 * The release a beat names, where one is published and the request's
 * daemon is below it (`HOST_RELEASE`); none otherwise, so a host on it or
 * past it, a Preview's ahead of it among them, is told of nothing.
 */
function newerReleaseFor(request: Request): DeviceAgentRelease | undefined {
  const version = presentedHostVersion(request);
  if (HOST_RELEASE === undefined || version === undefined) return undefined;
  if (hostVersionMeets(version, HOST_RELEASE.VERSION)) return undefined;
  return { version: HOST_RELEASE.VERSION, sha256: HOST_RELEASE.SHA256 };
}

/** The device-agents resource: the own enroll on the desktop's sign-in, a pairing's start on no credential and its poll on its poll secret, and every other procedure on the device's bearer. */
export function deviceAgentsProcedures(seams: DeviceAgentsProcedureSeams) {
  const deviceAgents = hosted.deviceAgents.use(deviceMiddleware(seams.resolveUserId));
  // Note that each caller middleware is used on the resource rather than its procedure, so it refuses before the input is read, as every procedure's does.
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
      const userCode = yield* openedPairing({
        pollSecretHash: poll.hash,
        ...input,
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
      // Note that a secret is minted for every poll, and the store keeps its hash only where it hands the pairing over.
      const minted = mintHostSecret(HOST_WIRE.DEVICE_SECRET_PREFIX);
      const polled = yield* hostedStoreOrUnavailable(
        pollHostPairing(hostSecretHash(context.pollSecret), minted.hash),
      );
      if (polled.status !== HOST_PAIRING_POLL_STATUS.APPROVED) return { status: polled.status };
      yield* recordServerEvent(SERVER_EVENT.HOST_INSTALL, polled.userId, {
        kind: SERVER_HOST_KIND.LUKE_HOST,
      });
      return { status: polled.status, deviceId: polled.deviceId, deviceSecret: minted.secret };
    }),
    enrollOwn: signedIn.enrollOwn.effect(function* ({ context, input }) {
      const { userId } = context;
      const version = yield* admittedHostVersion(presentedHostVersion(context.request));
      const minted = mintHostSecret(HOST_WIRE.DEVICE_SECRET_PREFIX);
      const machine = yield* enrollingMachine(input);
      // Note that a Mac enrolled before is keyed again here, which is no new install, so it is read first.
      const before = yield* hostedStoreOrUnavailable(hostsOf(userId));
      const enrolled = yield* hostedStoreOrUnavailable(
        enrollOwnDevice(userId, {
          id: input.deviceId,
          version,
          secretHash: minted.hash,
          ...(machine === undefined ? undefined : { machine }),
        }),
      );
      if (!enrolled) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      if (!before.some((host) => host.id === input.deviceId)) {
        yield* recordServerEvent(SERVER_EVENT.HOST_INSTALL, userId, {
          kind: SERVER_HOST_KIND.THIS_MAC,
        });
      }
      return { deviceId: input.deviceId, deviceSecret: minted.secret };
    }),
    register: deviceAgents.register.effect(function* ({ context, input }) {
      yield* ownDevice(context, input.deviceId);
      const { userId } = context;
      const { deviceId, capabilities, ...device } = input;
      const known = knownDeviceCapabilities(capabilities ?? []);
      return yield* keptOrNotFound(
        yield* hostedStoreOrUnavailable(
          registerDevice(userId, { id: deviceId, ...device, capabilities: known }),
        ),
      );
    }),
    beat: deviceAgents.beat.effect(function* ({ context, input }) {
      yield* followed(context, input.deviceId);
      const { deviceId, signedIn, update, updateFailure } = input;
      yield* keptOrNotFound(
        yield* hostedStoreOrUnavailable(
          beatDevice(context.userId, deviceId, signedIn, { update, updateFailure }),
        ),
      );
      // Note that the launches are read after the beat is written, so a claim the device finished before it sent the beat is among them.
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
    settleLine: deviceAgents.settleLine.effect(function* ({ context, input }) {
      yield* followed(context, input.deviceId);
      return yield* keptOrNotFound(
        yield* hostedStoreOrUnavailable(
          settledDeviceAgentLine(
            context.userId,
            input.deviceId,
            input.id,
            input.exitCode,
            input.refusal,
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
