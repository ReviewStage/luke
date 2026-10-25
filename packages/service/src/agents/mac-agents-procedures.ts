/**
 * mac-agents-procedures.ts -- a local agent's Mac registers and beats, takes its agents' lines and its tools' requests, and says what came of each.
 *
 * Every procedure reads the Mac's bearer alone, never a browser's session
 * cookie (`bearerOnlyMiddleware`), since a line carries a runner's secrets
 * and an answer is the word of the Mac that ran it, and names the Mac's
 * device id. Each answers not found, before it touches a row, where the
 * account has the `local-agents` experiment off, and every one but the
 * register where the account holds no such Mac (`agents/mac-agent.ts`); a
 * register under an id another account holds writes nothing and answers
 * not found too. A held read answers what waits for that Mac
 * (`GET /api/mac-agents/lines`, `GET /api/mac-agents/requests`), a claim
 * takes one row by its id, a launch line's secrets with it, and a settle or
 * an answer keeps what the Mac said of a row it claimed.
 */

import { accountExperimentOn } from "@luke/database/models/account-store";
import {
  answerMacAgentRequest,
  claimMacAgentRequest,
  settleMacAgentLine,
} from "@luke/database/models/mac-agent-store";
import { beatMacDevice, registerMacDevice } from "@luke/database/models/mac-device-store";
import { EXPERIMENT } from "@luke/settings";
import { Effect, Option } from "effect";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { bearerOnlyMiddleware, hosted } from "../orpc/base.js";
import {
  claimedMacAgentLine,
  macAgentDeviceOf,
  macAgentLinesFor,
  macAgentRequestsFor,
} from "./mac-agent.js";

export interface MacAgentsProcedureSeams {
  /** The account behind a request, read from the Mac's bearer alone (`bearerOnlyMiddleware`). */
  resolveUserId: UserIdResolver;
}

const DONE = { done: true } as const;

/** The account's own Mac under its experiment, or not found. */
const followed = (userId: string, deviceId: string) =>
  Effect.gen(function* () {
    if (!(yield* hostedStoreOrUnavailable(macAgentDeviceOf(userId, deviceId)))) {
      return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    }
  });

/** Kept, or not found where the account holds no such row. */
const keptOrNotFound = (kept: boolean) =>
  kept ? Effect.succeed(DONE) : Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

/** The mac-agents resource, on the Mac's bearer. */
export function macAgentsProcedures(seams: MacAgentsProcedureSeams) {
  const macAgents = hosted.macAgents.use(bearerOnlyMiddleware(seams.resolveUserId));
  return {
    register: macAgents.register.effect(function* ({ context, input }) {
      const { userId } = context;
      if (
        !(yield* hostedStoreOrUnavailable(accountExperimentOn(userId, EXPERIMENT.LOCAL_AGENTS)))
      ) {
        return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      }
      const { deviceId, ...device } = input;
      return yield* keptOrNotFound(
        yield* hostedStoreOrUnavailable(registerMacDevice(userId, { id: deviceId, ...device })),
      );
    }),
    beat: macAgents.beat.effect(function* ({ context, input }) {
      yield* followed(context.userId, input.deviceId);
      return yield* keptOrNotFound(
        yield* hostedStoreOrUnavailable(beatMacDevice(context.userId, input.deviceId)),
      );
    }),
    lines: macAgents.lines.effect(function* ({ context, input }) {
      yield* followed(context.userId, input.deviceId);
      const lines = yield* hostedStoreOrUnavailable(
        macAgentLinesFor(context.userId, input.deviceId),
      );
      return { lines };
    }),
    claimLine: macAgents.claimLine.effect(function* ({ context, input }) {
      yield* followed(context.userId, input.deviceId);
      const claimed = yield* hostedStoreOrUnavailable(
        claimedMacAgentLine(context.userId, input.deviceId, input.id),
      );
      if (Option.isNone(claimed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return claimed.value;
    }),
    settleLine: macAgents.settleLine.effect(function* ({ context, input }) {
      yield* followed(context.userId, input.deviceId);
      return yield* keptOrNotFound(
        yield* hostedStoreOrUnavailable(
          settleMacAgentLine(context.userId, input.deviceId, input.id, input.exitCode),
        ),
      );
    }),
    requests: macAgents.requests.effect(function* ({ context, input }) {
      yield* followed(context.userId, input.deviceId);
      const requests = yield* hostedStoreOrUnavailable(
        macAgentRequestsFor(context.userId, input.deviceId),
      );
      return { requests };
    }),
    claimRequest: macAgents.claimRequest.effect(function* ({ context, input }) {
      yield* followed(context.userId, input.deviceId);
      const claimed = yield* hostedStoreOrUnavailable(
        claimMacAgentRequest(context.userId, input.deviceId, input.id),
      );
      if (Option.isNone(claimed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { request: claimed.value };
    }),
    answerRequest: macAgents.answerRequest.effect(function* ({ context, input }) {
      yield* followed(context.userId, input.deviceId);
      return yield* keptOrNotFound(
        yield* hostedStoreOrUnavailable(
          answerMacAgentRequest(context.userId, input.deviceId, input.id, input.answer),
        ),
      );
    }),
  };
}
