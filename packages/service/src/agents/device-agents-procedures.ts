/**
 * device-agents-procedures.ts -- a local agent's Mac registers and beats, takes its agents' lines and its tools' requests, and says what came of each.
 *
 * Every procedure but the enrolls reads the device's bearer alone, never a
 * browser's session cookie (`deviceMiddleware`), since a line carries a
 * runner's secrets and an answer is the word of the device that ran it, and
 * names the device's id: the machine's device secret, which acts for its
 * own device alone and answers not found for any other. A desktop's own
 * sign-in, which released desktop builds followed the queue on, is refused
 * there as needing an upgrade.
 * The enroll's bearer is an install token instead (`installTokenMiddleware`),
 * which it trades for a host and the secret it calls on from then on
 * (`@luke/features/host-wire`), answered this once; it refuses an unknown,
 * revoked, or expired token as an invalid token, and the id of one of the
 * token's member's standing hosts as still enrolled. The own enroll's
 * bearer is the desktop's sign-in alone (`bearerOnlyMiddleware`, never a
 * browser's cookie, since it mints a credential), and it converts a device
 * the member's account registered in place under its id, or creates one
 * under the account with the name, platform and architecture the enroll
 * sends where the account never registered the id, answering its new
 * secret this once; it answers not found for another account's id, and
 * for an id the account never registered where the enroll sent no
 * machine, and refuses an enroll naming only some of the machine's fields
 * as invalid. A host's every call,
 * the enroll's included, is refused as needing an upgrade where its daemon
 * is below the floor (`auth/device-secret.ts`). Each answers not found,
 * before it touches a row, where the account has the `local-agents`
 * experiment off, and every one but the
 * register where the account holds no such Mac (`agents/device-agent.ts`); a
 * register under an id another account holds writes nothing and answers
 * not found too, and a register keeps only the capabilities this service
 * knows (`DEVICE_CAPABILITY`), so a newer follower's list is never refused.
 * A held read answers what waits for that Mac (`GET /api/device-agents/lines`,
 * `GET /api/device-agents/requests`), a claim takes one row by its id, a
 * launch line's secrets with it, a line's claim asked again under the
 * token it first carried answers that line again, and a settle or an answer keeps what the
 * Mac said of a row it claimed.
 */

import { accountExperimentOn } from "@luke/database/models/account-store";
import {
  answerDeviceAgentRequest,
  claimDeviceAgentRequest,
  openDeviceAgentLaunches,
} from "@luke/database/models/device-agent-store";
import { beatDevice, registerDevice } from "@luke/database/models/device-store";
import { enrollHost, enrollOwnDevice, HOST_ENROLL_REFUSAL } from "@luke/database/models/host-store";
import { DEVICE_CAPABILITY } from "@luke/features/device-agent-wire";
import { HOST_WIRE, type OwnDeviceEnrollRequest } from "@luke/features/host-wire";
import { EXPERIMENT } from "@luke/settings";
import { Effect, Option } from "effect";
import {
  admittedHostVersion,
  hostSecretHash,
  mintHostSecret,
  presentedHostVersion,
} from "../auth/device-secret.js";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import {
  actsForDevice,
  bearerOnlyMiddleware,
  type DeviceCaller,
  deviceMiddleware,
  hosted,
  installTokenMiddleware,
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

/** The device named, where the caller may act for it (`actsForDevice`); not found otherwise. */
const ownDevice = (caller: DeviceCaller, deviceId: string) =>
  actsForDevice(caller, deviceId) ? Effect.void : Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

/** Not found where the account has the `local-agents` experiment off. */
const experimentOn = (userId: string) =>
  Effect.gen(function* () {
    if (!(yield* hostedStoreOrUnavailable(accountExperimentOn(userId, EXPERIMENT.LOCAL_AGENTS)))) {
      return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    }
  });

/** The caller's own device under its account's experiment, or not found. */
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

/** The device-agents resource: the enroll on an install token, and every other procedure on the device's bearer. */
export function deviceAgentsProcedures(seams: DeviceAgentsProcedureSeams) {
  const deviceAgents = hosted.deviceAgents.use(deviceMiddleware(seams.resolveUserId));
  // Note that each caller middleware is used on the resource rather than its procedure, so it refuses before the input is read, as every procedure's does.
  const enrolling = hosted.deviceAgents.use(installTokenMiddleware);
  const signedIn = hosted.deviceAgents.use(bearerOnlyMiddleware(seams.resolveUserId));
  return {
    enroll: enrolling.enroll.effect(function* ({ context, input }) {
      const { deviceId, ...box } = input;
      const minted = mintHostSecret(HOST_WIRE.DEVICE_SECRET_PREFIX);
      const enrolled = yield* hostedStoreOrUnavailable(
        enrollHost(hostSecretHash(context.installToken), {
          id: deviceId,
          ...box,
          version: context.hostVersion,
          secretHash: minted.hash,
        }),
      );
      if ("refused" in enrolled) {
        return yield* Effect.fail(
          enrolled.refused === HOST_ENROLL_REFUSAL.STILL_ENROLLED
            ? HOSTED_REFUSAL.HOST_STILL_ENROLLED
            : HOSTED_REFUSAL.INVALID_TOKEN,
        );
      }
      return { deviceId, deviceSecret: minted.secret };
    }),
    enrollOwn: signedIn.enrollOwn.effect(function* ({ context, input }) {
      const { userId } = context;
      yield* experimentOn(userId);
      const version = yield* admittedHostVersion(presentedHostVersion(context.request));
      const minted = mintHostSecret(HOST_WIRE.DEVICE_SECRET_PREFIX);
      const machine = yield* enrollingMachine(input);
      const enrolled = yield* hostedStoreOrUnavailable(
        enrollOwnDevice(userId, {
          id: input.deviceId,
          version,
          secretHash: minted.hash,
          ...(machine === undefined ? undefined : { machine }),
        }),
      );
      if (!enrolled) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { deviceId: input.deviceId, deviceSecret: minted.secret };
    }),
    register: deviceAgents.register.effect(function* ({ context, input }) {
      yield* ownDevice(context, input.deviceId);
      const { userId } = context;
      yield* experimentOn(userId);
      const { deviceId, capabilities, ...device } = input;
      const known = Object.values(DEVICE_CAPABILITY).filter((capability) =>
        capabilities?.includes(capability),
      );
      return yield* keptOrNotFound(
        yield* hostedStoreOrUnavailable(
          registerDevice(userId, { id: deviceId, ...device, capabilities: known }),
        ),
      );
    }),
    beat: deviceAgents.beat.effect(function* ({ context, input }) {
      yield* followed(context, input.deviceId);
      yield* keptOrNotFound(
        yield* hostedStoreOrUnavailable(beatDevice(context.userId, input.deviceId, input.signedIn)),
      );
      // Note that the launches are read after the beat is written, so a claim the device finished before it sent the beat is among them.
      const openLaunches = yield* hostedStoreOrUnavailable(
        openDeviceAgentLaunches(context.userId, input.deviceId),
      );
      return { ...DONE, openLaunches };
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
