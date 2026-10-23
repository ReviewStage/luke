/**
 * runner-token-app.ts -- where a Codex runner on its starter's ChatGPT plan asks for the plan's access token, mid-turn included.
 *
 * App-server runs the runner's token command (`@luke/agent-runner`'s
 * `codex-token.ts`) as it needs a bearer for OpenAI: as a turn's requests go
 * out, again once the one it holds is five minutes old, and after a 401. The
 * command posts here under the runner's bearer, and this answers the
 * account's access token, renewed first where less than the token margin is
 * left of it (`refreshChatGptAccess`, under the row's lock, so two runners of
 * one account never race its rotating refresh token).
 *
 * The bearer is admitted as the events route admits it (`../luke-mcp/bearer.ts`):
 * a bearer no standing coding agent's conversation holds, a retired one's
 * among them, is refused. So is one whose agent does not run on Codex on its
 * starter's ChatGPT plan, and one past the brake, which is kept per agent.
 * What this answers is the token the runner's launch was already handed as
 * the plan's payer, to the same sandbox the same bearer already reaches
 * Luke's MCP server from. The token is never logged, and travels in the
 * answer's body alone, which no cache keeps.
 */

import type { RunnerTokenAnswer } from "@luke/agent-runner/protocol";
import type { DatabaseServices } from "@luke/database/core/query";
import {
  readCodingAgentHeaderOfConversation,
  readCodingAgentRouting,
} from "@luke/database/models/coding-agent-store";
import { parseKeyRing } from "@luke/database/models/provider-key-seal";
import { CONVERSATION_RUNTIME } from "@luke/database/storage-vocabulary";
import { CODING_AGENT_PAYER } from "@luke/features/coding-agent-wire";
import { HTTP_METHOD } from "@luke/wire";
import { Duration, Effect, Layer, Option, Redacted, Result } from "effect";
import type { HttpClient } from "effect/http";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/http";
import {
  CHATGPT_ACCESS,
  type ChatGptAccess,
  refreshChatGptAccess,
} from "../../accounts/chatgpt-credentials.js";
import { HostedEnvironment } from "../../environment.js";
import { HOSTED_HTTP_STATUS } from "../../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
} from "../../http/http-effect.js";
import { makeRateBrake, type RateBrake } from "../../http/rate-brake.js";
import { ANY_METHOD, type WebRoutes } from "../../route.js";
import { CODEX_TOKEN_MARGIN } from "../coder-host/codex-sessions.js";
import { admitRunnerBearer, presentedBearer } from "../luke-mcp/bearer.js";

/** The path a runner's token command posts to. */
export const RUNNER_TOKEN_PATH = "/api/agents/runner-token";

/**
 * How often one agent may ask: app-server asks every five minutes, and once
 * more after each 401, so a runner that asks more than this in ten minutes
 * is asking for something else.
 */
export const RUNNER_TOKEN_BRAKE = {
  windowMs: Duration.toMillis(Duration.minutes(10)),
  maxRequestsPerWindow: 20,
  maxTrackedUsers: 10_000,
} as const;

/** The refusal each way the sign-in can fail to answer a token, as a launch on it is refused. */
const REFUSAL_OF_ACCESS = {
  [CHATGPT_ACCESS.NONE]: HOSTED_REFUSAL.AGENT_PLAN_SIGNED_OUT,
  [CHATGPT_ACCESS.SIGNED_OUT]: HOSTED_REFUSAL.AGENT_PLAN_SIGNED_OUT,
  [CHATGPT_ACCESS.UNREADABLE]: HOSTED_REFUSAL.UNAVAILABLE,
  [CHATGPT_ACCESS.UNREACHABLE]: HOSTED_REFUSAL.AGENT_PLAN_UNREACHABLE,
  [CHATGPT_ACCESS.LIMIT_REACHED]: HOSTED_REFUSAL.AGENT_PLAN_LIMIT_REACHED,
  [CHATGPT_ACCESS.INELIGIBLE]: HOSTED_REFUSAL.AGENT_PLAN_INELIGIBLE,
} as const satisfies Record<Exclude<ChatGptAccess["outcome"], "ready">, HostedRefusal>;

/** POST: the plan's access token, for the Codex agent on the plan the bearer stands for. */
const runnerTokenEndpoint = /* @__PURE__ */ Effect.fn("web/runnerTokenEndpoint")(function* (
  brake: RateBrake,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | DatabaseServices | HostedEnvironment | HttpClient.HttpClient
> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const bearer = presentedBearer(request);
  if (bearer === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const admitted = yield* hostedStoreOrUnavailable(admitRunnerBearer(bearer));
  if (Option.isNone(admitted)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const { target } = admitted.value;
  const agent = yield* hostedStoreOrUnavailable(
    readCodingAgentHeaderOfConversation(target.userId, target.conversationId),
  );
  if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const routing = yield* hostedStoreOrUnavailable(
    readCodingAgentRouting(target.userId, agent.value.id),
  );
  // Note that only an agent its starter's plan pays for, on Codex, is handed the plan's token.
  const onPlan = Option.exists(
    routing,
    (row) =>
      row.runtime === CONVERSATION_RUNTIME.CODEX &&
      row.payer === CODING_AGENT_PAYER.CHATGPT_SUBSCRIPTION,
  );
  if (!onPlan) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  if (!(yield* brake.check(agent.value.id))) {
    return yield* Effect.fail(HOSTED_REFUSAL.QUOTA_EXHAUSTED);
  }
  const environment = yield* HostedEnvironment;
  const keys = environment.providerKeyEncryptionKeys;
  const ring = keys === undefined ? undefined : parseKeyRing(keys);
  if (ring === undefined || Result.isFailure(ring)) {
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  }
  const access = yield* hostedStoreOrUnavailable(
    refreshChatGptAccess(target.userId, ring.success, CODEX_TOKEN_MARGIN),
  );
  if (access.outcome !== CHATGPT_ACCESS.READY) {
    return yield* Effect.fail(REFUSAL_OF_ACCESS[access.outcome]);
  }
  const answer: RunnerTokenAnswer = { accessToken: Redacted.value(access.accessToken) };
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, answer);
});

/** The group: the one token path, braked per agent, and the hosted vocabulary's own refusal for any other. */
export function runnerTokenApp(): WebRoutes<
  DatabaseServices | HostedEnvironment | HttpClient.HttpClient
> {
  const endpoint = runnerTokenEndpoint(makeRateBrake(RUNNER_TOKEN_BRAKE));
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, RUNNER_TOKEN_PATH, hostedRefusing(endpoint)),
    hostedNotFoundRoute,
  );
}
