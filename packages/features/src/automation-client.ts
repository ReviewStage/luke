import { readEither } from "@luke/wire/effect";
import { Effect, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { CallCredential } from "./account-call.js";
import {
  AUTOMATION_CALL_FAILURE,
  type AutomationCallFailure,
  type AutomationChangeParams,
  type AutomationCreateParams,
  type AutomationDeletedView,
  type AutomationIdParams,
  type AutomationListParams,
  type AutomationListView,
  type AutomationRunParams,
  type AutomationRunsView,
  type AutomationRunView,
  type AutomationView,
  automationChangeParamsSchema,
  automationCreateParamsSchema,
} from "./automation-view.js";
import {
  AUTOMATION_TRIGGER,
  type AutomationSummary,
  type automationAnswerSchema,
  type automationChangeRequestSchema,
} from "./automation-wire.js";
import { askHosted, type HostedClient, type HostedFailure, hostedClient } from "./hosted-link.js";
import type { RepositoryUnreached } from "./repository-reach-wire.js";
import { automationWebhookPath } from "./service-paths.js";
import { HOSTED_API_ERROR, type HostedApiError } from "./service-wire.js";

/**
 * automation-client.ts -- the window's side of the account's automations, as the host asks the service for them.
 *
 * Every call is a procedure of the hosted contract (`contract/automations.ts`)
 * carried by the one account call (`hosted-link.ts`), so the bearer is read fresh per
 * attempt and a 401 is renewed and retried once. Each call answers what the
 * service said or why there is no answer, never a failure, because every
 * caller does the same with one: says why, and offers to try again. A write
 * the service would refuse by shape is refused here without traveling, and
 * a repository the automation's workspace does not reach is refused with
 * why where the service said.
 */

export interface HostedAutomationClientOptions {
  /** What authorizes each call on the signed-in account, read fresh for every attempt. */
  credential: CallCredential;
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

type Failed = {
  readonly failure: AutomationCallFailure;
  readonly unreached?: RepositoryUnreached;
};

const UNANSWERED: Failed = { failure: AUTOMATION_CALL_FAILURE.UNANSWERED };

/** The refusals a call may answer with, by the service's own word for each. */
type NamedRefusals = Readonly<Partial<Record<HostedApiError, AutomationCallFailure>>>;

/** The refusals every automation call can answer with. */
const REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: AUTOMATION_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.NO_REPOSITORY]: AUTOMATION_CALL_FAILURE.NO_REPOSITORY,
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE]: AUTOMATION_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
  [HOSTED_API_ERROR.INVALID_REQUEST]: AUTOMATION_CALL_FAILURE.INVALID,
  [HOSTED_API_ERROR.NOT_PERMITTED]: AUTOMATION_CALL_FAILURE.NOT_PERMITTED,
} satisfies NamedRefusals;

/**
 * A procedure's answer, or the refusal it failed with where it is one this
 * client names, with why a repository is out of reach where the service
 * said; unanswered for everything else.
 */
function answered<Answer>(
  asked: Effect.Effect<Answer, HostedFailure, HttpClient.HttpClient>,
): Effect.Effect<Answer | Failed, never, HttpClient.HttpClient> {
  return Effect.catch(asked, (failed) => Effect.succeed(failedAs(failed, REFUSALS)));
}

function failedAs(failed: HostedFailure, named: NamedRefusals): Failed {
  if (failed._tag !== "HostedRefused") return UNANSWERED;
  const failure = named[failed.refusal];
  if (failure === undefined) return UNANSWERED;
  const unreached =
    failure === AUTOMATION_CALL_FAILURE.REPOSITORY_NOT_REACHABLE
      ? failed.data?.unreached
      : undefined;
  return unreached === undefined ? { failure } : { failure, unreached };
}

/** A write's answer as the window hears it: the summary, and a webhook secret the write minted, the window's to show once by root AGENTS.md's carve-out. */
function summaryOnly(
  serviceBaseUrl: string,
  read: typeof automationAnswerSchema.Type | Failed,
): AutomationView {
  if ("failure" in read) return read;
  const automation = withWebhookUrl(serviceBaseUrl, read.automation);
  return read.webhookSecret === undefined
    ? { automation }
    : { automation, webhookSecret: read.webhookSecret };
}

