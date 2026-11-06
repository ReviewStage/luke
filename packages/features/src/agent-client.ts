import { HTTP_METHOD, type UnparsedWireValue, unparsedWire } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  type AccountCallEffects,
  accountCall,
  type CallAnswer,
  type CallCredential,
  callAnswered,
  jsonOf,
} from "./account-call.js";
import { ACCOUNT_INBOX_REPOSITORYLESS } from "./account-inbox-wire.js";
import type { AccountPreferencesLiveAnswer } from "./account-preferences-live.js";
import type { AccountPreferencesAnswerWire } from "./account-wire.js";
import type { AgentOriginLiveAnswer } from "./agent-origin-live.js";
import {
  AGENT_CALL_FAILURE,
  type AgentAgentAnswer,
  type AgentCallFailure,
  type AgentChangesAnswerView,
  type AgentDefaultAnswer,
  type AgentDeleteAnswerView,
  type AgentGitHubImageView,
  type AgentInboxAnsweredView,
  type AgentInboxAttachmentView,
  type AgentInboxItemHomeView,
  type AgentInboxMessagedView,
  type AgentInboxReadAllView,
  type AgentInboxReadStateView,
  type AgentListAnswer,
  type AgentMessageAnswerView,
  type AgentMessagesAnswerView,
  type AgentModelsAnswer,
  type AgentOverviewChecksAnswerView,
  type AgentOverviewConversationAnswerView,
  type AgentOverviewPullRequestAnswerView,
  type AgentPageAnswerView,
  type AgentPartView,
  type AgentPullRequestAnswerView,
  type AgentPullRequestViewedAnswerView,
  type AgentPullRequestWriteAnswerView,
  type AgentQueueAnswerView,
  type AgentReviewOptionsAnswerView,
  type AgentWorkspaceListParams,
  type AgentWorkspaceToolsAnswerView,
  type ChatGptDeviceLoginParams,
  type ChatGptDevicePollAnswerView,
  type ChatGptDeviceStartAnswerView,
  type DevicePresenceAnswerView,
  type DictationTranscribeAnswerView,
  type DictationTranscribeParams,
  type GitHubTokenAnswerView,
  type GitHubTokenSaveParams,
  githubImageTypeSchema,
  type HostDoneAnswerView,
  type HostsAnswerView,
  type MemoriesAnswerView,
  type MemoryForgetParams,
  type ProviderKeyForAgentsParams,
  type ProviderKeyRemoveParams,
  type ProviderKeySaveParams,
  type ProviderKeysAnswerView,
} from "./agent-view.js";
import {
  AGENT_LIST_ARCHIVED,
  AGENT_LIST_QUERY,
  AGENT_WORKSPACE_QUERY,
  type AgentAddRepositoryRequest,
  type AgentArchiveRequest,
  type AgentMessageRequest,
  type AgentNewestAnswer,
  type AgentOlderAnswer,
  type AgentPinRequest,
  type AgentQueueChange,
  type AgentReadRequest,
  type AgentRenameRequest,
  type AgentServersRequest,
  type AgentStartRequest,
  agentAddRepositoryRequestSchema,
  agentMessageRequestSchema,
  agentQueueChangeSchema,
  agentRenameRequestSchema,
  agentServersRequestSchema,
  agentStartRequestOnWire,
  type ExtraRepositoryRefusal,
  type LocalAgentRefusal,
  type RefusedDevice,
  TRANSCRIPT_PARTS_QUERY,
} from "./agent-wire.js";
import type { AgentChangeRequest } from "./contract/agents.js";
import {
  credentialMissingDataSchema,
  extraRepositoryRefusedDataSchema,
  localAgentRefusedDataSchema,
  planLimitReachedDataSchema,
} from "./contract/errors.js";
import { dictationRequestSchema } from "./dictation-wire.js";
import type { FailureFacts } from "./failure-facts.js";
import { githubTokenSaveRequestSchema } from "./github-token-wire.js";
import type { HostsLiveAnswer } from "./host-live.js";
import {
  HOST_PAIRING_CALL_FAILURE,
  type HostPairingApproveView,
  type HostPairingCallFailure,
  type HostPairingDenyView,
  type HostPairingFailed,
  type HostPairingView,
} from "./host-pairing-view.js";
import {
  askHosted,
  askLive,
  HOSTED_DEADLINE,
  type HostedClient,
  type HostedFailure,
  HostedUnanswered,
  hostedClient,
  hostedFailureFacts,
} from "./hosted-link.js";
import { imageBodyOf } from "./image-body.js";
import {
  INBOX_FILE_TYPE,
  type InboxAcknowledgeRequest,
  type InboxCloseRequest,
  type InboxMessageRequest,
  type InboxReadAllRequest,
  type InboxStartRequest,
  inboxAcknowledgeRequestSchema,
  inboxCloseRequestSchema,
  inboxMessageRequestSchema,
  inboxReadAllRequestSchema,
  inboxStartRequestSchema,
} from "./inbox-wire.js";
import {
  type AccountInboxItemsLiveAnswer,
  type AccountInboxLiveAnswer,
  type AgentTranscriptLiveAnswer,
  LIVE_POLL,
  LIVE_SIGNED_OUT,
  LIVE_USER_QUERY,
  type ScopeInboxLiveAnswer,
  TRANSCRIPT_NOW_QUERY,
  type TranscriptNowAnswer,
} from "./live-wire.js";
import type { WorkspaceMemoriesLiveAnswer } from "./memory-live.js";
import { MEMORY_QUERY } from "./memory-wire.js";
import {
  agentDefaultWriteSchema,
  type ModelChoice,
  type ModelProvider,
  modelChoiceSchema,
} from "./models-wire.js";
import {
  chatGptDeviceLoginRequestSchema,
  PROVIDER_KEY_QUERY,
  providerKeyForAgentsRequestSchema,
  providerKeySaveRequestSchema,
} from "./provider-key-wire.js";
import type { PullRequestChaptersLiveAnswer } from "./pull-request-chapters-live.js";
import {
  PULL_REQUEST_CHAPTERS_CALL_FAILURE,
  type PullRequestChaptersAnswerView,
} from "./pull-request-chapters-view.js";
import {
  type PullRequestActionRequest,
  pullRequestActionRequestSchema,
} from "./pull-request-write-wire.js";
import { type RepositoryUnreached, repositoryNotReachableSchema } from "./repository-reach-wire.js";
import { agentGitHubImagePath, agentPicturePath, inboxAttachmentPath } from "./service-paths.js";
import {
  HOSTED_API_ERROR,
  type HostedApiError,
  hostedErrorSchema,
  readServiceAnswer,
} from "./service-wire.js";
import type { TaskAgentRefusal } from "./task-wire.js";

