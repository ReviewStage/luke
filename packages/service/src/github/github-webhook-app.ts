import { createHmac, timingSafeEqual } from "node:crypto";
import type { DatabaseServices } from "@luke/database/core/query";
import {
  GITHUB_INSTALLATION_STATUS,
  type GitHubInstallationStatus,
} from "@luke/database/github-installation-vocabulary";
import { listCodingAgentsOnBranches } from "@luke/database/models/coding-agent-store";
import { EXCESS_KEYS, type UnparsedWireValue } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Clock, Effect, Layer, Redacted, Result, Schema } from "effect";
import {
  type HttpClient,
  HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/http";
import { deploymentEveOrigin } from "../agents/brain-host/eve-origin.js";
import { EVE_MOUNT, type EveTypedTurn } from "../agents/brain-host/eve-sessions.js";
import { agentPublished } from "../agents/coder-host/published.js";
import { deploymentEveForAccounts } from "../agents/deployment-eve.js";
import { queueGithubRuns } from "../automations/automation-github.js";
import type { EveForAccount } from "../automations/automation-runs.js";
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
import { agentWakeOf, wakeAgents } from "./agent-wakes.js";
import { clearRevokedAuthorization, GitHubApp } from "./github-app.js";
import { setInstallationStatus } from "./github-installations.js";

/**
 * github-webhook-app.ts -- the Luke GitHub App's webhook: a delivery about a pull request or its checks reads what the agents on that branch published again, one about an installation marks its workspace active or not, and a revoked authorization clears that GitHub user's tokens.
 *
 * The events read are a pull request's, a check suite's, a check run's once
 * it ends, and a commit status's, since the checks' one word counts the
 * statuses beside the runs. GitHub signs every delivery with the App's webhook secret, and nothing is
 * read before the signature over the body's own bytes is confirmed in
 * constant time; a deployment holding no secret refuses every delivery as
 * unavailable, so an unconfigured webhook trusts nothing. Of a delivery only
 * its event, its action, the repository's full name, and the branches it
 * names are read, and none of them is kept or logged: the branch finds the
 * agents whose rows stand on it, of whichever account, and what each
 * published is read again from GitHub on its owner's own token, exactly as
 * the agent's tab reads it (`packages/service/src/agents/coder-host/published.ts`), which writes
 * it on the agent's row for the task list. A delivery is therefore
 * idempotent: GitHub redelivering it reads the same pull request again. A
 * read that fails is logged by its kind alone and the delivery is still
 * answered, since GitHub retries nothing on its own and the next delivery
 * or the tab's next read reads again.
 *
 * An installation's own deliveries, which GitHub sends every App without
 * its subscribing, move the status of the workspace that stands for it
 * (`@luke/service/github/github-installations`): removed or suspended marks it
 * inactive, and unsuspended active again. Nothing is deleted, so an installation
 * suspended and brought back keeps its members and its tasks. GitHub never
 * redelivers a failed delivery on its own, so a status one missed is mended
 * by the next read of the installation from GitHub (`github-app.ts`). Its
 * `installation_repositories` deliveries, a repository given or taken, are
 * answered and ignored, because no repository of an installation is held:
 * the chip lists them from GitHub each time it opens, and every start checks
 * its repository there (`github-procedures.ts`, `workspace-repository.ts`).
 *
 * A user revoking their authorization of the App, which GitHub also sends
 * without subscribing (`github_app_authorization`), drops that GitHub user's
 * account row and its tokens, so no account stands linked to a GitHub that no
 * longer answers it.
 *
 * Every delivery is also read as an automation's trigger
 * (`packages/service/src/automations/automation-github.ts`): a pull request or issue opened or
 * labelled, a check suite that failed, or a push queues a run, under the
 * delivery's own id, for each automation on a task of the repository that
 * listens for it, and the minute sweep starts each one's agent. And a
 * review, a comment on a pull request, or a check that failed on an
 * agent's branch is told to the agents on that pull request as a message
 * from GitHub (`agent-wakes.ts`), through eve as the deployment acting for
 * each agent's owner, under the deployment's own eve secret an automation's
 * run reaches eve by; a deployment without it tells nobody.
 */

/** The path GitHub delivers to, as the App's settings name it under the deployment's origin. */
const GITHUB_WEBHOOK_PATH = "/api/github/webhook";

const HTTP_METHOD = { POST: "POST" } as const;

/** The headers a delivery carries that are read here. */
const DELIVERY_HEADER = {
  EVENT: "x-github-event",
  /** GitHub's id for the delivery, the same on a redelivery, which an automation's run is recorded under. */
  DELIVERY: "x-github-delivery",
  SIGNATURE: "x-hub-signature-256",
} as const;

/** What the signature header leads with before the HMAC's hex. */
const SIGNATURE_PREFIX = "sha256=";

/** The events a delivery is read for; any other is answered and ignored. */
const WEBHOOK_EVENT = {
  /** GitHub's own test delivery as the webhook is saved. */
  PING: "ping",
  PULL_REQUEST: "pull_request",
  CHECK_SUITE: "check_suite",
  CHECK_RUN: "check_run",
  /** A commit status, which the checks' one word counts beside the check runs. */
  STATUS: "status",
  /** The App installed, removed, suspended, or brought back on an account. */
  INSTALLATION: "installation",
  /** A user revoked their authorization of the App. */
  APP_AUTHORIZATION: "github_app_authorization",
} as const;

/** The one action an authorization delivery has: the user revoked it. */
const AUTHORIZATION_REVOKED = "revoked";

/** What each installation action leaves its workspace's status at; any other action moves nothing. */
const INSTALLATION_ACTION_STATUS: ReadonlyMap<string, GitHubInstallationStatus> = new Map([
  ["deleted", GITHUB_INSTALLATION_STATUS.DELETED],
  ["suspend", GITHUB_INSTALLATION_STATUS.SUSPENDED],
  ["unsuspend", GITHUB_INSTALLATION_STATUS.ACTIVE],
]);

/** A pull request's actions that change what a task's row says of it: where it stands, its title, or its size. */
const PULL_REQUEST_ACTIONS: ReadonlySet<string> = new Set([
  "opened",
  "reopened",
  "closed",
  "edited",
  "synchronize",
  "ready_for_review",
  "converted_to_draft",
]);

/** A check run is read once it has ended, since its start moves nothing a suite's own start does not. */
const CHECK_RUN_COMPLETED = "completed";

/** GitHub caps a delivery at 25 MB; a pull request's is a few kilobytes, so this is generous and still bounded. */
const MAXIMUM_DELIVERY_BYTES = 5 * 1024 * 1024;

/** The most agents one delivery reads again, newest started first, so a delivery answers inside GitHub's ten seconds. */
const MAXIMUM_AGENTS_PER_DELIVERY = 10;

/** How many of those reads run at once. */
const READ_CONCURRENCY = 4;

const RepositorySchema = Schema.Struct({ full_name: Schema.String });
const HeadSchema = Schema.Struct({ head: Schema.Struct({ ref: Schema.String }) });

/** A delivery as far as it is read: what happened, and the repository and branches it names. */
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

const CheckRunDeliverySchema = Schema.Struct({
  action: Schema.String,
  repository: RepositorySchema,
  check_run: Schema.Struct({
    check_suite: Schema.optionalKey(
      Schema.Struct({ head_branch: Schema.optionalKey(Schema.NullOr(Schema.String)) }),
    ),
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

/** An authorization delivery as far as it is read: what happened, and GitHub's own id of the user it happened to. */
const AuthorizationDeliverySchema = Schema.Struct({
  action: Schema.String,
  sender: Schema.Struct({ id: Schema.Number }),
});

/** A delivery read against the few fields it is read for; every other key GitHub sends is dropped unread. */
function readDelivery<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  payload: UnparsedWireValue,
) {
  return readEither(schema, { excess: EXCESS_KEYS.DROP })(payload);
}

/** The repository and branches a delivery is about, where it is one this webhook reads. */
interface DeliveryTarget {
  readonly repository: string;
  readonly branches: readonly string[];
}

/** Whether the signature header is the HMAC-SHA256 of the body's own bytes under the secret, compared in constant time. */
function signatureMatches(
  body: Uint8Array,
  header: string | null,
  secret: Redacted.Redacted,
): boolean {
  if (header === null || !header.startsWith(SIGNATURE_PREFIX)) return false;
  const offered = Buffer.from(header.slice(SIGNATURE_PREFIX.length), "hex");
  // The secret is revealed here alone, into the HMAC the compare reads.
  const wanted = createHmac("sha256", Redacted.value(secret)).update(body).digest();
  return offered.length === wanted.length && timingSafeEqual(offered, wanted);
}

/** Each branch named once, the null a detached head leaves dropped. */
function branchesOf(named: readonly (string | null)[]): readonly string[] {
  return [...new Set(named.filter((branch): branch is string => branch !== null))];
}

/** The repository and branches the delivery is about, where its event and action are ones that move a pull request's row; nothing otherwise. */
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
    case WEBHOOK_EVENT.CHECK_RUN: {
      const read = readDelivery(CheckRunDeliverySchema, payload);
      if (Result.isFailure(read) || read.success.action !== CHECK_RUN_COMPLETED) return undefined;
      const run = read.success.check_run;
      return {
        repository: read.success.repository.full_name,
        branches: branchesOf([
          run.check_suite?.head_branch ?? null,
          ...run.pull_requests.map((pr) => pr.head.ref),
        ]),
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

/** The installation an installation delivery is about and the status its action leaves it at, where its action moves one. */
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

/** The GitHub user whose authorization a delivery says was revoked; nothing for any other action. */
function revokedAuthorization(payload: UnparsedWireValue): number | undefined {
  const read = readDelivery(AuthorizationDeliverySchema, payload);
  if (Result.isFailure(read) || read.success.action !== AUTHORIZATION_REVOKED) return undefined;
  return read.success.sender.id;
}

/** What the agents on the target's branches published, read again on each owner's token; answers how many reads landed. */
const readAgainOnBranches = /* @__PURE__ */ Effect.fn("web/githubWebhookReadAgain")(function* (
  target: DeliveryTarget,
): Effect.fn.Return<number, HostedRefusal, DatabaseServices | HttpClient.HttpClient | GitHubApp> {
  const agents = yield* hostedStoreOrUnavailable(
    listCodingAgentsOnBranches(target.repository, target.branches, MAXIMUM_AGENTS_PER_DELIVERY),
  );
  const landed = yield* Effect.forEach(
    agents,
    ({ userId, agent }) =>
      agentPublished(userId, agent).pipe(
        Effect.as(true),
        // The kind alone: nothing of the delivery or the owner's token rides the line.
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

/** POST: one delivery, its signature confirmed before anything of it is read. */
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
    // A deployment with no App configured knows no bot of its own, so every bot is another's.
    const agentLogin = yield* Effect.orElseSucceed((yield* GitHubApp).botLogin, () => undefined);
    const queued = yield* hostedStoreOrUnavailable(
      queueGithubRuns(request.headers[DELIVERY_HEADER.DELIVERY] ?? "", event, payload, agentLogin),
    );
    const target = deliveryTarget(event, payload);
    const read = target === undefined ? 0 : yield* readAgainOnBranches(target);
    const wake = agentWakeOf(event, payload, yield* Clock.currentTimeMillis);
    // eve's coding-agent service as the deployment acting for each agent's owner, as an automation's
    // run reaches it (`agents/deployment-eve.ts`); a deployment that cannot reach it tells nobody.
    const eveForAccount: EveForAccount = yield* deploymentEveForAccounts<EveTypedTurn>(
      deploymentEveOrigin(),
      EVE_MOUNT.CODER,
    );
    const told =
      wake === undefined
        ? 0
        : yield* wakeAgents(
            eveForAccount,
            wake,
            request.headers[DELIVERY_HEADER.DELIVERY] ?? "",
            agentLogin,
          );
    return hostedJsonResponse(200, { read, queued, told });
  },
);

/** The group: the one delivery path, and the hosted vocabulary's own refusal for any other. */
export function githubWebhookApp(): WebRoutes<
  HostedEnvironment | DatabaseServices | HttpClient.HttpClient | GitHubApp
> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, GITHUB_WEBHOOK_PATH, hostedRefusing(deliveryEndpoint())),
    hostedNotFoundRoute,
  );
}
