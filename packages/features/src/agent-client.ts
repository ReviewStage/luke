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
import type { AccountPreferencesAnswerWire } from "./account-wire.js";
import {
  AGENT_ADD_REPOSITORY_RENAMES,
  AGENT_ARCHIVE_RENAMES,
  AGENT_CALL_FAILURE,
  AGENT_CHOOSE_RENAMES,
  AGENT_DELETE_RENAMES,
  AGENT_INBOX_WRITE_RENAMES,
  AGENT_NOT_FOUND_RENAMES,
  AGENT_RENAMES,
  AGENT_START_RENAMES,
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
  type AgentWarmAnswerView,
  type AgentWorkspaceListParams,
  type AgentWorkspaceToolsAnswerView,
  type ChaptersProviderAnswer,
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
import {
  CHAPTERS_MODEL,
  CHAPTERS_PICK_LIST,
  chaptersModelOn,
  chaptersProviderOf,
} from "./chapters-model-choice.js";
import { agentsContract } from "./contract/agents.js";
import { HOSTED_REFUSAL_DATA, refusalCarriesData } from "./contract/errors.js";
import { dictationRequestSchema } from "./dictation-wire.js";
import { FAILURE_FACT, type FailureFacts } from "./failure-facts.js";
import { githubTokenSaveRequestSchema } from "./github-token-wire.js";
import {
  HOST_PAIRING_RENAMES,
  type HostPairingApproveView,
  type HostPairingDenyView,
  type HostPairingView,
} from "./host-pairing-view.js";
import { askLiveRead, type HostedPoll, hostedCall } from "./hosted-call.js";
import { spelledFailure } from "./hosted-failure.js";
import {
  HOSTED_DEADLINE,
  type HostedClient,
  type HostedDeadline,
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
import type { AnyLiveRead, LiveReadAsked } from "./live-read.js";
import { TRANSCRIPT_NOW_QUERY, type TranscriptNowAnswer } from "./live-wire.js";
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
import {
  PULL_REQUEST_CHAPTERS_RENAMES,
  type PullRequestChaptersAnswerView,
} from "./pull-request-chapters-view.js";
import {
  type PullRequestActionRequest,
  pullRequestActionRequestSchema,
} from "./pull-request-write-wire.js";
import type { RepositoryUnreached } from "./repository-reach-wire.js";
import { agentGitHubImagePath, agentPicturePath, inboxAttachmentPath } from "./service-paths.js";
import {
  HOSTED_API_ERROR,
  type HostedApiError,
  hostedErrorSchema,
  readServiceAnswer,
} from "./service-wire.js";
import type { TaskAgentRefusal } from "./task-wire.js";

/**
 * agent-client.ts -- the window's side of a task's coding agents, as the host asks the service for them.
 *
 * Every call is the one account call, so the bearer is read fresh per
 * attempt and a 401 is renewed and retried once. Each call answers one of
 * the view's shapes rather than failing, because every caller does the same
 * thing with a failure: draws why, and offers to try again. The transcript
 * read and the two inbox reads, a task's and the account's, are the calls
 * the service holds open, for as long
 * as it waits on the agent's next message or the next change, so they
 * travel under a deadline of
 * their own that outlasts that hold; a Start travels under a longer one
 * still, since one from another agent copies its work first; every other
 * call keeps the account call's usual one.
 */

export interface HostedAgentClientOptions {
  /** What authorizes each call on the signed-in account, read fresh for every attempt. */
  credential: CallCredential;
  /** The hosted service origin, without a trailing slash. */
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

/** A served file's refusal: not found where the service said so; unanswered for anything else. */
function servedRefusal(payload: UnparsedWireValue): Failed {
  const refusal = Result.getOrUndefined(readServiceAnswer(hostedErrorSchema)(payload));
  return refusal === HOSTED_API_ERROR.NOT_FOUND
    ? { failure: AGENT_CALL_FAILURE.NOT_FOUND }
    : UNANSWERED;
}

/** The refusals a Start's contract declares, which are the ones a refusal beside a task it made may be read as. */
const START_DECLARED: ReadonlySet<string> = new Set(
  Object.keys(agentsContract.start["~orpc"].errorMap),
);

/** The field without which the others a refusal carries say nothing: why a device or a repository refused, before which device or repository. */
const LEADING_FIELD: Readonly<Partial<Record<HostedApiError, string>>> = {
  [HOSTED_API_ERROR.LOCAL_AGENT_REFUSED]: "localAgentRefusal",
  [HOSTED_API_ERROR.EXTRA_REPOSITORY_REFUSED]: "extraRepositoryRefusal",
};

/**
 * A Start's refusal the service answered beside a task it made all the same
 * (`task-wire.ts`'s `taskStartAnswerSchema`), read as a refused Start is:
 * its failure as a Start spells it (`AGENT_START_RENAMES`), with the fields
 * it carries where the service said and this build reads them; unanswered
 * for a refusal a Start does not name.
 */
export function startRefusedAs(refusal: TaskAgentRefusal): Failed {
  const payload = unparsedWire(refusal);
  const slug = Result.getOrUndefined(readServiceAnswer(hostedErrorSchema)(payload));
  if (slug === undefined || !START_DECLARED.has(slug)) return UNANSWERED;
  // SAFETY: a Start's refusals spelled as it spells them are among the agent rows' failures (`AGENT_ROW_CALLS`).
  const failure = spelledFailure(slug, { as: AGENT_START_RENAMES }) as AgentCallFailure | undefined;
  if (failure === undefined) return UNANSWERED;
  if (failure === AGENT_CALL_FAILURE.UNANSWERED || !refusalCarriesData(slug)) return { failure };
  const data = Result.getOrUndefined(readServiceAnswer(HOSTED_REFUSAL_DATA[slug])(payload));
  const leading = LEADING_FIELD[slug];
  if (data === undefined || (leading !== undefined && !(leading in data))) return { failure };
  return { failure, ...data };
}

/**
 * A failure read as no answer as it always read, bare but for the facts of
 * what failed beneath it where it has them: a refusal a call reads as no
 * answer (its `as` renames it so) carries none of the fields it would carry
 * as its own failure, as the table that call read its refusals through
 * before handed none.
 */
function unansweredBare<Answer extends object>(answer: Answer): Answer {
  if (!("failure" in answer) || answer.failure !== AGENT_CALL_FAILURE.UNANSWERED) return answer;
  const bare = "cause" in answer ? { ...UNANSWERED, cause: answer.cause } : UNANSWERED;
  // SAFETY: a bare unanswered failure is a member of every answer a call here reads its refusals into.
  return bare as Answer;
}

/**
 * A Start's or a repository added's failure without why the repositories
 * named beside the agent's own were refused, which these calls have never
 * handed the window (the table they read before read no such field), so it draws
 * that they were refused and not why.
 */
function extraRepositoryWhyLeftOut(answer: AgentAgentAnswer): AgentAgentAnswer {
  if (!("failure" in answer)) return answer;
  const { extraRepositoryRefusal: _why, refusedRepository: _repository, ...failed } = answer;
  return failed;
}

/**
 * A call that never reached the service, unanswered with where it ended,
 * the network or its deadline among them, which the window reports and
 * never draws, so a read the network failed is not reported as the app's.
 */
function unansweredCall(answer: Exclude<CallAnswer, { readonly response: Response }>): Failed {
  const { fault, errorName } = answer;
  const unanswered = new HostedUnanswered({
    fault,
    ...(errorName === undefined ? undefined : { errorName }),
  });
  return { ...UNANSWERED, cause: hostedFailureFacts(unanswered) };
}

/** The idempotency key a write taken once under it is asked under, where one is given. */
function keyed(key: string | undefined) {
  return key === undefined ? undefined : { idempotencyKey: key };
}

/** How a member's write on the inbox taken once under its idempotency key is asked: under `deadline`, and the key given where one is. */
function inboxWrite(deadline: HostedDeadline, key: string | undefined) {
  return { deadline, ...keyed(key) };
}

/** A keyed write the service took already under its key, as the host reads it: no answer, its cause that refusal (`keyed-write.ts`). */
const WRITTEN_ALREADY = {
  failure: AGENT_INBOX_WRITE_RENAMES[HOSTED_API_ERROR.ALREADY_WRITTEN],
  cause: { _tag: FAILURE_FACT.HOSTED_REFUSED, refusal: HOSTED_API_ERROR.ALREADY_WRITTEN },
} as const;

/**
 * A member's keyed write on the inbox, a key already written under read as
 * no answer whose cause is that refusal, as it always read. Note that the
 * cause is what tells the host the write landed and keeps what it drew
 * (`writeUntakenOf`), so the refusal is never renamed away, which would
 * drop it and take the write back. The trace it traveled under is not kept.
 */
function writtenAlreadyKept<Answer extends object>(
  answer: Answer,
):
  | Exclude<Answer, { readonly failure: typeof HOSTED_API_ERROR.ALREADY_WRITTEN }>
  | typeof WRITTEN_ALREADY {
  if ("failure" in answer && answer.failure === HOSTED_API_ERROR.ALREADY_WRITTEN) {
    return WRITTEN_ALREADY;
  }
  // SAFETY: an answer that is no key already written under is one of the others.
  return answer as Exclude<Answer, { readonly failure: typeof HOSTED_API_ERROR.ALREADY_WRITTEN }>;
}

/**
 * A write to an agent's row as the window always heard it: a key already
 * written under no answer whose cause is that refusal, which tells the host
 * the write landed (`writtenAlreadyKept`), and every other refusal but the
 * agent gone no answer, bare.
 */
function rowWritten<Answer extends object>(answer: Answer) {
  return unansweredBare(writtenAlreadyKept(answer));
}

/** A Generate's failure without why its repository is out of reach, which the tab has never been handed, so it draws that it is and not why. */
function reachUnsaid(answer: PullRequestChaptersAnswerView): PullRequestChaptersAnswerView {
  if (!("failure" in answer)) return answer;
  const { unreached: _why, ...failed } = answer;
  return failed;
}

/** The types an inbox item's attachment is served under: a block's picture's or recording's, or any a file an answer carried traveled as. */
const inboxFileTypeSchema = Schema.Literals(Object.values(INBOX_FILE_TYPE));

/** A served file's bytes in base64 under its type: a picture, a recording, or a file an inbox answer carried or a queued message holds; unanswered under any other type. */
function readInboxFile(response: Response): Effect.Effect<AgentInboxAttachmentView> {
  return Effect.map(imageBodyOf(response, inboxFileTypeSchema), (file) => file ?? UNANSWERED);
}

/** A transcript page read at once, or unanswered where the service said nothing of whether it would hold, as one too old to read at once does. */
function readNow(
  answer: (AgentMessagesAnswerView & { readonly holds?: boolean }) | Failed,
): TranscriptNowAnswer | Failed {
  if ("failure" in answer) return answer;
  return answer.holds === undefined ? UNANSWERED : { ...answer, holds: answer.holds };
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

/**
 * The default a write left off the preferences snapshot, with the
 * transaction it committed in, or why there was none: its coding-agent part
 * as a choice reads, the settings parts beside it the settings client's to
 * read.
 */
function defaultOf(
  read: AccountPreferencesAnswerWire | Exclude<AgentDefaultAnswer, { readonly choice: unknown }>,
): AgentDefaultAnswer {
  if ("failure" in read) return read;
  const choice = Option.getOrUndefined(Schema.decodeUnknownOption(modelChoiceSchema)(read.agent));
  if (choice === undefined) return UNANSWERED;
  return read.txid === undefined ? { choice } : { choice, txid: read.txid };
}

const readChaptersPick = Schema.decodeUnknownOption(Schema.Literals(CHAPTERS_PICK_LIST));

/** The chapters provider as a write answered it, read off the model it kept, with the transaction it committed in; unanswered where the answer named none the window can read. */
function chaptersProviderAnswer(
  read: AccountPreferencesAnswerWire | Failed,
): ChaptersProviderAnswer {
  if ("failure" in read) return read;
  const kept = Option.getOrUndefined(readChaptersPick(read.chaptersModel));
  if (kept === undefined) return UNANSWERED;
  const provider = chaptersProviderOf(kept);
  return read.txid === undefined ? { provider } : { provider, txid: read.txid };
}

/**
 * The window's reads and writes of a task's coding agents: the models the
 * service offers and the account's default among them, a task's agents,
 * one started, one's transcript past a cursor, one messaged, one's model
 * and effort changed, one stopped, what one published, the task's inbox
 * of what its agents need of the developer, read past a cursor and
 * answered an item at a time, and what waits across the account's tasks.
 */
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

  /** The models a coding agent may run on, as the service offers them now. */
  models(): Effect.Effect<AgentModelsAnswer, never, HttpClient.HttpClient> {
    return hostedCall(this.#hosted.models.list, undefined);
  }

  /** The account's hosts, as Settings lists them. */
  hosts(): Effect.Effect<HostsAnswerView, never, HttpClient.HttpClient> {
    return hostedCall(this.#hosted.hosts.list, undefined);
  }

  /** How long ago the account's own devices last beat, and nothing else of them, failed past `MAC_PRESENCE.READ_TIMEOUT_MS`. */
  devicePresence(): Effect.Effect<DevicePresenceAnswerView, never, HttpClient.HttpClient> {
    return hostedCall(this.#hosted.hosts.presence, undefined, {
      deadline: HOSTED_DEADLINE.PRESENCE,
    });
  }

  /** A declared live read sealed for following, or polled where `poll` asks (`askLiveRead`). */
  liveRead<Read extends AnyLiveRead>(read: Read, params: LiveReadAsked<Read>, poll?: HostedPoll) {
    return askLiveRead(this.#hosted.live, read, params, poll);
  }

  /** One of the account's hosts removed, its secret refused at once, answering the transaction it was removed in. */
  removeHost(id: string): Effect.Effect<HostDoneAnswerView, never, HttpClient.HttpClient> {
    return hostedCall(this.#hosted.hosts.remove, { id });
  }

  /** A box's pending pairing by the code its link named, as the approve screen shows it: the box and the address its start came from. */
  readHostPairing(code: string): Effect.Effect<HostPairingView, never, HttpClient.HttpClient> {
    return hostedCall(this.#hosted.hosts.readPairing, { code }, { as: HOST_PAIRING_RENAMES });
  }

  /** A box's pending pairing approved by its code, which makes the account's host at once; its box collects its secret on its next poll. */
  approveHostPairing(
    code: string,
  ): Effect.Effect<HostPairingApproveView, never, HttpClient.HttpClient> {
    return hostedCall(this.#hosted.hosts.approvePairing, { code }, { as: HOST_PAIRING_RENAMES });
  }

  /** A box's pending pairing denied by its code, so its box is answered denied. */
  denyHostPairing(code: string): Effect.Effect<HostPairingDenyView, never, HttpClient.HttpClient> {
    return hostedCall(this.#hosted.hosts.denyPairing, { code }, { as: HOST_PAIRING_RENAMES });
  }

  /** The account's default written on its own, answering it as kept with the transaction it committed in; a choice the service would refuse by shape is refused here without traveling at all. */
  writeDefault(
    choice: ModelChoice,
  ): Effect.Effect<AgentDefaultAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(agentDefaultWriteSchema)({ agent: choice }));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.map(
      hostedCall(this.#hosted.account.writePreferences, admitted, { as: AGENT_RENAMES }),
      defaultOf,
    );
  }

  /** Whose API key the account's chapters run on where it saved both, written on its own as the account's chapters model, its provider's model of Haiku's tier, answering it as kept with the transaction it committed in. */
  writeChaptersProvider(
    provider: ModelProvider,
  ): Effect.Effect<ChaptersProviderAnswer, never, HttpClient.HttpClient> {
    return Effect.map(
      hostedCall(
        this.#hosted.account.writePreferences,
        { chaptersModel: chaptersModelOn(provider, CHAPTERS_MODEL.HAIKU) },
        { as: AGENT_RENAMES },
      ),
      chaptersProviderAnswer,
    );
  }

  /** One memory forgotten for good, answering the workspace's memories as they then stand. */
  forgetMemory(
    params: MemoryForgetParams,
  ): Effect.Effect<MemoriesAnswerView, never, HttpClient.HttpClient> {
    // The workspace and the memory ride in the query, since a DELETE carries no body.
    return hostedCall(this.#hosted.account.forgetMemory, {
      query: { [MEMORY_QUERY.WORKSPACE_ID]: params.workspaceId, [MEMORY_QUERY.ID]: params.id },
    });
  }

  /** The account's own provider keys, as hints and statuses. */
  readProviderKeys(): Effect.Effect<ProviderKeysAnswerView, never, HttpClient.HttpClient> {
    return hostedCall(this.#hosted.account.providerKeys, undefined);
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
    return hostedCall(this.#hosted.account.saveProviderKey, admitted);
  }

  /** Codex's device-code login begun on the service: the code to enter, where, how often to ask again, and when it lapses. */
  startChatGptDeviceLogin(): Effect.Effect<
    ChatGptDeviceStartAnswerView,
    never,
    HttpClient.HttpClient
  > {
    return hostedCall(this.#hosted.account.startChatGptDeviceLogin, undefined);
  }

  /** How a device-code login stands, the keys once it connected; a login id the service would refuse by shape never travels. */
  pollChatGptDeviceLogin(
    params: ChatGptDeviceLoginParams,
  ): Effect.Effect<ChatGptDevicePollAnswerView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(chatGptDeviceLoginRequestSchema)(params));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedCall(this.#hosted.account.pollChatGptDeviceLogin, admitted);
  }

  /** A device-code login withdrawn, answering how it then stands; a login id the service would refuse by shape never travels. */
  cancelChatGptDeviceLogin(
    params: ChatGptDeviceLoginParams,
  ): Effect.Effect<ChatGptDevicePollAnswerView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(chatGptDeviceLoginRequestSchema)(params));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedCall(this.#hosted.account.cancelChatGptDeviceLogin, admitted);
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
    return hostedCall(this.#hosted.account.setProviderKeyForAgents, admitted);
  }

  /** One provider's key of the kind named, an API key where none is, removed, answering the keys as they then stand. */
  removeProviderKey(
    params: ProviderKeyRemoveParams,
  ): Effect.Effect<ProviderKeysAnswerView, never, HttpClient.HttpClient> {
    // The provider rides in the query, since a DELETE carries no body.
    return hostedCall(this.#hosted.account.removeProviderKey, {
      query: {
        [PROVIDER_KEY_QUERY.PROVIDER]: params.provider,
        ...(params.kind === undefined ? undefined : { [PROVIDER_KEY_QUERY.KIND]: params.kind }),
      },
    });
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
    return hostedCall(this.#hosted.dictation.transcribe, admitted, {
      deadline: HOSTED_DEADLINE.HELD,
    });
  }

  /** The member's own GitHub token, as what tells it apart; never the token. */
  readGitHubToken(): Effect.Effect<GitHubTokenAnswerView, never, HttpClient.HttpClient> {
    return hostedCall(this.#hosted.githubToken.read, undefined);
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
    return hostedCall(this.#hosted.githubToken.save, admitted);
  }

  /** The member's GitHub token removed, answering none. */
  removeGitHubToken(): Effect.Effect<GitHubTokenAnswerView, never, HttpClient.HttpClient> {
    return hostedCall(this.#hosted.githubToken.remove, undefined);
  }

  /** One task's agents with their status, in the order they were started, the archived ones among them, each flagged, where `includeArchived` asks. */
  list(
    taskId: string,
    includeArchived = false,
  ): Effect.Effect<AgentListAnswer, never, HttpClient.HttpClient> {
    return hostedCall(this.#hosted.agents.listOfTask, {
      id: taskId,
      ...(includeArchived
        ? { [AGENT_LIST_QUERY.ARCHIVED]: AGENT_LIST_ARCHIVED.INCLUDE }
        : undefined),
    });
  }

  /** A workspace's agents, newest started first, narrowed to one repository where one is named and to the words given where some are, the archived ones among them where `includeArchived` asks. */
  listWorkspace(
    params: AgentWorkspaceListParams,
  ): Effect.Effect<AgentListAnswer, never, HttpClient.HttpClient> {
    return hostedCall(this.#hosted.agents.listOfWorkspace, {
      [AGENT_WORKSPACE_QUERY.WORKSPACE_ID]: params.workspaceId,
      ...(params.repository === undefined
        ? undefined
        : { [AGENT_WORKSPACE_QUERY.REPOSITORY]: params.repository }),
      ...(params.words === undefined ? undefined : { [AGENT_WORKSPACE_QUERY.WORDS]: params.words }),
      ...(params.includeArchived === true
        ? { [AGENT_WORKSPACE_QUERY.ARCHIVED]: AGENT_LIST_ARCHIVED.INCLUDE }
        : undefined),
    });
  }

  /**
   * Starts an agent on the task under the request's own key, so a retry
   * carrying the same key answers the agent the first Start made; a request
   * the service would refuse by shape is refused here without traveling.
   */
  start(
    taskId: string,
    request: AgentStartRequest,
  ): Effect.Effect<AgentAgentAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(agentStartRequestOnWire(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.map(
      hostedCall(
        this.#hosted.agents.start,
        { params: { id: taskId }, body: admitted },
        { as: AGENT_START_RENAMES, deadline: HOSTED_DEADLINE.START },
      ),
      (started) => ("failure" in started ? extraRepositoryWhyLeftOut(started) : started.body),
    );
  }

  /**
   * Starts an agent from the one named, continuing it or forking it at the
   * message the request's `from` names, in that agent's own place: its task,
   * or its workspace and repository where it has none. Keyed and refused as
   * `start` is; a request whose `from` names no agent is refused here.
   */
  startFrom(
    request: AgentStartRequest,
  ): Effect.Effect<AgentAgentAnswer, never, HttpClient.HttpClient> {
    const sourceId = request.from?.agentId;
    const admitted = Result.getOrUndefined(agentStartRequestOnWire(request));
    if (sourceId === undefined || admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.map(
      hostedCall(
        this.#hosted.agents.startFrom,
        { params: { id: sourceId }, body: admitted },
        { as: AGENT_START_RENAMES, deadline: HOSTED_DEADLINE.START },
      ),
      (started) => ("failure" in started ? extraRepositoryWhyLeftOut(started) : started.body),
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
        ? hostedCall(this.#hosted.messages.agent, { id: agentId, ...query })
        : hostedCall(this.#hosted.messages.agentWorker, { id: agentId, call: callId, ...query });
    return Effect.map(asked, readNow);
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
  ): Effect.Effect<AgentNewestAnswer | Failed, never, HttpClient.HttpClient> {
    return Effect.map(
      this.#newest(agentId, callId, undefined, cut),
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
  ): Effect.Effect<AgentOlderAnswer | Failed, never, HttpClient.HttpClient> {
    return Effect.map(
      this.#newest(agentId, callId, before, cut),
      (answer): AgentOlderAnswer | Failed =>
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
      ? hostedCall(this.#hosted.messages.agentNewest, { id: agentId, ...page })
      : hostedCall(this.#hosted.messages.agentWorkerNewest, { id: agentId, call: callId, ...page });
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
  ): Effect.Effect<AgentPartView, never, HttpClient.HttpClient> {
    const part = { id: agentId, message: messageId, index: String(index) };
    return callId === undefined
      ? hostedCall(this.#hosted.messages.agentPart, part)
      : hostedCall(this.#hosted.messages.agentWorkerPart, { ...part, call: callId });
  }

  /**
   * Sends one agent a message under the key the window made for the send,
   * which a retry carries again, and answers the agent as it then stands,
   * which is running; a message the service would refuse by shape is
   * refused here without traveling.
   */
  message(
    agentId: string,
    request: AgentMessageRequest,
  ): Effect.Effect<AgentMessageAnswerView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(agentMessageRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedCall(
      this.#hosted.messages.send,
      { params: { id: agentId }, body: admitted },
      { deadline: HOSTED_DEADLINE.STEER },
    );
  }

  /** Changes one agent's queue of messages waiting behind its turn, answering the queue as it then stands; a change the service would refuse by shape is refused here without traveling. */
  changeQueue(
    agentId: string,
    change: AgentQueueChange,
  ): Effect.Effect<AgentQueueAnswerView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(agentQueueChangeSchema)(change));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedCall(
      this.#hosted.messages.queue,
      { params: { id: agentId }, body: admitted },
      { deadline: HOSTED_DEADLINE.STEER },
    );
  }

  /** Changes one agent's model and effort for its next step, answering it as it then stands; a choice the service would refuse by shape is refused here without traveling. */
  choose(
    agentId: string,
    choice: ModelChoice,
  ): Effect.Effect<AgentAgentAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(modelChoiceSchema)(choice));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.map(
      hostedCall(
        this.#hosted.agents.change,
        { params: { id: agentId }, body: admitted },
        { as: AGENT_CHOOSE_RENAMES },
      ),
      unansweredBare,
    );
  }

  /** Renames one agent, or clears its title with an empty one, under the idempotency key given where one is, answering it as it then stands; a title past the bound is refused here without traveling. */
  rename(
    agentId: string,
    request: AgentRenameRequest,
    key?: string,
  ): Effect.Effect<AgentAgentAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(agentRenameRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.map(
      hostedCall(
        this.#hosted.agents.change,
        { params: { id: agentId }, body: admitted },
        { as: AGENT_NOT_FOUND_RENAMES, ...keyed(key) },
      ),
      rowWritten,
    );
  }

  /** Switches one agent's MCP servers for its next turn on, the whole list of those off, answering it as it then stands; a list past the bound is refused here without traveling. */
  switchServers(
    agentId: string,
    request: AgentServersRequest,
  ): Effect.Effect<AgentAgentAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(agentServersRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.map(
      hostedCall(
        this.#hosted.agents.change,
        { params: { id: agentId }, body: admitted },
        { as: AGENT_NOT_FOUND_RENAMES },
      ),
      rowWritten,
    );
  }

  /** Adds a repository to one agent beside the ones it works in, answering it as it then stands; a repository refused by shape is refused here without traveling. */
  addRepository(
    agentId: string,
    request: AgentAddRepositoryRequest,
  ): Effect.Effect<AgentAgentAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(agentAddRepositoryRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.map(
      hostedCall(
        this.#hosted.agents.change,
        { params: { id: agentId }, body: admitted },
        { as: AGENT_ADD_REPOSITORY_RENAMES },
      ),
      (answer) => extraRepositoryWhyLeftOut(unansweredBare(answer)),
    );
  }

  /** Archives one agent, stopping a turn it still runs first, or brings it back, answering it as it then stands. */
  archive(
    agentId: string,
    request: AgentArchiveRequest,
  ): Effect.Effect<AgentAgentAnswer, never, HttpClient.HttpClient> {
    return Effect.map(
      hostedCall(
        this.#hosted.agents.change,
        { params: { id: agentId }, body: { archived: request.archived } },
        { as: AGENT_ARCHIVE_RENAMES },
      ),
      unansweredBare,
    );
  }

  /** Pins one agent for the account alone, or unpins it, under the idempotency key given where one is, answering it as it then stands. */
  pin(
    agentId: string,
    request: AgentPinRequest,
    key?: string,
  ): Effect.Effect<AgentAgentAnswer, never, HttpClient.HttpClient> {
    const body =
      request.position === undefined
        ? { pinned: request.pinned }
        : { pinned: request.pinned, position: request.position };
    return Effect.map(
      hostedCall(
        this.#hosted.agents.change,
        { params: { id: agentId }, body },
        { as: AGENT_NOT_FOUND_RENAMES, ...keyed(key) },
      ),
      rowWritten,
    );
  }

  /** Moves the account's own read mark of one agent (`read-mark.ts`), under the idempotency key given where one is, answering it as it then stands. */
  markRead(
    agentId: string,
    request: AgentReadRequest,
    key?: string,
  ): Effect.Effect<AgentAgentAnswer, never, HttpClient.HttpClient> {
    return Effect.map(
      hostedCall(
        this.#hosted.agents.change,
        { params: { id: agentId }, body: { readMark: request.readMark } },
        { as: AGENT_NOT_FOUND_RENAMES, ...keyed(key) },
      ),
      rowWritten,
    );
  }

  /** Deletes one agent for good, a turn it still runs stopped first; that it was, or why not: gone already, or one still starting with no turn to stop yet. */
  delete(agentId: string): Effect.Effect<AgentDeleteAnswerView, never, HttpClient.HttpClient> {
    return Effect.map(
      hostedCall(this.#hosted.agents.delete, { id: agentId }, { as: AGENT_DELETE_RENAMES }),
      unansweredBare,
    );
  }

  /** Stops one agent, answering it as it then stands. */
  stop(agentId: string): Effect.Effect<AgentAgentAnswer, never, HttpClient.HttpClient> {
    return Effect.map(
      hostedCall(this.#hosted.agents.stop, { id: agentId }, { as: AGENT_NOT_FOUND_RENAMES }),
      unansweredBare,
    );
  }

  /** Keeps one agent on screen warm for the next message (`agentWarmAnswerSchema`). */
  warm(agentId: string): Effect.Effect<AgentWarmAnswerView, never, HttpClient.HttpClient> {
    return hostedCall(this.#hosted.agents.warm, { id: agentId });
  }

  /** Takes one agent back to just before one of the developer's lines, stopping it first where it still works, answering it as it then stands. */
  rewind(
    agentId: string,
    messageId: string,
  ): Effect.Effect<AgentAgentAnswer, never, HttpClient.HttpClient> {
    return hostedCall(
      this.#hosted.agents.rewind,
      { params: { id: agentId }, body: { messageId } },
      { as: AGENT_NOT_FOUND_RENAMES, deadline: HOSTED_DEADLINE.STEER },
    );
  }

  /** One agent read whole as its own page by its id, on a task or with none. */
  agent(agentId: string): Effect.Effect<AgentPageAnswerView, never, HttpClient.HttpClient> {
    return hostedCall(this.#hosted.agents.read, { id: agentId });
  }

  /** What one agent published: the branch it pushed and the pull request from it, as GitHub holds them now. */
  pullRequest(
    agentId: string,
    number?: number,
  ): Effect.Effect<AgentPullRequestAnswerView, never, HttpClient.HttpClient> {
    return Effect.map(
      hostedCall(this.#hosted.agentPullRequests.pullRequest, pullRequestRead(agentId, number), {
        as: AGENT_NOT_FOUND_RENAMES,
      }),
      unansweredBare,
    );
  }

  /** One agent's changes: the files of its pull request as GitHub holds them now. */
  changes(
    agentId: string,
    number?: number,
  ): Effect.Effect<AgentChangesAnswerView, never, HttpClient.HttpClient> {
    return Effect.map(
      hostedCall(
        this.#hosted.agents.changes,
        { id: agentId, ...(number === undefined ? undefined : { number: String(number) }) },
        { as: AGENT_NOT_FOUND_RENAMES },
      ),
      unansweredBare,
    );
  }

  /** One agent's pull request itself as its overview draws it: its description, branches, mergeability, and people as GitHub holds them now. */
  overviewPullRequest(
    agentId: string,
    number?: number,
  ): Effect.Effect<AgentOverviewPullRequestAnswerView, never, HttpClient.HttpClient> {
    return Effect.map(
      hostedCall(
        this.#hosted.agentPullRequests.overviewPullRequest,
        pullRequestRead(agentId, number),
        { as: AGENT_NOT_FOUND_RENAMES },
      ),
      unansweredBare,
    );
  }

  /** Which of our own tools one agent is offered, and whether its `run_on_mac` would run now. */
  workspaceTools(
    agentId: string,
  ): Effect.Effect<AgentWorkspaceToolsAnswerView, never, HttpClient.HttpClient> {
    return hostedCall(this.#hosted.agents.workspaceTools, { id: agentId });
  }

  /** What the reviewer and label pickers of one agent's Pull request tab offer: its repository's labels, assignable users, and teams as GitHub holds them now. */
  reviewOptions(
    agentId: string,
  ): Effect.Effect<AgentReviewOptionsAnswerView, never, HttpClient.HttpClient> {
    return Effect.map(
      hostedCall(
        this.#hosted.agents.reviewOptions,
        { id: agentId },
        { as: AGENT_NOT_FOUND_RENAMES },
      ),
      unansweredBare,
    );
  }

  /** One agent's pull request's chapters generated for its head now, or the generation already under way, answered as a read of them is; held for as long as a generation may take. */
  generateChapters(
    agentId: string,
    number?: number,
  ): Effect.Effect<PullRequestChaptersAnswerView, never, HttpClient.HttpClient> {
    return Effect.map(
      hostedCall(
        this.#hosted.pullRequestChapters.generate,
        {
          params: { id: agentId },
          ...(number === undefined ? undefined : { query: { number: String(number) } }),
        },
        { as: PULL_REQUEST_CHAPTERS_RENAMES, deadline: HOSTED_DEADLINE.CHAPTERS },
      ),
      reachUnsaid,
    );
  }

  /** The checks on one agent's pull request's head as GitHub holds them now. */
  overviewChecks(
    agentId: string,
    number?: number,
  ): Effect.Effect<AgentOverviewChecksAnswerView, never, HttpClient.HttpClient> {
    return Effect.map(
      hostedCall(this.#hosted.agentPullRequests.overviewChecks, pullRequestRead(agentId, number), {
        as: AGENT_NOT_FOUND_RENAMES,
      }),
      unansweredBare,
    );
  }

  /** One agent's pull request's conversation and where its reviewers stand, as GitHub holds them now. */
  overviewConversation(
    agentId: string,
    number?: number,
  ): Effect.Effect<AgentOverviewConversationAnswerView, never, HttpClient.HttpClient> {
    return Effect.map(
      hostedCall(
        this.#hosted.agentPullRequests.overviewConversation,
        pullRequestRead(agentId, number),
        { as: AGENT_NOT_FOUND_RENAMES },
      ),
      unansweredBare,
    );
  }

  /**
   * One picture a tool answered an agent, or one of its workers where
   * `callId` names the delegation call, or one file of a message queued for
   * the agent, fetched under the account: its bytes in base64 under the media
   * type the service kept or the file travels as, as an inbox file is; not
   * found where the agent is not one the account reaches or it keeps no such
   * picture or file; unanswered for anything else.
   */
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
          return Effect.map(jsonOf(answer.response), (body) => servedRefusal(unparsedWire(body)));
        }
        return readInboxFile(answer.response);
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
  ): Effect.Effect<AgentPullRequestWriteAnswerView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(pullRequestActionRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    const read = pullRequestRead(agentId, number);
    return Effect.map(
      hostedCall(
        this.#hosted.agentPullRequests.action,
        {
          params: { id: read.id },
          ...(read.number === undefined ? undefined : { query: { number: read.number } }),
          body: admitted,
        },
        { as: AGENT_NOT_FOUND_RENAMES },
      ),
      unansweredBare,
    );
  }

  /** Which of the agent's pull request's files the member marked viewed on GitHub, read on their own sign-in. */
  pullRequestViewed(
    agentId: string,
    number?: number,
  ): Effect.Effect<AgentPullRequestViewedAnswerView, never, HttpClient.HttpClient> {
    return Effect.map(
      hostedCall(this.#hosted.agentPullRequests.viewed, pullRequestRead(agentId, number), {
        as: AGENT_NOT_FOUND_RENAMES,
      }),
      unansweredBare,
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
  ): Effect.Effect<AgentGitHubImageView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.GET, path: agentGitHubImagePath(agentId, src) }),
      (answer): Effect.Effect<AgentGitHubImageView> => {
        if (!callAnswered(answer)) return Effect.succeed(unansweredCall(answer));
        if (!answer.response.ok) {
          return Effect.map(jsonOf(answer.response), (body) => servedRefusal(unparsedWire(body)));
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
  ): Effect.Effect<AgentInboxAttachmentView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.GET, path: inboxAttachmentPath(itemId, attachmentId) }),
      (answer): Effect.Effect<AgentInboxAttachmentView> => {
        if (!callAnswered(answer)) return Effect.succeed(unansweredCall(answer));
        if (!answer.response.ok) {
          return Effect.map(jsonOf(answer.response), (body) => servedRefusal(unparsedWire(body)));
        }
        return readInboxFile(answer.response);
      },
    );
  }

  /**
   * Acknowledges one notice of the inbox, Got it, against the revision the
   * window drew, under the key the window made for the nod, which a retry
   * carries again; sent under the idempotency key given where one is. It
   * answers the item as it then stands with whether the nod was taken; a
   * nod the service would refuse by shape is refused here without
   * traveling.
   */
  answerInbox(
    itemId: string,
    request: InboxAcknowledgeRequest,
    key?: string,
  ): Effect.Effect<AgentInboxAnsweredView, never, HttpClient.HttpClient> {
    const body = wireRequestOf(inboxAcknowledgeRequestSchema, request);
    if (body === undefined) return Effect.succeed(UNANSWERED);
    return Effect.map(
      hostedCall(
        this.#hosted.inbox.answer,
        { params: { id: itemId }, body },
        inboxWrite(HOSTED_DEADLINE.STEER, key),
      ),
      writtenAlreadyKept,
    );
  }

  /**
   * Closes one open item of the inbox without an answer, against the
   * revision the window drew, under the key the window made for the close,
   * which a retry carries again; sent under the idempotency key given where
   * one is. It answers the item as it then stands with whether the close
   * was taken, as an answer does.
   */
  closeInbox(
    itemId: string,
    request: InboxCloseRequest,
    key?: string,
  ): Effect.Effect<AgentInboxAnsweredView, never, HttpClient.HttpClient> {
    const body = wireRequestOf(inboxCloseRequestSchema, request);
    if (body === undefined) return Effect.succeed(UNANSWERED);
    return Effect.map(
      hostedCall(
        this.#hosted.inbox.close,
        { params: { id: itemId }, body },
        inboxWrite(HOSTED_DEADLINE.STEER, key),
      ),
      writtenAlreadyKept,
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
  ): Effect.Effect<AgentInboxMessagedView, never, HttpClient.HttpClient> {
    const body = wireRequestOf(inboxMessageRequestSchema, request);
    if (body === undefined) return Effect.succeed(UNANSWERED);
    return hostedCall(
      this.#hosted.inbox.message,
      { params: { id: itemId }, body },
      { deadline: HOSTED_DEADLINE.STEER },
    );
  }

  /**
   * A thread the account starts with one agent, as a new mail is written:
   * the thread as it then stands, its first message on it, where the
   * service wrote it and handed it to the agent; the refusals a message to
   * the agent answers with otherwise, since it reaches the agent as one.
   */
  startInboxThread(
    request: InboxStartRequest,
  ): Effect.Effect<AgentInboxMessagedView, never, HttpClient.HttpClient> {
    const body = wireRequestOf(inboxStartRequestSchema, request);
    if (body === undefined) return Effect.succeed(UNANSWERED);
    return hostedCall(this.#hosted.inbox.start, body, { deadline: HOSTED_DEADLINE.STEER });
  }

  /** Where one item stands, its agent, task, and workspace, as a link naming it by its id alone is opened; not found where the item is not one the account may read. */
  inboxItemHome(
    itemId: string,
  ): Effect.Effect<AgentInboxItemHomeView, never, HttpClient.HttpClient> {
    return hostedCall(this.#hosted.inbox.home, { id: itemId });
  }

  /**
   * One item marked read for the account, as opening it does: its id and
   * its read state; not found where the item is not one the account
   * reaches. Marking an item read that is read already changes nothing, so
   * the window may ask on every open. Sent under the idempotency key given
   * where one is.
   */
  markInboxItemRead(
    itemId: string,
    key?: string,
  ): Effect.Effect<AgentInboxReadStateView, never, HttpClient.HttpClient> {
    return Effect.map(
      hostedCall(
        this.#hosted.inbox.markItemRead,
        { id: itemId },
        inboxWrite(HOSTED_DEADLINE.USUAL, key),
      ),
      writtenAlreadyKept,
    );
  }

  /** One item marked unread for the account until it reads the item again, under the idempotency key given where one is: its id and its read state; not found where the item is not one the account reaches. */
  markInboxItemUnread(
    itemId: string,
    key?: string,
  ): Effect.Effect<AgentInboxReadStateView, never, HttpClient.HttpClient> {
    return Effect.map(
      hostedCall(
        this.#hosted.inbox.markItemUnread,
        { id: itemId },
        inboxWrite(HOSTED_DEADLINE.USUAL, key),
      ),
      writtenAlreadyKept,
    );
  }

  /** One item's reminder set for the account for `until`, in epoch milliseconds, or canceled where `until` is null, whether it is read standing as it was, under the idempotency key given where one is: its id and its read state; not found where the item is not one the account reaches. */
  remindInboxItem(
    itemId: string,
    until: number | null,
    key?: string,
  ): Effect.Effect<AgentInboxReadStateView, never, HttpClient.HttpClient> {
    return Effect.map(
      hostedCall(
        this.#hosted.inbox.remindItem,
        { params: { id: itemId }, body: { until } },
        inboxWrite(HOSTED_DEADLINE.USUAL, key),
      ),
      writtenAlreadyKept,
    );
  }

  /**
   * Every item the account's Inbox lists marked read for it, open or
   * settled, in the one workspace the request names or in all of its
   * workspaces, under the idempotency key given where one is: how many were
   * unread. It clears the unread dots alone; an item still waiting on an
   * answer still waits.
   */
  markInboxRead(
    request: InboxReadAllRequest = {},
    key?: string,
  ): Effect.Effect<AgentInboxReadAllView, never, HttpClient.HttpClient> {
    const body = wireRequestOf(inboxReadAllRequestSchema, request);
    if (body === undefined) return Effect.succeed(UNANSWERED);
    return Effect.map(
      hostedCall(this.#hosted.inbox.markAllRead, body, inboxWrite(HOSTED_DEADLINE.USUAL, key)),
      writtenAlreadyKept,
    );
  }
}
