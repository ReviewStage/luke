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
  type CallCredential,
  callAnswered,
} from "./account-call.js";
import type { AccountPreferencesAnswerWire } from "./account-wire.js";
import { type ChaptersModelId, chaptersModelSchema } from "./chapters-model-choice.js";
import {
  CHAT_ATTACHMENT_QUERY,
  CHAT_QUERY,
  type ChatJoinAnswer,
  type ChatWriteRequest,
  chatWriteRequestSchema,
} from "./chat-wire.js";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
  type CodingAgentCallFailure,
  type CodingAgentCallsAnswerView,
  type CodingAgentChangesAnswerView,
  type CodingAgentChatWriteAnswerView,
  type CodingAgentDefaultAnswer,
  type CodingAgentDeleteAnswerView,
  type CodingAgentGitHubImageView,
  type CodingAgentInboxAnsweredView,
  type CodingAgentInboxAttachmentView,
  type CodingAgentInboxMessagedView,
  type CodingAgentInboxReadAllView,
  type CodingAgentInboxReadStateView,
  type CodingAgentListAnswer,
  type CodingAgentMessageAnswerView,
  type CodingAgentMessagesAnswerView,
  type CodingAgentModelsAnswer,
  type CodingAgentOperatorEnsureAnswerView,
  type CodingAgentOverviewChecksAnswerView,
  type CodingAgentOverviewConversationAnswerView,
  type CodingAgentOverviewPullRequestAnswerView,
  type CodingAgentPageAnswerView,
  type CodingAgentPartView,
  type CodingAgentPullRequestAnswerView,
  type CodingAgentPullRequestViewedAnswerView,
  type CodingAgentPullRequestWriteAnswerView,
  type CodingAgentReviewOptionsAnswerView,
  type CodingAgentWorkspaceListParams,
  type DictationTranscribeAnswerView,
  type DictationTranscribeParams,
  type GitHubTokenAnswerView,
  type GitHubTokenSaveParams,
  githubImageTypeSchema,
  type PlanTemplateAnswerView,
  type PlanTemplateRevisionAnswerView,
  type PlanTemplateRevisionParams,
  type PlanTemplateRevisionsAnswerView,
  type PlanTemplateRevisionsParams,
  type PlanTemplateWriteParams,
  type ProviderKeyForAgentsParams,
  type ProviderKeyRemoveParams,
  type ProviderKeySaveParams,
  type ProviderKeysAnswerView,
} from "./coding-agent-view.js";
import {
  CODING_AGENT_ATTACHMENT_TYPE,
  CODING_AGENT_LIST_ARCHIVED,
  CODING_AGENT_LIST_QUERY,
  CODING_AGENT_WORKSPACE_QUERY,
  type CodingAgentArchiveRequest,
  type CodingAgentMessageRequest,
  type CodingAgentNewestAnswer,
  type CodingAgentOlderAnswer,
  type CodingAgentPinRequest,
  type CodingAgentRenameRequest,
  type CodingAgentServersRequest,
  type CodingAgentStartRequest,
  codingAgentMessageRequestSchema,
  codingAgentRenameRequestSchema,
  codingAgentServersRequestSchema,
  codingAgentStartRequestOnWire,
  type OperatorEnsureRequest,
  TRANSCRIPT_PARTS_QUERY,
} from "./coding-agent-wire.js";
import type { CodingAgentChangeRequest } from "./contract/agents.js";
import { credentialMissingDataSchema, planLimitReachedDataSchema } from "./contract/errors.js";
import { conversationMediaTypeSchema } from "./conversation-picture-wire.js";
import { dictationRequestSchema } from "./dictation-wire.js";
import { githubTokenSaveRequestSchema } from "./github-token-wire.js";
import {
  askHosted,
  askLive,
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
  inboxAnswerRequestSchema,
  inboxCloseRequestSchema,
  inboxImageTypeSchema,
  inboxMessageRequestSchema,
  inboxReadAllRequestSchema,
} from "./inbox-wire.js";
import type { AccountInboxLiveAnswer, ScopeInboxLiveAnswer } from "./live-wire.js";
import {
  type AgentTranscriptLiveAnswer,
  LIVE_SIGNED_OUT,
  LIVE_USER_QUERY,
  TRANSCRIPT_NOW_QUERY,
  type TranscriptNowAnswer,
  type WorkspaceChatLiveAnswer,
} from "./live-wire.js";
import {
  codingAgentDefaultWriteSchema,
  type ModelChoice,
  type ModelProvider,
  modelChoiceSchema,
} from "./models-wire.js";
import { planTemplateWriteRequestSchema } from "./plan-document-template.js";
import {
  type ChatGptCredentialsSaveRequest,
  type ChatGptHostAnswer,
  chatGptCredentialsSaveRequestSchema,
  PROVIDER_KEY_QUERY,
  providerKeyForAgentsRequestSchema,
  providerKeySaveRequestSchema,
} from "./provider-key-wire.js";
import {
  type ChaptersModelAnswerView,
  PULL_REQUEST_CHAPTERS_CALL_FAILURE,
  type PullRequestChaptersAnswerView,
} from "./pull-request-chapters-view.js";
import {
  type PullRequestActionRequest,
  pullRequestActionRequestSchema,
} from "./pull-request-write-wire.js";
import { type RepositoryUnreached, repositoryNotReachableSchema } from "./repository-reach-wire.js";
import {
  agentGitHubImagePath,
  agentPicturePath,
  HOSTED_SERVICE_PATH,
  inboxAttachmentPath,
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
  readonly resetsAt?: number;
  readonly provider?: ModelProvider;
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
  [HOSTED_API_ERROR.NOT_PERMITTED]: CODING_AGENT_CALL_FAILURE.NOT_PERMITTED,
  [HOSTED_API_ERROR.AGENT_IMAGE_PREPARING]: CODING_AGENT_CALL_FAILURE.AGENT_IMAGE_PREPARING,
  [HOSTED_API_ERROR.NATIVE_AGENT_NOT_HERE]: CODING_AGENT_CALL_FAILURE.NATIVE_AGENT_NOT_HERE,
  [HOSTED_API_ERROR.AGENT_PLAN_SIGNED_OUT]: CODING_AGENT_CALL_FAILURE.AGENT_PLAN_SIGNED_OUT,
  [HOSTED_API_ERROR.AGENT_PLAN_UNREACHABLE]: CODING_AGENT_CALL_FAILURE.AGENT_PLAN_UNREACHABLE,
  [HOSTED_API_ERROR.AGENT_PLAN_LIMIT_REACHED]: CODING_AGENT_CALL_FAILURE.AGENT_PLAN_LIMIT_REACHED,
  [HOSTED_API_ERROR.AGENT_PLAN_INELIGIBLE]: CODING_AGENT_CALL_FAILURE.AGENT_PLAN_INELIGIBLE,
  [HOSTED_API_ERROR.AGENT_CREDENTIAL_MISSING]: CODING_AGENT_CALL_FAILURE.AGENT_CREDENTIAL_MISSING,
  [HOSTED_API_ERROR.AGENT_API_KEY_UNREADABLE]: CODING_AGENT_CALL_FAILURE.AGENT_API_KEY_UNREADABLE,
} satisfies NamedRefusals;

