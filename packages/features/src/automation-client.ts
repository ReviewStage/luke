import { readEither } from "@repo/wire/effect";
import { Effect, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { CallCredential } from "./account-call.js";
import {
  type AutomationRunsLiveAnswer,
  type AutomationsLiveAnswer,
  type AutomationWorkspaceRunsLiveAnswer,
  withWebhookUrl,
} from "./automation-live.js";
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
import type { automationAnswerSchema, automationChangeRequestSchema } from "./automation-wire.js";
import {
  askHosted,
  askLive,
  type HostedClient,
  type HostedFailure,
  hostedClient,
} from "./hosted-link.js";
import { LIVE_SIGNED_OUT, LIVE_USER_QUERY } from "./live-wire.js";
import type { RepositoryUnreached } from "./repository-reach-wire.js";
import { HOSTED_API_ERROR, type HostedApiError } from "./service-wire.js";

export interface HostedAutomationClientOptions {
  credential: CallCredential;
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

type Failed = {
  readonly failure: AutomationCallFailure;
  readonly unreached?: RepositoryUnreached;
};

const UNANSWERED: Failed = { failure: AUTOMATION_CALL_FAILURE.UNANSWERED };

type NamedRefusals = Readonly<Partial<Record<HostedApiError, AutomationCallFailure>>>;

const REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: AUTOMATION_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.NO_REPOSITORY]: AUTOMATION_CALL_FAILURE.NO_REPOSITORY,
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE]: AUTOMATION_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
  [HOSTED_API_ERROR.INVALID_REQUEST]: AUTOMATION_CALL_FAILURE.INVALID,
  [HOSTED_API_ERROR.NOT_PERMITTED]: AUTOMATION_CALL_FAILURE.NOT_PERMITTED,
} satisfies NamedRefusals;

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

function summaryOnly(
  serviceBaseUrl: string,
  read: typeof automationAnswerSchema.Type | Failed,
): AutomationView {
  if ("failure" in read) return read;
  const automation = withWebhookUrl(serviceBaseUrl, read.automation);
  return {
    automation,
    ...(read.webhookSecret === undefined ? undefined : { webhookSecret: read.webhookSecret }),
    ...(read.txid === undefined ? undefined : { txid: read.txid }),
  };
}

function liveAnswered<Answer>(
  asked: Effect.Effect<Answer, HostedFailure, HttpClient.HttpClient>,
): Effect.Effect<Answer | Failed | typeof LIVE_SIGNED_OUT, never, HttpClient.HttpClient> {
  return Effect.catch(asked, (failed) =>
    Effect.succeed(
      failed._tag === "HostedRefused" && failed.refusal === HOSTED_API_ERROR.INVALID_TOKEN
        ? LIVE_SIGNED_OUT
        : failedAs(failed, REFUSALS),
    ),
  );
}

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

  create(
    params: AutomationCreateParams,
  ): Effect.Effect<AutomationView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(automationCreateParamsSchema)(params));
    if (admitted === undefined) return Effect.succeed({ failure: AUTOMATION_CALL_FAILURE.INVALID });
    return Effect.map(answered(askHosted(this.#hosted.automations.create, admitted)), (read) =>
      summaryOnly(this.#serviceBaseUrl, read),
    );
  }

  change(
    params: AutomationChangeParams,
  ): Effect.Effect<AutomationView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(automationChangeParamsSchema)(params));
    if (admitted === undefined) return Effect.succeed({ failure: AUTOMATION_CALL_FAILURE.INVALID });
    return this.#changed(admitted.automationId, admitted.change);
  }

  replaceWebhookSecret(params: {
    readonly automationId: string;
    readonly webhookSecretHash: string;
  }): Effect.Effect<AutomationView, never, HttpClient.HttpClient> {
    return this.#changed(params.automationId, { webhookSecretHash: params.webhookSecretHash });
  }

  remove(
    params: AutomationIdParams,
  ): Effect.Effect<AutomationDeletedView, never, HttpClient.HttpClient> {
    return Effect.map(
      answered(askHosted(this.#hosted.automations.remove, { id: params.automationId })),
      (read): AutomationDeletedView =>
        "failure" in read
          ? read
          : read.txid === undefined
            ? { deleted: true }
            : { deleted: true, txid: read.txid },
    );
  }

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

  runs(
    params: AutomationIdParams,
  ): Effect.Effect<AutomationRunsView, never, HttpClient.HttpClient> {
    return answered(askHosted(this.#hosted.automations.runs, { id: params.automationId }));
  }

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

  listLive(
    workspaceId: string,
    userId: string,
    poll = false,
    after?: string,
  ): Effect.Effect<
    AutomationsLiveAnswer | Failed | typeof LIVE_SIGNED_OUT,
    never,
    HttpClient.HttpClient
  > {
    return liveAnswered(
      askLive(
        this.#hosted.live.automations,
        { workspaceId, [LIVE_USER_QUERY]: userId },
        poll,
        after,
      ),
    );
  }

  workspaceRunsLive(
    workspaceId: string,
    userId: string,
    poll = false,
    after?: string,
  ): Effect.Effect<
    AutomationWorkspaceRunsLiveAnswer | Failed | typeof LIVE_SIGNED_OUT,
    never,
    HttpClient.HttpClient
  > {
    return liveAnswered(
      askLive(
        this.#hosted.live.automationWorkspaceRuns,
        { workspaceId, [LIVE_USER_QUERY]: userId },
        poll,
        after,
      ),
    );
  }

  runsLive(
    automationId: string,
    userId: string,
    poll = false,
    after?: string,
  ): Effect.Effect<
    AutomationRunsLiveAnswer | Failed | typeof LIVE_SIGNED_OUT,
    never,
    HttpClient.HttpClient
  > {
    return liveAnswered(
      askLive(
        this.#hosted.live.automationRuns,
        { id: automationId, [LIVE_USER_QUERY]: userId },
        poll,
        after,
      ),
    );
  }
}