export interface HostedAgentClientOptions {
  credential: CallCredential;
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

const UNANSWERED = { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;

type Failed = {
  readonly failure: AgentCallFailure;
  readonly cause?: FailureFacts;
  readonly unreached?: RepositoryUnreached;
  readonly resetsAt?: number;
  readonly provider?: ModelProvider;
  readonly localAgentRefusal?: LocalAgentRefusal;
  readonly refusedDevice?: RefusedDevice;
  readonly extraRepositoryRefusal?: ExtraRepositoryRefusal;
  readonly refusedRepository?: string;
};

type NamedRefusals = Readonly<Partial<Record<HostedApiError, AgentCallFailure>>>;

const START_REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: AGENT_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.NO_REPOSITORY]: AGENT_CALL_FAILURE.NO_REPOSITORY,
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE]: AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
  [HOSTED_API_ERROR.GITHUB_UNANSWERED]: AGENT_CALL_FAILURE.GITHUB_UNANSWERED,
  [HOSTED_API_ERROR.INVALID_REQUEST]: AGENT_CALL_FAILURE.INVALID_CHOICE,
  [HOSTED_API_ERROR.NOT_PERMITTED]: AGENT_CALL_FAILURE.NOT_PERMITTED,
  [HOSTED_API_ERROR.NATIVE_AGENT_NOT_HERE]: AGENT_CALL_FAILURE.NATIVE_AGENT_NOT_HERE,
  [HOSTED_API_ERROR.AGENT_PLAN_SIGNED_OUT]: AGENT_CALL_FAILURE.AGENT_PLAN_SIGNED_OUT,
  [HOSTED_API_ERROR.AGENT_PLAN_UNREACHABLE]: AGENT_CALL_FAILURE.AGENT_PLAN_UNREACHABLE,
  [HOSTED_API_ERROR.AGENT_PLAN_LIMIT_REACHED]: AGENT_CALL_FAILURE.AGENT_PLAN_LIMIT_REACHED,
  [HOSTED_API_ERROR.AGENT_PLAN_INELIGIBLE]: AGENT_CALL_FAILURE.AGENT_PLAN_INELIGIBLE,
  [HOSTED_API_ERROR.AGENT_CREDENTIAL_MISSING]: AGENT_CALL_FAILURE.AGENT_CREDENTIAL_MISSING,
  [HOSTED_API_ERROR.AGENT_API_KEY_UNREADABLE]: AGENT_CALL_FAILURE.AGENT_API_KEY_UNREADABLE,
  [HOSTED_API_ERROR.LOCAL_AGENT_REFUSED]: AGENT_CALL_FAILURE.LOCAL_AGENT_REFUSED,
  [HOSTED_API_ERROR.DEVICE_REMOVED]: AGENT_CALL_FAILURE.DEVICE_REMOVED,
  [HOSTED_API_ERROR.EXTRA_REPOSITORY_REFUSED]: AGENT_CALL_FAILURE.EXTRA_REPOSITORY_REFUSED,
} satisfies NamedRefusals;

const MEMORY_REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: AGENT_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.NOT_PERMITTED]: AGENT_CALL_FAILURE.NOT_PERMITTED,
} satisfies NamedRefusals;

const ROW_REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: AGENT_CALL_FAILURE.NOT_FOUND,
} satisfies NamedRefusals;

const ADD_REPOSITORY_REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: AGENT_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.NOT_PERMITTED]: AGENT_CALL_FAILURE.NOT_PERMITTED,
  [HOSTED_API_ERROR.EXTRA_REPOSITORY_REFUSED]: AGENT_CALL_FAILURE.EXTRA_REPOSITORY_REFUSED,
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE]: AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
  [HOSTED_API_ERROR.GITHUB_UNANSWERED]: AGENT_CALL_FAILURE.GITHUB_UNANSWERED,
} satisfies NamedRefusals;

const ARCHIVE_REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: AGENT_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.AGENT_NOT_READY]: AGENT_CALL_FAILURE.AGENT_NOT_READY,
} satisfies NamedRefusals;

