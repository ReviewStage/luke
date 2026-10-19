import {
  HTTP_METHOD,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
} from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  type AccountCallEffects,
  accountCall,
  type CallAnswer,
  type CallCredential,
  callAnswered,
} from "./account-call.js";
import type { AccountPreferencesAnswerWire } from "./account-wire.js";
import {
  CHAT_ATTACHMENT_QUERY,
  CHAT_QUERY,
  type ChatWriteRequest,
  chatWriteRequestSchema,
} from "./chat-wire.js";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
  type CodingAgentCallFailure,
  type CodingAgentChangesAnswerView,
  type CodingAgentChatAnswerView,
  type CodingAgentChatWriteAnswerView,
  type CodingAgentDefaultAnswer,
  type CodingAgentGitHubImageView,
  type CodingAgentInboxAnsweredView,
  type CodingAgentInboxAttachmentView,
  type CodingAgentInboxMessagedView,
  type CodingAgentInboxReadAllView,
  type CodingAgentInboxReadStateView,
  type CodingAgentListAnswer,
  type CodingAgentMessagesAnswerView,
  type CodingAgentModelsAnswer,
  type CodingAgentOverviewChecksAnswerView,
  type CodingAgentOverviewConversationAnswerView,
  type CodingAgentOverviewPullRequestAnswerView,
  type CodingAgentPageAnswerView,
  type CodingAgentPullRequestAnswerView,
  type CodingAgentPullRequestViewedAnswerView,
  type CodingAgentPullRequestWriteAnswerView,
  type CodingAgentReviewOptionsAnswerView,
  type CodingAgentWorkspaceListParams,
  type DictationTranscribeAnswerView,
  type DictationTranscribeParams,
  githubImageTypeSchema,
  type PlanTemplateAnswerView,
  type PlanTemplateRevisionAnswerView,
  type PlanTemplateRevisionParams,
  type PlanTemplateRevisionsAnswerView,
  type PlanTemplateRevisionsParams,
  type PlanTemplateWriteParams,
  type ProviderKeyRemoveParams,
  type ProviderKeySaveParams,
  type ProviderKeysAnswerView,
} from "./coding-agent-view.js";
import {
  CODING_AGENT_ATTACHMENT_TYPE,
  CODING_AGENT_CURSOR_START,
  CODING_AGENT_LIST_ARCHIVED,
  CODING_AGENT_LIST_QUERY,
  CODING_AGENT_WORKSPACE_QUERY,
  type CodingAgentArchiveRequest,
  type CodingAgentMessageRequest,
  type CodingAgentPinRequest,
  type CodingAgentRenameRequest,
  type CodingAgentServersRequest,
  type CodingAgentStartRequest,
  codingAgentAnswerSchema,
  codingAgentChangesAnswerSchema,
  codingAgentListAnswerSchema,
  codingAgentMessageRequestSchema,
  codingAgentOverviewChecksAnswerSchema,
  codingAgentOverviewConversationAnswerSchema,
  codingAgentOverviewPullRequestAnswerSchema,
  codingAgentPageAnswerSchema,
  codingAgentPullRequestAnswerSchema,
  codingAgentRenameRequestSchema,
  codingAgentReviewOptionsAnswerSchema,
  codingAgentServersRequestSchema,
  codingAgentStartRequestOnWire,
} from "./coding-agent-wire.js";
import { dictationRequestSchema } from "./dictation-wire.js";
import {
  askHosted,
  HOSTED_DEADLINE,
  type HostedClient,
  type HostedFailure,
  hostedClient,
} from "./hosted-link.js";
import { imageBodyOf } from "./image-body.js";
import {
  type InboxAnswerRequest,
  type InboxCloseRequest,
  type InboxMessageRequest,
  type InboxReadAllRequest,
  inboxAnsweredSchema,
  inboxAnswerRequestSchema,
  inboxCloseRequestSchema,
  inboxImageTypeSchema,
  inboxMessagedSchema,
  inboxMessageRequestSchema,
  inboxReadAllRequestSchema,
  inboxReadAllSchema,
  inboxReadStateSchema,
} from "./inbox-wire.js";
import {
  type AccountInboxLiveAnswer,
  accountInboxLiveAnswerSchema,
  type ScopeInboxLiveAnswer,
  scopeInboxLiveAnswerSchema,
} from "./live-wire.js";
import {
  codingAgentDefaultWriteSchema,
  type ModelChoice,
  modelChoiceSchema,
} from "./models-wire.js";
import { planTemplateWriteRequestSchema } from "./plan-document-template.js";
import { PROVIDER_KEY_QUERY, providerKeySaveRequestSchema } from "./provider-key-wire.js";
import {
  type PullRequestActionRequest,
  pullRequestActionRequestSchema,
  pullRequestViewedAnswerSchema,
  pullRequestWriteAnswerSchema,
} from "./pull-request-write-wire.js";
import { type RepositoryUnreached, repositoryNotReachableSchema } from "./repository-reach-wire.js";
import {
  agentChangesPath,
  agentGitHubImagePath,
  agentOverviewChecksPath,
  agentOverviewConversationPath,
  agentOverviewPullRequestPath,
  agentPath,
  agentPicturePath,
  agentPullRequestActionPath,
  agentPullRequestPath,
  agentPullRequestViewedPath,
  agentReviewOptionsPath,
  agentStopPath,
  HOSTED_SERVICE_PATH,
  inboxAttachmentPath,
  inboxClosePath,
  inboxItemPath,
  inboxItemReadPath,
  inboxMessagesPath,
  taskAgentsPath,
} from "./service-paths.js";
import {
  HOSTED_API_ERROR,
  type HostedApiError,
  hostedErrorSchema,
  readServiceAnswer,
} from "./service-wire.js";
import type { TaskAgentRefusal } from "./task-wire.js";