/** The refusals a call that names one row can answer with. */
const ROW_REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: CODING_AGENT_CALL_FAILURE.NOT_FOUND,
} satisfies NamedRefusals;

/** The refusals an archive or a delete can answer with: the agent gone, or one still starting or awaiting its turn, which has no turn to stop yet. */
const ARCHIVE_REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: CODING_AGENT_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.AGENT_NOT_READY]: CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY,
} satisfies NamedRefusals;

/** The refusals a message can answer with: the agent gone, the words past the bound, a session still coming up or ended for good, the repository the turn's checkout no longer reaches, and an agent on its starter's own GitHub token the caller did not start. */
const MESSAGE_REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: CODING_AGENT_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.MESSAGE_TOO_LONG]: CODING_AGENT_CALL_FAILURE.MESSAGE_TOO_LONG,
  [HOSTED_API_ERROR.AGENT_NOT_READY]: CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY,
  [HOSTED_API_ERROR.AGENT_RETIRED]: CODING_AGENT_CALL_FAILURE.AGENT_RETIRED,
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE]: CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
  [HOSTED_API_ERROR.GITHUB_UNANSWERED]: CODING_AGENT_CALL_FAILURE.GITHUB_UNANSWERED,
  [HOSTED_API_ERROR.NOT_PERMITTED]: CODING_AGENT_CALL_FAILURE.NOT_PERMITTED,
  [HOSTED_API_ERROR.AGENT_IMAGE_PREPARING]: CODING_AGENT_CALL_FAILURE.AGENT_IMAGE_PREPARING,
  [HOSTED_API_ERROR.NATIVE_AGENT_NOT_HERE]: CODING_AGENT_CALL_FAILURE.NATIVE_AGENT_NOT_HERE,
  [HOSTED_API_ERROR.AGENT_PLAN_SIGNED_OUT]: CODING_AGENT_CALL_FAILURE.AGENT_PLAN_SIGNED_OUT,
  [HOSTED_API_ERROR.AGENT_PLAN_UNREACHABLE]: CODING_AGENT_CALL_FAILURE.AGENT_PLAN_UNREACHABLE,
  [HOSTED_API_ERROR.AGENT_PLAN_LIMIT_REACHED]: CODING_AGENT_CALL_FAILURE.AGENT_PLAN_LIMIT_REACHED,
  [HOSTED_API_ERROR.AGENT_PLAN_INELIGIBLE]: CODING_AGENT_CALL_FAILURE.AGENT_PLAN_INELIGIBLE,
  [HOSTED_API_ERROR.AGENT_CREDENTIAL_MISSING]: CODING_AGENT_CALL_FAILURE.AGENT_CREDENTIAL_MISSING,
  [HOSTED_API_ERROR.AGENT_API_KEY_UNREADABLE]: CODING_AGENT_CALL_FAILURE.AGENT_API_KEY_UNREADABLE,
} satisfies NamedRefusals;

/** The refusals an answer to the inbox can answer with: a message's own, since an answer the agent needs to hear reaches it as one. */
const INBOX_ANSWER_REFUSALS = MESSAGE_REFUSALS;

/** The refusals a dictated clip can answer with: the account saved no OpenAI key to hear it on. */
const DICTATION_REFUSALS = {
  [HOSTED_API_ERROR.OPENAI_KEY_MISSING]: CODING_AGENT_CALL_FAILURE.OPENAI_KEY_MISSING,
} satisfies NamedRefusals;

/** The refusals writing the default can answer with: a choice the catalog does not offer. */
const DEFAULT_REFUSALS = {
  [HOSTED_API_ERROR.INVALID_REQUEST]: CODING_AGENT_CALL_FAILURE.INVALID_CHOICE,
} satisfies NamedRefusals;

