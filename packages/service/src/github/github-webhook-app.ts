import { createHmac, timingSafeEqual } from "node:crypto";
import type { DatabaseServices } from "@repo/database/core/query";
import {
  GITHUB_INSTALLATION_STATUS,
  type GitHubInstallationStatus,
} from "@repo/database/github-installation-vocabulary";
import { listAgentsOnBranches } from "@repo/database/models/agent-store";
import {
  noteGitHubRepository,
  type RepositorySighting,
} from "@repo/database/models/github-repositories";
import { EXCESS_KEYS, HTTP_METHOD, type UnparsedWireValue } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Clock, Effect, Layer, Redacted, Result, Schema } from "effect";
import {
  type HttpClient,
  HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/http";
import { agentPublished } from "../agents/coder-host/published.js";
import { routedSessions } from "../agents/coder-host/runtime-sessions.js";
import { queueGithubRuns } from "../automations/automation-github.js";
import type { SessionsForAccount } from "../automations/automation-runs.js";
import { HostedEnvironment } from "../environment.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  parseJsonBytes,
  readBodyBytesEffect,
} from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { agentWakeOf, checksCompletedWakeOf, wakeAgents } from "./agent-wakes.js";
import { clearRevokedAuthorization, GitHubApp } from "./github-app.js";
import { setInstallationStatus } from "./github-installations.js";
import { GitHubBackground } from "./github-rate-gate.js";

const GITHUB_WEBHOOK_PATH = "/api/github/webhook";

const DELIVERY_HEADER = {
  EVENT: "x-github-event",
  DELIVERY: "x-github-delivery",
  SIGNATURE: "x-hub-signature-256",
} as const;

const SIGNATURE_PREFIX = "sha256=";

const WEBHOOK_EVENT = {
  PING: "ping",
  PULL_REQUEST: "pull_request",
  CHECK_SUITE: "check_suite",
  STATUS: "status",
  INSTALLATION: "installation",
  APP_AUTHORIZATION: "github_app_authorization",
  REPOSITORY: "repository",
} as const;

const REPOSITORY_ACTION = {
  RENAMED: "renamed",
  TRANSFERRED: "transferred",
} as const;

const AUTHORIZATION_REVOKED = "revoked";

const INSTALLATION_ACTION_STATUS: ReadonlyMap<string, GitHubInstallationStatus> = new Map([
  ["deleted", GITHUB_INSTALLATION_STATUS.DELETED],
  ["suspend", GITHUB_INSTALLATION_STATUS.SUSPENDED],
  ["unsuspend", GITHUB_INSTALLATION_STATUS.ACTIVE],
]);

const PULL_REQUEST_ACTIONS: ReadonlySet<string> = new Set([
  "opened",
  "reopened",
  "closed",
  "edited",
  "synchronize",
  "ready_for_review",
  "converted_to_draft",
  "enqueued",
  "dequeued",
]);

const MAXIMUM_DELIVERY_BYTES = 5 * 1024 * 1024;

const MAXIMUM_AGENTS_PER_DELIVERY = 10;

const READ_CONCURRENCY = 4;

const RepositorySchema = Schema.Struct({ full_name: Schema.String });
const HeadSchema = Schema.Struct({ head: Schema.Struct({ ref: Schema.String }) });

const PullRequestDeliverySchema = Schema.Struct({
  action: Schema.String,
  repository: RepositorySchema,
  pull_request: HeadSchema,
});

const CheckSuiteDeliverySchema = Schema.Struct({
  repository: RepositorySchema,
  check_suite: Schema.Struct({
    head_branch: Schema.NullOr(Schema.String),
    pull_requests: Schema.Array(HeadSchema),
  }),
});

const StatusDeliverySchema = Schema.Struct({
  repository: RepositorySchema,
  branches: Schema.Array(Schema.Struct({ name: Schema.String })),
});

const InstallationDeliverySchema = Schema.Struct({
  action: Schema.String,
  installation: Schema.Struct({ id: Schema.Number }),
});

const SightedDeliverySchema = Schema.Struct({
  repository: Schema.Struct({
    id: Schema.Number,
    full_name: Schema.String,
    updated_at: Schema.DateFromString,
  }),
});

const OwnerLoginSchema = Schema.Struct({ login: Schema.String });

