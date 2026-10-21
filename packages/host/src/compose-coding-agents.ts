import type { HostedCodingAgentClient } from "@luke/features";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAccountInboxAnswerView,
  type CodingAgentAgentAnswer,
  type CodingAgentCallsAnswerView,
  type CodingAgentChangesAnswerView,
  type CodingAgentChatAnswerView,
  type CodingAgentChatWriteAnswerView,
  type CodingAgentDefaultAnswer,
  type CodingAgentDeleteAnswerView,
  type CodingAgentGitHubImageView,
  type CodingAgentInboxAnsweredView,
  type CodingAgentInboxAttachmentView,
  type CodingAgentInboxChanged,
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
  type CodingAgentPartView,
  type CodingAgentPullRequestAnswerView,
  type CodingAgentPullRequestViewedAnswerView,
  type CodingAgentPullRequestWriteAnswerView,
  type CodingAgentReviewOptionsAnswerView,
  codingAgentArchiveParamsSchema,
  codingAgentChatAttachmentParamsSchema,
  codingAgentChatFollowParamsSchema,
  codingAgentChatPostParamsSchema,
  codingAgentChooseParamsSchema,
  codingAgentDefaultWriteParamsSchema,
  codingAgentGitHubImageParamsSchema,
  codingAgentInboxAnswerParamsSchema,
  codingAgentInboxAttachmentParamsSchema,
  codingAgentInboxCloseParamsSchema,
  codingAgentInboxMessageParamsSchema,
  codingAgentInboxReadStateParamsSchema,
  codingAgentInboxScopeSchema,
  codingAgentListParamsSchema,
  codingAgentMessageParamsSchema,
  codingAgentMessagesParamsSchema,
  codingAgentPageParamsSchema,
  codingAgentPartParamsSchema,
  codingAgentPictureParamsSchema,
  codingAgentPinParamsSchema,
  codingAgentPullRequestActionParamsSchema,
  codingAgentPullRequestParamsSchema,
  codingAgentPullRequestReadParamsSchema,
  codingAgentRenameParamsSchema,
  codingAgentServersParamsSchema,
  codingAgentStartParamsSchema,
  codingAgentStopParamsSchema,
  codingAgentTranscriptKeySchema,
  codingAgentWorkspaceListParamsSchema,
  type DictationTranscribeAnswerView,
  dictationTranscribeParamsSchema,
  type GitHubTokenAnswerView,
  githubTokenSaveParamsSchema,
  INBOX_SCOPE_KIND,
  type PlanTemplateAnswerView,
  type PlanTemplateRevisionAnswerView,
  type PlanTemplateRevisionsAnswerView,
  type ProviderKeysAnswerView,
  planTemplateRevisionParamsSchema,
  planTemplateRevisionsParamsSchema,
  planTemplateWriteParamsSchema,
  providerKeyForAgentsParamsSchema,
  providerKeyRemoveParamsSchema,
  providerKeySaveParamsSchema,
  TRANSCRIPT_KIND,
} from "@luke/features/coding-agent-view";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import { inboxReadAllRequestSchema } from "@luke/features/inbox-wire";
import { LIVE_SIGNED_OUT } from "@luke/features/live-wire";
import {
  type ChaptersModelAnswerView,
  chaptersModelWriteParamsSchema,
  type PullRequestChaptersAnswerView,
  pullRequestChaptersParamsSchema,
} from "@luke/features/pull-request-chapters-view";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  invalid,
} from "@luke/gateway";
import { unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, FiberHandle, FiberMap, RcMap, Result, type Schema, type Scope } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { type AccountInboxes, accountInboxes, followAccountInbox } from "./account-inbox-follow.js";
import { followWorkspaceChat } from "./chat-follow.js";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { HostKernel } from "./host-kernel.js";
import { type LiveClient, openRealtimeClient } from "./live-follow.js";
import type { RunMode } from "./run-mode.js";
import {
  followInbox,
  InboxScopeKey,
  type ScopeInboxes,
  scopeInboxes,
} from "./scope-inbox-follow.js";
import {
  followTranscript,
  type TranscriptFollows,
  TranscriptKey,
  transcriptFollows,
  windowsPage,
} from "./transcript-follow.js";