/** The refusals changing an agent's choice can answer with: the agent gone, or a choice the catalog does not offer. */
const CHOOSE_REFUSALS = {
  ...ROW_REFUSALS,
  ...DEFAULT_REFUSALS,
} satisfies NamedRefusals;

/** The chapters failures a refusal may stand for, by the service's own word for each. */
type ChaptersRefusals = Readonly<
  Partial<
    Record<
      HostedApiError,
      (typeof PULL_REQUEST_CHAPTERS_CALL_FAILURE)[keyof typeof PULL_REQUEST_CHAPTERS_CALL_FAILURE]
    >
  >
>;

/** The refusals a read or a Generate of a pull request's chapters can answer with. */
const CHAPTERS_REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: PULL_REQUEST_CHAPTERS_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE]:
    PULL_REQUEST_CHAPTERS_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
  [HOSTED_API_ERROR.GITHUB_UNANSWERED]: PULL_REQUEST_CHAPTERS_CALL_FAILURE.GITHUB_UNANSWERED,
  [HOSTED_API_ERROR.UNAVAILABLE]: PULL_REQUEST_CHAPTERS_CALL_FAILURE.UNAVAILABLE,
} satisfies ChaptersRefusals;

/** A chapters procedure's answer, or the refusal it failed with where it is one the tab acts on; unanswered for everything else. */
function chaptersAnswer(
  asked: Effect.Effect<PullRequestChaptersAnswerView, HostedFailure, HttpClient.HttpClient>,
  named: ChaptersRefusals = CHAPTERS_REFUSALS,
): Effect.Effect<PullRequestChaptersAnswerView, never, HttpClient.HttpClient> {
  return Effect.catch(asked, (failed) =>
    Effect.succeed({
      failure:
        (failed._tag === "HostedRefused" ? named[failed.refusal] : undefined) ??
        PULL_REQUEST_CHAPTERS_CALL_FAILURE.UNANSWERED,
    }),
  );
}

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
  if (failure === CODING_AGENT_CALL_FAILURE.AGENT_PLAN_LIMIT_REACHED) {
    const limit = Result.getOrUndefined(readServiceAnswer(planLimitReachedDataSchema)(payload));
    return limit?.resetsAt === undefined ? { failure } : { failure, resetsAt: limit.resetsAt };
  }
  if (failure === CODING_AGENT_CALL_FAILURE.AGENT_CREDENTIAL_MISSING) {
    const missing = Result.getOrUndefined(readServiceAnswer(credentialMissingDataSchema)(payload));
    return missing?.provider === undefined ? { failure } : { failure, provider: missing.provider };
  }
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

/** A transcript's picture's bytes in base64 under its type: a picture, or a WebM an agent recorded; unanswered under any other type. */
function readConversationPicture(
  response: Response,
): Effect.Effect<CodingAgentInboxAttachmentView> {
  return Effect.map(
    imageBodyOf(response, conversationMediaTypeSchema),
    (picture) => picture ?? UNANSWERED,
  );
}

/** The types an inbox item's attachment is served under: a block's picture's, or any a file an answer carried travelled as. */
const inboxFileTypeSchema = Schema.Literals(Object.values(CODING_AGENT_ATTACHMENT_TYPE));

/** An inbox attachment's bytes in base64 under its type: a picture, or a file an answer carried; unanswered under any other type. */
function readInboxFile(response: Response): Effect.Effect<CodingAgentInboxAttachmentView> {
  return Effect.map(imageBodyOf(response, inboxFileTypeSchema), (file) => file ?? UNANSWERED);
}

/**
 * A procedure's answer, or the refusal it failed with where it is one the
 * caller names, with the fields that refusal carries; unanswered for
 * everything else.
 */
/** A transcript page read at once, or unanswered where the service said nothing of whether it would hold, as one too old to read at once does. */
function readNow(
  answer: (CodingAgentMessagesAnswerView & { readonly holds?: boolean }) | Failed,
): TranscriptNowAnswer | Failed {
  if ("failure" in answer) return answer;
  return answer.holds === undefined ? UNANSWERED : { ...answer, holds: answer.holds };
}

function hostedAnswer<Answer>(
  asked: Effect.Effect<Answer, HostedFailure, HttpClient.HttpClient>,
  named: NamedRefusals,
): Effect.Effect<Answer | Failed, never, HttpClient.HttpClient> {
  return Effect.catch(asked, (failed) => Effect.succeed(hostedFailedAs(failed, named)));
}

/**
 * A request as the service reads it: checked as the service would check it,
 * so one it would refuse by shape never travels, and then encoded back into
 * the value the wire carries (a trimmed text trimmed); nothing where it is
 * refused.
 */
function wireRequestOf<Request, Encoded>(
  schema: Schema.Codec<Request, Encoded>,
  request: UnparsedWireValue,
): Encoded | undefined {
  const admitted = Result.getOrUndefined(readEither(schema)(request));
  if (admitted === undefined) return undefined;
  return Option.getOrUndefined(Schema.encodeOption(schema)(admitted));
}

/** The agent and, where the tab names one, the pull request of its repository a read is about, the number as its query spells it. */
function pullRequestRead(agentId: string, number: number | undefined) {
  return number === undefined ? { id: agentId } : { id: agentId, number: String(number) };
}

