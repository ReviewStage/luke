import { createHmac, timingSafeEqual } from "node:crypto";
import type { DatabaseServices } from "@sidecar/database/core/query";
import {
  GITHUB_INSTALLATION_STATUS,
  type GitHubInstallationStatus,
} from "@sidecar/database/github-installation-vocabulary";
import { askRecord } from "@sidecar/database/models/asks";
import {
  listCodingAgentsOnBranches,
  type OwnedCodingAgent,
} from "@sidecar/database/models/coding-agent-store";
import { REPORT_KIND, type Report } from "@sidecar/hosted/rollout-wire";
import { EXCESS_KEYS, type UnparsedWireValue } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Layer, Redacted, Result, Schema } from "effect";
import {
  type HttpClient,
  HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/http";
import { clearRevokedAuthorization, type GitHubApp } from "./github/github-app.js";
import { queueGithubRuns } from "./hosted/automation-github.js";
import { type EveSessions, eveSessionsComposer } from "./hosted/brain-host/eve-sessions.js";
import { reportToPlan } from "./hosted/brain-host/report.js";
import { agentPublished } from "./hosted/coder-host/published.js";
import { HostedEnvironment } from "./hosted/environment.js";
import { setInstallationStatus } from "./hosted/github-installations.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  parseJsonBytes,
  readBodyBytesEffect,
} from "./hosted/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

/**
 * github-webhook-app.ts -- the Luke GitHub App's webhook: a delivery about a pull request or its checks reads what the agents on that branch published again, one about an installation marks its workspace active or not, and a revoked authorization clears that GitHub user's tokens, and a merge, a close, or a review asking for changes is reported to Luke.
 *
 * The events read are a pull request's, a check suite's, a check run's once
 * it ends, and a commit status's, since the checks' one word counts the
 * statuses beside the runs, and a review once submitted. GitHub signs every delivery with the App's webhook secret, and nothing is
 * read before the signature over the body's own bytes is confirmed in
 * constant time; a deployment holding no secret refuses every delivery as
 * unavailable, so an unconfigured webhook trusts nothing. Of a delivery only
 * its event, its action, the repository's full name, the branches it names,
 * and what a close or a review tells Luke are read, and none of them is
 * logged or kept but in the report below: the branch finds the
 * agents whose rows stand on it, of whichever account, and what each
 * published is read again from GitHub on its owner's own token, exactly as
 * the agent's tab reads it (`hosted/coder-host/published.ts`), which writes
 * it on the agent's row for the plan list. A delivery is therefore
 * idempotent: GitHub redelivering it reads the same pull request again. A
 * read that fails is logged by its kind alone and the delivery is still
 * answered, since GitHub retries nothing on its own and the next delivery
 * or the tab's next read reads again.
 *
 * An installation's own deliveries, which GitHub sends every App without
 * its subscribing, move the status of the workspace that stands for it
 * (`hosted/github-installations.ts`): removed or suspended marks it
 * inactive, and unsuspended active again. Nothing is deleted, so an installation
 * suspended and brought back keeps its members and its plans.
 *
 * A user revoking their authorization of the App, which GitHub also sends
 * without subscribing (`github_app_authorization`), drops that GitHub user's
 * account row and its tokens, so no account stands linked to a GitHub that no
 * longer answers it.
 *
 * Every delivery is also read as an automation's trigger
 * (`hosted/automation-github.ts`): a pull request or issue opened or
 * labelled, a check suite that failed, or a push queues a run, under the
 * delivery's own id, for each automation on a plan of the repository that
 * listens for it, and the minute sweep starts each one's agent.
 *
 * A pull request merged or closed by hand, and a review asking for changes,
 * are also told to Luke: after the reread, each plan with a rollout worker on
 * the branch gets a GitHub report on its conversation (`reportToPlan`), keyed
 * by the delivery's id, so a redelivery reports once. The reread comes first
 * so the [rollout] lines that report's turn reads already say merged. The
 * report goes to eve as the deployment acting for the worker's owner, which
 * is the only caller the planning channel lets open a report turn.
 */

/** The path GitHub delivers to, as the App's settings name it under the deployment's origin. */
const GITHUB_WEBHOOK_PATH = "/api/github/webhook";

const HTTP_METHOD = { POST: "POST" } as const;