/**
 * coding-agent-client.ts -- the window's side of a task's coding agents, as the host asks the service for them.
 *
 * Every call is the one account call, so the bearer is read fresh per
 * attempt and a 401 is renewed and retried once. Each call answers one of
 * the view's shapes rather than failing, because every caller does the same
 * thing with a failure: draws why, and offers to try again. The transcript
 * read, the two inbox reads, a task's and the account's, and the
 * workspace's chat read are the calls the service holds open, for as long
 * as it waits on the agent's next message or the next change, so they
 * travel under a deadline of
 * their own that outlasts that hold; a Start travels under a longer one
 * still, since one from another agent copies its work first; every other
 * call keeps the account call's usual one. The account's task
 * template is read and written here too, as Settings asks for it beside
 * the default and the keys.
 */

/**
 * How long a Start may stand: a Start from another agent copies its work,
 * summarizing what does not fit, before the new agent's session opens,
 * which can run well past the usual deadline; a Start that outlasts it is
 * asked again under the same key and answered with the agent it made.
 */
const START_TIMEOUT_MS = 120_000;

export interface HostedCodingAgentClientOptions {
  /** What authorizes each call on the signed-in account, read fresh for every attempt. */
  credential: CallCredential;
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

const UNANSWERED = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

type Failed = {
  readonly failure: CodingAgentCallFailure;
  readonly unreached?: RepositoryUnreached;
};

/** The refusals a call may answer with, by the service's own word for each. */
type NamedRefusals = Readonly<Partial<Record<HostedApiError, CodingAgentCallFailure>>>;

/** The refusals a Start can answer with. */
const START_REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: CODING_AGENT_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.NO_REPOSITORY]: CODING_AGENT_CALL_FAILURE.NO_REPOSITORY,
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE]: CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
  [HOSTED_API_ERROR.GITHUB_UNANSWERED]: CODING_AGENT_CALL_FAILURE.GITHUB_UNANSWERED,
  [HOSTED_API_ERROR.INVALID_REQUEST]: CODING_AGENT_CALL_FAILURE.INVALID_CHOICE,
  [HOSTED_API_ERROR.TASK_ARCHIVED]: CODING_AGENT_CALL_FAILURE.TASK_ARCHIVED,
} satisfies NamedRefusals;

/** The refusals a call that names one row can answer with. */
const ROW_REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: CODING_AGENT_CALL_FAILURE.NOT_FOUND,
} satisfies NamedRefusals;

/** The refusals an archive can answer with: the agent gone, or one still starting or awaiting its turn, which has no turn to stop yet. */
const ARCHIVE_REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: CODING_AGENT_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.AGENT_NOT_READY]: CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY,
} satisfies NamedRefusals;

/** The refusals a message can answer with: the agent gone, the words past the bound, a session still coming up or ended for good, its task archived, and the repository the turn's checkout no longer reaches. */
const MESSAGE_REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: CODING_AGENT_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.MESSAGE_TOO_LONG]: CODING_AGENT_CALL_FAILURE.MESSAGE_TOO_LONG,
  [HOSTED_API_ERROR.AGENT_NOT_READY]: CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY,
  [HOSTED_API_ERROR.AGENT_RETIRED]: CODING_AGENT_CALL_FAILURE.AGENT_RETIRED,
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE]: CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
  [HOSTED_API_ERROR.GITHUB_UNANSWERED]: CODING_AGENT_CALL_FAILURE.GITHUB_UNANSWERED,
  [HOSTED_API_ERROR.TASK_ARCHIVED]: CODING_AGENT_CALL_FAILURE.TASK_ARCHIVED,
} satisfies NamedRefusals;

/** The refusals an answer to the inbox can answer with: a message's own, since an answer the agent needs to hear reaches it as one. */
const INBOX_ANSWER_REFUSALS = MESSAGE_REFUSALS;

/** The refusals writing the default can answer with: a choice the catalog does not offer. */
const DEFAULT_REFUSALS = {
  [HOSTED_API_ERROR.INVALID_REQUEST]: CODING_AGENT_CALL_FAILURE.INVALID_CHOICE,
} satisfies NamedRefusals;

/** The refusals changing an agent's choice can answer with: the agent gone, or a choice the catalog does not offer. */
const CHOOSE_REFUSALS = {
  ...ROW_REFUSALS,
  ...DEFAULT_REFUSALS,
} satisfies NamedRefusals;

/** A response's body as JSON, or nothing where it is not JSON at all. */
function jsonOf(response: Response): Effect.Effect<WireBoundaryInput> {
  return Effect.promise((): Promise<WireBoundaryInput> => response.json().catch(() => undefined));
}

