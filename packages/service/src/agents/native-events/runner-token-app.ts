import type { RunnerTokenAnswer } from "@repo/agent-runner/protocol";
import type { DatabaseServices } from "@repo/database/core/query";
import {
  type Agent,
  hasRepository,
  readAgent,
  readAgentHeaderOfConversation,
  readAgentRouting,
} from "@repo/database/models/agent-store";
import { deviceLayout } from "@repo/database/models/device-store";
import { parseKeyRing } from "@repo/database/models/provider-key-seal";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { HOSTED_SERVICE_PATH } from "@repo/features";
import { AGENT_MACHINE, AGENT_PAYER } from "@repo/features/agent-wire";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { type HostGithubTokenAnswer, hostGithubTokenRequestSchema } from "@repo/features/host-wire";
import { HTTP_METHOD } from "@repo/wire";
import { Duration, Effect, Layer, Option, Redacted, Result, Schema } from "effect";
import type { HttpClient } from "effect/http";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/http";
import {
  CHATGPT_ACCESS,
  type ChatGptAccess,
  refreshChatGptAccess,
} from "../../accounts/chatgpt-credentials.js";
import { HostedEnvironment } from "../../environment.js";
import type { GitHubApp } from "../../github/github-app.js";
import { HOSTED_HTTP_STATUS } from "../../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  parseJsonBytes,
  readBodyBytesEffect,
} from "../../http/http-effect.js";
import { makeRateBrake, type RateBrake } from "../../http/rate-brake.js";
import { actsForDevice, type DeviceCaller, deviceCallerOf } from "../../orpc/base.js";
import { ANY_METHOD, type WebRoutes } from "../../route.js";
import { CODER_REFUSAL } from "../coder-host/bounds.js";
import { agentRepositoryToken } from "../coder-host/checkout.js";
import { CODEX_TOKEN_MARGIN } from "../coder-host/codex-sessions.js";
import { admitRunnerBearer, presentedBearer } from "../workspace-mcp/bearer.js";

export const RUNNER_TOKEN_PATH = HOSTED_SERVICE_PATH.RUNNER_TOKEN;

export const RUNNER_TOKEN_BRAKE = {
  windowMs: Duration.toMillis(Duration.minutes(10)),
  maxRequestsPerWindow: 20,
  maxTrackedUsers: 10_000,
} as const;

const HOST_GITHUB_TOKEN_MAX_BODY_BYTES = 1_024;

const REFUSAL_OF_ACCESS = {
  [CHATGPT_ACCESS.NONE]: HOSTED_REFUSAL.AGENT_PLAN_SIGNED_OUT,
  [CHATGPT_ACCESS.SIGNED_OUT]: HOSTED_REFUSAL.AGENT_PLAN_SIGNED_OUT,
  [CHATGPT_ACCESS.UNREADABLE]: HOSTED_REFUSAL.UNAVAILABLE,
  [CHATGPT_ACCESS.UNREACHABLE]: HOSTED_REFUSAL.AGENT_PLAN_UNREACHABLE,
  [CHATGPT_ACCESS.LIMIT_REACHED]: HOSTED_REFUSAL.AGENT_PLAN_LIMIT_REACHED,
  [CHATGPT_ACCESS.INELIGIBLE]: HOSTED_REFUSAL.AGENT_PLAN_INELIGIBLE,
} as const satisfies Record<Exclude<ChatGptAccess["outcome"], "ready">, HostedRefusal>;

const decodeGithubTokenRequest = Schema.decodeUnknownOption(hostGithubTokenRequestSchema);

const askedAgent = /* @__PURE__ */ Effect.fn("web/askedAgent")(function* (userId: string) {
  const body = yield* parseJsonBytes(yield* readBodyBytesEffect(HOST_GITHUB_TOKEN_MAX_BODY_BYTES));
  const asked = decodeGithubTokenRequest(body);
  if (Option.isNone(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  return yield* hostedStoreOrUnavailable(readAgent(userId, asked.value.agentId));
});

const repositoryTokenFor = /* @__PURE__ */ Effect.fn("web/repositoryTokenFor")(function* (
  userId: string,
  agent: Agent,
  brake: RateBrake,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  DatabaseServices | HttpClient.HttpClient | GitHubApp
> {
  if (!hasRepository(agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  if (!(yield* brake.check(agent.id))) {
    return yield* Effect.fail(HOSTED_REFUSAL.QUOTA_EXHAUSTED);
  }
  const target = { userId, conversationId: agent.conversationId };
  const minted = yield* agentRepositoryToken(target, agent).pipe(
    Effect.mapError((refused) =>
      refused.reason === CODER_REFUSAL.NOT_REACHABLE
        ? HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE
        : HOSTED_REFUSAL.GITHUB_UNANSWERED,
    ),
  );
  if (minted.access.kind !== GITHUB_ACCESS.APP) {
    return yield* Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
  }
  const answer: HostGithubTokenAnswer = { githubToken: Redacted.value(minted.token) };
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, answer);
});

const deviceGithubToken = /* @__PURE__ */ Effect.fn("web/deviceGithubToken")(function* (
  caller: DeviceCaller,
  brake: RateBrake,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | DatabaseServices | HttpClient.HttpClient | GitHubApp
> {
  const { userId } = caller;
  const found = yield* askedAgent(userId);
  const agent = Option.filter(
    found,
    (row) => row.userId === userId && row.machine === AGENT_MACHINE.DEVICE,
  );
  const deviceId = Option.getOrUndefined(
    Option.flatMap(agent, (row) => Option.fromNullishOr(row.deviceId)),
  );
  if (Option.isNone(agent) || deviceId === undefined || !actsForDevice(caller, deviceId)) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  }
  const standing = yield* hostedStoreOrUnavailable(deviceLayout(userId, deviceId));
  if (Option.isNone(standing)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  return yield* repositoryTokenFor(userId, agent.value, brake);
});

const runnerTokenEndpoint = /* @__PURE__ */ Effect.fn("web/runnerTokenEndpoint")(function* (
  brake: RateBrake,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  | HttpServerRequest.HttpServerRequest
  | DatabaseServices
  | HostedEnvironment
  | HttpClient.HttpClient
  | GitHubApp
> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const bearer = presentedBearer(request);
  if (bearer === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const admitted = yield* hostedStoreOrUnavailable(admitRunnerBearer(bearer));
  if (Option.isNone(admitted)) {
    return yield* deviceGithubToken(yield* deviceCallerOf(request), brake);
  }
  const { target } = admitted.value;
  const agent = yield* hostedStoreOrUnavailable(
    readAgentHeaderOfConversation(target.userId, target.conversationId),
  );
  if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  if (agent.value.machine !== AGENT_MACHINE.DEVICE) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  }
  const routing = yield* hostedStoreOrUnavailable(readAgentRouting(target.userId, agent.value.id));
  const payer = Option.getOrUndefined(
    Option.flatMap(
      Option.filter(routing, (row) => row.runtime === CONVERSATION_RUNTIME.CODEX),
      (row) => Option.fromNullishOr(row.payer),
    ),
  );
  const onPlan = payer === AGENT_PAYER.CHATGPT_SUBSCRIPTION || payer === AGENT_PAYER.MAC_SIGN_IN;
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

export function runnerTokenApp(): WebRoutes<
  DatabaseServices | HostedEnvironment | HttpClient.HttpClient | GitHubApp
> {
  const endpoint = runnerTokenEndpoint(makeRateBrake(RUNNER_TOKEN_BRAKE));
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, RUNNER_TOKEN_PATH, hostedRefusing(endpoint)),
    hostedNotFoundRoute,
  );
}