const RepositoryChangeDeliverySchema = Schema.Struct({
  action: Schema.String,
  repository: Schema.Struct({ name: Schema.String, owner: OwnerLoginSchema }),
  changes: Schema.Struct({
    repository: Schema.optionalKey(Schema.Struct({ name: Schema.Struct({ from: Schema.String }) })),
    owner: Schema.optionalKey(
      Schema.Struct({
        from: Schema.Struct({
          user: Schema.optionalKey(OwnerLoginSchema),
          organization: Schema.optionalKey(OwnerLoginSchema),
        }),
      }),
    ),
  }),
});

const AuthorizationDeliverySchema = Schema.Struct({
  action: Schema.String,
  sender: Schema.Struct({ id: Schema.Number }),
});

function readDelivery<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  payload: UnparsedWireValue,
) {
  return readEither(schema, { excess: EXCESS_KEYS.DROP })(payload);
}

interface DeliveryTarget {
  readonly repository: string;
  readonly branches: readonly string[];
}

function signatureMatches(
  body: Uint8Array,
  header: string | null,
  secret: Redacted.Redacted,
): boolean {
  if (header === null || !header.startsWith(SIGNATURE_PREFIX)) return false;
  const offered = Buffer.from(header.slice(SIGNATURE_PREFIX.length), "hex");
  const wanted = createHmac("sha256", Redacted.value(secret)).update(body).digest();
  return offered.length === wanted.length && timingSafeEqual(offered, wanted);
}

function branchesOf(named: readonly (string | null)[]): readonly string[] {
  return [...new Set(named.filter((branch): branch is string => branch !== null))];
}

function deliveryTarget(event: string, payload: UnparsedWireValue): DeliveryTarget | undefined {
  switch (event) {
    case WEBHOOK_EVENT.PULL_REQUEST: {
      const read = readDelivery(PullRequestDeliverySchema, payload);
      if (Result.isFailure(read) || !PULL_REQUEST_ACTIONS.has(read.success.action))
        return undefined;
      return {
        repository: read.success.repository.full_name,
        branches: [read.success.pull_request.head.ref],
      };
    }
    case WEBHOOK_EVENT.CHECK_SUITE: {
      const read = readDelivery(CheckSuiteDeliverySchema, payload);
      if (Result.isFailure(read)) return undefined;
      const suite = read.success.check_suite;
      return {
        repository: read.success.repository.full_name,
        branches: branchesOf([suite.head_branch, ...suite.pull_requests.map((pr) => pr.head.ref)]),
      };
    }
    case WEBHOOK_EVENT.STATUS: {
      const read = readDelivery(StatusDeliverySchema, payload);
      if (Result.isFailure(read)) return undefined;
      return {
        repository: read.success.repository.full_name,
        branches: branchesOf(read.success.branches.map((branch) => branch.name)),
      };
    }
    default:
      return undefined;
  }
}

function formerName(payload: UnparsedWireValue): string | undefined {
  const read = readDelivery(RepositoryChangeDeliverySchema, payload);
  if (Result.isFailure(read)) return undefined;
  const { action, repository, changes } = read.success;
  if (action === REPOSITORY_ACTION.RENAMED && changes.repository !== undefined) {
    return `${repository.owner.login}/${changes.repository.name.from}`;
  }
  const from = changes.owner?.from;
  const formerOwner = from?.organization?.login ?? from?.user?.login;
  return action === REPOSITORY_ACTION.TRANSFERRED && formerOwner !== undefined
    ? `${formerOwner}/${repository.name}`
    : undefined;
}

function repositorySighting(
  event: string,
  payload: UnparsedWireValue,
): RepositorySighting | undefined {
  const read = readDelivery(SightedDeliverySchema, payload);
  if (Result.isFailure(read)) return undefined;
  const { id, full_name: fullName, updated_at: updatedAt } = read.success.repository;
  const formerly = event === WEBHOOK_EVENT.REPOSITORY ? formerName(payload) : undefined;
  return { id, fullName, updatedAt, formerly };
}

function installationTarget(
  payload: UnparsedWireValue,
): { readonly installationId: number; readonly status: GitHubInstallationStatus } | undefined {
  const read = readDelivery(InstallationDeliverySchema, payload);
  if (Result.isFailure(read)) return undefined;
  const status = INSTALLATION_ACTION_STATUS.get(read.success.action);
  return status === undefined
    ? undefined
    : { installationId: read.success.installation.id, status };
}

function revokedAuthorization(payload: UnparsedWireValue): number | undefined {
  const read = readDelivery(AuthorizationDeliverySchema, payload);
  if (Result.isFailure(read) || read.success.action !== AUTHORIZATION_REVOKED) return undefined;
  return read.success.sender.id;
}