/**
 * The refusal a refused answer carries, where it is one the caller names;
 * unanswered otherwise. A repository out of reach carries why where the
 * service said and the reason is one this build reads, and none otherwise.
 */
function refusedAs(payload: UnparsedWireValue, named: NamedRefusals): Failed {
  const refusal = Result.getOrUndefined(readServiceAnswer(hostedErrorSchema)(payload));
  const failure = refusal === undefined ? undefined : named[refusal];
  if (failure === undefined) return UNANSWERED;
  if (failure !== CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE) return { failure };
  const reached = Result.getOrUndefined(readServiceAnswer(repositoryNotReachableSchema)(payload));
  return reached === undefined ? { failure } : { failure, unreached: reached.unreached };
}

/** A Start's refusal the service answered beside a task it made all the same (`task-wire.ts`'s `taskStartAnswerSchema`), read as a refused Start is. */
export function startRefusedAs(refusal: TaskAgentRefusal): Failed {
  return refusedAs(unparsedWire(refusal), START_REFUSALS);
}

/** An image's bytes read whole and spelled in base64 under the type the service named, or unanswered where the type is none an image block may be or the body could not be read. */
function readImage(response: Response): Effect.Effect<CodingAgentInboxAttachmentView> {
  return Effect.map(imageBodyOf(response, inboxImageTypeSchema), (image) => image ?? UNANSWERED);
}

/** The types an inbox item's attachment is served under: a block's picture's, or any a file an answer carried travelled as. */
const inboxFileTypeSchema = Schema.Literals(Object.values(CODING_AGENT_ATTACHMENT_TYPE));

/** An inbox attachment's bytes in base64 under its type: a picture, or a file an answer carried; unanswered under any other type. */
function readInboxFile(response: Response): Effect.Effect<CodingAgentInboxAttachmentView> {
  return Effect.map(imageBodyOf(response, inboxFileTypeSchema), (file) => file ?? UNANSWERED);
}

/**
 * An answer read whole: the body the schema admits where the service
 * answered, a key a newer service added dropped rather than refused, the
 * refusal where it is one the caller names, and unanswered for everything
 * else.
 */
function readAnswer<Answer, Encoded>(
  answer: CallAnswer,
  schema: Schema.Codec<Answer, Encoded>,
  named: NamedRefusals,
): Effect.Effect<Answer | Failed> {
  if (!callAnswered(answer)) return Effect.succeed(UNANSWERED);
  return Effect.map(jsonOf(answer.response), (body): Answer | Failed => {
    const payload = unparsedWire(body);
    if (!answer.response.ok) return refusedAs(payload, named);
    const read = Result.getOrUndefined(readServiceAnswer(schema)(payload));
    return read === undefined ? UNANSWERED : read;
  });
}

/**
 * A procedure's answer, or the refusal it failed with where it is one the
 * caller names, with the fields that refusal carries; unanswered for
 * everything else.
 */
function hostedAnswer<Answer>(
  asked: Effect.Effect<Answer, HostedFailure, HttpClient.HttpClient>,
  named: NamedRefusals,
): Effect.Effect<Answer | Failed, never, HttpClient.HttpClient> {
  return Effect.catch(asked, (failed) => Effect.succeed(hostedFailedAs(failed, named)));
}

function hostedFailedAs(failed: HostedFailure, named: NamedRefusals): Failed {
  if (failed._tag !== "HostedRefused") return UNANSWERED;
  const failure = named[failed.refusal];
  if (failure === undefined) return UNANSWERED;
  const unreached = failed.data?.unreached;
  return unreached === undefined ? { failure } : { failure, unreached };
}

/**
 * The default read off the preferences snapshot, or why there was none: its
 * coding-agent part as a choice reads, the settings parts beside it the
 * settings client's to read.
 */
function defaultOf(read: AccountPreferencesAnswerWire | Failed): CodingAgentDefaultAnswer {
  if ("failure" in read) return read;
  const choice = Option.getOrUndefined(
    Schema.decodeUnknownOption(modelChoiceSchema)(read.codingAgent),
  );
  return choice === undefined ? UNANSWERED : { choice };
}

/**
 * The window's reads and writes of a task's coding agents: the models the
 * service offers and the account's default among them, a task's agents,
 * one started, one's transcript past a cursor, one messaged, one's model
 * and effort changed, one stopped, what one published, the task's inbox
 * of what its agents need of the developer, read past a cursor and
 * answered an item at a time, and what waits across the account's tasks.
 */
export class HostedCodingAgentClient {
  readonly #call: AccountCallEffects;
  readonly #start: AccountCallEffects;

  readonly #hosted: HostedClient;