/**
 * compose-coding-agents.ts -- a task's coding agents, asked of the service on the window's behalf: the models, the account's default, its own provider keys, and its plan template, the agents, one started, one's transcript, one messaged, one's model changed, one stopped, what one published, a clip dictated into an agent's box heard as words, the task's inbox, one item of it answered, what waits across the account, and the workspace's chat, read and written.
 *
 * Nothing is held here but the transcripts' subscriptions, the followed
 * inboxes' (`scope-inbox-follow.ts`), heard as `INBOX_CHANGED` events, and
 * each followed workspace chat's (`chat-follow.ts`), heard as `CHAT_CHANGED`
 * events. The window holds the agents it draws and the cursor it reads
 * from, asks when a task opens, when it starts or stops an agent, and while
 * an agent's tab shows its running transcript, and every ask is one call of
 * the service answered whole. The transcript read is held open here while
 * the agent runs and nothing new stands, on a Neon Realtime subscription to
 * what its pages are read from (`transcript-follow.ts`), which a sign-out
 * lets go. What waits across the account is followed the same way, on the
 * account's own subscription (`account-inbox-follow.ts`), heard as
 * `ACCOUNT_INBOX_CHANGED` events by main's notices rather than a window
 * (`agent-notices.ts`). Behind a
 * closed account gate, or on a run that sends nothing, every ask answers
 * unanswered. A provider key passes through on its way to the service and
 * is held nowhere here; no answer carries one back.
 */

/** The service's side of the agents, as this concern asks it. */
export type CodingAgentClient = Pick<
  HostedCodingAgentClient,
  | "chapters"
  | "generateChapters"
  | "readChaptersModel"
  | "writeChaptersModel"
  | "models"
  | "readDefault"
  | "writeDefault"
  | "list"
  | "listWorkspace"
  | "start"
  | "startFrom"
  | "messagesNow"
  | "agentPart"
  | "agentTranscriptLive"
  | "message"
  | "choose"
  | "rename"
  | "switchServers"
  | "archive"
  | "pin"
  | "stop"
  | "delete"
  | "agent"
  | "calls"
  | "pullRequest"
  | "changes"
  | "overviewPullRequest"
  | "reviewOptions"
  | "overviewChecks"
  | "overviewConversation"
  | "githubImage"
  | "pullRequestAction"
  | "pullRequestViewed"
  | "readProviderKeys"
  | "saveProviderKey"
  | "removeProviderKey"
  | "setProviderKeyForAgents"
  | "readGitHubToken"
  | "saveGitHubToken"
  | "removeGitHubToken"
  | "readPlanTemplate"
  | "writePlanTemplate"
  | "readPlanTemplateRevisions"
  | "readPlanTemplateRevision"
  | "restorePlanTemplate"
  | "transcribeDictation"
  | "answerInbox"
  | "closeInbox"
  | "messageInbox"
  | "markInboxItemRead"
  | "markInboxItemUnread"
  | "markInboxRead"
  | "taskInboxLive"
  | "agentInboxLive"
  | "accountInboxLive"
  | "inboxAttachment"
  | "agentPicture"
  | "chatPost"
  | "chatJoin"
  | "workspaceChatLive"
  | "chatAttachment"
>;

export interface CodingAgentsDependencies {
  kernel: Pick<HostKernel, "emit" | "now"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  client: CodingAgentClient;
  /** The account signed in now, by its id, which every live read names; none where nobody is. */
  accountId: () => string | undefined;
  /** Realtime's client at an address, which a transcript and every plan's and agent's inbox are followed over; Realtime's own outside a test. */
  openLive?: (url: string) => LiveClient | PromiseLike<LiveClient>;
  /**
   * Hands a line typed to an agent to the call standing on that agent, where
   * one does (`LiveSessionHolder.typeLine`); answers whether the call took
   * it. None where this Mac holds no calls, and every line steers.
   */
  typeIntoCall?: (agentId: string, text: string, clientKey: string) => boolean;
}

export interface CodingAgentsComposer extends Composer {
  /** Every transcript's, every plan's and agent's inbox's, and the account inbox's subscription let go, as a sign-out lets them go. */
  readonly reset: Effect.Effect<void>;
  /**
   * The task an agent is on, as the service reads it now, which a call into
   * the agent is checked against: null for an agent on no task, and none
   * for one archived, or that the account does not reach or could not read.
   */
  readonly agentTaskOf: (agentId: string) => Effect.Effect<string | null | undefined>;
}

const UNANSWERED = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

/** Whether the service may be asked now: a run that sends, behind an open account gate. */
function gateOf({ kernel, account }: CodingAgentsDependencies): () => boolean {
  return () => kernel.runMode.sendsNetwork && account.capabilitiesActive();
}

/** The service asked behind the gate, over the host's own HTTP client. */
function askedOf(dependencies: CodingAgentsDependencies, http: HttpClient.HttpClient) {
  const gate = gateOf(dependencies);
  return <Answer>(
    call: Effect.Effect<Answer, never, HttpClient.HttpClient>,
  ): Effect.Effect<Answer | typeof UNANSWERED> =>
    gate() ? Effect.provideService(call, HttpClient.HttpClient, http) : Effect.succeed(UNANSWERED);
}