const MESSAGE_REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: AGENT_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.MESSAGE_TOO_LONG]: AGENT_CALL_FAILURE.MESSAGE_TOO_LONG,
  [HOSTED_API_ERROR.AGENT_NOT_READY]: AGENT_CALL_FAILURE.AGENT_NOT_READY,
  [HOSTED_API_ERROR.AGENT_RETIRED]: AGENT_CALL_FAILURE.AGENT_RETIRED,
  [HOSTED_API_ERROR.DEVICE_REMOVED]: AGENT_CALL_FAILURE.DEVICE_REMOVED,
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE]: AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
  [HOSTED_API_ERROR.GITHUB_UNANSWERED]: AGENT_CALL_FAILURE.GITHUB_UNANSWERED,
  [HOSTED_API_ERROR.NOT_PERMITTED]: AGENT_CALL_FAILURE.NOT_PERMITTED,
  [HOSTED_API_ERROR.NATIVE_AGENT_NOT_HERE]: AGENT_CALL_FAILURE.NATIVE_AGENT_NOT_HERE,
  [HOSTED_API_ERROR.AGENT_PLAN_SIGNED_OUT]: AGENT_CALL_FAILURE.AGENT_PLAN_SIGNED_OUT,
  [HOSTED_API_ERROR.AGENT_PLAN_UNREACHABLE]: AGENT_CALL_FAILURE.AGENT_PLAN_UNREACHABLE,
  [HOSTED_API_ERROR.AGENT_PLAN_LIMIT_REACHED]: AGENT_CALL_FAILURE.AGENT_PLAN_LIMIT_REACHED,
  [HOSTED_API_ERROR.AGENT_PLAN_INELIGIBLE]: AGENT_CALL_FAILURE.AGENT_PLAN_INELIGIBLE,
  [HOSTED_API_ERROR.AGENT_CREDENTIAL_MISSING]: AGENT_CALL_FAILURE.AGENT_CREDENTIAL_MISSING,
  [HOSTED_API_ERROR.AGENT_API_KEY_UNREADABLE]: AGENT_CALL_FAILURE.AGENT_API_KEY_UNREADABLE,
  [HOSTED_API_ERROR.LOCAL_AGENT_REFUSED]: AGENT_CALL_FAILURE.LOCAL_AGENT_REFUSED,
} satisfies NamedRefusals;

const INBOX_ANSWER_REFUSALS = MESSAGE_REFUSALS;

const DICTATION_REFUSALS = {
  [HOSTED_API_ERROR.OPENAI_KEY_MISSING]: AGENT_CALL_FAILURE.OPENAI_KEY_MISSING,
} satisfies NamedRefusals;

const DEFAULT_REFUSALS = {
  [HOSTED_API_ERROR.INVALID_REQUEST]: AGENT_CALL_FAILURE.INVALID_CHOICE,
} satisfies NamedRefusals;

const CHOOSE_REFUSALS = {
  ...ROW_REFUSALS,
  ...DEFAULT_REFUSALS,
} satisfies NamedRefusals;

const PAIRING_REFUSALS: Readonly<Partial<Record<HostedApiError, HostPairingCallFailure>>> = {
  [HOSTED_API_ERROR.NOT_FOUND]: HOST_PAIRING_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.INVALID_REQUEST]: HOST_PAIRING_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.HOST_PAIRING_HELD]: HOST_PAIRING_CALL_FAILURE.HELD,
};

function pairingAnswer<Answer>(
  asked: Effect.Effect<Answer, HostedFailure, HttpClient.HttpClient>,
): Effect.Effect<Answer | HostPairingFailed, never, HttpClient.HttpClient> {
  return Effect.catch(asked, (failed): Effect.Effect<HostPairingFailed> => {
    const failure = failed._tag === "HostedRefused" ? PAIRING_REFUSALS[failed.refusal] : undefined;
    if (failed._tag !== "HostedRefused" || failure === undefined) {
      return Effect.succeed({ failure: HOST_PAIRING_CALL_FAILURE.UNANSWERED });
    }
    const heldUntil = failed.data?.heldUntil;
    return Effect.succeed(
      failure === HOST_PAIRING_CALL_FAILURE.HELD && heldUntil !== undefined
        ? { failure, heldUntil }
        : { failure },
    );
  });
}

type ChaptersRefusals = Readonly<
  Partial<
    Record<
      HostedApiError,
      (typeof PULL_REQUEST_CHAPTERS_CALL_FAILURE)[keyof typeof PULL_REQUEST_CHAPTERS_CALL_FAILURE]
    >
  >
>;

const CHAPTERS_REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: PULL_REQUEST_CHAPTERS_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE]:
    PULL_REQUEST_CHAPTERS_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
  [HOSTED_API_ERROR.GITHUB_UNANSWERED]: PULL_REQUEST_CHAPTERS_CALL_FAILURE.GITHUB_UNANSWERED,
  [HOSTED_API_ERROR.UNAVAILABLE]: PULL_REQUEST_CHAPTERS_CALL_FAILURE.UNAVAILABLE,
} satisfies ChaptersRefusals;

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

function refusedAs(payload: UnparsedWireValue, named: NamedRefusals): Failed {
  const refusal = Result.getOrUndefined(readServiceAnswer(hostedErrorSchema)(payload));
  const failure = refusal === undefined ? undefined : named[refusal];
  if (failure === undefined) return UNANSWERED;
  if (failure === AGENT_CALL_FAILURE.AGENT_PLAN_LIMIT_REACHED) {
    const limit = Result.getOrUndefined(readServiceAnswer(planLimitReachedDataSchema)(payload));
    return limit?.resetsAt === undefined ? { failure } : { failure, resetsAt: limit.resetsAt };
  }
  if (failure === AGENT_CALL_FAILURE.AGENT_CREDENTIAL_MISSING) {
    const missing = Result.getOrUndefined(readServiceAnswer(credentialMissingDataSchema)(payload));
    return missing?.provider === undefined ? { failure } : { failure, provider: missing.provider };
  }
  if (failure === AGENT_CALL_FAILURE.LOCAL_AGENT_REFUSED) {
    const refused = Result.getOrUndefined(readServiceAnswer(localAgentRefusedDataSchema)(payload));
    if (refused?.localAgentRefusal === undefined) return { failure };
    return {
      failure,
      localAgentRefusal: refused.localAgentRefusal,
      ...(refused.refusedDevice === undefined
        ? undefined
        : { refusedDevice: refused.refusedDevice }),
    };
  }
  if (failure === AGENT_CALL_FAILURE.EXTRA_REPOSITORY_REFUSED) {
    const refused = Result.getOrUndefined(
      readServiceAnswer(extraRepositoryRefusedDataSchema)(payload),
    );
    if (refused?.extraRepositoryRefusal === undefined) return { failure };
    return {
      failure,
      extraRepositoryRefusal: refused.extraRepositoryRefusal,
      ...(refused.refusedRepository === undefined
        ? undefined
        : { refusedRepository: refused.refusedRepository }),
    };
  }
  if (failure !== AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE) return { failure };
  const reached = Result.getOrUndefined(readServiceAnswer(repositoryNotReachableSchema)(payload));
  return reached === undefined ? { failure } : { failure, unreached: reached.unreached };
}

