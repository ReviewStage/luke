import { RUNNER_LINES, type RunnerLinesAnswer } from "@repo/agent-runner/protocol";
import type { DatabaseServices } from "@repo/database/core/query";
import { readAgentOfConversation } from "@repo/database/models/agent-store";
import { type RunnerLine, runnerLinesPast } from "@repo/database/models/runner-line-store";
import { TOPIC } from "@repo/database/sync/notification";
import { HTTP_METHOD } from "@repo/wire";
import { DateTime, Duration, Effect, Layer, Option, Schema } from "effect";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/http";
import { heldUntil } from "../../http/held-read.js";
import { HOSTED_HTTP_STATUS } from "../../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
} from "../../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../../route.js";
import { CODER } from "../coder-host/bounds.js";
import { admitRunnerBearer, presentedBearer } from "../workspace-mcp/bearer.js";

export const RUNNER_LINES_PATH = "/api/agents/runner-lines";

const RUNNER_LINES_ANSWER = {
  LIMIT: 64,
  MAX_BYTES: 4 * 1024 * 1024,
  POLL: Duration.millis(500),
} as const;

const PlaceSchema = Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));

const ReadQuerySchema = Schema.Struct({
  [RUNNER_LINES.QUERY.LAUNCH]: PlaceSchema,
  [RUNNER_LINES.QUERY.AFTER]: PlaceSchema,
});

const readQuery = Schema.decodeUnknownOption(ReadQuerySchema);

function bounded(lines: readonly RunnerLine[]): readonly RunnerLine[] {
  let bytes = 0;
  const carried: RunnerLine[] = [];
  for (const line of lines) {
    bytes += Buffer.byteLength(line.text);
    if (carried.length > 0 && bytes > RUNNER_LINES_ANSWER.MAX_BYTES) break;
    carried.push(line);
  }
  return carried;
}

const runnerLinesEndpoint = /* @__PURE__ */ Effect.fn("web/runnerLinesEndpoint")(
  function* (): Effect.fn.Return<
    HttpServerResponse.HttpServerResponse,
    HostedRefusal,
    HttpServerRequest.HttpServerRequest | DatabaseServices
  > {
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    if (incoming.method !== HTTP_METHOD.GET) {
      return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
    }
    const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
    const bearer = presentedBearer(request);
    if (bearer === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    const query = readQuery(Object.fromEntries(new URL(request.url).searchParams));
    if (Option.isNone(query)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    const admitted = yield* hostedStoreOrUnavailable(admitRunnerBearer(bearer));
    if (Option.isNone(admitted)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    const { target } = admitted.value;
    const agent = yield* hostedStoreOrUnavailable(
      readAgentOfConversation(target.userId, target.conversationId),
    );
    if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    const now = yield* DateTime.nowAsDate;
    const read = runnerLinesPast(target.userId, agent.value.id, {
      launch: query.value[RUNNER_LINES.QUERY.LAUNCH],
      after: query.value[RUNNER_LINES.QUERY.AFTER],
      since: new Date(now.getTime() - Duration.toMillis(CODER.LINE_GRACE)),
      limit: RUNNER_LINES_ANSWER.LIMIT,
    });
    const held = yield* hostedStoreOrUnavailable(
      heldUntil(
        read,
        (lines) => lines.length > 0,
        [[TOPIC.AGENT, agent.value.id]],
        RUNNER_LINES_ANSWER.POLL,
        Duration.millis(RUNNER_LINES.HOLD_MS),
      ),
    );
    const lines = Option.match(held, { onNone: () => [], onSome: (moved) => bounded(moved.read) });
    const answer: RunnerLinesAnswer = { lines };
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, answer);
  },
);

export function runnerLinesApp(): WebRoutes<DatabaseServices> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, RUNNER_LINES_PATH, hostedRefusing(runnerLinesEndpoint())),
    hostedNotFoundRoute,
  );
}