/** The headers a delivery carries that are read here. */
const DELIVERY_HEADER = {
  EVENT: "x-github-event",
  /** GitHub's id for the delivery, the same on a redelivery, which an automation's run is recorded under and a report to Luke is keyed by. */
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
  /** A review submitted on a pull request, told to Luke where it asks for changes. */
  PULL_REQUEST_REVIEW: "pull_request_review",
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

/** A pull request's actions that change what a plan's row says of it: where it stands, its title, or its size. */
const PULL_REQUEST_ACTIONS: ReadonlySet<string> = new Set([
  "opened",
  "reopened",
  "closed",
  "edited",
  "synchronize",
  "ready_for_review",
  "converted_to_draft",
]);

/** A pull request's action that ends it, merged or not. */
const PULL_REQUEST_CLOSED = "closed";

/** A review's action as it is submitted, and the state of one asking for changes, as the webhook spells them. */
const REVIEW_SUBMITTED = "submitted";
const REVIEW_CHANGES_REQUESTED = "changes_requested";

/** The most characters of a review's own words a report carries, inside the report's own bound with room for the line before them. */
const MAXIMUM_REVIEW_CHARS = 3_000;

/** How much of a merge commit's id a report names, as `git` abbreviates one. */
const SHORT_SHA_CHARS = 7;

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

/** A delivery as far as it is read: what happened, the repository and branch it names, and for a close, whether and where it merged. */
const PullRequestDeliverySchema = Schema.Struct({
  action: Schema.String,
  repository: RepositorySchema,
  pull_request: Schema.Struct({
    number: Schema.Int,
    head: Schema.Struct({ ref: Schema.String }),
    base: Schema.Struct({ ref: Schema.String }),
    merged: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
    merge_commit_sha: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
});

const PullRequestReviewDeliverySchema = Schema.Struct({
  action: Schema.String,
  repository: RepositorySchema,
  review: Schema.Struct({ state: Schema.String, body: Schema.NullOr(Schema.String) }),
  pull_request: Schema.Struct({ number: Schema.Int, head: Schema.Struct({ ref: Schema.String }) }),
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

/** What a delivery tells Luke of a pull request: a report but for its reporter, which is the repository. */
interface DeliveryReport {
  readonly kind: Report["kind"];
  readonly pullRequest: number;
  readonly text: string;
}

/** The repository and branches a delivery is about, where it is one this webhook reads, and what it tells Luke, where it tells him anything. */
interface DeliveryTarget {
  readonly repository: string;
  readonly branches: readonly string[];
  readonly report?: DeliveryReport;
}

export interface GitHubWebhookSeams {
  /** The origin eve answers on; nothing where the deployment names none, which reports nothing to Luke. */
  readonly eveOrigin: () => string | undefined;
  /** eve as the deployment reaches it for the account; a test hands a fake, and the deployment composes eve's client over the ambient `HttpClient` under its own secret. */
  readonly eve?: (account: string) => EveSessions;
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

/** What a pull request's close tells Luke: merged into its base as a commit, or closed without merging. */
function closeReport(pull: typeof PullRequestDeliverySchema.Type.pull_request): DeliveryReport {
  if (pull.merged === true) {
    const as = pull.merge_commit_sha
      ? ` as ${pull.merge_commit_sha.slice(0, SHORT_SHA_CHARS)}`
      : "";
    return {
      kind: REPORT_KIND.MERGED,
      pullRequest: pull.number,
      text: `#${pull.number} merged into ${pull.base.ref}${as} on GitHub.`,
    };
  }
  return {
    kind: REPORT_KIND.STOPPED,
    pullRequest: pull.number,
    text: `#${pull.number} closed without merging on GitHub.`,
  };
}

/** What a review asking for changes tells Luke: that it did, and the review's own words, bounded. */
function reviewReport(pullRequest: number, body: string | null): DeliveryReport {
  const words = body?.trim().slice(0, MAXIMUM_REVIEW_CHARS) ?? "";
  return {
    kind: REPORT_KIND.BLOCKED,
    pullRequest,
    text: [`A review requested changes on #${pullRequest}.`, ...(words ? ["", words] : [])].join(
      "\n",
    ),
  };
}

/** The repository and branches the delivery is about, where its event and action are ones that move a pull request's row or tell Luke something; nothing otherwise. */
function deliveryTarget(event: string, payload: UnparsedWireValue): DeliveryTarget | undefined {
  switch (event) {
    case WEBHOOK_EVENT.PULL_REQUEST: {
      const read = readDelivery(PullRequestDeliverySchema, payload);
      if (Result.isFailure(read) || !PULL_REQUEST_ACTIONS.has(read.success.action))
        return undefined;
      const pull = read.success.pull_request;
      return {
        repository: read.success.repository.full_name,
        branches: [pull.head.ref],
        ...(read.success.action === PULL_REQUEST_CLOSED
          ? { report: closeReport(pull) }
          : undefined),
      };
    }
    case WEBHOOK_EVENT.PULL_REQUEST_REVIEW: {
      const read = readDelivery(PullRequestReviewDeliverySchema, payload);
      if (
        Result.isFailure(read) ||
        read.success.action !== REVIEW_SUBMITTED ||
        read.success.review.state.toLowerCase() !== REVIEW_CHANGES_REQUESTED
      )
        return undefined;
      const pull = read.success.pull_request;
      return {
        repository: read.success.repository.full_name,
        branches: [pull.head.ref],
        report: reviewReport(pull.number, read.success.review.body),
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
  agents: readonly OwnedCodingAgent[],
): Effect.fn.Return<number, never, DatabaseServices | HttpClient.HttpClient | GitHubApp> {
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

/** eve as the deployment reaches it for an account, or nothing where the deployment names no secret or no origin for eve. */
const deploymentEve = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: GitHubWebhookSeams,
): Effect.fn.Return<
  ((account: string) => EveSessions) | undefined,
  never,
  HttpClient.HttpClient | HostedEnvironment
> {
  if (seams.eve !== undefined) return seams.eve;
  const { cronSecret } = yield* HostedEnvironment;
  const origin = seams.eveOrigin();
  if (cronSecret === undefined || origin === undefined) return undefined;
  const compose = yield* eveSessionsComposer;
  return (account) => compose({ origin, caller: { secret: cronSecret, account } });
});

/**
 * The delivery's report handed to Luke on the plan of each rollout worker
 * among the agents, keyed by the delivery's id. Note that the reports run one
 * at a time, because two workers of one plan on one branch then report once:
 * the second finds the ask the first recorded under the same key.
 */
const reportToPlans = /* @__PURE__ */ Effect.fn("web/githubWebhookReport")(function* (
  seams: GitHubWebhookSeams,
  agents: readonly OwnedCodingAgent[],
  repository: string,
  delivery: DeliveryReport,
  deliveryId: string,
): Effect.fn.Return<void, never, DatabaseServices | HttpClient.HttpClient | HostedEnvironment> {
  const workers = agents.filter(({ agent }) => agent.position !== null);
  if (workers.length === 0) return;
  const eveOf = yield* deploymentEve(seams);
  if (eveOf === undefined) {
    yield* Effect.logWarning("github webhook: a report found no eve to reach");
    return;
  }
  const report: Report = { ...delivery, github: repository };
  for (const { userId, agent } of workers) {
    const eve = eveOf(userId);
    const reported = yield* reportToPlan(
      { asks: askRecord(), eve },
      { userId, planId: agent.planId, report, clientKey: deliveryId },
    ).pipe(
      Effect.catch((failure) =>
        Effect.as(
          Effect.logWarning("github webhook: a report could not be handed to Luke", {
            failure: failure._tag,
          }),
          undefined,
        ),
      ),
    );
    if (reported !== undefined && Result.isFailure(reported)) {
      yield* Effect.logWarning("github webhook: Luke did not take a report", {
        refusal: reported.failure.refusal,
      });
    }
  }
});

/** POST: one delivery, its signature confirmed before anything of it is read. */
const deliveryEndpoint = /* @__PURE__ */ Effect.fn("web/githubWebhookEndpoint")(function* (
  seams: GitHubWebhookSeams,
): Effect.fn.Return<
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
  const queued = yield* hostedStoreOrUnavailable(
    queueGithubRuns(request.headers[DELIVERY_HEADER.DELIVERY] ?? "", event, payload),
  );
  const target = deliveryTarget(event, payload);
  if (target === undefined) return hostedJsonResponse(200, { read: 0, queued });
  const agents = yield* hostedStoreOrUnavailable(
    listCodingAgentsOnBranches(target.repository, target.branches, MAXIMUM_AGENTS_PER_DELIVERY),
  );
  const read = yield* readAgainOnBranches(agents);
  const deliveryId = request.headers[DELIVERY_HEADER.DELIVERY];
  // A delivery with no id of its own cannot be told to Luke once, so it is not told at all.
  if (target.report !== undefined && deliveryId) {
    yield* reportToPlans(seams, agents, target.repository, target.report, deliveryId);
  }
  return hostedJsonResponse(200, { read, queued });
});

/** The group: the one delivery path, and the hosted vocabulary's own refusal for any other. */
export function githubWebhookApp(
  seams: GitHubWebhookSeams,
): WebRoutes<HostedEnvironment | DatabaseServices | HttpClient.HttpClient | GitHubApp> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, GITHUB_WEBHOOK_PATH, hostedRefusing(deliveryEndpoint(seams))),
    hostedNotFoundRoute,
  );
}