export function startRefusedAs(refusal: TaskAgentRefusal): Failed {
  return refusedAs(unparsedWire(refusal), START_REFUSALS);
}

function unansweredCall(answer: Exclude<CallAnswer, { readonly response: Response }>): Failed {
  const { fault, errorName } = answer;
  const unanswered = new HostedUnanswered({
    fault,
    ...(errorName === undefined ? undefined : { errorName }),
  });
  return { ...UNANSWERED, cause: hostedFailureFacts(unanswered) };
}

const inboxFileTypeSchema = Schema.Literals(Object.values(INBOX_FILE_TYPE));

function readInboxFile(response: Response): Effect.Effect<AgentInboxAttachmentView> {
  return Effect.map(imageBodyOf(response, inboxFileTypeSchema), (file) => file ?? UNANSWERED);
}

function readNow(
  answer: (AgentMessagesAnswerView & { readonly holds?: boolean }) | Failed,
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

function wireRequestOf<Request, Encoded>(
  schema: Schema.Codec<Request, Encoded>,
  request: UnparsedWireValue,
): Encoded | undefined {
  const admitted = Result.getOrUndefined(readEither(schema)(request));
  if (admitted === undefined) return undefined;
  return Option.getOrUndefined(Schema.encodeOption(schema)(admitted));
}

function pullRequestRead(agentId: string, number: number | undefined) {
  return number === undefined ? { id: agentId } : { id: agentId, number: String(number) };
}

function hostedFailedAs(failed: HostedFailure, named: NamedRefusals): Failed {
  const failure = failed._tag === "HostedRefused" ? named[failed.refusal] : undefined;
  if (failed._tag !== "HostedRefused" || failure === undefined) {
    return { ...UNANSWERED, cause: hostedFailureFacts(failed) };
  }
  const unreached = failed.data?.unreached;
  const resetsAt = failed.data?.resetsAt;
  const provider = failed.data?.provider;
  const localAgentRefusal = failed.data?.localAgentRefusal;
  const refusedDevice = failed.data?.refusedDevice;
  return {
    failure,
    ...(unreached === undefined ? undefined : { unreached }),
    ...(resetsAt === undefined ? undefined : { resetsAt }),
    ...(provider === undefined ? undefined : { provider }),
    ...(localAgentRefusal === undefined ? undefined : { localAgentRefusal }),
    ...(refusedDevice === undefined ? undefined : { refusedDevice }),
  };
}

function defaultOf(read: AccountPreferencesAnswerWire | Failed): AgentDefaultAnswer {
  if ("failure" in read) return read;
  const choice = Option.getOrUndefined(Schema.decodeUnknownOption(modelChoiceSchema)(read.agent));
  if (choice === undefined) return UNANSWERED;
  return read.txid === undefined ? { choice } : { choice, txid: read.txid };
}

export class HostedAgentClient {
  readonly #call: AccountCallEffects;

  readonly #hosted: HostedClient;

  constructor(options: HostedAgentClientOptions) {
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

  models(): Effect.Effect<AgentModelsAnswer, never, HttpClient.HttpClient> {
    return hostedAnswer(askHosted(this.#hosted.models.list, undefined), {});
  }

  hosts(): Effect.Effect<HostsAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(askHosted(this.#hosted.hosts.list, undefined), ROW_REFUSALS);
  }

  devicePresence(): Effect.Effect<DevicePresenceAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(askHosted(this.#hosted.hosts.presence, undefined), ROW_REFUSALS);
  }

  hostsLive(
    userId: string,
    poll = false,
    after?: string,
  ): Effect.Effect<
    HostsLiveAnswer | Failed | typeof LIVE_SIGNED_OUT,
    never,
    HttpClient.HttpClient
  > {
    const read = { [LIVE_USER_QUERY]: userId };
    return Effect.catchIf(
      askLive(this.#hosted.live.hosts, read, poll, after),
      (failed) =>
        failed._tag === "HostedRefused" && failed.refusal === HOSTED_API_ERROR.INVALID_TOKEN,
      () => Effect.succeed(LIVE_SIGNED_OUT),
    ).pipe((signed) => hostedAnswer(signed, ROW_REFUSALS));
  }

  removeHost(id: string): Effect.Effect<HostDoneAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(askHosted(this.#hosted.hosts.remove, { id }), ROW_REFUSALS);
  }

  readHostPairing(code: string): Effect.Effect<HostPairingView, never, HttpClient.HttpClient> {
    return pairingAnswer(askHosted(this.#hosted.hosts.readPairing, { code }));
  }

  approveHostPairing(
    code: string,
  ): Effect.Effect<HostPairingApproveView, never, HttpClient.HttpClient> {
    return pairingAnswer(askHosted(this.#hosted.hosts.approvePairing, { code }));
  }

  denyHostPairing(code: string): Effect.Effect<HostPairingDenyView, never, HttpClient.HttpClient> {
    return pairingAnswer(askHosted(this.#hosted.hosts.denyPairing, { code }));
  }

  accountPreferencesLive(
    userId: string,
    poll = false,
    after?: string,
  ): Effect.Effect<
    AccountPreferencesLiveAnswer | Failed | typeof LIVE_SIGNED_OUT,
    never,
    HttpClient.HttpClient
  > {
    const read = { [LIVE_USER_QUERY]: userId };
    return Effect.catchIf(
      askLive(this.#hosted.live.accountPreferences, read, poll, after),
      (failed) =>
        failed._tag === "HostedRefused" && failed.refusal === HOSTED_API_ERROR.INVALID_TOKEN,
      () => Effect.succeed(LIVE_SIGNED_OUT),
    ).pipe((signed) => hostedAnswer(signed, {}));
  }

  writeDefault(
    choice: ModelChoice,
  ): Effect.Effect<AgentDefaultAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(agentDefaultWriteSchema)({ agent: choice }));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.map(
      hostedAnswer(askHosted(this.#hosted.account.writePreferences, admitted), DEFAULT_REFUSALS),
      defaultOf,
    );
  }

  workspaceMemoriesLive(
    workspaceId: string,
    userId: string,
    poll = false,
    after?: string,
  ): Effect.Effect<
    WorkspaceMemoriesLiveAnswer | Failed | typeof LIVE_SIGNED_OUT,
    never,
    HttpClient.HttpClient
  > {
    const read = { workspaceId, [LIVE_USER_QUERY]: userId };
    return Effect.catchIf(
      askLive(this.#hosted.live.workspaceMemories, read, poll, after),
      (failed) =>
        failed._tag === "HostedRefused" && failed.refusal === HOSTED_API_ERROR.INVALID_TOKEN,
      () => Effect.succeed(LIVE_SIGNED_OUT),
    ).pipe((signed) => hostedAnswer(signed, MEMORY_REFUSALS));
  }

  forgetMemory(
    params: MemoryForgetParams,
  ): Effect.Effect<MemoriesAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(
      askHosted(this.#hosted.account.forgetMemory, {
        query: { [MEMORY_QUERY.WORKSPACE_ID]: params.workspaceId, [MEMORY_QUERY.ID]: params.id },
      }),
      MEMORY_REFUSALS,
    );
  }

  readProviderKeys(): Effect.Effect<ProviderKeysAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(askHosted(this.#hosted.account.providerKeys, undefined), {});
  }

  saveProviderKey(
    params: ProviderKeySaveParams,
  ): Effect.Effect<ProviderKeysAnswerView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(providerKeySaveRequestSchema)(params));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedAnswer(askHosted(this.#hosted.account.saveProviderKey, admitted), {});
  }

  startChatGptDeviceLogin(): Effect.Effect<
    ChatGptDeviceStartAnswerView,
    never,
    HttpClient.HttpClient
  > {
    return hostedAnswer(askHosted(this.#hosted.account.startChatGptDeviceLogin, undefined), {});
  }

  pollChatGptDeviceLogin(
    params: ChatGptDeviceLoginParams,
  ): Effect.Effect<ChatGptDevicePollAnswerView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(chatGptDeviceLoginRequestSchema)(params));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedAnswer(askHosted(this.#hosted.account.pollChatGptDeviceLogin, admitted), {});
  }

  cancelChatGptDeviceLogin(
    params: ChatGptDeviceLoginParams,
  ): Effect.Effect<ChatGptDevicePollAnswerView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(chatGptDeviceLoginRequestSchema)(params));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedAnswer(askHosted(this.#hosted.account.cancelChatGptDeviceLogin, admitted), {});
  }

  setProviderKeyForAgents(
    params: ProviderKeyForAgentsParams,
  ): Effect.Effect<ProviderKeysAnswerView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(providerKeyForAgentsRequestSchema)(params));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedAnswer(askHosted(this.#hosted.account.setProviderKeyForAgents, admitted), {});
  }

  removeProviderKey(
    params: ProviderKeyRemoveParams,
  ): Effect.Effect<ProviderKeysAnswerView, never, HttpClient.HttpClient> {
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

  readGitHubToken(): Effect.Effect<GitHubTokenAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(askHosted(this.#hosted.githubToken.read, undefined), {});
  }

  saveGitHubToken(
    params: GitHubTokenSaveParams,
  ): Effect.Effect<GitHubTokenAnswerView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(githubTokenSaveRequestSchema)(params));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedAnswer(askHosted(this.#hosted.githubToken.save, admitted), {});
  }

  removeGitHubToken(): Effect.Effect<GitHubTokenAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(askHosted(this.#hosted.githubToken.remove, undefined), {});
  }

  list(
    taskId: string,
    includeArchived = false,
  ): Effect.Effect<AgentListAnswer, never, HttpClient.HttpClient> {
    return hostedAnswer(
      askHosted(this.#hosted.agents.listOfTask, {
        id: taskId,
        ...(includeArchived
          ? { [AGENT_LIST_QUERY.ARCHIVED]: AGENT_LIST_ARCHIVED.INCLUDE }
          : undefined),
      }),
      ROW_REFUSALS,
    );
  }

  listWorkspace(
    params: AgentWorkspaceListParams,
  ): Effect.Effect<AgentListAnswer, never, HttpClient.HttpClient> {
    return hostedAnswer(
      askHosted(this.#hosted.agents.listOfWorkspace, {
        [AGENT_WORKSPACE_QUERY.WORKSPACE_ID]: params.workspaceId,
        ...(params.repository === undefined
          ? undefined
          : { [AGENT_WORKSPACE_QUERY.REPOSITORY]: params.repository }),
        ...(params.words === undefined
          ? undefined
          : { [AGENT_WORKSPACE_QUERY.WORDS]: params.words }),
        ...(params.includeArchived === true
          ? { [AGENT_WORKSPACE_QUERY.ARCHIVED]: AGENT_LIST_ARCHIVED.INCLUDE }
          : undefined),
      }),
      ROW_REFUSALS,
    );
  }

  start(
    taskId: string,
    request: AgentStartRequest,
  ): Effect.Effect<AgentAgentAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(agentStartRequestOnWire(request));
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

  startFrom(
    request: AgentStartRequest,
  ): Effect.Effect<AgentAgentAnswer, never, HttpClient.HttpClient> {
    const sourceId = request.from?.agentId;
    const admitted = Result.getOrUndefined(agentStartRequestOnWire(request));
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

  messagesNewest(
    agentId: string,
    callId?: string,
    cut = false,
  ): Effect.Effect<AgentNewestAnswer | Failed, never, HttpClient.HttpClient> {
    return Effect.map(
      hostedAnswer(this.#newest(agentId, callId, undefined, cut), ROW_REFUSALS),
      (answer) => ("failure" in answer || "status" in answer ? answer : UNANSWERED),
    );
  }

  messagesBefore(
    agentId: string,
    before: string,
    callId?: string,
    cut = false,
  ): Effect.Effect<AgentOlderAnswer | Failed, never, HttpClient.HttpClient> {
    return Effect.map(
      hostedAnswer(this.#newest(agentId, callId, before, cut), ROW_REFUSALS),
      (answer): AgentOlderAnswer | Failed =>
        "failure" in answer
          ? answer
          : {
              messages: answer.messages,
              ...(answer.before === undefined ? undefined : { before: answer.before }),
            },
    );
  }

  #newest(agentId: string, callId?: string, before?: string, cut = false) {
    const page = {
      ...(before === undefined ? undefined : { before }),
      ...(cut ? { parts: TRANSCRIPT_PARTS_QUERY.CUT } : undefined),
    };
    return callId === undefined
      ? askHosted(this.#hosted.messages.agentNewest, { id: agentId, ...page })
      : askHosted(this.#hosted.messages.agentWorkerNewest, { id: agentId, call: callId, ...page });
  }

  agentPart(
    agentId: string,
    messageId: string,
    index: number,
    callId?: string,
  ): Effect.Effect<AgentPartView, never, HttpClient.HttpClient> {
    const part = { id: agentId, message: messageId, index: String(index) };
    const asked =
      callId === undefined
        ? askHosted(this.#hosted.messages.agentPart, part)
        : askHosted(this.#hosted.messages.agentWorkerPart, { ...part, call: callId });
    return hostedAnswer(asked, ROW_REFUSALS);
  }

  agentTranscriptLive(
    agentId: string,
    userId: string,
    callId?: string,
    poll = false,
    after?: string,
    cursor?: string,
  ): Effect.Effect<
    AgentTranscriptLiveAnswer | Failed | typeof LIVE_SIGNED_OUT,
    never,
    HttpClient.HttpClient
  > {
    const read = {
      id: agentId,
      [LIVE_USER_QUERY]: userId,
      ...(cursor === undefined ? undefined : { [LIVE_POLL.CURSOR]: cursor }),
    };
    const named = callId === undefined ? read : { ...read, call: callId };
    return Effect.catchIf(
      askLive(this.#hosted.live.agentTranscript, named, poll, after),
      (failed) =>
        failed._tag === "HostedRefused" && failed.refusal === HOSTED_API_ERROR.INVALID_TOKEN,
      () => Effect.succeed(LIVE_SIGNED_OUT),
    ).pipe((signed) => hostedAnswer(signed, ROW_REFUSALS));
  }

  message(
    agentId: string,
    request: AgentMessageRequest,
  ): Effect.Effect<AgentMessageAnswerView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(agentMessageRequestSchema)(request));
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

  changeQueue(
    agentId: string,
    change: AgentQueueChange,
  ): Effect.Effect<AgentQueueAnswerView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(agentQueueChangeSchema)(change));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedAnswer(
      askHosted(
        this.#hosted.messages.queue,
        { params: { id: agentId }, body: admitted },
        HOSTED_DEADLINE.STEER,
      ),
      MESSAGE_REFUSALS,
    );
  }

  choose(
    agentId: string,
    choice: ModelChoice,
  ): Effect.Effect<AgentAgentAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(modelChoiceSchema)(choice));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return this.#change(agentId, admitted, CHOOSE_REFUSALS);
  }

  rename(
    agentId: string,
    request: AgentRenameRequest,
    key?: string,
  ): Effect.Effect<AgentAgentAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(agentRenameRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return this.#change(agentId, admitted, ROW_REFUSALS, key);
  }

  switchServers(
    agentId: string,
    request: AgentServersRequest,
  ): Effect.Effect<AgentAgentAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(agentServersRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return this.#change(agentId, admitted, ROW_REFUSALS);
  }

  addRepository(
    agentId: string,
    request: AgentAddRepositoryRequest,
  ): Effect.Effect<AgentAgentAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(agentAddRepositoryRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return this.#change(agentId, admitted, ADD_REPOSITORY_REFUSALS);
  }

  archive(
    agentId: string,
    request: AgentArchiveRequest,
  ): Effect.Effect<AgentAgentAnswer, never, HttpClient.HttpClient> {
    return this.#change(agentId, { archived: request.archived }, ARCHIVE_REFUSALS);
  }

  pin(
    agentId: string,
    request: AgentPinRequest,
    key?: string,
  ): Effect.Effect<AgentAgentAnswer, never, HttpClient.HttpClient> {
    return this.#change(
      agentId,
      request.position === undefined
        ? { pinned: request.pinned }
        : { pinned: request.pinned, position: request.position },
      ROW_REFUSALS,
      key,
    );
  }

  markRead(
    agentId: string,
    request: AgentReadRequest,
    key?: string,
  ): Effect.Effect<AgentAgentAnswer, never, HttpClient.HttpClient> {
    return this.#change(agentId, { readMark: request.readMark }, ROW_REFUSALS, key);
  }

  #change(
    agentId: string,
    body: AgentChangeRequest,
    named: NamedRefusals,
    key?: string,
  ): Effect.Effect<AgentAgentAnswer, never, HttpClient.HttpClient> {
    return hostedAnswer(
      askHosted(
        this.#hosted.agents.change,
        { params: { id: agentId }, body },
        HOSTED_DEADLINE.USUAL,
        key,
      ),
      named,
    );
  }

  delete(agentId: string): Effect.Effect<AgentDeleteAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(askHosted(this.#hosted.agents.delete, { id: agentId }), ARCHIVE_REFUSALS);
  }

  stop(agentId: string): Effect.Effect<AgentAgentAnswer, never, HttpClient.HttpClient> {
    return hostedAnswer(askHosted(this.#hosted.agents.stop, { id: agentId }), ROW_REFUSALS);
  }

  rewind(
    agentId: string,
    messageId: string,
  ): Effect.Effect<AgentAgentAnswer, never, HttpClient.HttpClient> {
    return hostedAnswer(
      askHosted(
        this.#hosted.agents.rewind,
        { params: { id: agentId }, body: { messageId } },
        HOSTED_DEADLINE.STEER,
      ),
      ROW_REFUSALS,
    );
  }

  agent(agentId: string): Effect.Effect<AgentPageAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(askHosted(this.#hosted.agents.read, { id: agentId }), ROW_REFUSALS);
  }

  pullRequest(
    agentId: string,
    number?: number,
  ): Effect.Effect<AgentPullRequestAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(
      askHosted(this.#hosted.agentPullRequests.pullRequest, pullRequestRead(agentId, number)),
      ROW_REFUSALS,
    );
  }

  changes(
    agentId: string,
    number?: number,
  ): Effect.Effect<AgentChangesAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(
      askHosted(this.#hosted.agents.changes, {
        id: agentId,
        ...(number === undefined ? undefined : { number: String(number) }),
      }),
      ROW_REFUSALS,
    );
  }

  overviewPullRequest(
    agentId: string,
    number?: number,
  ): Effect.Effect<AgentOverviewPullRequestAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(
      askHosted(
        this.#hosted.agentPullRequests.overviewPullRequest,
        pullRequestRead(agentId, number),
      ),
      ROW_REFUSALS,
    );
  }

  workspaceTools(
    agentId: string,
  ): Effect.Effect<AgentWorkspaceToolsAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(
      askHosted(this.#hosted.agents.workspaceTools, { id: agentId }),
      ROW_REFUSALS,
    );
  }

  reviewOptions(
    agentId: string,
  ): Effect.Effect<AgentReviewOptionsAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(
      askHosted(this.#hosted.agents.reviewOptions, { id: agentId }),
      ROW_REFUSALS,
    );
  }

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

  overviewChecks(
    agentId: string,
    number?: number,
  ): Effect.Effect<AgentOverviewChecksAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(
      askHosted(this.#hosted.agentPullRequests.overviewChecks, pullRequestRead(agentId, number)),
      ROW_REFUSALS,
    );
  }

  overviewConversation(
    agentId: string,
    number?: number,
  ): Effect.Effect<AgentOverviewConversationAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(
      askHosted(
        this.#hosted.agentPullRequests.overviewConversation,
        pullRequestRead(agentId, number),
      ),
      ROW_REFUSALS,
    );
  }

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
      askLive(
        this.#hosted.live.inbox,
        {
          [LIVE_USER_QUERY]: userId,
          [ACCOUNT_INBOX_REPOSITORYLESS.QUERY]: ACCOUNT_INBOX_REPOSITORYLESS.INCLUDE,
        },
        poll,
        after,
      ),
      (failed) =>
        failed._tag === "HostedRefused" && failed.refusal === HOSTED_API_ERROR.INVALID_TOKEN,
      () => Effect.succeed(LIVE_SIGNED_OUT),
    ).pipe((signed) => hostedAnswer(signed, {}));
  }

  accountInboxItemsLive(
    userId: string,
    sync: string | undefined,
  ): Effect.Effect<
    AccountInboxItemsLiveAnswer | Failed | typeof LIVE_SIGNED_OUT,
    never,
    HttpClient.HttpClient
  > {
    const read = {
      [LIVE_USER_QUERY]: userId,
      ...(sync === undefined ? undefined : { [LIVE_POLL.SYNC]: sync }),
    };
    return Effect.catchIf(
      askLive(
        this.#hosted.live.inboxItems,
        read,
        true,
        undefined,
        sync !== undefined && sync !== "",
      ),
      (failed) =>
        failed._tag === "HostedRefused" && failed.refusal === HOSTED_API_ERROR.INVALID_TOKEN,
      () => Effect.succeed(LIVE_SIGNED_OUT),
    ).pipe((signed) => hostedAnswer(signed, {}));
  }

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

  pullRequestChaptersLive(
    agentId: string,
    number: number,
    userId: string,
    poll = false,
    after?: string,
  ): Effect.Effect<
    PullRequestChaptersLiveAnswer | Failed | typeof LIVE_SIGNED_OUT,
    never,
    HttpClient.HttpClient
  > {
    const read = { id: agentId, number: String(number), [LIVE_USER_QUERY]: userId };
    return Effect.catchIf(
      askLive(this.#hosted.live.pullRequestChapters, read, poll, after),
      (failed) =>
        failed._tag === "HostedRefused" && failed.refusal === HOSTED_API_ERROR.INVALID_TOKEN,
      () => Effect.succeed(LIVE_SIGNED_OUT),
    ).pipe((signed) => hostedAnswer(signed, ROW_REFUSALS));
  }

  agentOriginLive(
    agentId: string,
    userId: string,
    poll = false,
    after?: string,
  ): Effect.Effect<
    AgentOriginLiveAnswer | Failed | typeof LIVE_SIGNED_OUT,
    never,
    HttpClient.HttpClient
  > {
    const read = { id: agentId, [LIVE_USER_QUERY]: userId };
    return Effect.catchIf(
      askLive(this.#hosted.live.agentOrigin, read, poll, after),
      (failed) =>
        failed._tag === "HostedRefused" && failed.refusal === HOSTED_API_ERROR.INVALID_TOKEN,
      () => Effect.succeed(LIVE_SIGNED_OUT),
    ).pipe((signed) => hostedAnswer(signed, ROW_REFUSALS));
  }

  agentPicture(
    agentId: string,
    pictureId: string,
    callId?: string,
  ): Effect.Effect<AgentInboxAttachmentView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.GET,
        path: agentPicturePath(agentId, pictureId, callId),
      }),
      (answer): Effect.Effect<AgentInboxAttachmentView> => {
        if (!callAnswered(answer)) return Effect.succeed(unansweredCall(answer));
        if (!answer.response.ok) {
          return Effect.map(jsonOf(answer.response), (body) =>
            refusedAs(unparsedWire(body), ROW_REFUSALS),
          );
        }
        return readInboxFile(answer.response);
      },
    );
  }

  pullRequestAction(
    agentId: string,
    request: PullRequestActionRequest,
    number?: number,
  ): Effect.Effect<AgentPullRequestWriteAnswerView, never, HttpClient.HttpClient> {
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

  pullRequestViewed(
    agentId: string,
    number?: number,
  ): Effect.Effect<AgentPullRequestViewedAnswerView, never, HttpClient.HttpClient> {
    return hostedAnswer(
      askHosted(this.#hosted.agentPullRequests.viewed, pullRequestRead(agentId, number)),
      ROW_REFUSALS,
    );
  }

  githubImage(
    agentId: string,
    src: string,
  ): Effect.Effect<AgentGitHubImageView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.GET, path: agentGitHubImagePath(agentId, src) }),
      (answer): Effect.Effect<AgentGitHubImageView> => {
        if (!callAnswered(answer)) return Effect.succeed(unansweredCall(answer));
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

  inboxAttachment(
    itemId: string,
    attachmentId: string,
  ): Effect.Effect<AgentInboxAttachmentView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.GET, path: inboxAttachmentPath(itemId, attachmentId) }),
      (answer): Effect.Effect<AgentInboxAttachmentView> => {
        if (!callAnswered(answer)) return Effect.succeed(unansweredCall(answer));
        if (!answer.response.ok) {
          return Effect.map(jsonOf(answer.response), (body) =>
            refusedAs(unparsedWire(body), ROW_REFUSALS),
          );
        }
        return readInboxFile(answer.response);
      },
    );
  }

  answerInbox(
    itemId: string,
    request: InboxAcknowledgeRequest,
    key?: string,
  ): Effect.Effect<AgentInboxAnsweredView, never, HttpClient.HttpClient> {
    const body = wireRequestOf(inboxAcknowledgeRequestSchema, request);
    if (body === undefined) return Effect.succeed(UNANSWERED);
    return hostedAnswer(
      askHosted(
        this.#hosted.inbox.answer,
        { params: { id: itemId }, body },
        HOSTED_DEADLINE.STEER,
        key,
      ),
      INBOX_ANSWER_REFUSALS,
    );
  }

  closeInbox(
    itemId: string,
    request: InboxCloseRequest,
    key?: string,
  ): Effect.Effect<AgentInboxAnsweredView, never, HttpClient.HttpClient> {
    const body = wireRequestOf(inboxCloseRequestSchema, request);
    if (body === undefined) return Effect.succeed(UNANSWERED);
    return hostedAnswer(
      askHosted(
        this.#hosted.inbox.close,
        { params: { id: itemId }, body },
        HOSTED_DEADLINE.STEER,
        key,
      ),
      INBOX_ANSWER_REFUSALS,
    );
  }

  messageInbox(
    itemId: string,
    request: InboxMessageRequest,
  ): Effect.Effect<AgentInboxMessagedView, never, HttpClient.HttpClient> {
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

  startInboxThread(
    request: InboxStartRequest,
  ): Effect.Effect<AgentInboxMessagedView, never, HttpClient.HttpClient> {
    const body = wireRequestOf(inboxStartRequestSchema, request);
    if (body === undefined) return Effect.succeed(UNANSWERED);
    return hostedAnswer(
      askHosted(this.#hosted.inbox.start, body, HOSTED_DEADLINE.STEER),
      INBOX_ANSWER_REFUSALS,
    );
  }

  inboxItemHome(
    itemId: string,
  ): Effect.Effect<AgentInboxItemHomeView, never, HttpClient.HttpClient> {
    return hostedAnswer(askHosted(this.#hosted.inbox.home, { id: itemId }), ROW_REFUSALS);
  }

  markInboxItemRead(
    itemId: string,
    key?: string,
  ): Effect.Effect<AgentInboxReadStateView, never, HttpClient.HttpClient> {
    return hostedAnswer(
      askHosted(this.#hosted.inbox.markItemRead, { id: itemId }, HOSTED_DEADLINE.USUAL, key),
      ROW_REFUSALS,
    );
  }

  markInboxItemUnread(
    itemId: string,
    key?: string,
  ): Effect.Effect<AgentInboxReadStateView, never, HttpClient.HttpClient> {
    return hostedAnswer(
      askHosted(this.#hosted.inbox.markItemUnread, { id: itemId }, HOSTED_DEADLINE.USUAL, key),
      ROW_REFUSALS,
    );
  }

  remindInboxItem(
    itemId: string,
    until: number | null,
    key?: string,
  ): Effect.Effect<AgentInboxReadStateView, never, HttpClient.HttpClient> {
    return hostedAnswer(
      askHosted(
        this.#hosted.inbox.remindItem,
        { params: { id: itemId }, body: { until } },
        HOSTED_DEADLINE.USUAL,
        key,
      ),
      ROW_REFUSALS,
    );
  }

  markInboxRead(
    request: InboxReadAllRequest = {},
    key?: string,
  ): Effect.Effect<AgentInboxReadAllView, never, HttpClient.HttpClient> {
    const body = wireRequestOf(inboxReadAllRequestSchema, request);
    if (body === undefined) return Effect.succeed(UNANSWERED);
    return hostedAnswer(
      askHosted(this.#hosted.inbox.markAllRead, body, HOSTED_DEADLINE.USUAL, key),
      {},
    );
  }
}