const readAgainOnBranches = /* @__PURE__ */ Effect.fn("web/githubWebhookReadAgain")(function* (
  target: DeliveryTarget,
): Effect.fn.Return<number, HostedRefusal, DatabaseServices | HttpClient.HttpClient | GitHubApp> {
  const agents = yield* hostedStoreOrUnavailable(
    listAgentsOnBranches(target.repository, target.branches, MAXIMUM_AGENTS_PER_DELIVERY),
  );
  const landed = yield* Effect.forEach(
    agents,
    ({ userId, agent }) =>
      agentPublished(userId, agent).pipe(
        Effect.as(true),
        Effect.catch((failure) =>
          Effect.as(
            Effect.logWarning("github webhook: an agent's pull request could not be read again", {
              failure: failure._tag,
            }),
            false,
          ),
        ),
      ),
    { concurrency: READ_CONCURRENCY },
  );
  return landed.filter(Boolean).length;
});

const deliveryEndpoint = /* @__PURE__ */ Effect.fn("web/githubWebhookEndpoint")(
  function* (): Effect.fn.Return<
    HttpServerResponse.HttpServerResponse,
    HostedRefusal,
    | HttpServerRequest.HttpServerRequest
    | HostedEnvironment
    | DatabaseServices
    | HttpClient.HttpClient
    | GitHubApp
  > {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (request.method !== HTTP_METHOD.POST) {
      return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
    }
    const { githubWebhookSecret } = yield* HostedEnvironment;
    if (githubWebhookSecret === undefined) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
    const body = yield* readBodyBytesEffect(MAXIMUM_DELIVERY_BYTES);
    const signature = request.headers[DELIVERY_HEADER.SIGNATURE] ?? null;
    if (!signatureMatches(body, signature, githubWebhookSecret)) {
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    }
    const event = request.headers[DELIVERY_HEADER.EVENT] ?? "";
    if (event === WEBHOOK_EVENT.PING) return hostedJsonResponse(200, { read: 0 });
    const payload = yield* parseJsonBytes(body);
    if (event === WEBHOOK_EVENT.INSTALLATION) {
      const moved = installationTarget(payload);
      if (moved !== undefined) {
        yield* hostedStoreOrUnavailable(setInstallationStatus(moved.installationId, moved.status));
      }
      return hostedJsonResponse(200, { read: 0 });
    }
    if (event === WEBHOOK_EVENT.APP_AUTHORIZATION) {
      const githubUserId = revokedAuthorization(payload);
      if (githubUserId !== undefined) {
        yield* hostedStoreOrUnavailable(clearRevokedAuthorization(githubUserId));
      }
      return hostedJsonResponse(200, { read: 0 });
    }
    const sighting = repositorySighting(event, payload);
    if (sighting !== undefined) yield* hostedStoreOrUnavailable(noteGitHubRepository(sighting));
    if (event === WEBHOOK_EVENT.REPOSITORY) return hostedJsonResponse(200, { read: 0 });
    const agentLogin = yield* Effect.orElseSucceed((yield* GitHubApp).botLogin, () => undefined);
    const queued = yield* hostedStoreOrUnavailable(
      queueGithubRuns(request.headers[DELIVERY_HEADER.DELIVERY] ?? "", event, payload, agentLogin),
    );
    const target = deliveryTarget(event, payload);
    const read = target === undefined ? 0 : yield* readAgainOnBranches(target);
    const now = yield* Clock.currentTimeMillis;
    const wakes = [agentWakeOf(event, payload, now), checksCompletedWakeOf(event, payload, now)];
    const sessionsForAccount: SessionsForAccount = routedSessions;
    const counts = yield* Effect.forEach(wakes, (wake) =>
      wake === undefined
        ? Effect.succeed(0)
        : wakeAgents(
            sessionsForAccount,
            wake,
            request.headers[DELIVERY_HEADER.DELIVERY] ?? "",
            agentLogin,
          ),
    );
    const told = counts.reduce((sum, count) => sum + count, 0);
    return hostedJsonResponse(200, { read, queued, told });
  },
  Effect.provideService(GitHubBackground, true),
);

export function githubWebhookApp(): WebRoutes<
  HostedEnvironment | DatabaseServices | HttpClient.HttpClient | GitHubApp
> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, GITHUB_WEBHOOK_PATH, hostedRefusing(deliveryEndpoint())),
    hostedNotFoundRoute,
  );
}
