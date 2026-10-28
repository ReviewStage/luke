/**
 * runner-lines-app.ts -- where a cloud runner reads Luke's lines past its cursor, held open until one is queued.
 *
 * A runner whose config names this read (`@luke/agent-runner`'s
 * `RUNNER_LINES`) takes Luke's lines from here rather than from its stdin,
 * so a line stands until the runner says it took it, rather than counting as
 * delivered the moment a write to a pipe succeeded. The read names the
 * launch by its first event number and the place of the last line the
 * runner read, and is answered the agent's lines past that place
 * (`@luke/database`'s `runner-line-store.ts`): those written for the launch,
 * and the message lines an earlier launch never took, queued no longer ago
 * than a line still reads as awaiting its turn (`CODER.LINE_GRACE`), so a
 * line the developer was already told went unanswered is never run behind
 * their back. Where nothing stands past the place, the read is held on the
 * agent's topic (`../../http/held-read.ts`), which a line queued wakes
 * through Luke Sync, and answers none at the hold's end, as a device's read
 * is held; the runner asks again.
 *
 * The bearer is admitted as the events route admits it
 * (`../luke-mcp/bearer.ts`): one no standing agent holds, a retired one's
 * among them, is refused, and a launch's bearer is its own, so a launch a
 * newer one replaced reads nothing more. An answer carries the lines whole,
 * at least one, up to `RUNNER_LINES_ANSWER.MAX_BYTES`, so a run of large
 * messages is read over several answers.
 */

import { RUNNER_LINES, type RunnerLinesAnswer } from "@luke/agent-runner/protocol";
import type { DatabaseServices } from "@luke/database/core/query";
import { readCodingAgentOfConversation } from "@luke/database/models/coding-agent-store";
import { type RunnerLine, runnerLinesPast } from "@luke/database/models/runner-line-store";
import { TOPIC } from "@luke/database/sync/notification";
import { HTTP_METHOD } from "@luke/wire";
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
import { admitRunnerBearer, presentedBearer } from "../luke-mcp/bearer.js";

/** The path a runner reads its lines from. */
export const RUNNER_LINES_PATH = "/api/agents/runner-lines";

/**
 * What one answer carries: at most `LIMIT` lines, and no more than
 * `MAX_BYTES` of them past the first, under the platform's own bound on a
 * function's answer; and how often a held read looks again where Luke Sync
 * cannot wake it.
 */
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

/** The lines an answer carries: every one up to the bound, and the first whatever its size. */
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

/** GET: the lines past the runner's place, held while there are none. */
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
      readCodingAgentOfConversation(target.userId, target.conversationId),
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

/** The group: the one lines path, and the hosted vocabulary's own refusal for any other. */
export function runnerLinesApp(): WebRoutes<DatabaseServices> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, RUNNER_LINES_PATH, hostedRefusing(runnerLinesEndpoint())),
    hostedNotFoundRoute,
  );
}
