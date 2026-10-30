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
 * starter's ChatGPT plan, and one past the brake, which is kept per agent. A
 * local agent's runner asks here from its Mac as a sandbox's does, so no
 * token travels through the Mac's queue.
 * What this answers is the token the runner's launch was already handed as
 * the plan's payer, to the same sandbox the same bearer already reaches
 * Luke's MCP server from. The token is never logged, and travels in the
 * answer's body alone, which no cache keeps.
 *
 * A device asks here too, for a GitHub token for one of its agents
 * (`@luke/features/host-wire`'s `hostGithubTokenRequestSchema`), since its
 * agents' VMs never reach a developer's git login: an enrolled machine on
 * its device secret, a Linux box and a Mac alike, read as a device caller
 * (`../../orpc/base.ts`'s `deviceCallerOf`, which refuses a released
 * desktop build on its own sign-in's bearer as needing an upgrade) and held
 * to one rule (`deviceGithubToken`): the agent the member's own and pinned
 * to the caller's own device, and that device running its agents in a VM. It is
 * answered only an installation token the App mints for the agent's
 * repository, on the terms the cloud's checkout mints its sandbox's
 * (`coder-host/checkout.ts`'s `agentRepositoryToken`): good for an hour, cut
 * to that one repository. A member's own classic token, which does not
 * expire, never leaves for a device. The device signs the agent in with it
 * and asks again well inside the hour; it is braked per agent with the
 * Codex token.
 */

import type { RunnerTokenAnswer } from "@luke/agent-runner/protocol";
import type { DatabaseServices } from "@luke/database/core/query";
import {
  type Agent,
  hasRepository,
  readAgent,
  readAgentHeaderOfConversation,
  readAgentRouting,
} from "@luke/database/models/agent-store";
import { latestDeviceAgentLaunch } from "@luke/database/models/device-agent-store";
import { deviceLayout } from "@luke/database/models/device-store";
import { parseKeyRing } from "@luke/database/models/provider-key-seal";
import { CONVERSATION_RUNTIME } from "@luke/database/storage-vocabulary";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import { AGENT_MACHINE, AGENT_PAYER } from "@luke/features/agent-wire";
import { DEVICE_ISOLATION, deviceAgentLaunchPayloadSchema } from "@luke/features/device-agent-wire";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { type HostGithubTokenAnswer, hostGithubTokenRequestSchema } from "@luke/features/host-wire";
import { HTTP_METHOD } from "@luke/wire";
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
  type UserIdResolver,
} from "../../http/http-effect.js";
import { makeRateBrake, type RateBrake } from "../../http/rate-brake.js";
import { actsForDevice, type DeviceCaller, deviceCallerOf } from "../../orpc/base.js";
import { ANY_METHOD, type WebRoutes } from "../../route.js";
import { CODER_REFUSAL } from "../coder-host/bounds.js";
import { agentRepositoryToken } from "../coder-host/checkout.js";
import { CODEX_TOKEN_MARGIN } from "../coder-host/codex-sessions.js";
import { admitRunnerBearer, presentedBearer } from "../luke-mcp/bearer.js";

/** What the route is handed of the deployment's. */
export interface RunnerTokenSeams {
  /** The account a desktop's own sign-in names, read from its bearer alone, never a browser's session, so a released desktop build is refused as needing an upgrade. */
  readonly resolveUserId: UserIdResolver;
}

/** The path a runner's token command, and a host asking for its agent's GitHub token, post to. */
export const RUNNER_TOKEN_PATH = HOSTED_SERVICE_PATH.RUNNER_TOKEN;

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

/** The most a host's ask for its agent's GitHub token may weigh: an agent's id, and room to spare. */
const HOST_GITHUB_TOKEN_MAX_BODY_BYTES = 1_024;

/** The refusal each way the sign-in can fail to answer a token, as a launch on it is refused. */
const REFUSAL_OF_ACCESS = {
  [CHATGPT_ACCESS.NONE]: HOSTED_REFUSAL.AGENT_PLAN_SIGNED_OUT,
  [CHATGPT_ACCESS.SIGNED_OUT]: HOSTED_REFUSAL.AGENT_PLAN_SIGNED_OUT,
  [CHATGPT_ACCESS.UNREADABLE]: HOSTED_REFUSAL.UNAVAILABLE,
  [CHATGPT_ACCESS.UNREACHABLE]: HOSTED_REFUSAL.AGENT_PLAN_UNREACHABLE,
  [CHATGPT_ACCESS.LIMIT_REACHED]: HOSTED_REFUSAL.AGENT_PLAN_LIMIT_REACHED,
  [CHATGPT_ACCESS.INELIGIBLE]: HOSTED_REFUSAL.AGENT_PLAN_INELIGIBLE,
} as const satisfies Record<Exclude<ChatGptAccess["outcome"], "ready">, HostedRefusal>;

const decodeLaunchPayload = Schema.decodeUnknownOption(deviceAgentLaunchPayloadSchema);
const decodeGithubTokenRequest = Schema.decodeUnknownOption(hostGithubTokenRequestSchema);

/**
 * Whether the agent's newest launch runs on its Mac's own sign-in, as its
 * launch line recorded it (`RunnerMark.ownLogin`), whatever the Mac says of
 * its sign-in since; one with no launch, or none the store can read, reads
 * as so, and is handed nothing.
 */
const launchedOnMacLogin = (userId: string, agentId: string) =>
  hostedStoreOrUnavailable(
    Effect.map(latestDeviceAgentLaunch(userId, agentId), (launch) =>
      Option.match(
        Option.flatMap(launch, (line) => decodeLaunchPayload(line.payload)),
        {
          onNone: () => true,
          onSome: (payload) => payload.ownLogin === true,
        },
      ),
    ),
  );

/** The agent the body names, as the member's store reads it; refused where the body names none. */
const askedAgent = /* @__PURE__ */ Effect.fn("web/askedAgent")(function* (userId: string) {
  const body = yield* parseJsonBytes(yield* readBodyBytesEffect(HOST_GITHUB_TOKEN_MAX_BODY_BYTES));
  const asked = decodeGithubTokenRequest(body);
  if (Option.isNone(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  return yield* hostedStoreOrUnavailable(readAgent(userId, asked.value.agentId));
});

/**
 * An installation token for the device agent's repository, braked per
 * agent, answered uncached; refused where the agent works in no repository
 * or the installation of its task's workspace does not reach it.
 */
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

/**
 * A GitHub token for a device's own agent named in the body, the one rule
 * every device caller is held to: an installation token for the agent's
 * repository, where the agent is the member's own and pinned to the caller's own device
 * (`actsForDevice`), that device runs its agents in a VM
 * of their own (`DEVICE_ISOLATION.SANDBOX`), since an agent run directly on
 * a device pushes on its developer's own login, and the agent works in a
 * repository the installation of its task's workspace reaches; refused
 * otherwise.
 */
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
  // Note that a teammate's agent the member reaches in a shared workspace is refused, as is one in the cloud.
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
  // Note that the device is read under the member, so another member's device reads as none.
  const standing = yield* hostedStoreOrUnavailable(deviceLayout(userId, deviceId));
  if (!Option.exists(standing, (each) => each.isolation === DEVICE_ISOLATION.SANDBOX)) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  }
  return yield* repositoryTokenFor(userId, agent.value, brake);
});

/** POST: the plan's access token, for the Codex agent on the plan the bearer stands for; or, on a host's device secret, its agent's GitHub token. */
const runnerTokenEndpoint = /* @__PURE__ */ Effect.fn("web/runnerTokenEndpoint")(function* (
  brake: RateBrake,
  seams: RunnerTokenSeams,
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
  // Note that a runner's bearer is admitted first, so a runner reads as it always has, even one whose random bearer happens to begin like a device secret.
  if (Option.isNone(admitted)) {
    return yield* deviceGithubToken(yield* deviceCallerOf(seams.resolveUserId, request), brake);
  }
  const { target } = admitted.value;
  const agent = yield* hostedStoreOrUnavailable(
    readAgentHeaderOfConversation(target.userId, target.conversationId),
  );
  if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const routing = yield* hostedStoreOrUnavailable(readAgentRouting(target.userId, agent.value.id));
  // Note that only an agent its starter's plan pays for, on Codex, is handed the plan's token: one
  // started on the plan, or a local one started on its Mac's own sign-in whose running launch
  // turned to the plan as that Mac was signed out of Codex (`codex-sessions.ts`'s `savedPayer`),
  // which its launch line records, so a sign-in on the Mac since cuts no plan-backed turn short.
  const payer = Option.getOrUndefined(
    Option.flatMap(
      Option.filter(routing, (row) => row.runtime === CONVERSATION_RUNTIME.CODEX),
      (row) => Option.fromNullishOr(row.payer),
    ),
  );
  const onPlan =
    payer === AGENT_PAYER.CHATGPT_SUBSCRIPTION ||
    (payer === AGENT_PAYER.MAC_SIGN_IN &&
      !(yield* launchedOnMacLogin(target.userId, agent.value.id)));
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
export function runnerTokenApp(
  seams: RunnerTokenSeams,
): WebRoutes<DatabaseServices | HostedEnvironment | HttpClient.HttpClient | GitHubApp> {
  const endpoint = runnerTokenEndpoint(makeRateBrake(RUNNER_TOKEN_BRAKE), seams);
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, RUNNER_TOKEN_PATH, hostedRefusing(endpoint)),
    hostedNotFoundRoute,
  );
}