  constructor(options: HostedCodingAgentClientOptions) {
    const { credential } = options;
    this.#hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#start = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential,
      requestTimeoutMs: START_TIMEOUT_MS,
    });
  }

  /** The models a coding agent may run on, as the service offers them now. */
  models(): Effect.Effect<CodingAgentModelsAnswer, never, HttpClient.HttpClient> {
    return hostedAnswer(askHosted(this.#hosted.models.list, undefined), {});
  }

  /** The account's default model and effort, read off the preferences snapshot. */
  readDefault(): Effect.Effect<CodingAgentDefaultAnswer, never, HttpClient.HttpClient> {
    return Effect.map(
      hostedAnswer(askHosted(this.#hosted.account.preferences, undefined), {}),
      defaultOf,
    );
  }

  /** The account's default written on its own, answering it as kept; a choice the service would refuse by shape is refused here without traveling at all. */
  writeDefault(
    choice: ModelChoice,
  ): Effect.Effect<CodingAgentDefaultAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(codingAgentDefaultWriteSchema)({ codingAgent: choice }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.map(
      hostedAnswer(askHosted(this.#hosted.account.writePreferences, admitted), DEFAULT_REFUSALS),
      defaultOf,
    );
  }

  /** The account's plan template: its own, or the default while it keeps none. */
  readPlanTemplate(): Effect.Effect<PlanTemplateAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(askHosted(this.#hosted.account.planTemplate, undefined), {});
  }

  /**
   * The template kept verbatim, or the default again for null, answering it
   * as then kept; a template past the bound is refused here without
   * traveling at all.
   */
  writePlanTemplate(
    params: PlanTemplateWriteParams,
  ): Effect.Effect<PlanTemplateAnswerView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(planTemplateWriteRequestSchema)(params));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedAnswer(askHosted(this.#hosted.account.writePlanTemplate, admitted), {});
  }

  /** A page of the account's plan template history, the newest or the one before a revision. */
  readPlanTemplateRevisions(
    params: PlanTemplateRevisionsParams,
  ): Effect.Effect<PlanTemplateRevisionsAnswerView, never, HttpClient.HttpClient> {
    // The revision a page is read before travels as the text a query carries.
    const query = params.before === undefined ? {} : { before: String(params.before) };
    return hostedAnswer(askHosted(this.#hosted.account.planTemplateRevisions, query), {});
  }

  /** One revision of the account's plan template beside the one before it. */
  readPlanTemplateRevision(
    params: PlanTemplateRevisionParams,
  ): Effect.Effect<PlanTemplateRevisionAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(
      askHosted(this.#hosted.account.planTemplateRevision, { seq: String(params.seq) }),
      {},
    );
  }

  /** One revision of the account's plan template put back as the template, answering it as then kept. */
  restorePlanTemplate(
    params: PlanTemplateRevisionParams,
  ): Effect.Effect<PlanTemplateAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(
      askHosted(this.#hosted.account.restorePlanTemplate, { seq: String(params.seq) }),
      {},
    );
  }

  /** The account's own provider keys, as hints and statuses. */
  readProviderKeys(): Effect.Effect<ProviderKeysAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(askHosted(this.#hosted.account.providerKeys, undefined), {});
  }

  /**
   * One key saved for its provider, answering the keys as they then stand
   * and, where the service kept nothing, why; a key the service would
   * refuse by shape is refused here without traveling at all.
   */
  saveProviderKey(
    params: ProviderKeySaveParams,
  ): Effect.Effect<ProviderKeysAnswerView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(providerKeySaveRequestSchema)(params));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedAnswer(askHosted(this.#hosted.account.saveProviderKey, admitted), {});
  }

  /** One provider's key removed, answering the keys as they then stand. */
  removeProviderKey(
    params: ProviderKeyRemoveParams,
  ): Effect.Effect<ProviderKeysAnswerView, never, HttpClient.HttpClient> {
    // The provider rides in the query, since a DELETE carries no body.
    return hostedAnswer(
      askHosted(this.#hosted.account.removeProviderKey, {
        query: { [PROVIDER_KEY_QUERY.PROVIDER]: params.provider },
      }),
      {},
    );
  }

  /**
   * One dictated clip's words, under the held deadline, since the service
   * answers only once the model has heard the clip through; a clip the
   * service would refuse by shape is refused here without traveling at all.
   */
  transcribeDictation(
    params: DictationTranscribeParams,
  ): Effect.Effect<DictationTranscribeAnswerView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(dictationRequestSchema)(params));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedAnswer(
      askHosted(this.#hosted.dictation.transcribe, admitted, HOSTED_DEADLINE.HELD),
      {},
    );
  }

  /** One task's agents with their status, in the order they were started, the archived ones among them, each flagged, where `includeArchived` asks. */
  list(
    taskId: string,
    includeArchived = false,
  ): Effect.Effect<CodingAgentListAnswer, never, HttpClient.HttpClient> {
    const query = new URLSearchParams({
      [CODING_AGENT_LIST_QUERY.ARCHIVED]: CODING_AGENT_LIST_ARCHIVED.INCLUDE,
    });
    const path = includeArchived ? `${taskAgentsPath(taskId)}?${query}` : taskAgentsPath(taskId);
    return Effect.flatMap(this.#call.send({ method: HTTP_METHOD.GET, path }), (answer) =>
      readAnswer(answer, codingAgentListAnswerSchema, ROW_REFUSALS),
    );
  }

  /** A workspace's agents, newest started first, narrowed to one repository where one is named and to the words given where some are, the archived ones among them where `includeArchived` asks. */
  listWorkspace(
    params: CodingAgentWorkspaceListParams,
  ): Effect.Effect<CodingAgentListAnswer, never, HttpClient.HttpClient> {
    const query = new URLSearchParams({
      [CODING_AGENT_WORKSPACE_QUERY.WORKSPACE_ID]: params.workspaceId,
    });
    if (params.repository !== undefined) {
      query.set(CODING_AGENT_WORKSPACE_QUERY.REPOSITORY, params.repository);
    }
    if (params.words !== undefined) query.set(CODING_AGENT_WORKSPACE_QUERY.WORDS, params.words);
    if (params.includeArchived === true) {
      query.set(CODING_AGENT_WORKSPACE_QUERY.ARCHIVED, CODING_AGENT_LIST_ARCHIVED.INCLUDE);
    }
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.GET, path: `${HOSTED_SERVICE_PATH.AGENTS}?${query}` }),
      (answer) => readAnswer(answer, codingAgentListAnswerSchema, ROW_REFUSALS),
    );
  }

  /**
   * Starts an agent on the task under the request's own key, so a retry
   * carrying the same key answers the agent the first Start made; a request
   * the service would refuse by shape is refused here without traveling.
   */
  start(
    taskId: string,
    request: CodingAgentStartRequest,
  ): Effect.Effect<CodingAgentAgentAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(codingAgentStartRequestOnWire(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.flatMap(
      this.#start.send({
        method: HTTP_METHOD.POST,
        path: taskAgentsPath(taskId),
        body: JSON.stringify(admitted),
      }),
      (answer) => readAnswer(answer, codingAgentAnswerSchema, START_REFUSALS),
    );
  }

  /** One agent's transcript past the cursor, or a worker's where the delegation call that started it is named, held by the service while the agent or the worker runs and nothing new stands. */
  messages(
    agentId: string,
    after: string,
    callId?: string,
  ): Effect.Effect<CodingAgentMessagesAnswerView, never, HttpClient.HttpClient> {
    const asked =
      callId === undefined
        ? askHosted(this.#hosted.messages.agent, { id: agentId, after }, HOSTED_DEADLINE.HELD)
        : askHosted(
            this.#hosted.messages.agentWorker,
            { id: agentId, call: callId, after },
            HOSTED_DEADLINE.HELD,
          );
    return hostedAnswer(asked, ROW_REFUSALS);
  }

  /**
   * One task's conversation as an agent's transcript is read, or a
   * brain worker's where the call that started it is named: past the
   * cursor, held by the service while a turn or the worker runs; with no
   * cursor, its newest turns; with `before`, the turns before that one.
   */
  taskMessages(
    taskId: string,
    page: { after?: string; before?: string },
    callId?: string,
  ): Effect.Effect<CodingAgentMessagesAnswerView, never, HttpClient.HttpClient> {
    const asked =
      callId === undefined
        ? askHosted(
            this.#hosted.messages.task,
            {
              id: taskId,
              ...(page.after === undefined ? undefined : { after: page.after }),
              ...(page.before === undefined ? undefined : { before: page.before }),
            },
            HOSTED_DEADLINE.HELD,
          )
        : askHosted(
            this.#hosted.messages.taskWorker,
            { id: taskId, call: callId, after: page.after ?? CODING_AGENT_CURSOR_START },
            HOSTED_DEADLINE.HELD,
          );
    return hostedAnswer(asked, ROW_REFUSALS);
  }

  /**
   * Sends one agent a message under the key the window made for the send,
   * which a retry carries again, and answers the agent as it then stands,
   * which is running; a message the service would refuse by shape is
   * refused here without traveling.
   */
  message(
    agentId: string,
    request: CodingAgentMessageRequest,
  ): Effect.Effect<CodingAgentAgentAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(codingAgentMessageRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedAnswer(
      askHosted(this.#hosted.messages.send, { params: { id: agentId }, body: admitted }),
      MESSAGE_REFUSALS,
    );
  }

  /** Changes one agent's model and effort for its next step, answering it as it then stands; a choice the service would refuse by shape is refused here without traveling. */
  choose(
    agentId: string,
    choice: ModelChoice,
  ): Effect.Effect<CodingAgentAgentAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(modelChoiceSchema)(choice));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.PATCH,
        path: agentPath(agentId),
        body: JSON.stringify(admitted),
      }),
      (answer) => readAnswer(answer, codingAgentAnswerSchema, CHOOSE_REFUSALS),
    );
  }

  /** Renames one agent, or clears its title with an empty one, answering it as it then stands; a title past the bound is refused here without traveling. */
  rename(
    agentId: string,
    request: CodingAgentRenameRequest,
  ): Effect.Effect<CodingAgentAgentAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(codingAgentRenameRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.PATCH,
        path: agentPath(agentId),
        body: JSON.stringify(admitted),
      }),
      (answer) => readAnswer(answer, codingAgentAnswerSchema, ROW_REFUSALS),
    );
  }

  /** Switches one agent's MCP servers for its next turn on, the whole list of those off, answering it as it then stands; a list past the bound is refused here without traveling. */
  switchServers(
    agentId: string,
    request: CodingAgentServersRequest,
  ): Effect.Effect<CodingAgentAgentAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(codingAgentServersRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.PATCH,
        path: agentPath(agentId),
        body: JSON.stringify(admitted),
      }),
      (answer) => readAnswer(answer, codingAgentAnswerSchema, ROW_REFUSALS),
    );
  }

  /** Archives one agent, stopping a turn it still runs first, or brings it back, answering it as it then stands. */
  archive(
    agentId: string,
    request: CodingAgentArchiveRequest,
  ): Effect.Effect<CodingAgentAgentAnswer, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.PATCH,
        path: agentPath(agentId),
        body: JSON.stringify({ archived: request.archived }),
      }),
      (answer) => readAnswer(answer, codingAgentAnswerSchema, ARCHIVE_REFUSALS),
    );
  }

  /** Pins one agent for the account alone, or unpins it, answering it as it then stands. */
  pin(
    agentId: string,
    request: CodingAgentPinRequest,
  ): Effect.Effect<CodingAgentAgentAnswer, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.PATCH,
        path: agentPath(agentId),
        body: JSON.stringify(
          request.position === undefined
            ? { pinned: request.pinned }
            : { pinned: request.pinned, position: request.position },
        ),
      }),
      (answer) => readAnswer(answer, codingAgentAnswerSchema, ROW_REFUSALS),
    );
  }

  /** Stops one agent, answering it as it then stands. */
  stop(agentId: string): Effect.Effect<CodingAgentAgentAnswer, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.POST, path: agentStopPath(agentId) }),
      (answer) => readAnswer(answer, codingAgentAnswerSchema, ROW_REFUSALS),
    );
  }

  /** One agent read whole as its own page by its id, on a task or with none. */
  agent(agentId: string): Effect.Effect<CodingAgentPageAnswerView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.GET, path: agentPath(agentId) }),
      (answer) => readAnswer(answer, codingAgentPageAnswerSchema, ROW_REFUSALS),
    );
  }

  /** What one agent published: the branch it pushed and the pull request from it, as GitHub holds them now. */
  pullRequest(
    agentId: string,
    number?: number,
  ): Effect.Effect<CodingAgentPullRequestAnswerView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.GET, path: agentPullRequestPath(agentId, number) }),
      (answer) => readAnswer(answer, codingAgentPullRequestAnswerSchema, ROW_REFUSALS),
    );
  }

  /** One agent's changes: the files of its pull request as GitHub holds them now. */
  changes(
    agentId: string,
    number?: number,
  ): Effect.Effect<CodingAgentChangesAnswerView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.GET, path: agentChangesPath(agentId, number) }),
      (answer) => readAnswer(answer, codingAgentChangesAnswerSchema, ROW_REFUSALS),
    );
  }

  /** One agent's pull request itself as its overview draws it: its description, branches, mergeability, and people as GitHub holds them now. */
  overviewPullRequest(
    agentId: string,
    number?: number,
  ): Effect.Effect<CodingAgentOverviewPullRequestAnswerView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.GET,
        path: agentOverviewPullRequestPath(agentId, number),
      }),
      (answer) => readAnswer(answer, codingAgentOverviewPullRequestAnswerSchema, ROW_REFUSALS),
    );
  }

  /** What the reviewer and label pickers of one agent's Pull request tab offer: its repository's labels, collaborators, and teams as GitHub holds them now. */
  reviewOptions(
    agentId: string,
  ): Effect.Effect<CodingAgentReviewOptionsAnswerView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.GET, path: agentReviewOptionsPath(agentId) }),
      (answer) => readAnswer(answer, codingAgentReviewOptionsAnswerSchema, ROW_REFUSALS),
    );
  }

  /** The checks on one agent's pull request's head as GitHub holds them now. */
  overviewChecks(
    agentId: string,
    number?: number,
  ): Effect.Effect<CodingAgentOverviewChecksAnswerView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.GET, path: agentOverviewChecksPath(agentId, number) }),
      (answer) => readAnswer(answer, codingAgentOverviewChecksAnswerSchema, ROW_REFUSALS),
    );
  }

  /** One agent's pull request's conversation and where its reviewers stand, as GitHub holds them now. */
  overviewConversation(
    agentId: string,
    number?: number,
  ): Effect.Effect<CodingAgentOverviewConversationAnswerView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.GET,
        path: agentOverviewConversationPath(agentId, number),
      }),
      (answer) => readAnswer(answer, codingAgentOverviewConversationAnswerSchema, ROW_REFUSALS),
    );
  }

  /** A workspace's chat past the cursor: what a person in it sees, held by the service while nothing moved. */
  chat(
    workspaceId: string,
    after: string,
  ): Effect.Effect<CodingAgentChatAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(
      askHosted(this.#hosted.messages.chat, { workspaceId, after }, HOSTED_DEADLINE.HELD),
      ROW_REFUSALS,
    );
  }

  /**
   * One picture a chat message carries, by the attachment its image block
   * names, fetched under the account: its bytes in base64 under the media
   * type the service sniffed and kept, as an inbox image is; not found
   * where the account is not in the workspace or the message carries no
   * such picture; unanswered for anything else.
   */
  chatAttachment(
    workspaceId: string,
    messageId: string,
    attachmentId: string,
  ): Effect.Effect<CodingAgentInboxAttachmentView, never, HttpClient.HttpClient> {
    const query = new URLSearchParams({
      [CHAT_ATTACHMENT_QUERY.WORKSPACE_ID]: workspaceId,
      [CHAT_ATTACHMENT_QUERY.MESSAGE_ID]: messageId,
      [CHAT_ATTACHMENT_QUERY.ATTACHMENT_ID]: attachmentId,
    });
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.GET,
        path: `${HOSTED_SERVICE_PATH.WORKSPACES_CHAT_ATTACHMENT}?${query}`,
      }),
      (answer) => {
        if (!callAnswered(answer)) return Effect.succeed(UNANSWERED);
        if (!answer.response.ok) {
          return Effect.map(jsonOf(answer.response), (body) =>
            refusedAs(unparsedWire(body), ROW_REFUSALS),
          );
        }
        return readImage(answer.response);
      },
    );
  }

  /**
   * What waits on the developer across the account, sealed for following
   * over Neon Realtime: answered at once, never held. Unanswered for
   * anything that went wrong, which the caller answers by asking again.
   */
  accountInboxLive(): Effect.Effect<AccountInboxLiveAnswer | Failed, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_INBOX }),
      (answer) => readAnswer(answer, accountInboxLiveAnswerSchema, {}),
    );
  }

  /**
   * One plan's inbox sealed for following over Neon Realtime, answered at
   * once: not found where the account reaches no such plan, unanswered
   * for anything else, which the caller answers by asking again.
   */
  taskInboxLive(
    taskId: string,
  ): Effect.Effect<ScopeInboxLiveAnswer | Failed, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.GET,
        path: `${HOSTED_SERVICE_PATH.LIVE_TASK_INBOX}?${new URLSearchParams({ id: taskId })}`,
      }),
      (answer) => readAnswer(answer, scopeInboxLiveAnswerSchema, ROW_REFUSALS),
    );
  }

  /** One agent's inbox sealed for following over Neon Realtime, on the terms a plan's is. */
  agentInboxLive(
    agentId: string,
  ): Effect.Effect<ScopeInboxLiveAnswer | Failed, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.GET,
        path: `${HOSTED_SERVICE_PATH.LIVE_AGENT_INBOX}?${new URLSearchParams({ id: agentId })}`,
      }),
      (answer) => readAnswer(answer, scopeInboxLiveAnswerSchema, ROW_REFUSALS),
    );
  }

  /**
   * One picture a tool answered an agent, or one of its workers where
   * `callId` names the delegation call, fetched under the account: its
   * bytes in base64 under the media type the service kept, as an inbox
   * image is; not found where the agent is not one the account reaches or
   * its transcript keeps no such picture; unanswered for anything else.
   */
  agentPicture(
    agentId: string,
    pictureId: string,
    callId?: string,
  ): Effect.Effect<CodingAgentInboxAttachmentView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.GET,
        path: agentPicturePath(agentId, pictureId, callId),
      }),
      (answer) => {
        if (!callAnswered(answer)) return Effect.succeed(UNANSWERED);
        if (!answer.response.ok) {
          return Effect.map(jsonOf(answer.response), (body) =>
            refusedAs(unparsedWire(body), ROW_REFUSALS),
          );
        }
        return readImage(answer.response);
      },
    );
  }

  /**
   * One change to an agent's pull request, made on GitHub by the service as
   * the account, on its own GitHub sign-in: how GitHub took it; a change the
   * service would refuse by shape is refused here without traveling.
   */
  pullRequestAction(
    agentId: string,
    request: PullRequestActionRequest,
    number?: number,
  ): Effect.Effect<CodingAgentPullRequestWriteAnswerView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(pullRequestActionRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.POST,
        path: agentPullRequestActionPath(agentId, number),
        body: JSON.stringify(admitted),
      }),
      (answer) => readAnswer(answer, pullRequestWriteAnswerSchema, ROW_REFUSALS),
    );
  }

  /** Which of the agent's pull request's files the member marked viewed on GitHub, read on their own sign-in. */
  pullRequestViewed(
    agentId: string,
    number?: number,
  ): Effect.Effect<CodingAgentPullRequestViewedAnswerView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.GET,
        path: agentPullRequestViewedPath(agentId, number),
      }),
      (answer) => readAnswer(answer, pullRequestViewedAnswerSchema, ROW_REFUSALS),
    );
  }

  /**
   * Writes to a workspace's chat as the account's own member of it: a post,
   * an answer to an ask, a resolve, or how far the person has read, under
   * the key the window made where the write carries one, which a retry
   * carries again; a write the service would refuse by shape is refused
   * here without traveling.
   */
  chatPost(
    workspaceId: string,
    request: ChatWriteRequest,
  ): Effect.Effect<CodingAgentChatWriteAnswerView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(chatWriteRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedAnswer(
      askHosted(this.#hosted.messages.chatWrite, {
        query: { [CHAT_QUERY.WORKSPACE_ID]: workspaceId },
        body: admitted,
      }),
      MESSAGE_REFUSALS,
    );
  }
  /**
   * One image an agent's pull request's overview names, by the address
   * GitHub's rendering spelled, fetched under the account: its bytes in
   * base64 under the type GitHub served; not found where GitHub answers no
   * image the window draws; unanswered for anything else.
   */
  githubImage(
    agentId: string,
    src: string,
  ): Effect.Effect<CodingAgentGitHubImageView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.GET, path: agentGitHubImagePath(agentId, src) }),
      (answer): Effect.Effect<CodingAgentGitHubImageView> => {
        if (!callAnswered(answer)) return Effect.succeed(UNANSWERED);
        if (!answer.response.ok) {
          return Effect.map(jsonOf(answer.response), (body) =>
            refusedAs(unparsedWire(body), ROW_REFUSALS),
          );
        }
        return Effect.map(
          imageBodyOf(answer.response, githubImageTypeSchema),
          (image) => image ?? UNANSWERED,
        );
      },
    );
  }

  /**
   * One image of an inbox item, fetched under the account: its bytes in
   * base64 under the media type the service kept, where the service answered
   * with one of the types an image block's picture or an answer's file may be; not found where the item or
   * the attachment is not the account's; unanswered for anything else,
   * another media type included, so nothing the window draws is a type it
   * did not expect.
   */
  inboxAttachment(
    itemId: string,
    attachmentId: string,
  ): Effect.Effect<CodingAgentInboxAttachmentView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.GET, path: inboxAttachmentPath(itemId, attachmentId) }),
      (answer) => {
        if (!callAnswered(answer)) return Effect.succeed(UNANSWERED);
        if (!answer.response.ok) {
          return Effect.map(jsonOf(answer.response), (body) =>
            refusedAs(unparsedWire(body), ROW_REFUSALS),
          );
        }
        return readInboxFile(answer.response);
      },
    );
  }

  /**
   * Answers one item of the inbox against the revision the window drew,
   * under the key the window made for the answer, which a retry carries
   * again, and answers the item as it then stands with whether the answer
   * was taken; an answer the service would refuse by shape is refused here
   * without traveling.
   */
  answerInbox(
    itemId: string,
    request: InboxAnswerRequest,
  ): Effect.Effect<CodingAgentInboxAnsweredView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(inboxAnswerRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.POST,
        path: inboxItemPath(itemId),
        body: JSON.stringify(admitted),
      }),
      (answer) => readAnswer(answer, inboxAnsweredSchema, INBOX_ANSWER_REFUSALS),
    );
  }

  /**
   * Closes one open item of the inbox without an answer, against the
   * revision the window drew, under the key the window made for the close,
   * which a retry carries again, and answers the item as it then stands with
   * whether the close was taken, as an answer does.
   */
  closeInbox(
    itemId: string,
    request: InboxCloseRequest,
  ): Effect.Effect<CodingAgentInboxAnsweredView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(inboxCloseRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.POST,
        path: inboxClosePath(itemId),
        body: JSON.stringify(admitted),
      }),
      (answer) => readAnswer(answer, inboxAnsweredSchema, INBOX_ANSWER_REFUSALS),
    );
  }

  /**
   * A message of the account's on one item's thread, open or settled: the
   * item as it then stands, its thread with the message on it, where the
   * service wrote it and handed it to the agent; the refusals a message to
   * the agent answers with otherwise, since it reaches the agent as one.
   */
  messageInbox(
    itemId: string,
    request: InboxMessageRequest,
  ): Effect.Effect<CodingAgentInboxMessagedView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(inboxMessageRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.POST,
        path: inboxMessagesPath(itemId),
        body: JSON.stringify(admitted),
      }),
      (answer) => readAnswer(answer, inboxMessagedSchema, INBOX_ANSWER_REFUSALS),
    );
  }

  /**
   * One item marked read for the account, as opening it does: its id and
   * its read state; not found where the item is not one the account
   * reaches. Marking an item read that is read already changes nothing, so
   * the window may ask on every open.
   */
  markInboxItemRead(
    itemId: string,
  ): Effect.Effect<CodingAgentInboxReadStateView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.PUT, path: inboxItemReadPath(itemId) }),
      (answer) => readAnswer(answer, inboxReadStateSchema, ROW_REFUSALS),
    );
  }

  /** One item marked unread for the account until it reads the item again: its id and its read state; not found where the item is not one the account reaches. */
  markInboxItemUnread(
    itemId: string,
  ): Effect.Effect<CodingAgentInboxReadStateView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.DELETE, path: inboxItemReadPath(itemId) }),
      (answer) => readAnswer(answer, inboxReadStateSchema, ROW_REFUSALS),
    );
  }

  /**
   * Every item the account's Inbox lists marked read for it, open or
   * settled, in the one workspace the request names or in all of its
   * workspaces: how many were unread. It clears the unread dots alone; an
   * item still waiting on an answer still waits.
   */
  markInboxRead(
    request: InboxReadAllRequest = {},
  ): Effect.Effect<CodingAgentInboxReadAllView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(inboxReadAllRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.PUT,
        path: HOSTED_SERVICE_PATH.INBOX_READ,
        body: JSON.stringify(admitted),
      }),
      (answer) => readAnswer(answer, inboxReadAllSchema, {}),
    );
  }
}