export function composeCodingAgents(
  dependencies: CodingAgentsDependencies,
): Effect.Effect<CodingAgentsComposer, never, Scope.Scope | HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const asked = askedOf(dependencies, http);
    const { client } = dependencies;
    const transcripts = yield* transcriptFollows({
      seal: (key, poll, userId, after) =>
        asked(
          dependencies.client.agentTranscriptLive(key.agentId, userId, key.callId, poll, after),
        ),
      accountId: dependencies.accountId,
      openLive: dependencies.openLive ?? openRealtimeClient,
      now: dependencies.kernel.now,
    });
    const followed = yield* FiberMap.make<TranscriptKey>();
    const inboxes = yield* scopeInboxes({
      seal: (scope, poll, userId, after) =>
        asked(
          scope.kind === INBOX_SCOPE_KIND.PLAN
            ? client.taskInboxLive(scope.id, userId, poll, after)
            : client.agentInboxLive(scope.id, userId, poll, after),
        ),
      accountId: dependencies.accountId,
      openLive: dependencies.openLive ?? openRealtimeClient,
      now: dependencies.kernel.now,
    });
    const accounts = yield* accountInboxes({
      seal: (userId, poll, after) => asked(client.accountInboxLive(userId, poll, after)),
      openLive: dependencies.openLive ?? openRealtimeClient,
      now: dependencies.kernel.now,
    });
    const chats = yield* FiberMap.make<string>();
    const inboxFollows = yield* FiberMap.make<InboxScopeKey>();
    const accountFollow = yield* FiberHandle.make();
    return composed(
      dependencies,
      http,
      transcripts,
      followed,
      { inboxes, followed: inboxFollows },
      chats,
      { accounts, followed: accountFollow },
    );
  });
}

/** The scopes' subscriptions the windows share, and the follows main asked for, one fiber per scope. */
interface ScopeFollows {
  readonly inboxes: ScopeInboxes;
  readonly followed: FiberMap.FiberMap<InboxScopeKey>;
}

/** The account's subscriptions, and the one follow main asked for. */
interface AccountFollow {
  readonly accounts: AccountInboxes;
  readonly followed: FiberHandle.FiberHandle;
}

