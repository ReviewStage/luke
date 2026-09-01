import { Effect } from "effect";
import type { HostedUsageAnswer } from "../core.js";
import { HostedAuth, HostedMeterService } from "../services/tags.js";
import {
  HOSTED_HTTP_STATUS,
  jsonResponseEffect,
  methodNotAllowed,
  unauthorized,
} from "./http-effect.js";

export const handleUsage = Effect.fn("handleUsage")(function* (request: Request) {
  if (request.method !== "GET") {
    return methodNotAllowed();
  }

  const auth = yield* HostedAuth;
  const userId = yield* auth.resolveUserId(request);
  if (!userId) {
    return unauthorized();
  }

  const meter = yield* HostedMeterService;
  const usage: HostedUsageAnswer = yield* meter.readUsage(userId);
  return yield* jsonResponseEffect(HOSTED_HTTP_STATUS.OK, usage);
});
