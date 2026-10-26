/**
 * device-agents-procedures.ts -- a local agent's Mac registers and beats, takes its agents' lines and its tools' requests, and says what came of each.
 *
 * Every procedure but the enroll reads the device's bearer alone, never a
 * browser's session cookie (`deviceMiddleware`), since a line carries a
 * runner's secrets and an answer is the word of the device that ran it, and
 * names the device's id: a desktop's sign-in, or a host's device secret,
 * which acts for its own device alone and answers not found for any other.
 * The enroll reads no bearer: it trades an install token for a host and the
 * secret it calls on from then on (`@luke/features/host-wire`), answered
 * this once, and refuses an unknown, revoked, or expired token as an invalid
 * token. A host's every call, the enroll's included, is refused as needing
 * an upgrade where its daemon is below the floor (`auth/device-secret.ts`). Each answers not found, before it touches a row, where the
 * account has the `local-agents` experiment off, and every one but the
 * register where the account holds no such Mac (`agents/device-agent.ts`); a
 * register under an id another account holds writes nothing and answers
 * not found too. A held read answers what waits for that Mac
 * (`GET /api/device-agents/lines`, `GET /api/device-agents/requests`), a claim
 * takes one row by its id, a launch line's secrets with it, and a settle or
 * an answer keeps what the Mac said of a row it claimed.
 */

import { accountExperimentOn } from "@luke/database/models/account-store";
import {
  answerDeviceAgentRequest,
  claimDeviceAgentRequest,
} from "@luke/database/models/device-agent-store";
import { beatDevice, registerDevice } from "@luke/database/models/device-store";
import { enrollHost } from "@luke/database/models/host-store";
import { HOST_WIRE } from "@luke/features/host-wire";
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
import { type DeviceCaller, deviceMiddleware, hosted } from "../orpc/base.js";
import {
  claimedDeviceAgentLine,
  deviceAgentDeviceOf,
  deviceAgentLinesFor,
  deviceAgentRequestsFor,
  settledDeviceAgentLine,
} from "./device-agent.js";

export interface DeviceAgentsProcedureSeams {
  /** The account behind a desktop's request, read from its bearer alone (`deviceMiddleware`). */
  resolveUserId: UserIdResolver;
}

const DONE = { done: true } as const;

/** The device named, where the caller may act for it: a host for itself alone, a desktop for any device of its account; not found otherwise. */
const ownDevice = (caller: DeviceCaller, deviceId: string) =>
  caller.hostDeviceId === undefined || caller.hostDeviceId === deviceId
    ? Effect.void
    : Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

/** The caller's own device under its account's experiment, or not found. */
const followed = (caller: DeviceCaller, deviceId: string) =>
  Effect.gen(function* () {
    yield* ownDevice(caller, deviceId);
    const { userId } = caller;
    if (!(yield* hostedStoreOrUnavailable(deviceAgentDeviceOf(userId, deviceId)))) {
      return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    }
  });

/** Kept, or not found where the account holds no such row. */
const keptOrNotFound = (kept: boolean) =>
  kept ? Effect.succeed(DONE) : Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

/** The device-agents resource: the enroll on an install token, and every other procedure on the device's bearer. */
export function deviceAgentsProcedures(seams: DeviceAgentsProcedureSeams) {
  const deviceAgents = hosted.deviceAgents.use(deviceMiddleware(seams.resolveUserId));
  return {
    enroll: hosted.deviceAgents.enroll.effect(function* ({ context, input }) {
      const version = yield* admittedHostVersion(presentedHostVersion(context.request));
      const { installToken, deviceId, ...box } = input;
      const minted = mintHostSecret(HOST_WIRE.DEVICE_SECRET_PREFIX);
      const enrolled = yield* hostedStoreOrUnavailable(
        enrollHost(hostSecretHash(installToken), {
          id: deviceId,
          ...box,
          version,
          secretHash: minted.hash,
        }),
      );
      if (Option.isNone(enrolled)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
      return { deviceId, deviceSecret: minted.secret };
    }),
    register: deviceAgents.register.effect(function* ({ context, input }) {
      yield* ownDevice(context, input.deviceId);
      const { userId } = context;
      if (
        !(yield* hostedStoreOrUnavailable(accountExperimentOn(userId, EXPERIMENT.LOCAL_AGENTS)))
      ) {
        return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      }
      const { deviceId, ...device } = input;
      return yield* keptOrNotFound(
        yield* hostedStoreOrUnavailable(registerDevice(userId, { id: deviceId, ...device })),
      );
    }),
    beat: deviceAgents.beat.effect(function* ({ context, input }) {
      yield* followed(context, input.deviceId);
      return yield* keptOrNotFound(
        yield* hostedStoreOrUnavailable(beatDevice(context.userId, input.deviceId, input.signedIn)),
      );
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
        claimedDeviceAgentLine(context.userId, input.deviceId, input.id),
      );
      if (Option.isNone(claimed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return claimed.value;
    }),
    settleLine: deviceAgents.settleLine.effect(function* ({ context, input }) {
      yield* followed(context, input.deviceId);
      return yield* keptOrNotFound(
        yield* hostedStoreOrUnavailable(
          settledDeviceAgentLine(context.userId, input.deviceId, input.id, input.exitCode),
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
