import {
  HTTP_METHOD,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
} from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Result, type Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  type AccountCallEffects,
  accountCall,
  type CallAnswer,
  type CallCredential,
  callAnswered,
} from "./account-call.js";
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
  AUTOMATION_LIST_QUERY,
  AUTOMATION_TRIGGER,
  type AutomationSummary,
  automationAnswerSchema,
  automationListAnswerSchema,
  automationRunAnswerSchema,
  automationRunsAnswerSchema,
} from "./automation-wire.js";
import { type RepositoryUnreached, repositoryNotReachableSchema } from "./repository-reach-wire.js";
import {
  automationPath,
  automationRunPath,
  automationRunsPath,
  automationWebhookPath,
  HOSTED_SERVICE_PATH,
} from "./service-paths.js";
import {
  HOSTED_API_ERROR,
  type HostedApiError,
  hostedErrorSchema,
  readServiceAnswer,
} from "./service-wire.js";

/**
 * automation-client.ts -- the window's side of the account's automations, as the host asks the service for them.
 *
 * Every call is the one account call, so the bearer is read fresh per
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

/** A response's body as JSON, or nothing where it is not JSON at all. */
function jsonOf(response: Response): Effect.Effect<WireBoundaryInput> {
  return Effect.promise((): Promise<WireBoundaryInput> => response.json().catch(() => undefined));
}

/**
 * A body that says nothing let go unread: cancelled rather than read, so its
 * stream is not left open and a body that stalls past its headers holds up
 * no answer.
 */
function cancelled(response: Response): Effect.Effect<void> {
  return Effect.ignore(Effect.tryPromise(() => response.body?.cancel() ?? Promise.resolve()));
}

/** The refusal a refused answer carries, where it is one this client names, with why a repository is out of reach where the service said; unanswered otherwise. */
function refusedAs(payload: UnparsedWireValue, named: NamedRefusals): Failed {
  const refusal = Result.getOrUndefined(readServiceAnswer(hostedErrorSchema)(payload));
  const failure = refusal === undefined ? undefined : named[refusal];
  if (failure === undefined) return UNANSWERED;
  if (failure !== AUTOMATION_CALL_FAILURE.REPOSITORY_NOT_REACHABLE) return { failure };
  const reached = Result.getOrUndefined(readServiceAnswer(repositoryNotReachableSchema)(payload));
  return reached === undefined ? { failure } : { failure, unreached: reached.unreached };
}

/** An answer read whole: the body the schema admits, a key a newer service added dropped, or why there is none. */
function readAnswer<Answer, Encoded>(
  answer: CallAnswer,
  schema: Schema.Codec<Answer, Encoded>,
): Effect.Effect<Answer | Failed> {
  if (!callAnswered(answer)) return Effect.succeed(UNANSWERED);
  return Effect.map(jsonOf(answer.response), (body): Answer | Failed => {
    const payload = unparsedWire(body);
    if (!answer.response.ok) return refusedAs(payload, REFUSALS);
    const read = Result.getOrUndefined(readServiceAnswer(schema)(payload));
    return read === undefined ? UNANSWERED : read;
  });
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

/** The list's query: one task's or one workspace's, or none for every automation the account reads. */
function listQuery(params: AutomationListParams): string {
  const query = new URLSearchParams();
  if (params.taskId !== undefined) query.set(AUTOMATION_LIST_QUERY.TASK_ID, params.taskId);
  if (params.workspaceId !== undefined) {
    query.set(AUTOMATION_LIST_QUERY.WORKSPACE_ID, params.workspaceId);
  }
  const spelled = query.toString();
  return spelled === "" ? "" : `?${spelled}`;
}

/** The window's reads and writes of the account's automations. */
export class HostedAutomationClient {
  readonly #call: AccountCallEffects;
  readonly #serviceBaseUrl: string;

  constructor(options: HostedAutomationClientOptions) {
    this.#serviceBaseUrl = options.serviceBaseUrl;
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  /** The account's automations, or one task's, or one workspace's. */
  list(
    params: AutomationListParams,
  ): Effect.Effect<AutomationListView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.GET,
        path: `${HOSTED_SERVICE_PATH.AUTOMATIONS}${listQuery(params)}`,
      }),
      (answer) =>
        Effect.map(readAnswer(answer, automationListAnswerSchema), (read) =>
          "failure" in read
            ? read
            : {
                automations: read.automations.map((each) =>
                  withWebhookUrl(this.#serviceBaseUrl, each),
                ),
              },
        ),
    );
  }

  /** An automation made, answering it as the service kept it. */
  create(
    params: AutomationCreateParams,
  ): Effect.Effect<AutomationView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(automationCreateParamsSchema)(params));
    if (admitted === undefined) return Effect.succeed({ failure: AUTOMATION_CALL_FAILURE.INVALID });
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.AUTOMATIONS,
        body: JSON.stringify(admitted),
      }),
      (answer) =>
        Effect.map(readAnswer(answer, automationAnswerSchema), (read) =>
          summaryOnly(this.#serviceBaseUrl, read),
        ),
    );
  }

  /** One automation changed, answering it as it then stands. */
  change(
    params: AutomationChangeParams,
  ): Effect.Effect<AutomationView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(automationChangeParamsSchema)(params));
    if (admitted === undefined) return Effect.succeed({ failure: AUTOMATION_CALL_FAILURE.INVALID });
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.PATCH,
        path: automationPath(admitted.automationId),
        body: JSON.stringify(admitted.change),
      }),
      (answer) =>
        Effect.map(readAnswer(answer, automationAnswerSchema), (read) =>
          summaryOnly(this.#serviceBaseUrl, read),
        ),
    );
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
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.PATCH,
        path: automationPath(params.automationId),
        body: JSON.stringify({ webhookSecretHash: params.webhookSecretHash }),
      }),
      (answer) =>
        Effect.map(readAnswer(answer, automationAnswerSchema), (read) =>
          summaryOnly(this.#serviceBaseUrl, read),
        ),
    );
  }

  /** One automation deleted with its history. */
  remove(
    params: AutomationIdParams,
  ): Effect.Effect<AutomationDeletedView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.DELETE, path: automationPath(params.automationId) }),
      (answer): Effect.Effect<AutomationDeletedView> => {
        if (!callAnswered(answer)) return Effect.succeed(UNANSWERED);
        if (answer.response.ok) return Effect.as(cancelled(answer.response), { deleted: true });
        return Effect.map(jsonOf(answer.response), (body) =>
          refusedAs(unparsedWire(body), REFUSALS),
        );
      },
    );
  }

  /** One automation run now, under the window's key, answering the run as it came out. */
  runNow(
    params: AutomationRunParams,
  ): Effect.Effect<AutomationRunView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.POST,
        path: automationRunPath(params.automationId),
        body: JSON.stringify({ idempotencyKey: params.idempotencyKey }),
      }),
      (answer) => readAnswer(answer, automationRunAnswerSchema),
    );
  }

  /** One automation's runs, newest first. */
  runs(
    params: AutomationIdParams,
  ): Effect.Effect<AutomationRunsView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.GET, path: automationRunsPath(params.automationId) }),
      (answer) => readAnswer(answer, automationRunsAnswerSchema),
    );
  }
}