/** The composer's one table, built from its seams; nothing here starts anything but a transcript's or a scope's inbox subscription, while a window reads it. */
function composed(
  dependencies: CodingAgentsDependencies,
  http: HttpClient.HttpClient,
  transcripts: TranscriptFollows,
  /** The transcripts main follows for its windows, one fiber each. */
  followed: FiberMap.FiberMap<TranscriptKey>,
  { inboxes, followed: inboxFollows }: ScopeFollows,
  /** Each workspace's chat main follows for its windows, one fiber each. */
  chats: FiberMap.FiberMap<string>,
  /** What waits across the account, and main's one follow of it. */
  { accounts, followed: accountFollow }: AccountFollow,
): CodingAgentsComposer {
  const { client, kernel } = dependencies;
  const gate = gateOf(dependencies);
  const asked = askedOf(dependencies, http);

  /**
   * The agent as a line handed to its call leaves it, as a message's answer
   * carries it: read whole and answered as its summary, running, as a steer's
   * answer is read after the message was taken. The call writes and asks the
   * line a moment after the frame leaves, so a read now could still say the
   * agent is idle; the transcript's follow settles the status from there.
   */
  const agentAsItStands = (agentId: string): Effect.Effect<CodingAgentAgentAnswer> =>
    Effect.map(asked(client.agent(agentId)), (answer) => {
      if ("failure" in answer) return answer;
      const {
        automationId: _automation,
        origin: _origin,
        workspaceId: _workspace,
        repository: _repository,
        ...agent
      } = answer.agent;
      return { agent: { ...agent, status: CODING_AGENT_STATUS.RUNNING } };
    });

  /** A workspace's chat sealed for the account a follow started for, as every renewal of it names; signed out where none was. */
  const chatLiveFor =
    (workspaceId: string, userId: string | undefined) => (poll: boolean, after?: string) =>
      userId === undefined
        ? Effect.succeed(LIVE_SIGNED_OUT)
        : asked(client.workspaceChatLive(workspaceId, userId, poll, after));

  /** The params read against the method's own schema, or the invalid-params refusal worded. */
  const read = <Params>(
    schema: Schema.Codec<Params, unknown>,
    params: Parameters<GatewayMethodTable[keyof GatewayMethodTable] & object>[0],
    sentence: string,
  ) => {
    const result = readEither(schema)(unparsedWire(params));
    return Result.isFailure(result) ? invalid(sentence) : Effect.succeed(result.success);
  };

  /** The agent's or worker's transcript a follow names, and the key its subscription and follow are held under. */
  const agentTranscriptOf = (
    params: Parameters<GatewayMethodTable[keyof GatewayMethodTable] & object>[0],
  ) =>
    Effect.gen(function* () {
      const sentence = "following a transcript names an agent, and a worker's call where it is one";
      const transcript = yield* read(codingAgentTranscriptKeySchema, params, sentence);
      if (transcript.kind !== TRANSCRIPT_KIND.AGENT) return yield* invalid(sentence);
      return {
        transcript,
        key: new TranscriptKey({ agentId: transcript.agentId, callId: transcript.callId }),
      };
    });

  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.CODING_AGENTS_MODELS]: () =>
      Effect.map(asked(client.models()), (answer) => carried<CodingAgentModelsAnswer>(answer)),
    [GATEWAY_METHOD.CODING_AGENTS_DEFAULT_READ]: () =>
      Effect.map(asked(client.readDefault()), (answer) =>
        carried<CodingAgentDefaultAnswer>(answer),
      ),
    [GATEWAY_METHOD.CODING_AGENTS_DEFAULT_WRITE]: (params) =>
      Effect.gen(function* () {
        const choice = yield* read(
          codingAgentDefaultWriteParamsSchema,
          params,
          "the default names a model and its effort",
        );
        const answer = yield* asked(client.writeDefault(choice));
        return carried<CodingAgentDefaultAnswer>(answer);
      }),
    [GATEWAY_METHOD.PROVIDER_KEYS_READ]: () =>
      Effect.map(asked(client.readProviderKeys()), (answer) =>
        carried<ProviderKeysAnswerView>(answer),
      ),
    [GATEWAY_METHOD.PROVIDER_KEYS_SAVE]: (params) =>
      Effect.gen(function* () {
        // Note that the sentence names the shape and never the value, because the value is a key.
        const save = yield* read(
          providerKeySaveParamsSchema,
          params,
          "a save names a provider and a key",
        );
        const answer = yield* asked(client.saveProviderKey(save));
        return carried<ProviderKeysAnswerView>(answer);
      }),
    [GATEWAY_METHOD.PLAN_TEMPLATE_READ]: () =>
      Effect.map(asked(client.readPlanTemplate()), (answer) =>
        carried<PlanTemplateAnswerView>(answer),
      ),
    [GATEWAY_METHOD.PLAN_TEMPLATE_WRITE]: (params) =>
      Effect.gen(function* () {
        const write = yield* read(
          planTemplateWriteParamsSchema,
          params,
          "a template write names a template within the bound, or null for the default",
        );
        const answer = yield* asked(client.writePlanTemplate(write));
        return carried<PlanTemplateAnswerView>(answer);
      }),
    [GATEWAY_METHOD.PLAN_TEMPLATE_REVISIONS]: (params) =>
      Effect.gen(function* () {
        const page = yield* read(
          planTemplateRevisionsParamsSchema,
          params,
          "a page of the template's history names the revision it is read before, or none",
        );
        const answer = yield* asked(client.readPlanTemplateRevisions(page));
        return carried<PlanTemplateRevisionsAnswerView>(answer);
      }),
    [GATEWAY_METHOD.PLAN_TEMPLATE_REVISION]: (params) =>
      Effect.gen(function* () {
        const revision = yield* read(
          planTemplateRevisionParamsSchema,
          params,
          "a revision of the template names its number",
        );
        const answer = yield* asked(client.readPlanTemplateRevision(revision));
        return carried<PlanTemplateRevisionAnswerView>(answer);
      }),
    [GATEWAY_METHOD.PLAN_TEMPLATE_RESTORE]: (params) =>
      Effect.gen(function* () {
        const revision = yield* read(
          planTemplateRevisionParamsSchema,
          params,
          "a restore of the template names the revision it brings back",
        );
        const answer = yield* asked(client.restorePlanTemplate(revision));
        return carried<PlanTemplateAnswerView>(answer);
      }),
    [GATEWAY_METHOD.DICTATION_TRANSCRIBE]: (params) =>
      Effect.gen(function* () {
        // Note that the sentence names the shape and never the words, because they are the developer's voice.
        const clip = yield* read(
          dictationTranscribeParamsSchema,
          params,
          "a clip names its audio, its length, and its words",
        );
        const answer = yield* asked(client.transcribeDictation(clip));
        return carried<DictationTranscribeAnswerView>(answer);
      }),
    [GATEWAY_METHOD.PROVIDER_KEYS_REMOVE]: (params) =>
      Effect.gen(function* () {
        const removal = yield* read(
          providerKeyRemoveParamsSchema,
          params,
          "a removal names a provider",
        );
        const answer = yield* asked(client.removeProviderKey(removal));
        return carried<ProviderKeysAnswerView>(answer);
      }),
    [GATEWAY_METHOD.PROVIDER_KEYS_FOR_AGENTS]: (params) =>
      Effect.gen(function* () {
        const change = yield* read(
          providerKeyForAgentsParamsSchema,
          params,
          "a default names a provider, a plan, and on or off",
        );
        const answer = yield* asked(client.setProviderKeyForAgents(change));
        return carried<ProviderKeysAnswerView>(answer);
      }),
    [GATEWAY_METHOD.GITHUB_TOKEN_READ]: () =>
      Effect.map(asked(client.readGitHubToken()), (answer) =>
        carried<GitHubTokenAnswerView>(answer),
      ),
    [GATEWAY_METHOD.GITHUB_TOKEN_SAVE]: (params) =>
      Effect.gen(function* () {
        // Note that the sentence names the shape and never the value, because the value is a token.
        const save = yield* read(githubTokenSaveParamsSchema, params, "a save names a token");
        const answer = yield* asked(client.saveGitHubToken(save));
        return carried<GitHubTokenAnswerView>(answer);
      }),
    [GATEWAY_METHOD.GITHUB_TOKEN_REMOVE]: () =>
      Effect.map(asked(client.removeGitHubToken()), (answer) =>
        carried<GitHubTokenAnswerView>(answer),
      ),
    [GATEWAY_METHOD.CODING_AGENTS_LIST]: (params) =>
      Effect.gen(function* () {
        const { taskId, includeArchived } = yield* read(
          codingAgentListParamsSchema,
          params,
          "listing a task's agents names one task",
        );
        const answer = yield* asked(client.list(taskId, includeArchived));
        return carried<CodingAgentListAnswer>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_WORKSPACE_LIST]: (params) =>
      Effect.gen(function* () {
        const listed = yield* read(
          codingAgentWorkspaceListParamsSchema,
          params,
          "listing a workspace's agents names one workspace",
        );
        return carried<CodingAgentListAnswer>(yield* asked(client.listWorkspace(listed)));
      }),
    [GATEWAY_METHOD.CODING_AGENTS_START]: (params) =>
      Effect.gen(function* () {
        const { taskId, ...request } = yield* read(
          codingAgentStartParamsSchema,
          params,
          "starting an agent names a task or an agent to start from, and the press's own key",
        );
        // A Start from another agent that names no task goes where that agent is, its task or its workspace.
        const answer = yield* asked(
          taskId === undefined ? client.startFrom(request) : client.start(taskId, request),
        );
        return carried<CodingAgentAgentAnswer>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_MESSAGES]: (params) =>
      Effect.gen(function* () {
        const { agentId, after, callId } = yield* read(
          codingAgentMessagesParamsSchema,
          params,
          "reading an agent's transcript names the agent and a cursor",
        );
        // Note that the page is read at once, since Copy transcript waits on no hold.
        const answer = yield* asked(client.messagesNow(agentId, after, callId));
        return carried<CodingAgentMessagesAnswerView>(windowsPage(answer));
      }),
    [GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const { transcript, key } = yield* agentTranscriptOf(params);
        const tell = (page: CodingAgentMessagesAnswerView) =>
          Effect.sync(() =>
            kernel.emit(GATEWAY_EVENT.TRANSCRIPT_CHANGED, carried({ transcript, page })),
          );
        const follow = gate()
          ? followTranscript(
              transcripts,
              key,
              // The window draws a followed page, so its heavy parts come cut, each fetched whole as it opens.
              (after) => asked(client.messagesNow(key.agentId, after, key.callId, true)),
              tell,
            )
          : tell(UNANSWERED);
        yield* FiberMap.run(followed, key, follow);
        return {};
      }),
    [GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const { key } = yield* agentTranscriptOf(params);
        yield* FiberMap.remove(followed, key);
        return {};
      }),
    [GATEWAY_METHOD.CODING_AGENTS_MESSAGE]: (params) =>
      Effect.gen(function* () {
        const { agentId, ...request } = yield* read(
          codingAgentMessageParamsSchema,
          params,
          "messaging an agent names the agent, its words, and the send's key",
        );
        // A line with words, typed while this Mac's call is up on the agent, is the call's: the
        // service answers it aloud and writes it down as typed. Its files ride nowhere, since the
        // call hands on words alone; a line of files alone steers as it would with no call up.
        if (
          request.text !== "" &&
          dependencies.typeIntoCall?.(agentId, request.text, request.clientKey) === true
        ) {
          return carried<CodingAgentAgentAnswer>(yield* agentAsItStands(agentId));
        }
        const answer = yield* asked(client.message(agentId, request));
        return carried<CodingAgentAgentAnswer>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_CHOOSE]: (params) =>
      Effect.gen(function* () {
        const { agentId, ...choice } = yield* read(
          codingAgentChooseParamsSchema,
          params,
          "changing an agent's model names the agent, a model, and its effort",
        );
        const answer = yield* asked(client.choose(agentId, choice));
        return carried<CodingAgentAgentAnswer>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_RENAME]: (params) =>
      Effect.gen(function* () {
        const { agentId, ...request } = yield* read(
          codingAgentRenameParamsSchema,
          params,
          "renaming an agent names the agent and its title",
        );
        const answer = yield* asked(client.rename(agentId, request));
        return carried<CodingAgentAgentAnswer>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_SERVERS]: (params) =>
      Effect.gen(function* () {
        const { agentId, ...request } = yield* read(
          codingAgentServersParamsSchema,
          params,
          "switching an agent's MCP servers names the agent and the servers off",
        );
        const answer = yield* asked(client.switchServers(agentId, request));
        return carried<CodingAgentAgentAnswer>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_ARCHIVE]: (params) =>
      Effect.gen(function* () {
        const { agentId, ...request } = yield* read(
          codingAgentArchiveParamsSchema,
          params,
          "archiving an agent names the agent and whether it is archived",
        );
        const answer = yield* asked(client.archive(agentId, request));
        return carried<CodingAgentAgentAnswer>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_PIN]: (params) =>
      Effect.gen(function* () {
        const { agentId, ...request } = yield* read(
          codingAgentPinParamsSchema,
          params,
          "pinning an agent names the agent and whether it is pinned",
        );
        const answer = yield* asked(client.pin(agentId, request));
        return carried<CodingAgentAgentAnswer>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_STOP]: (params) =>
      Effect.gen(function* () {
        const { agentId } = yield* read(
          codingAgentStopParamsSchema,
          params,
          "stopping an agent names one agent",
        );
        const answer = yield* asked(client.stop(agentId));
        return carried<CodingAgentAgentAnswer>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_DELETE]: (params) =>
      Effect.gen(function* () {
        const { agentId } = yield* read(
          codingAgentStopParamsSchema,
          params,
          "deleting an agent names one agent",
        );
        const answer = yield* asked(client.delete(agentId));
        return carried<CodingAgentDeleteAnswerView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_PAGE]: (params) =>
      Effect.gen(function* () {
        const { agentId } = yield* read(
          codingAgentPageParamsSchema,
          params,
          "reading an agent's page names one agent",
        );
        const answer = yield* asked(client.agent(agentId));
        return carried<CodingAgentPageAnswerView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_CALLS]: (params) =>
      Effect.gen(function* () {
        const { agentId } = yield* read(
          codingAgentPageParamsSchema,
          params,
          "reading an agent's calls names one agent",
        );
        const answer = yield* asked(client.calls(agentId));
        return carried<CodingAgentCallsAnswerView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_PULL_REQUEST]: (params) =>
      Effect.gen(function* () {
        const { agentId, number } = yield* read(
          codingAgentPullRequestReadParamsSchema,
          params,
          "reading what an agent published names one agent",
        );
        const answer = yield* asked(client.pullRequest(agentId, number));
        return carried<CodingAgentPullRequestAnswerView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_CHANGES]: (params) =>
      Effect.gen(function* () {
        const { agentId, number } = yield* read(
          codingAgentPullRequestReadParamsSchema,
          params,
          "reading an agent's changes names one agent",
        );
        const answer = yield* asked(client.changes(agentId, number));
        return carried<CodingAgentChangesAnswerView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_CHAPTERS]: (params) =>
      Effect.gen(function* () {
        const { agentId, number } = yield* read(
          pullRequestChaptersParamsSchema,
          params,
          "reading a pull request's chapters names one agent",
        );
        const answer = yield* asked(client.chapters(agentId, number));
        return carried<PullRequestChaptersAnswerView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_CHAPTERS_GENERATE]: (params) =>
      Effect.gen(function* () {
        const { agentId, number } = yield* read(
          pullRequestChaptersParamsSchema,
          params,
          "generating a pull request's chapters names one agent",
        );
        const answer = yield* asked(client.generateChapters(agentId, number));
        return carried<PullRequestChaptersAnswerView>(answer);
      }),
    [GATEWAY_METHOD.CHAPTERS_MODEL_READ]: () =>
      Effect.map(asked(client.readChaptersModel()), (answer) =>
        carried<ChaptersModelAnswerView>(answer),
      ),
    [GATEWAY_METHOD.CHAPTERS_MODEL_WRITE]: (params) =>
      Effect.gen(function* () {
        const { model } = yield* read(
          chaptersModelWriteParamsSchema,
          params,
          "the chapters model names one of the models Settings offers",
        );
        const answer = yield* asked(client.writeChaptersModel(model));
        return carried<ChaptersModelAnswerView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_OVERVIEW_PULL_REQUEST]: (params) =>
      Effect.gen(function* () {
        const { agentId, number } = yield* read(
          codingAgentPullRequestReadParamsSchema,
          params,
          "reading an agent's pull request names one agent",
        );
        const answer = yield* asked(client.overviewPullRequest(agentId, number));
        return carried<CodingAgentOverviewPullRequestAnswerView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_REVIEW_OPTIONS]: (params) =>
      Effect.gen(function* () {
        const { agentId } = yield* read(
          codingAgentPullRequestParamsSchema,
          params,
          "reading what an agent's pickers offer names one agent",
        );
        const answer = yield* asked(client.reviewOptions(agentId));
        return carried<CodingAgentReviewOptionsAnswerView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_OVERVIEW_CHECKS]: (params) =>
      Effect.gen(function* () {
        const { agentId, number } = yield* read(
          codingAgentPullRequestReadParamsSchema,
          params,
          "reading an agent's pull request's checks names one agent",
        );
        const answer = yield* asked(client.overviewChecks(agentId, number));
        return carried<CodingAgentOverviewChecksAnswerView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_OVERVIEW_CONVERSATION]: (params) =>
      Effect.gen(function* () {
        const { agentId, number } = yield* read(
          codingAgentPullRequestReadParamsSchema,
          params,
          "reading an agent's pull request's conversation names one agent",
        );
        const answer = yield* asked(client.overviewConversation(agentId, number));
        return carried<CodingAgentOverviewConversationAnswerView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_PULL_REQUEST_ACTION]: (params) =>
      Effect.gen(function* () {
        const { agentId, number, request } = yield* read(
          codingAgentPullRequestActionParamsSchema,
          params,
          "changing an agent's pull request names the agent and the change",
        );
        const answer = yield* asked(client.pullRequestAction(agentId, request, number));
        return carried<CodingAgentPullRequestWriteAnswerView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_PULL_REQUEST_VIEWED]: (params) =>
      Effect.gen(function* () {
        const { agentId, number } = yield* read(
          codingAgentPullRequestReadParamsSchema,
          params,
          "reading which files of an agent's pull request were viewed names the agent",
        );
        const answer = yield* asked(client.pullRequestViewed(agentId, number));
        return carried<CodingAgentPullRequestViewedAnswerView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_GITHUB_IMAGE]: (params) =>
      Effect.gen(function* () {
        const { agentId, src } = yield* read(
          codingAgentGitHubImageParamsSchema,
          params,
          "reading an image of an agent's pull request names the agent and the image's address",
        );
        const answer = yield* asked(client.githubImage(agentId, src));
        return carried<CodingAgentGitHubImageView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_INBOX_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const scope = yield* read(
          codingAgentInboxScopeSchema,
          params,
          "following an inbox names a plan or an agent",
        );
        const tell = (inbox: CodingAgentInboxChanged["inbox"]) =>
          Effect.sync(() => kernel.emit(GATEWAY_EVENT.INBOX_CHANGED, carried({ scope, inbox })));
        const key = new InboxScopeKey(scope);
        const follow = gate() ? followInbox(inboxes, key, tell) : tell(UNANSWERED);
        yield* FiberMap.run(inboxFollows, key, follow);
        return {};
      }),
    [GATEWAY_METHOD.CODING_AGENTS_INBOX_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const scope = yield* read(
          codingAgentInboxScopeSchema,
          params,
          "letting an inbox go names a plan or an agent",
        );
        yield* FiberMap.remove(inboxFollows, new InboxScopeKey(scope));
        return {};
      }),
    [GATEWAY_METHOD.CODING_AGENTS_INBOX_ATTACHMENT]: (params) =>
      Effect.gen(function* () {
        const { itemId, attachmentId } = yield* read(
          codingAgentInboxAttachmentParamsSchema,
          params,
          "reading an inbox item's image names the item and the attachment",
        );
        const answer = yield* asked(client.inboxAttachment(itemId, attachmentId));
        return carried<CodingAgentInboxAttachmentView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_PICTURE]: (params) =>
      Effect.gen(function* () {
        const { agentId, pictureId, callId } = yield* read(
          codingAgentPictureParamsSchema,
          params,
          "reading an agent's picture names the agent and the picture",
        );
        const answer = yield* asked(client.agentPicture(agentId, pictureId, callId));
        return carried<CodingAgentInboxAttachmentView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_PART]: (params) =>
      Effect.gen(function* () {
        const { agentId, messageId, index, callId } = yield* read(
          codingAgentPartParamsSchema,
          params,
          "reading a part of an agent's transcript names the agent, the message, and the part",
        );
        const answer = yield* asked(client.agentPart(agentId, messageId, index, callId));
        return carried<CodingAgentPartView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_INBOX_ANSWER]: (params) =>
      Effect.gen(function* () {
        const { itemId, ...request } = yield* read(
          codingAgentInboxAnswerParamsSchema,
          params,
          "answering an inbox item names the item, the revision it answers, the answer, and the answer's key",
        );
        const answer = yield* asked(client.answerInbox(itemId, request));
        return carried<CodingAgentInboxAnsweredView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_INBOX_CLOSE]: (params) =>
      Effect.gen(function* () {
        const { itemId, ...request } = yield* read(
          codingAgentInboxCloseParamsSchema,
          params,
          "closing an inbox item names the item, the revision it closes, and the close's key",
        );
        const answer = yield* asked(client.closeInbox(itemId, request));
        return carried<CodingAgentInboxAnsweredView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_INBOX_MESSAGE]: (params) =>
      Effect.gen(function* () {
        const { itemId, ...request } = yield* read(
          codingAgentInboxMessageParamsSchema,
          params,
          "a message on an inbox item names the item, the words or files, and the message's key",
        );
        const answer = yield* asked(client.messageInbox(itemId, request));
        return carried<CodingAgentInboxMessagedView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_INBOX_READ_STATE]: (params) =>
      Effect.gen(function* () {
        const { itemId, unread } = yield* read(
          codingAgentInboxReadStateParamsSchema,
          params,
          "marking an inbox item names the item and whether it reads as unread",
        );
        const answer = yield* asked(
          unread ? client.markInboxItemUnread(itemId) : client.markInboxItemRead(itemId),
        );
        return carried<CodingAgentInboxReadStateView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_INBOX_READ_ALL]: (params) =>
      Effect.gen(function* () {
        const request = yield* read(
          inboxReadAllRequestSchema,
          params,
          "marking the inbox read names no more than the workspace it lists",
        );
        const answer = yield* asked(client.markInboxRead(request));
        return carried<CodingAgentInboxReadAllView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_CHAT_POST]: (params) =>
      Effect.gen(function* () {
        const { workspaceId, write } = yield* read(
          codingAgentChatPostParamsSchema,
          params,
          "writing to a workspace's chat names the workspace and one post, answer, resolve, or read",
        );
        const answer = yield* asked(client.chatPost(workspaceId, write));
        return carried<CodingAgentChatWriteAnswerView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_CHAT_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const { workspaceId } = yield* read(
          codingAgentChatFollowParamsSchema,
          params,
          "following a workspace's chat names the workspace",
        );
        const tell = (chat: CodingAgentChatAnswerView) =>
          Effect.sync(() =>
            kernel.emit(GATEWAY_EVENT.CHAT_CHANGED, carried({ workspaceId, chat })),
          );
        const follow = gate()
          ? followWorkspaceChat({
              join: () => asked(client.chatJoin(workspaceId)),
              live: chatLiveFor(workspaceId, dependencies.accountId()),
              openLive: dependencies.openLive ?? openRealtimeClient,
              now: kernel.now,
              tell,
            })
          : tell(UNANSWERED);
        yield* FiberMap.run(chats, workspaceId, follow);
        return {};
      }),
    [GATEWAY_METHOD.CODING_AGENTS_CHAT_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const { workspaceId } = yield* read(
          codingAgentChatFollowParamsSchema,
          params,
          "letting a workspace's chat go names the workspace",
        );
        yield* FiberMap.remove(chats, workspaceId);
        return {};
      }),
    [GATEWAY_METHOD.CODING_AGENTS_CHAT_ATTACHMENT]: (params) =>
      Effect.gen(function* () {
        const { workspaceId, messageId, attachmentId } = yield* read(
          codingAgentChatAttachmentParamsSchema,
          params,
          "reading a chat message's picture names the workspace, the message, and the attachment",
        );
        const answer = yield* asked(client.chatAttachment(workspaceId, messageId, attachmentId));
        return carried<CodingAgentInboxAttachmentView>(answer);
      }),
    [GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX_FOLLOW]: () =>
      Effect.gen(function* () {
        const tell = (answer: CodingAgentAccountInboxAnswerView) =>
          Effect.sync(() => kernel.emit(GATEWAY_EVENT.ACCOUNT_INBOX_CHANGED, carried(answer)));
        const userId = dependencies.accountId();
        const follow =
          gate() && userId !== undefined
            ? followAccountInbox(accounts, userId, tell)
            : tell(UNANSWERED);
        yield* FiberHandle.run(accountFollow, follow);
        return {};
      }),
    [GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX_UNFOLLOW]: () =>
      Effect.as(FiberHandle.clear(accountFollow), {}),
  };

  const reset = Effect.gen(function* () {
    yield* FiberMap.clear(followed);
    yield* FiberMap.clear(chats);
    yield* FiberMap.clear(inboxFollows);
    yield* FiberHandle.clear(accountFollow);
    for (const key of yield* RcMap.keys(transcripts)) yield* RcMap.invalidate(transcripts, key);
    for (const scope of yield* RcMap.keys(inboxes)) yield* RcMap.invalidate(inboxes, scope);
    for (const userId of yield* RcMap.keys(accounts)) yield* RcMap.invalidate(accounts, userId);
  });

  const agentTaskOf = (agentId: string) =>
    Effect.map(asked(client.agent(agentId)), (answer) =>
      "agent" in answer && answer.agent.archivedAt === undefined ? answer.agent.planId : undefined,
    );
  return { methods, lifetime: Effect.void, reset, agentTaskOf };
}
