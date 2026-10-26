/**
 * device-agents-procedures.ts -- a local agent's Mac registers and beats, takes its agents' lines and its tools' requests, and says what came of each.
 *
 * Every procedure reads the Mac's bearer alone, never a browser's session
 * cookie (`bearerOnlyMiddleware`), since a line carries a runner's secrets
 * and an answer is the word of the Mac that ran it, and names the Mac's
 * device id. Each answers not found, before it touches a row, where the
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
import { EXPERIMENT } from "@luke/settings";
import { Effect, Option } from "effect";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { bearerOnlyMiddleware, hosted } from "../orpc/base.js";
import {
  claimedDeviceAgentLine,
  deviceAgentDeviceOf,
  deviceAgentLinesFor,
  deviceAgentRequestsFor,
  settledDeviceAgentLine,
} from "./device-agent.js";

export interface DeviceAgentsProcedureSeams {
  /** The account behind a request, read from the Mac's bearer alone (`bearerOnlyMiddleware`). */
  resolveUserId: UserIdResolver;
}

const DONE = { done: true } as const;

/** The account's own Mac under its experiment, or not found. */
const followed = (userId: string, deviceId: string) =>
  Effect.gen(function* () {
    if (!(yield* hostedStoreOrUnavailable(deviceAgentDeviceOf(userId, deviceId)))) {
      return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    }
  });

/** Kept, or not found where the account holds no such row. */
const keptOrNotFound = (kept: boolean) =>
  kept ? Effect.succeed(DONE) : Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

/** The device-agents resource, on the Mac's bearer. */
export function deviceAgentsProcedures(seams: DeviceAgentsProcedureSeams) {
  const deviceAgents = hosted.deviceAgents.use(bearerOnlyMiddleware(seams.resolveUserId));
  return {
    register: deviceAgents.register.effect(function* ({ context, input }) {
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
      yield* followed(context.userId, input.deviceId);
      return yield* keptOrNotFound(
        yield* hostedStoreOrUnavailable(beatDevice(context.userId, input.deviceId, input.signedIn)),
      );
    }),
    lines: deviceAgents.lines.effect(function* ({ context, input }) {
      yield* followed(context.userId, input.deviceId);
      const lines = yield* hostedStoreOrUnavailable(
        deviceAgentLinesFor(context.userId, input.deviceId),
      );
      return { lines };
    }),
    claimLine: deviceAgents.claimLine.effect(function* ({ context, input }) {
      yield* followed(context.userId, input.deviceId);
      const claimed = yield* hostedStoreOrUnavailable(
        claimedDeviceAgentLine(context.userId, input.deviceId, input.id),
      );
      if (Option.isNone(claimed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return claimed.value;
    }),
    settleLine: deviceAgents.settleLine.effect(function* ({ context, input }) {
      yield* followed(context.userId, input.deviceId);
      return yield* keptOrNotFound(
        yield* hostedStoreOrUnavailable(
          settledDeviceAgentLine(context.userId, input.deviceId, input.id, input.exitCode),
        ),
      );
    }),
    requests: deviceAgents.requests.effect(function* ({ context, input }) {
      yield* followed(context.userId, input.deviceId);
      const requests = yield* hostedStoreOrUnavailable(
        deviceAgentRequestsFor(context.userId, input.deviceId),
      );
      return { requests };
    }),
    claimRequest: deviceAgents.claimRequest.effect(function* ({ context, input }) {
      yield* followed(context.userId, input.deviceId);
      const claimed = yield* hostedStoreOrUnavailable(
        claimDeviceAgentRequest(context.userId, input.deviceId, input.id),
      );
      if (Option.isNone(claimed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { request: claimed.value };
    }),
    answerRequest: deviceAgents.answerRequest.effect(function* ({ context, input }) {
      yield* followed(context.userId, input.deviceId);
      return yield* keptOrNotFound(
        yield* hostedStoreOrUnavailable(
          answerDeviceAgentRequest(context.userId, input.deviceId, input.id, input.answer),
        ),
      );
    }),
  };
}