function hostedFailedAs(failed: HostedFailure, named: NamedRefusals): Failed {
  if (failed._tag !== "HostedRefused") return UNANSWERED;
  const failure = named[failed.refusal];
  if (failure === undefined) return UNANSWERED;
  const unreached = failed.data?.unreached;
  const resetsAt = failed.data?.resetsAt;
  const provider = failed.data?.provider;
  return {
    failure,
    ...(unreached === undefined ? undefined : { unreached }),
    ...(resetsAt === undefined ? undefined : { resetsAt }),
    ...(provider === undefined ? undefined : { provider }),
  };
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

/** The chapters model as nothing the window can show: the call never answered, or answered no model this build offers. */
const CHAPTERS_MODEL_UNANSWERED = {
  failure: PULL_REQUEST_CHAPTERS_CALL_FAILURE.UNANSWERED,
} as const;

/** The chapters model read off the preferences snapshot, or unanswered where it carries none this build offers. */
function chaptersModelAnswerOf(
  asked: Effect.Effect<AccountPreferencesAnswerWire, HostedFailure, HttpClient.HttpClient>,
): Effect.Effect<ChaptersModelAnswerView, never, HttpClient.HttpClient> {
  return Effect.match(asked, {
    onFailure: () => CHAPTERS_MODEL_UNANSWERED,
    onSuccess: (read) => {
      const model = Option.getOrUndefined(
        Schema.decodeUnknownOption(chaptersModelSchema)(read.chaptersModel),
      );
      return model === undefined ? CHAPTERS_MODEL_UNANSWERED : { model };
    },
  });
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

  /** The Claude model the account's Generate chapters runs on, read off the preferences snapshot. */
  readChaptersModel(): Effect.Effect<ChaptersModelAnswerView, never, HttpClient.HttpClient> {
    return chaptersModelAnswerOf(askHosted(this.#hosted.account.preferences, undefined));
  }

  /** The account's chapters model written on its own, answering it as kept. */
  writeChaptersModel(
    model: ChaptersModelId,
  ): Effect.Effect<ChaptersModelAnswerView, never, HttpClient.HttpClient> {
    return chaptersModelAnswerOf(
      askHosted(this.#hosted.account.writePreferences, { chaptersModel: model }),
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

  /** The account's `ext_agent_host_id` for Luke's hosted runtime, which a ChatGPT sign-in names as its host. */
  chatGptHost(): Effect.Effect<ChatGptHostAnswer | Failed, never, HttpClient.HttpClient> {
    return hostedAnswer(askHosted(this.#hosted.account.chatGptHost, undefined), {});
  }

  /**
   * A ChatGPT sign-in the desktop completed, handed to the service once,
   * answering the keys as they then stand and, where the service kept
   * nothing, why; a sign-in the service would refuse by shape never travels.
   */
  saveChatGptCredentials(
    credentials: ChatGptCredentialsSaveRequest,
  ): Effect.Effect<ProviderKeysAnswerView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(chatGptCredentialsSaveRequestSchema)(credentials),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedAnswer(askHosted(this.#hosted.account.saveChatGptCredentials, admitted), {});
  }

  /**
   * A connected plan's default for the account's coding agents turned on or
   * off, answering the keys as they then stand; a request the service would
   * refuse by shape never travels.
   */
  setProviderKeyForAgents(
    params: ProviderKeyForAgentsParams,
  ): Effect.Effect<ProviderKeysAnswerView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(providerKeyForAgentsRequestSchema)(params));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedAnswer(askHosted(this.#hosted.account.setProviderKeyForAgents, admitted), {});
  }

  /** One provider's key of the kind named, an API key where none is, removed, answering the keys as they then stand. */
  removeProviderKey(
    params: ProviderKeyRemoveParams,
  ): Effect.Effect<ProviderKeysAnswerView, never, HttpClient.HttpClient> {
    // The provider rides in the query, since a DELETE carries no body.
    return hostedAnswer(
      askHosted(this.#hosted.account.removeProviderKey, {
        query: {
          [PROVIDER_KEY_QUERY.PROVIDER]: params.provider,
          ...(params.kind === undefined ? undefined : { [PROVIDER_KEY_QUERY.KIND]: params.kind }),
        },
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
      DICTATION_REFUSALS,
    );
  }

  /** The member's own GitHub token, as what tells it apart; never the token. */
  readGitHubToken(): Effect.Effect<GitHubTokenAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(askHosted(this.#hosted.githubToken.read, undefined), {});
  }

  /**
   * The member's GitHub token saved, answering it as it then stands and,
   * where the service kept nothing, why; a token the service would refuse
   * by shape is refused here without traveling at all.
   */
  saveGitHubToken(
    params: GitHubTokenSaveParams,
  ): Effect.Effect<GitHubTokenAnswerView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(githubTokenSaveRequestSchema)(params));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedAnswer(askHosted(this.#hosted.githubToken.save, admitted), {});
  }

  /** The member's GitHub token removed, answering none. */
  removeGitHubToken(): Effect.Effect<GitHubTokenAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(askHosted(this.#hosted.githubToken.remove, undefined), {});
  }

  /** One task's agents with their status, in the order they were started, the archived ones among them, each flagged, where `includeArchived` asks. */
  list(
    taskId: string,
    includeArchived = false,
  ): Effect.Effect<CodingAgentListAnswer, never, HttpClient.HttpClient> {
    return hostedAnswer(
      askHosted(this.#hosted.agents.listOfTask, {
        id: taskId,
        ...(includeArchived
          ? { [CODING_AGENT_LIST_QUERY.ARCHIVED]: CODING_AGENT_LIST_ARCHIVED.INCLUDE }
          : undefined),
      }),
      ROW_REFUSALS,
    );
  }

  /** A workspace's agents, newest started first, narrowed to one repository where one is named and to the words given where some are, the archived ones among them where `includeArchived` asks. */
  listWorkspace(
    params: CodingAgentWorkspaceListParams,
  ): Effect.Effect<CodingAgentListAnswer, never, HttpClient.HttpClient> {
    return hostedAnswer(
      askHosted(this.#hosted.agents.listOfWorkspace, {
        [CODING_AGENT_WORKSPACE_QUERY.WORKSPACE_ID]: params.workspaceId,
        ...(params.repository === undefined
          ? undefined
          : { [CODING_AGENT_WORKSPACE_QUERY.REPOSITORY]: params.repository }),
        ...(params.words === undefined
          ? undefined
          : { [CODING_AGENT_WORKSPACE_QUERY.WORDS]: params.words }),
        ...(params.includeArchived === true
          ? { [CODING_AGENT_WORKSPACE_QUERY.ARCHIVED]: CODING_AGENT_LIST_ARCHIVED.INCLUDE }
          : undefined),
      }),
      ROW_REFUSALS,
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
    return hostedAnswer(
      Effect.map(
        askHosted(
          this.#hosted.agents.start,
          { params: { id: taskId }, body: admitted },
          HOSTED_DEADLINE.START,
        ),
        (started) => started.body,
      ),
      START_REFUSALS,
    );
  }

  /**
   * Starts an agent from the one named, continuing it or forking it at the
   * message the request's `from` names, in that agent's own place: its task,
   * or its workspace and repository where it has none. Keyed and refused as
   * `start` is; a request whose `from` names no agent is refused here.
   */
  startFrom(
    request: CodingAgentStartRequest,
  ): Effect.Effect<CodingAgentAgentAnswer, never, HttpClient.HttpClient> {
    const sourceId = request.from?.agentId;
    const admitted = Result.getOrUndefined(codingAgentStartRequestOnWire(request));
    if (sourceId === undefined || admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedAnswer(
      Effect.map(
        askHosted(
          this.#hosted.agents.startFrom,
          { params: { id: sourceId }, body: admitted },
          HOSTED_DEADLINE.START,
        ),
        (started) => started.body,
      ),
      START_REFUSALS,
    );
  }

  /**
   * One agent's transcript past the cursor, or a worker's, read at once
   * rather than held, with whether the held read would have held on it: for
   * a reader following the transcript's live statements, which reads again
   * once they move. Where `cut` asks, its heavy parts come cut to their two
   * ends, which the reader fetches whole as it opens one (`agentPart`).
   */
  messagesNow(
    agentId: string,
    after: string,
    callId?: string,
    cut = false,
  ): Effect.Effect<TranscriptNowAnswer | Failed, never, HttpClient.HttpClient> {
    const query = {
      after,
      wait: TRANSCRIPT_NOW_QUERY.NONE,
      ...(cut ? { parts: TRANSCRIPT_PARTS_QUERY.CUT } : undefined),
    };
    const asked =
      callId === undefined
        ? askHosted(this.#hosted.messages.agent, { id: agentId, ...query })
        : askHosted(this.#hosted.messages.agentWorker, { id: agentId, call: callId, ...query });
    return Effect.map(hostedAnswer(asked, ROW_REFUSALS), readNow);
  }

  /**
   * One agent's transcript, or a worker's, read back from its end at once:
   * its newest page, with all the page past a cursor carries, the cursor
   * `messagesNow` follows on from with nothing written meanwhile missed, and
   * where the next older page is read below (`messagesBefore`); none where
   * nothing older stands. Where `cut` asks, its heavy parts come cut to
   * their two ends, as `messagesNow`'s do.
   */
  messagesNewest(
    agentId: string,
    callId?: string,
    cut = false,
  ): Effect.Effect<CodingAgentNewestAnswer | Failed, never, HttpClient.HttpClient> {
    return Effect.map(
      hostedAnswer(this.#newest(agentId, callId, undefined, cut), ROW_REFUSALS),
      // Note that a read naming no `before` is answered the newest page, which an older page alone is not.
      (answer) => ("failure" in answer || "status" in answer ? answer : UNANSWERED),
    );
  }

  /**
   * The page of an agent's transcript, or a worker's, below the oldest row
   * a reader holds, as `messagesNewest` or this answered `before`: its
   * messages, oldest first, and where the page older still is read below;
   * none where nothing older stands.
   */
  messagesBefore(
    agentId: string,
    before: string,
    callId?: string,
    cut = false,
  ): Effect.Effect<CodingAgentOlderAnswer | Failed, never, HttpClient.HttpClient> {
    return Effect.map(
      hostedAnswer(this.#newest(agentId, callId, before, cut), ROW_REFUSALS),
      (answer): CodingAgentOlderAnswer | Failed =>
        "failure" in answer
          ? answer
          : {
              messages: answer.messages,
              ...(answer.before === undefined ? undefined : { before: answer.before }),
            },
    );
  }

  /** A transcript read back from its end, the agent's or its worker's, below `before` where it names one, its heavy parts cut where `cut` asks. */
  #newest(agentId: string, callId?: string, before?: string, cut = false) {
    const page = {
      ...(before === undefined ? undefined : { before }),
      ...(cut ? { parts: TRANSCRIPT_PARTS_QUERY.CUT } : undefined),
    };
    return callId === undefined
      ? askHosted(this.#hosted.messages.agentNewest, { id: agentId, ...page })
      : askHosted(this.#hosted.messages.agentWorkerNewest, { id: agentId, call: callId, ...page });
  }

  /**
   * One part of a message of an agent's transcript, or a worker's where
   * `callId` names the delegation call, whole: what a page carried cut. Not
   * found where the agent is not one the account reaches or no such part
   * stands; unanswered for anything else.
   */
  agentPart(
    agentId: string,
    messageId: string,
    index: number,
    callId?: string,
  ): Effect.Effect<CodingAgentPartView, never, HttpClient.HttpClient> {
    const part = { id: agentId, message: messageId, index: String(index) };
    const asked =
      callId === undefined
        ? askHosted(this.#hosted.messages.agentPart, part)
        : askHosted(this.#hosted.messages.agentWorkerPart, { ...part, call: callId });
    return hostedAnswer(asked, ROW_REFUSALS);
  }

  /**
   * One agent's transcript, or a worker's where the delegation call is
   * named, sealed for following over Neon Realtime, answered at once: not
   * found where the account reaches no such agent, unanswered for anything
   * else, which the caller answers by sealing it again; with `poll`, its
   * rows inline, for a reader polling while Realtime fails it. Sealed for
   * the account `userId` names, and signed out where the session is no
   * longer that account's.
   */
  agentTranscriptLive(
    agentId: string,
    userId: string,
    callId?: string,
    poll = false,
    after?: string,
  ): Effect.Effect<
    AgentTranscriptLiveAnswer | Failed | typeof LIVE_SIGNED_OUT,
    never,
    HttpClient.HttpClient
  > {
    const read = { id: agentId, [LIVE_USER_QUERY]: userId };
    const named = callId === undefined ? read : { ...read, call: callId };
    return Effect.catchIf(
      askLive(this.#hosted.live.agentTranscript, named, poll, after),
      (failed) =>
        failed._tag === "HostedRefused" && failed.refusal === HOSTED_API_ERROR.INVALID_TOKEN,
      () => Effect.succeed(LIVE_SIGNED_OUT),
    ).pipe((signed) => hostedAnswer(signed, ROW_REFUSALS));
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
  ): Effect.Effect<CodingAgentMessageAnswerView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(codingAgentMessageRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedAnswer(
      askHosted(
        this.#hosted.messages.send,
        { params: { id: agentId }, body: admitted },
        HOSTED_DEADLINE.STEER,
      ),
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
    return this.#change(agentId, admitted, CHOOSE_REFUSALS);
  }

  /** Renames one agent, or clears its title with an empty one, answering it as it then stands; a title past the bound is refused here without traveling. */
  rename(
    agentId: string,
    request: CodingAgentRenameRequest,
  ): Effect.Effect<CodingAgentAgentAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(codingAgentRenameRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return this.#change(agentId, admitted, ROW_REFUSALS);
  }

  /** Switches one agent's MCP servers for its next turn on, the whole list of those off, answering it as it then stands; a list past the bound is refused here without traveling. */
  switchServers(
    agentId: string,
    request: CodingAgentServersRequest,
  ): Effect.Effect<CodingAgentAgentAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(codingAgentServersRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return this.#change(agentId, admitted, ROW_REFUSALS);
  }

  /** Archives one agent, stopping a turn it still runs first, or brings it back, answering it as it then stands. */
  archive(
    agentId: string,
    request: CodingAgentArchiveRequest,
  ): Effect.Effect<CodingAgentAgentAnswer, never, HttpClient.HttpClient> {
    return this.#change(agentId, { archived: request.archived }, ARCHIVE_REFUSALS);
  }

  /** Pins one agent for the account alone, or unpins it, answering it as it then stands. */
  pin(
    agentId: string,
    request: CodingAgentPinRequest,
  ): Effect.Effect<CodingAgentAgentAnswer, never, HttpClient.HttpClient> {
    return this.#change(
      agentId,
      request.position === undefined
        ? { pinned: request.pinned }
        : { pinned: request.pinned, position: request.position },
      ROW_REFUSALS,
    );
  }

  /** One change of an agent, answering it as it then stands. */
  /** Ensures the account's operator in a workspace, Luke, or with `reset` archives the one standing and makes a fresh one: its id, or why there is none. */
  ensureOperator(
    workspaceId: string,
    request: OperatorEnsureRequest,
  ): Effect.Effect<CodingAgentOperatorEnsureAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(
      askHosted(this.#hosted.agents.ensureOperator, { params: { id: workspaceId }, body: request }),
      START_REFUSALS,
    );
  }

  #change(
    agentId: string,
    body: CodingAgentChangeRequest,
    named: NamedRefusals,
  ): Effect.Effect<CodingAgentAgentAnswer, never, HttpClient.HttpClient> {
    return hostedAnswer(
      askHosted(this.#hosted.agents.change, { params: { id: agentId }, body }),
      named,
    );
  }

  /** Deletes one agent for good, a turn it still runs stopped first; that it was, or why not: gone already, or one still starting with no turn to stop yet. */
  delete(
    agentId: string,
  ): Effect.Effect<CodingAgentDeleteAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(askHosted(this.#hosted.agents.delete, { id: agentId }), ARCHIVE_REFUSALS);
  }

  /** Stops one agent, answering it as it then stands. */
  stop(agentId: string): Effect.Effect<CodingAgentAgentAnswer, never, HttpClient.HttpClient> {
    return hostedAnswer(askHosted(this.#hosted.agents.stop, { id: agentId }), ROW_REFUSALS);
  }

  /** One agent read whole as its own page by its id, on a task or with none. */
  agent(agentId: string): Effect.Effect<CodingAgentPageAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(askHosted(this.#hosted.agents.read, { id: agentId }), ROW_REFUSALS);
  }

  /** The calls into one agent, oldest first, each with its lines and its record, which its tab draws a call's boundaries from; not found for an agent the account does not reach. */
  calls(agentId: string): Effect.Effect<CodingAgentCallsAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(askHosted(this.#hosted.agents.calls, { id: agentId }), ROW_REFUSALS);
  }

  /** What one agent published: the branch it pushed and the pull request from it, as GitHub holds them now. */
  pullRequest(
    agentId: string,
    number?: number,
  ): Effect.Effect<CodingAgentPullRequestAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(
      askHosted(this.#hosted.agentPullRequests.pullRequest, pullRequestRead(agentId, number)),
      ROW_REFUSALS,
    );
  }

  /** One agent's changes: the files of its pull request as GitHub holds them now. */
  changes(
    agentId: string,
    number?: number,
  ): Effect.Effect<CodingAgentChangesAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(
      askHosted(this.#hosted.agents.changes, {
        id: agentId,
        ...(number === undefined ? undefined : { number: String(number) }),
      }),
      ROW_REFUSALS,
    );
  }

  /** One agent's pull request itself as its overview draws it: its description, branches, mergeability, and people as GitHub holds them now. */
  overviewPullRequest(
    agentId: string,
    number?: number,
  ): Effect.Effect<CodingAgentOverviewPullRequestAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(
      askHosted(
        this.#hosted.agentPullRequests.overviewPullRequest,
        pullRequestRead(agentId, number),
      ),
      ROW_REFUSALS,
    );
  }

  /** What the reviewer and label pickers of one agent's Pull request tab offer: its repository's labels, collaborators, and teams as GitHub holds them now. */
  reviewOptions(
    agentId: string,
  ): Effect.Effect<CodingAgentReviewOptionsAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(
      askHosted(this.#hosted.agents.reviewOptions, { id: agentId }),
      ROW_REFUSALS,
    );
  }

  /** The workspace's newest chapters of one agent's pull request, or of its repository's by the number given, with its head as GitHub holds it now. */
  chapters(
    agentId: string,
    number?: number,
  ): Effect.Effect<PullRequestChaptersAnswerView, never, HttpClient.HttpClient> {
    return chaptersAnswer(
      askHosted(this.#hosted.pullRequestChapters.read, {
        id: agentId,
        ...(number === undefined ? undefined : { number: String(number) }),
      }),
    );
  }

  /** One agent's pull request's chapters generated for its head now, or the generation already under way, answered as `chapters` answers; held for as long as a generation may take. */
  generateChapters(
    agentId: string,
    number?: number,
  ): Effect.Effect<PullRequestChaptersAnswerView, never, HttpClient.HttpClient> {
    return chaptersAnswer(
      askHosted(
        this.#hosted.pullRequestChapters.generate,
        {
          params: { id: agentId },
          ...(number === undefined ? undefined : { query: { number: String(number) } }),
        },
        HOSTED_DEADLINE.CHAPTERS,
      ),
    );
  }

  /** The checks on one agent's pull request's head as GitHub holds them now. */
  overviewChecks(
    agentId: string,
    number?: number,
  ): Effect.Effect<CodingAgentOverviewChecksAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(
      askHosted(this.#hosted.agentPullRequests.overviewChecks, pullRequestRead(agentId, number)),
      ROW_REFUSALS,
    );
  }

  /** One agent's pull request's conversation and where its reviewers stand, as GitHub holds them now. */
  overviewConversation(
    agentId: string,
    number?: number,
  ): Effect.Effect<CodingAgentOverviewConversationAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(
      askHosted(
        this.#hosted.agentPullRequests.overviewConversation,
        pullRequestRead(agentId, number),
      ),
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
   * What waits on the developer across the account sealed for following
   * over Neon Realtime, or with `poll` its rows inline, answered at once:
   * unanswered for anything that went wrong, which the caller answers by
   * asking again. Sealed for the account `userId` names, and signed out
   * where the session is no longer that account's.
   */
  accountInboxLive(
    userId: string,
    poll = false,
    after?: string,
  ): Effect.Effect<
    AccountInboxLiveAnswer | Failed | typeof LIVE_SIGNED_OUT,
    never,
    HttpClient.HttpClient
  > {
    return Effect.catchIf(
      askLive(this.#hosted.live.inbox, { [LIVE_USER_QUERY]: userId }, poll, after),
      (failed) =>
        failed._tag === "HostedRefused" && failed.refusal === HOSTED_API_ERROR.INVALID_TOKEN,
      () => Effect.succeed(LIVE_SIGNED_OUT),
    ).pipe((signed) => hostedAnswer(signed, {}));
  }

  /**
   * One plan's inbox sealed for following over Neon Realtime, or with
   * `poll` its rows inline, answered at once: not found where the account
   * reaches no such plan, unanswered for anything else, which the caller
   * answers by asking again. Sealed for the account `userId` names, and
   * signed out where the session is no longer that account's.
   */
  taskInboxLive(
    taskId: string,
    userId: string,
    poll = false,
    after?: string,
  ): Effect.Effect<
    ScopeInboxLiveAnswer | Failed | typeof LIVE_SIGNED_OUT,
    never,
    HttpClient.HttpClient
  > {
    const read = { id: taskId, [LIVE_USER_QUERY]: userId };
    return Effect.catchIf(
      askLive(this.#hosted.live.taskInbox, read, poll, after),
      (failed) =>
        failed._tag === "HostedRefused" && failed.refusal === HOSTED_API_ERROR.INVALID_TOKEN,
      () => Effect.succeed(LIVE_SIGNED_OUT),
    ).pipe((signed) => hostedAnswer(signed, ROW_REFUSALS));
  }

  /** One agent's inbox sealed for following over Neon Realtime, on the terms a plan's is. */
  agentInboxLive(
    agentId: string,
    userId: string,
    poll = false,
    after?: string,
  ): Effect.Effect<
    ScopeInboxLiveAnswer | Failed | typeof LIVE_SIGNED_OUT,
    never,
    HttpClient.HttpClient
  > {
    const read = { id: agentId, [LIVE_USER_QUERY]: userId };
    return Effect.catchIf(
      askLive(this.#hosted.live.agentInbox, read, poll, after),
      (failed) =>
        failed._tag === "HostedRefused" && failed.refusal === HOSTED_API_ERROR.INVALID_TOKEN,
      () => Effect.succeed(LIVE_SIGNED_OUT),
    ).pipe((signed) => hostedAnswer(signed, ROW_REFUSALS));
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
        return readConversationPicture(answer.response);
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
    const read = pullRequestRead(agentId, number);
    return hostedAnswer(
      askHosted(this.#hosted.agentPullRequests.action, {
        params: { id: read.id },
        ...(read.number === undefined ? undefined : { query: { number: read.number } }),
        body: admitted,
      }),
      ROW_REFUSALS,
    );
  }

  /** Which of the agent's pull request's files the member marked viewed on GitHub, read on their own sign-in. */
  pullRequestViewed(
    agentId: string,
    number?: number,
  ): Effect.Effect<CodingAgentPullRequestViewedAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(
      askHosted(this.#hosted.agentPullRequests.viewed, pullRequestRead(agentId, number)),
      ROW_REFUSALS,
    );
  }

  /**
   * The account's person joining a workspace's chat: their member and its
   * `#general` made where they are not yet, which a follow does once before
   * it seals. Not found where the account is not in the workspace or has
   * Chat off; unanswered for anything else.
   */
  chatJoin(
    workspaceId: string,
  ): Effect.Effect<ChatJoinAnswer | Failed, never, HttpClient.HttpClient> {
    return Effect.map(
      hostedAnswer(
        askHosted(this.#hosted.messages.chatWrite, {
          query: { [CHAT_QUERY.WORKSPACE_ID]: workspaceId },
          body: { join: true },
        }),
        ROW_REFUSALS,
      ),
      // A write answers no member, which only a join is answered with.
      (answer) => ("failure" in answer || "self" in answer ? answer : UNANSWERED),
    );
  }

  /**
   * A workspace's chat sealed for following over Neon Realtime for the
   * account named, answered at once: not found where the account has not
   * joined it, signed out where the session is another's, unanswered for
   * anything else, which the caller answers by sealing it again; with
   * `poll`, its rows inline, held past `after` until they move.
   */
  workspaceChatLive(
    workspaceId: string,
    userId: string,
    poll = false,
    after?: string,
  ): Effect.Effect<
    WorkspaceChatLiveAnswer | Failed | typeof LIVE_SIGNED_OUT,
    never,
    HttpClient.HttpClient
  > {
    const named = { workspaceId, [LIVE_USER_QUERY]: userId };
    return Effect.catchIf(
      askLive(this.#hosted.live.workspaceChat, named, poll, after),
      (failed) =>
        failed._tag === "HostedRefused" && failed.refusal === HOSTED_API_ERROR.INVALID_TOKEN,
      () => Effect.succeed(LIVE_SIGNED_OUT),
    ).pipe((signed) => hostedAnswer(signed, ROW_REFUSALS));
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
    return Effect.map(
      hostedAnswer(
        askHosted(this.#hosted.messages.chatWrite, {
          query: { [CHAT_QUERY.WORKSPACE_ID]: workspaceId },
          body: admitted,
        }),
        MESSAGE_REFUSALS,
      ),
      // A join answers the joiner's member, which no write is answered with.
      (answer) => ("self" in answer ? UNANSWERED : answer),
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
    const body = wireRequestOf(inboxAnswerRequestSchema, request);
    if (body === undefined) return Effect.succeed(UNANSWERED);
    return hostedAnswer(
      askHosted(this.#hosted.inbox.answer, { params: { id: itemId }, body }, HOSTED_DEADLINE.STEER),
      INBOX_ANSWER_REFUSALS,
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
    const body = wireRequestOf(inboxCloseRequestSchema, request);
    if (body === undefined) return Effect.succeed(UNANSWERED);
    return hostedAnswer(
      askHosted(this.#hosted.inbox.close, { params: { id: itemId }, body }, HOSTED_DEADLINE.STEER),
      INBOX_ANSWER_REFUSALS,
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
    const body = wireRequestOf(inboxMessageRequestSchema, request);
    if (body === undefined) return Effect.succeed(UNANSWERED);
    return hostedAnswer(
      askHosted(
        this.#hosted.inbox.message,
        { params: { id: itemId }, body },
        HOSTED_DEADLINE.STEER,
      ),
      INBOX_ANSWER_REFUSALS,
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
    return hostedAnswer(askHosted(this.#hosted.inbox.markItemRead, { id: itemId }), ROW_REFUSALS);
  }

  /** One item marked unread for the account until it reads the item again: its id and its read state; not found where the item is not one the account reaches. */
  markInboxItemUnread(
    itemId: string,
  ): Effect.Effect<CodingAgentInboxReadStateView, never, HttpClient.HttpClient> {
    return hostedAnswer(askHosted(this.#hosted.inbox.markItemUnread, { id: itemId }), ROW_REFUSALS);
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
    const body = wireRequestOf(inboxReadAllRequestSchema, request);
    if (body === undefined) return Effect.succeed(UNANSWERED);
    return hostedAnswer(askHosted(this.#hosted.inbox.markAllRead, body), {});
  }
}