/** A webhook automation with the address its caller posts to, on the service this client reaches; any other as it came. */
function withWebhookUrl(serviceBaseUrl: string, automation: AutomationSummary): AutomationSummary {
  if (automation.trigger.kind !== AUTOMATION_TRIGGER.WEBHOOK) return automation;
  return { ...automation, webhookUrl: `${serviceBaseUrl}${automationWebhookPath(automation.id)}` };
}

/** The window's reads and writes of the account's automations. */
export class HostedAutomationClient {
  readonly #hosted: HostedClient;
  readonly #serviceBaseUrl: string;

  constructor(options: HostedAutomationClientOptions) {
    this.#serviceBaseUrl = options.serviceBaseUrl;
    this.#hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  /** The account's automations, or one task's, or one workspace's. */
  list(
    params: AutomationListParams,
  ): Effect.Effect<AutomationListView, never, HttpClient.HttpClient> {
    const query = {
      ...(params.taskId === undefined ? undefined : { planId: params.taskId }),
      ...(params.workspaceId === undefined ? undefined : { workspaceId: params.workspaceId }),
    };
    return Effect.map(
      answered(askHosted(this.#hosted.automations.list, query)),
      (read): AutomationListView =>
        "failure" in read
          ? read
          : {
              automations: read.automations.map((each) =>
                withWebhookUrl(this.#serviceBaseUrl, each),
              ),
            },
    );
  }

  /** An automation made, answering it as the service kept it. */
  create(
    params: AutomationCreateParams,
  ): Effect.Effect<AutomationView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(automationCreateParamsSchema)(params));
    if (admitted === undefined) return Effect.succeed({ failure: AUTOMATION_CALL_FAILURE.INVALID });
    return Effect.map(answered(askHosted(this.#hosted.automations.create, admitted)), (read) =>
      summaryOnly(this.#serviceBaseUrl, read),
    );
  }

  /** One automation changed, answering it as it then stands. */
  change(
    params: AutomationChangeParams,
  ): Effect.Effect<AutomationView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(automationChangeParamsSchema)(params));
    if (admitted === undefined) return Effect.succeed({ failure: AUTOMATION_CALL_FAILURE.INVALID });
    return this.#changed(admitted.automationId, admitted.change);
  }

  /**
   * A webhook trigger's secret replaced by one the host minted, sent by its
   * SHA-256 alone, so the secret itself never leaves this machine; answering
   * the automation as it then stands.
   */
  replaceWebhookSecret(params: {
    readonly automationId: string;
    readonly webhookSecretHash: string;
  }): Effect.Effect<AutomationView, never, HttpClient.HttpClient> {
    return this.#changed(params.automationId, { webhookSecretHash: params.webhookSecretHash });
  }

  /** One automation deleted with its history. */
  remove(
    params: AutomationIdParams,
  ): Effect.Effect<AutomationDeletedView, never, HttpClient.HttpClient> {
    return Effect.map(
      answered(askHosted(this.#hosted.automations.remove, { id: params.automationId })),
      (read): AutomationDeletedView => ("failure" in read ? read : { deleted: true }),
    );
  }

  /** One automation run now, under the window's key, answering the run as it came out. */
  runNow(
    params: AutomationRunParams,
  ): Effect.Effect<AutomationRunView, never, HttpClient.HttpClient> {
    return Effect.map(
      answered(
        askHosted(this.#hosted.automations.run, {
          params: { id: params.automationId },
          body: { idempotencyKey: params.idempotencyKey },
        }),
      ),
      (read): AutomationRunView => ("failure" in read ? read : read.body),
    );
  }

  /** One automation's runs, newest first. */
  runs(
    params: AutomationIdParams,
  ): Effect.Effect<AutomationRunsView, never, HttpClient.HttpClient> {
    return answered(askHosted(this.#hosted.automations.runs, { id: params.automationId }));
  }

  /** One automation's change sent, answering it as it then stands. */
  #changed(
    automationId: string,
    change: typeof automationChangeRequestSchema.Encoded,
  ): Effect.Effect<AutomationView, never, HttpClient.HttpClient> {
    return Effect.map(
      answered(
        askHosted(this.#hosted.automations.change, { params: { id: automationId }, body: change }),
      ),
      (read) => summaryOnly(this.#serviceBaseUrl, read),
    );
  }
}
