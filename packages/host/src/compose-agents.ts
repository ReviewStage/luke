import type { HostedAgentClient } from "@luke/features";
import {
  AGENT_CALL_FAILURE,
  type AgentAccountInboxAnswerView,
  type AgentAgentAnswer,
  type AgentChangesAnswerView,
  type AgentDefaultAnswer,
  type AgentDeleteAnswerView,
  type AgentGitHubImageView,
  type AgentInboxAnsweredView,
  type AgentInboxAttachmentView,
  type AgentInboxChanged,
  type AgentInboxMessagedView,
  type AgentInboxReadAllView,
  type AgentInboxReadStateView,
  type AgentListAnswer,
  type AgentLukeToolsAnswerView,
  type AgentMessagesAnswerView,
  type AgentModelsAnswer,
  type AgentOperatorEnsureAnswerView,
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
  type AgentTranscriptOlderAnswer,
  type AgentTranscriptPage,
  ARCHIVE_DRAWN,
  agentArchiveParamsSchema,
  agentChooseParamsSchema,
  agentDefaultWriteParamsSchema,
  agentGitHubImageParamsSchema,
  agentInboxAnswerParamsSchema,
  agentInboxAttachmentParamsSchema,
  agentInboxCloseParamsSchema,
  agentInboxMessageParamsSchema,
  agentInboxReadAllParamsSchema,
  agentInboxReadStateParamsSchema,
  agentInboxScopeSchema,
  agentInboxStartParamsSchema,
  agentListParamsSchema,
  agentMessageParamsSchema,
  agentMessagesParamsSchema,
  agentOperatorEnsureParamsSchema,
  agentPageParamsSchema,
  agentPartParamsSchema,
  agentPictureParamsSchema,
  agentPinParamsSchema,
  agentPullRequestActionParamsSchema,
  agentPullRequestParamsSchema,
  agentPullRequestReadParamsSchema,
  agentQueueParamsSchema,
  agentRenameParamsSchema,
  agentRewindParamsSchema,
  agentServersParamsSchema,
  agentStartParamsSchema,
  agentStopParamsSchema,
  agentTranscriptKeySchema,
  agentTranscriptOlderParamsSchema,
  agentWorkspaceListParamsSchema,
  type DevicePresenceAnswerView,
  type DictationTranscribeAnswerView,
  dictationTranscribeParamsSchema,
  type GitHubTokenAnswerView,
  githubTokenSaveParamsSchema,
  type HostDoneAnswerView,
  type HostInstallTokenAnswerView,
  type HostsAnswerView,
  hostIdParamsSchema,
  hostInstallTokenParamsSchema,
  INBOX_SCOPE_KIND,
  type MemoriesAnswerView,
  memoriesReadParamsSchema,
  memoryForgetParamsSchema,
  type ProviderKeysAnswerView,
  providerKeyForAgentsParamsSchema,
  providerKeyRemoveParamsSchema,
  providerKeySaveParamsSchema,
  TRANSCRIPT_KIND,
} from "@luke/features/agent-view";
import { AGENT_ARCHIVER, CONTEXT_WINDOW } from "@luke/features/agent-wire";
import type { InboxItem } from "@luke/features/inbox-wire";
import {
  acknowledgedNow,
  answeredNow,
  closedNow,
  type InboxReader,
} from "@luke/features/inbox-writes";
import { LIVE_READ, type LiveRead } from "@luke/features/live-wire";
import {
  type ChaptersModelAnswerView,
  chaptersModelWriteParamsSchema,
  type PullRequestChaptersAnswerView,
  pullRequestChaptersParamsSchema,
  pullRequestChaptersReadParamsSchema,
} from "@luke/features/pull-request-chapters-view";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  invalid,
  readParams,
} from "@luke/gateway";
import { Effect, Equal, FiberHandle, FiberMap, Option, RcMap, type Scope } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { type AccountInboxes, accountInboxes, followAccountInbox } from "./account-inbox-follow.js";
import { followAccountItems } from "./account-items-follow.js";
import { type AppHostRead, type AppInboxItems, UNREAD } from "./app-state.js";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { HostKernel } from "./host-kernel.js";
import {
  INBOX_CHANGE,
  type InboxReads,
  type InboxWritten,
  inboxReads,
} from "./inbox-collections.js";
import {
  type AccountReads,
  accountReads,
  type RowRefused,
  type RowWrite,
  type RowWritten,
} from "./live-collection.js";
import type { RunMode } from "./run-mode.js";
import {
  followInbox,
  InboxScopeKey,
  type ScopeInboxes,
  scopeInboxes,
} from "./scope-inbox-follow.js";
import type { AgentRow } from "./task-list-collections.js";
import {
  followTranscript,
  type TranscriptFollows,
  TranscriptKey,
  type TranscriptMemory,
  transcriptFollows,
  windowsPage,
} from "./transcript-follow.js";
import { type TranscriptHeld, transcriptHeld } from "./transcript-held.js";

/**
 * compose-agents.ts -- a task's coding agents, asked of the service on the window's behalf: the models, the account's default, its own provider keys, the agents, one started, one's transcript, one messaged, one's model changed, one stopped, what one published, a clip dictated into an agent's box heard as words, the task's inbox, one item of it answered, and what waits across the account.
 *
 * Nothing is held here but the transcripts' subscriptions, and the followed
 * inboxes' (`scope-inbox-follow.ts`), heard as `INBOX_CHANGED` events. The window holds the agents it draws and the cursor it reads
 * from, asks when a task opens, when it starts or stops an agent, and while
 * an agent's tab shows its running transcript, and every ask is one call of
 * the service answered whole. The transcript read is held open here while
 * the agent runs and nothing new stands, on the service's held poll of what
 * its pages are read from (`transcript-follow.ts`), which a sign-out lets
 * go. What waits across the account is followed the same way, on the
 * account's own live read (`account-inbox-follow.ts`), heard as
 * `ACCOUNT_INBOX_CHANGED` events by main's notices rather than a window
 * (`agent-notices.ts`). Every item the account reaches is followed whole
 * on one read of its own (`account-items-follow.ts`) for the signed-in
 * session (`accountReads`), from the gate opening (`open`) until a
 * sign-out, told as `INBOX_ITEMS_CHANGED` events to the app state every
 * window draws. Behind a
 * closed account gate, or on a run that sends nothing, every ask answers
 * unanswered. A provider key passes through on its way to the service and
 * is held nowhere here; no answer carries one back.
 */

/** The service's side of the agents, as this concern asks it. */
export type AgentClient = Pick<
  HostedAgentClient,
  | "chapters"
  | "generateChapters"
  | "readChaptersModel"
  | "writeChaptersModel"
  | "models"
  | "readDefault"
  | "writeDefault"
  | "hosts"
  | "devicePresence"
  | "removeHost"
  | "keepHostInstallToken"
  | "revokeHostInstallToken"
  | "list"
  | "listWorkspace"
  | "start"
  | "startFrom"
  | "messagesNow"
  | "agentPart"
  | "messagesNewest"
  | "messagesBefore"
  | "agentTranscriptLive"
  | "message"
  | "choose"
  | "rename"
  | "switchServers"
  | "changeQueue"
  | "archive"
  | "pin"
  | "ensureOperator"
  | "stop"
  | "rewind"
  | "delete"
  | "agent"
  | "pullRequest"
  | "changes"
  | "overviewPullRequest"
  | "reviewOptions"
  | "lukeTools"
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
  | "readMemories"
  | "forgetMemory"
  | "transcribeDictation"
  | "answerInbox"
  | "closeInbox"
  | "messageInbox"
  | "startInboxThread"
  | "markInboxItemRead"
  | "markInboxItemUnread"
  | "markInboxRead"
  | "taskInboxLive"
  | "agentInboxLive"
  | "accountInboxLive"
  | "accountInboxItemsLive"
  | "inboxAttachment"
  | "agentPicture"
>;

export interface AgentsDependencies {
  kernel: Pick<HostKernel, "emit" | "now"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  client: AgentClient;
  /** The account signed in now, by its id, which every live read names; none where nobody is. */
  accountId: () => string | undefined;
  /** The member signed in now, as an answer or a close drawn before the service says how it stands names them; none where nobody is. */
  reader?: () => InboxReader | undefined;
  /**
   * Waits for a write's transaction to arrive on the task list followed
   * live, which holds every agent's row (`TasksComposer.listed`), so a
   * Start, or an archive a dialog waits on, is answered once the list
   * carries it; none waits for nothing.
   */
  listed?: (txid: string | undefined) => Effect.Effect<void>;
  /**
   * A change to an agent's row of the task list, drawn at once and kept or
   * taken back as the service answers it (`TasksComposer.writeAgent`): a
   * rename, an archive, a pin, a change of model, or a switch of MCP
   * servers. None writes alone, drawing nothing.
   */
  writeAgent?: RowWrite<AgentRow>;
}

export interface AgentsComposer extends Composer {
  /** The session's account reads opened for the account signed in, as the gate opening opens them. */
  readonly open: Effect.Effect<void>;
  /** Every transcript's, every plan's and agent's inbox's, the account inbox's, and the account's items' subscription let go, as a sign-out lets them go. */
  readonly reset: Effect.Effect<void>;
}

const UNANSWERED = { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;

/** Whether the service may be asked now: a run that sends, behind an open account gate. */
function gateOf({ kernel, account }: AgentsDependencies): () => boolean {
  return () => kernel.runMode.sendsNetwork && account.capabilitiesActive();
}

/** The service asked behind the gate, over the host's own HTTP client. */
function askedOf(dependencies: AgentsDependencies, http: HttpClient.HttpClient) {
  const gate = gateOf(dependencies);
  return <Answer>(
    call: Effect.Effect<Answer, never, HttpClient.HttpClient>,
  ): Effect.Effect<Answer | typeof UNANSWERED> =>
    gate() ? Effect.provideService(call, HttpClient.HttpClient, http) : Effect.succeed(UNANSWERED);
}

export function composeAgents(
  dependencies: AgentsDependencies,
): Effect.Effect<AgentsComposer, never, Scope.Scope | HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const asked = askedOf(dependencies, http);
    const { client } = dependencies;
    const transcripts = yield* transcriptFollows({
      seal: (key, poll, userId, after, cursor) =>
        asked(
          dependencies.client.agentTranscriptLive(
            key.agentId,
            userId,
            key.callId,
            poll,
            after,
            cursor,
          ),
        ),
      accountId: dependencies.accountId,
    });
    const followed = yield* FiberMap.make<TranscriptKey>();
    const reads = inboxReads();
    const held = yield* transcriptHeld<TranscriptKey>();
    const inboxes = yield* scopeInboxes({
      seal: (scope, poll, userId, after) =>
        asked(
          scope.kind === INBOX_SCOPE_KIND.PLAN
            ? client.taskInboxLive(scope.id, userId, poll, after)
            : client.agentInboxLive(scope.id, userId, poll, after),
        ),
      accountId: dependencies.accountId,
      reads,
    });
    const accounts = yield* accountInboxes({
      seal: (userId, poll, after) => asked(client.accountInboxLive(userId, poll, after)),
      reads,
    });
    const gate = gateOf(dependencies);
    const tellItems = (read: AppHostRead<AppInboxItems>) =>
      Effect.sync(() => dependencies.kernel.emit(GATEWAY_EVENT.INBOX_ITEMS_CHANGED, carried(read)));
    // Note that a session's reads close before the window is told it holds none, so nothing the last account drew lands after.
    const sessionReads = yield* accountReads<LiveRead>(
      () => (gate() ? dependencies.accountId() : undefined),
      tellItems(UNREAD),
    );
    const followItems = (userId: string) =>
      followAccountItems(
        {
          seal: (account, since, poll, after) =>
            asked(client.accountInboxItemsLive(account, since, poll, after)),
          reads,
        },
        userId,
        tellItems,
      );
    const inboxFollows = yield* FiberMap.make<InboxScopeKey>();
    const accountFollow = yield* FiberHandle.make();
    return composed(
      dependencies,
      http,
      { transcripts, followed, held },
      { inboxes, followed: inboxFollows, reads },
      { accounts, followed: accountFollow },
      { reads: sessionReads, followItems },
    );
  });
}

/** The transcripts' subscriptions the windows share, the follows main asked for, one fiber each, and the windows this host held of the transcripts it followed last. */
interface Transcripts {
  readonly transcripts: TranscriptFollows;
  readonly followed: FiberMap.FiberMap<TranscriptKey>;
  readonly held: TranscriptHeld<TranscriptKey>;
}

/** The scopes' subscriptions the windows share, and the follows main asked for, one fiber per scope. */
interface ScopeFollows {
  readonly inboxes: ScopeInboxes;
  readonly followed: FiberMap.FiberMap<InboxScopeKey>;
  /** The followed inboxes' waits, the account's among them, which a mark, an answer, or a close waits on. */
  readonly reads: InboxReads;
}

/** The account's subscriptions, and the one follow main asked for. */
interface AccountFollow {
  readonly accounts: AccountInboxes;
  readonly followed: FiberHandle.FiberHandle;
}

/** The session's account reads, and the follow of every item the account reaches among them. */
interface SessionReads {
  readonly reads: AccountReads<LiveRead>;
  readonly followItems: (userId: string) => Effect.Effect<void>;
}

/** The composer's one table, built from its seams; nothing here starts anything but a transcript's or a scope's inbox subscription, while a window reads it. */
function composed(
  dependencies: AgentsDependencies,
  http: HttpClient.HttpClient,
  { transcripts, followed, held }: Transcripts,
  { inboxes, followed: inboxFollows, reads }: ScopeFollows,
  /** What waits across the account, and main's one follow of it. */
  { accounts, followed: accountFollow }: AccountFollow,
  /** The session's account reads, every item the account reaches among them. */
  { reads: sessionReads, followItems }: SessionReads,
): AgentsComposer {
  const { client, kernel } = dependencies;
  const gate = gateOf(dependencies);
  const asked = askedOf(dependencies, http);
  const listed = dependencies.listed ?? (() => Effect.void);
  const writeAgent: RowWrite<AgentRow> =
    dependencies.writeAgent ??
    ((_agentId, _change, written) =>
      Effect.map(written, (result) => ("refused" in result ? result.refused : result.answer)));
  /** An agent's row written as the service answers it: kept on the transaction it names, or refused. */
  const agentWritten = (call: Effect.Effect<AgentAgentAnswer>) =>
    Effect.map(
      call,
      (answered): RowWritten<AgentRow, AgentAgentAnswer> | RowRefused<AgentAgentAnswer> =>
        "agent" in answered ? { answer: answered, txid: answered.txid } : { refused: answered },
    );

  /** What this host holds of one transcript for the account signed in as the follow opens; nothing is held while nobody is. */
  const memoryOf = (key: TranscriptKey): TranscriptMemory => {
    const userId = dependencies.accountId();
    if (userId === undefined) {
      return {
        recall: Effect.succeed(Option.none()),
        keep: () => Effect.void,
        forget: Effect.void,
      };
    }
    return {
      recall: held.recall(key, userId),
      keep: (window) => held.keep(key, userId, window),
      forget: held.forget((other) => Equal.equals(other, key)),
    };
  };

  /** The member signed in now, whom a write drawn before the service answers names. */
  const reader = () => dependencies.reader?.();

  /** What the service answered of a write on items: its transaction, the item it names, and whether it was kept, as a nod or a close is only where taken. */
  const writtenOf = (
    answer:
      | { readonly failure: unknown }
      | { readonly txid?: string; readonly item?: InboxItem; readonly taken?: boolean },
  ): InboxWritten =>
    "failure" in answer
      ? { txid: undefined, item: undefined, kept: false }
      : { txid: answer.txid, item: answer.item, kept: answer.taken !== false };

  /** The agent's or worker's transcript a follow names, and the key its subscription and follow are held under. */
  const agentTranscriptOf = (
    params: Parameters<GatewayMethodTable[keyof GatewayMethodTable] & object>[0],
  ) =>
    Effect.gen(function* () {
      const sentence = "following a transcript names an agent, and a worker's call where it is one";
      const transcript = yield* readParams(agentTranscriptKeySchema, params, sentence);
      if (transcript.kind !== TRANSCRIPT_KIND.AGENT) return yield* invalid(sentence);
      return {
        transcript,
        key: new TranscriptKey({ agentId: transcript.agentId, callId: transcript.callId }),
      };
    });

  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.AGENTS_MODELS]: () =>
      Effect.map(asked(client.models()), (answer) => carried<AgentModelsAnswer>(answer)),
    [GATEWAY_METHOD.AGENTS_DEFAULT_READ]: () =>
      Effect.map(asked(client.readDefault()), (answer) => carried<AgentDefaultAnswer>(answer)),
    [GATEWAY_METHOD.AGENTS_DEFAULT_WRITE]: (params) =>
      Effect.gen(function* () {
        const choice = yield* readParams(
          agentDefaultWriteParamsSchema,
          params,
          "the default names a model and its effort",
        );
        const answer = yield* asked(client.writeDefault(choice));
        return carried<AgentDefaultAnswer>(answer);
      }),
    [GATEWAY_METHOD.HOSTS_LIST]: () =>
      Effect.map(asked(client.hosts()), (answer) => carried<HostsAnswerView>(answer)),
    [GATEWAY_METHOD.HOSTS_PRESENCE]: () =>
      Effect.map(asked(client.devicePresence()), (answer) =>
        carried<DevicePresenceAnswerView>(answer),
      ),
    [GATEWAY_METHOD.HOSTS_REMOVE]: (params) =>
      Effect.gen(function* () {
        const { id } = yield* readParams(hostIdParamsSchema, params, "a remove names a host");
        return carried<HostDoneAnswerView>(yield* asked(client.removeHost(id)));
      }),
    [GATEWAY_METHOD.HOSTS_KEEP_INSTALL_TOKEN]: (params) =>
      Effect.gen(function* () {
        // Note that only the token's hash crosses here: the window that minted the token keeps it.
        const { tokenHash } = yield* readParams(
          hostInstallTokenParamsSchema,
          params,
          "keeping an install token names its hash",
        );
        return carried<HostInstallTokenAnswerView>(
          yield* asked(client.keepHostInstallToken(tokenHash)),
        );
      }),
    [GATEWAY_METHOD.HOSTS_REVOKE_INSTALL_TOKEN]: (params) =>
      Effect.gen(function* () {
        const { id } = yield* readParams(
          hostIdParamsSchema,
          params,
          "a revoke names an install token",
        );
        return carried<HostDoneAnswerView>(yield* asked(client.revokeHostInstallToken(id)));
      }),
    [GATEWAY_METHOD.PROVIDER_KEYS_READ]: () =>
      Effect.map(asked(client.readProviderKeys()), (answer) =>
        carried<ProviderKeysAnswerView>(answer),
      ),
    [GATEWAY_METHOD.PROVIDER_KEYS_SAVE]: (params) =>
      Effect.gen(function* () {
        // Note that the sentence names the shape and never the value, because the value is a key.
        const save = yield* readParams(
          providerKeySaveParamsSchema,
          params,
          "a save names a provider and a key",
        );
        const answer = yield* asked(client.saveProviderKey(save));
        return carried<ProviderKeysAnswerView>(answer);
      }),
    [GATEWAY_METHOD.MEMORIES_READ]: (params) =>
      Effect.gen(function* () {
        const reading = yield* readParams(
          memoriesReadParamsSchema,
          params,
          "a read names a workspace",
        );
        const answer = yield* asked(client.readMemories(reading));
        return carried<MemoriesAnswerView>(answer);
      }),
    [GATEWAY_METHOD.MEMORIES_FORGET]: (params) =>
      Effect.gen(function* () {
        const forget = yield* readParams(
          memoryForgetParamsSchema,
          params,
          "a forget names a workspace and a memory's id",
        );
        const answer = yield* asked(client.forgetMemory(forget));
        return carried<MemoriesAnswerView>(answer);
      }),
    [GATEWAY_METHOD.DICTATION_TRANSCRIBE]: (params) =>
      Effect.gen(function* () {
        // Note that the sentence names the shape and never the words, because they are the developer's voice.
        const clip = yield* readParams(
          dictationTranscribeParamsSchema,
          params,
          "a clip names its audio, its length, and its words",
        );
        const answer = yield* asked(client.transcribeDictation(clip));
        return carried<DictationTranscribeAnswerView>(answer);
      }),
    [GATEWAY_METHOD.PROVIDER_KEYS_REMOVE]: (params) =>
      Effect.gen(function* () {
        const removal = yield* readParams(
          providerKeyRemoveParamsSchema,
          params,
          "a removal names a provider",
        );
        const answer = yield* asked(client.removeProviderKey(removal));
        return carried<ProviderKeysAnswerView>(answer);
      }),
    [GATEWAY_METHOD.PROVIDER_KEYS_FOR_AGENTS]: (params) =>
      Effect.gen(function* () {
        const change = yield* readParams(
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
        const save = yield* readParams(githubTokenSaveParamsSchema, params, "a save names a token");
        const answer = yield* asked(client.saveGitHubToken(save));
        return carried<GitHubTokenAnswerView>(answer);
      }),
    [GATEWAY_METHOD.GITHUB_TOKEN_REMOVE]: () =>
      Effect.map(asked(client.removeGitHubToken()), (answer) =>
        carried<GitHubTokenAnswerView>(answer),
      ),
    [GATEWAY_METHOD.AGENTS_LIST]: (params) =>
      Effect.gen(function* () {
        const { taskId, includeArchived } = yield* readParams(
          agentListParamsSchema,
          params,
          "listing a task's agents names one task",
        );
        const answer = yield* asked(client.list(taskId, includeArchived));
        return carried<AgentListAnswer>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_WORKSPACE_LIST]: (params) =>
      Effect.gen(function* () {
        const listed = yield* readParams(
          agentWorkspaceListParamsSchema,
          params,
          "listing a workspace's agents names one workspace",
        );
        return carried<AgentListAnswer>(yield* asked(client.listWorkspace(listed)));
      }),
    [GATEWAY_METHOD.AGENTS_START]: (params) =>
      Effect.gen(function* () {
        const { taskId, ...request } = yield* readParams(
          agentStartParamsSchema,
          params,
          "starting an agent names a task or an agent to start from, and the press's own key",
        );
        // A Start from another agent that names no task goes where that agent is, its task or its workspace.
        const answer = yield* asked(
          taskId === undefined ? client.startFrom(request) : client.start(taskId, request),
        );
        // Note that a Start answers once the task list carries its agent, because the window draws
        // a task's agents from the list alone, so the tab it opens finds its agent there.
        if ("txid" in answer) yield* listed(answer.txid);
        return carried<AgentAgentAnswer>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_MESSAGES]: (params) =>
      Effect.gen(function* () {
        const { agentId, after, callId } = yield* readParams(
          agentMessagesParamsSchema,
          params,
          "reading an agent's transcript names the agent and a cursor",
        );
        // Note that the page is read at once, since Copy transcript waits on no hold.
        const answer = yield* asked(client.messagesNow(agentId, after, callId));
        return carried<AgentMessagesAnswerView>(windowsPage(answer));
      }),
    [GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const { transcript, key } = yield* agentTranscriptOf(params);
        const tell = (page: AgentTranscriptPage) =>
          Effect.sync(() =>
            kernel.emit(GATEWAY_EVENT.TRANSCRIPT_CHANGED, carried({ transcript, page })),
          );
        const follow = gate()
          ? followTranscript(
              transcripts,
              key,
              // The window draws a followed page, so its heavy parts come cut, each fetched whole as it opens.
              {
                newest: () => asked(client.messagesNewest(key.agentId, key.callId, true)),
                after: (after) => asked(client.messagesNow(key.agentId, after, key.callId, true)),
              },
              memoryOf(key),
              tell,
            )
          : tell(UNANSWERED);
        yield* FiberMap.run(followed, key, follow);
        return {};
      }),
    [GATEWAY_METHOD.AGENTS_TRANSCRIPT_OLDER]: (params) =>
      Effect.gen(function* () {
        const { agentId, callId, before } = yield* readParams(
          agentTranscriptOlderParamsSchema,
          params,
          "reading an older page names the transcript and where to read below",
        );
        const answer = yield* asked(client.messagesBefore(agentId, before, callId, true));
        return carried<AgentTranscriptOlderAnswer>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_TRANSCRIPT_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const { key } = yield* agentTranscriptOf(params);
        yield* FiberMap.remove(followed, key);
        return {};
      }),
    [GATEWAY_METHOD.AGENTS_MESSAGE]: (params) =>
      Effect.gen(function* () {
        const { agentId, ...request } = yield* readParams(
          agentMessageParamsSchema,
          params,
          "messaging an agent names the agent, its words, and the send's key",
        );
        const answer = yield* asked(client.message(agentId, request));
        if (!("agent" in answer)) return carried<AgentAgentAnswer>(answer);
        // Note that a send answers at once rather than once its row reaches the followed transcript,
        // because the window draws the line under the row's id until that row lands, so no page from
        // before the write can take it away, and the next send waits on this answer.
        return carried<AgentAgentAnswer>({ agent: answer.agent });
      }),
    [GATEWAY_METHOD.AGENTS_CHOOSE]: (params) =>
      Effect.gen(function* () {
        const { agentId, ...choice } = yield* readParams(
          agentChooseParamsSchema,
          params,
          "changing an agent's model names the agent, a model, and its effort",
        );
        // A change of model is drawn on the agent's row at once, on the model's whole window where it names none.
        const answer = yield* writeAgent<AgentAgentAnswer>(
          agentId,
          () => ({
            model: choice.model,
            effort: choice.effort,
            contextWindow: choice.contextWindow ?? CONTEXT_WINDOW.LONG,
          }),
          agentWritten(asked(client.choose(agentId, choice))),
        );
        return carried<AgentAgentAnswer>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_RENAME]: (params) =>
      Effect.gen(function* () {
        const { agentId, ...request } = yield* readParams(
          agentRenameParamsSchema,
          params,
          "renaming an agent names the agent and its title",
        );
        // A rename is drawn on the agent's row at once, an empty title clearing it.
        const title = request.title.length === 0 ? null : request.title;
        const answer = yield* writeAgent<AgentAgentAnswer>(
          agentId,
          () => ({ title }),
          agentWritten(asked(client.rename(agentId, request))),
        );
        return carried<AgentAgentAnswer>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_SERVERS]: (params) =>
      Effect.gen(function* () {
        const { agentId, ...request } = yield* readParams(
          agentServersParamsSchema,
          params,
          "switching an agent's MCP servers names the agent and the servers off",
        );
        // A switch is drawn on the agent's row at once, the whole list of those off.
        const answer = yield* writeAgent<AgentAgentAnswer>(
          agentId,
          () => ({ disabledServers: request.disabledServers }),
          agentWritten(asked(client.switchServers(agentId, request))),
        );
        return carried<AgentAgentAnswer>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_QUEUE]: (params) =>
      Effect.gen(function* () {
        const { agentId, change } = yield* readParams(
          agentQueueParamsSchema,
          params,
          "changing an agent's queue names the agent and the change",
        );
        const answer = yield* asked(client.changeQueue(agentId, change));
        return carried<AgentQueueAnswerView>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_ARCHIVE]: (params) =>
      Effect.gen(function* () {
        const { agentId, drawn, ...request } = yield* readParams(
          agentArchiveParamsSchema,
          params,
          "archiving an agent names the agent and whether it is archived",
        );
        // Note that an agent archived lets go of what this host held of its transcript and its workers'.
        const written = Effect.tap(asked(client.archive(agentId, request)), (answer) =>
          "agent" in answer ? held.forget((key) => key.agentId === agentId) : Effect.void,
        );
        // An archive is drawn on the agent's row at once, stamped now by the member, unless a dialog
        // that asked waits on the answer, which then comes once the list carries it.
        if (drawn === ARCHIVE_DRAWN.ON_ANSWER) {
          const answer = yield* written;
          if ("txid" in answer) yield* listed(answer.txid);
          return carried<AgentAgentAnswer>(answer);
        }
        const archiver = reader();
        const at = kernel.now();
        const answer = yield* writeAgent<AgentAgentAnswer>(
          agentId,
          () =>
            request.archived
              ? {
                  archivedAt: at,
                  archivedBy:
                    archiver === undefined
                      ? null
                      : { by: AGENT_ARCHIVER.MEMBER, userId: archiver.userId },
                  archiverName: archiver?.name ?? null,
                }
              : { archivedAt: null, archivedBy: null, archiverName: null },
          agentWritten(written),
        );
        return carried<AgentAgentAnswer>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_PIN]: (params) =>
      Effect.gen(function* () {
        const { agentId, ...request } = yield* readParams(
          agentPinParamsSchema,
          params,
          "pinning an agent names the agent and whether it is pinned",
        );
        // A pin is drawn on the agent's row at once, newest pinned and standing where it was dragged, and kept once the list carries it.
        const answer = yield* writeAgent<AgentAgentAnswer>(
          agentId,
          (row) =>
            request.pinned
              ? {
                  pinnedAt: row.pinnedAt ?? kernel.now(),
                  pinPosition: request.position ?? (row.pinnedAt === null ? null : row.pinPosition),
                }
              : { pinnedAt: null, pinPosition: null },
          agentWritten(asked(client.pin(agentId, request))),
        );
        return carried<AgentAgentAnswer>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_ENSURE_OPERATOR]: (params) =>
      Effect.gen(function* () {
        const { workspaceId, ...request } = yield* readParams(
          agentOperatorEnsureParamsSchema,
          params,
          "ensuring the operator names its workspace",
        );
        const answer = yield* asked(client.ensureOperator(workspaceId, request));
        // Note that a made operator is waited for on the list, so its row stands once the window hears its id.
        if ("txid" in answer) yield* listed(answer.txid);
        return carried<AgentOperatorEnsureAnswerView>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_STOP]: (params) =>
      Effect.gen(function* () {
        const { agentId } = yield* readParams(
          agentStopParamsSchema,
          params,
          "stopping an agent names one agent",
        );
        const answer = yield* asked(client.stop(agentId));
        return carried<AgentAgentAnswer>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_REWIND]: (params) =>
      Effect.gen(function* () {
        const { agentId, messageId } = yield* readParams(
          agentRewindParamsSchema,
          params,
          "rewinding an agent names one agent and one of its lines",
        );
        const answer = yield* asked(client.rewind(agentId, messageId));
        return carried<AgentAgentAnswer>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_DELETE]: (params) =>
      Effect.gen(function* () {
        const { agentId } = yield* readParams(
          agentStopParamsSchema,
          params,
          "deleting an agent names one agent",
        );
        const answer = yield* asked(client.delete(agentId));
        if ("txid" in answer) yield* listed(answer.txid);
        return carried<AgentDeleteAnswerView>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_PAGE]: (params) =>
      Effect.gen(function* () {
        const { agentId } = yield* readParams(
          agentPageParamsSchema,
          params,
          "reading an agent's page names one agent",
        );
        const answer = yield* asked(client.agent(agentId));
        return carried<AgentPageAnswerView>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_PULL_REQUEST]: (params) =>
      Effect.gen(function* () {
        const { agentId, number } = yield* readParams(
          agentPullRequestReadParamsSchema,
          params,
          "reading what an agent published names one agent",
        );
        const answer = yield* asked(client.pullRequest(agentId, number));
        return carried<AgentPullRequestAnswerView>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_CHANGES]: (params) =>
      Effect.gen(function* () {
        const { agentId, number } = yield* readParams(
          agentPullRequestReadParamsSchema,
          params,
          "reading an agent's changes names one agent",
        );
        const answer = yield* asked(client.changes(agentId, number));
        return carried<AgentChangesAnswerView>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_CHAPTERS]: (params) =>
      Effect.gen(function* () {
        const { agentId, number } = yield* readParams(
          pullRequestChaptersReadParamsSchema,
          params,
          "reading a pull request's chapters names one agent and its pull request's number",
        );
        const answer = yield* asked(client.chapters(agentId, number));
        return carried<PullRequestChaptersAnswerView>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_CHAPTERS_GENERATE]: (params) =>
      Effect.gen(function* () {
        const { agentId, number } = yield* readParams(
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
        const { model } = yield* readParams(
          chaptersModelWriteParamsSchema,
          params,
          "the chapters model names one of the models Settings offers",
        );
        const answer = yield* asked(client.writeChaptersModel(model));
        return carried<ChaptersModelAnswerView>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_OVERVIEW_PULL_REQUEST]: (params) =>
      Effect.gen(function* () {
        const { agentId, number } = yield* readParams(
          agentPullRequestReadParamsSchema,
          params,
          "reading an agent's pull request names one agent",
        );
        const answer = yield* asked(client.overviewPullRequest(agentId, number));
        return carried<AgentOverviewPullRequestAnswerView>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_REVIEW_OPTIONS]: (params) =>
      Effect.gen(function* () {
        const { agentId } = yield* readParams(
          agentPullRequestParamsSchema,
          params,
          "reading what an agent's pickers offer names one agent",
        );
        const answer = yield* asked(client.reviewOptions(agentId));
        return carried<AgentReviewOptionsAnswerView>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_LUKE_TOOLS]: (params) =>
      Effect.gen(function* () {
        const { agentId } = yield* readParams(
          agentPullRequestParamsSchema,
          params,
          "reading an agent's Luke tools names one agent",
        );
        const answer = yield* asked(client.lukeTools(agentId));
        return carried<AgentLukeToolsAnswerView>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_OVERVIEW_CHECKS]: (params) =>
      Effect.gen(function* () {
        const { agentId, number } = yield* readParams(
          agentPullRequestReadParamsSchema,
          params,
          "reading an agent's pull request's checks names one agent",
        );
        const answer = yield* asked(client.overviewChecks(agentId, number));
        return carried<AgentOverviewChecksAnswerView>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_OVERVIEW_CONVERSATION]: (params) =>
      Effect.gen(function* () {
        const { agentId, number } = yield* readParams(
          agentPullRequestReadParamsSchema,
          params,
          "reading an agent's pull request's conversation names one agent",
        );
        const answer = yield* asked(client.overviewConversation(agentId, number));
        return carried<AgentOverviewConversationAnswerView>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_PULL_REQUEST_ACTION]: (params) =>
      Effect.gen(function* () {
        const { agentId, number, request } = yield* readParams(
          agentPullRequestActionParamsSchema,
          params,
          "changing an agent's pull request names the agent and the change",
        );
        const answer = yield* asked(client.pullRequestAction(agentId, request, number));
        return carried<AgentPullRequestWriteAnswerView>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_PULL_REQUEST_VIEWED]: (params) =>
      Effect.gen(function* () {
        const { agentId, number } = yield* readParams(
          agentPullRequestReadParamsSchema,
          params,
          "reading which files of an agent's pull request were viewed names the agent",
        );
        const answer = yield* asked(client.pullRequestViewed(agentId, number));
        return carried<AgentPullRequestViewedAnswerView>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_GITHUB_IMAGE]: (params) =>
      Effect.gen(function* () {
        const { agentId, src } = yield* readParams(
          agentGitHubImageParamsSchema,
          params,
          "reading an image of an agent's pull request names the agent and the image's address",
        );
        const answer = yield* asked(client.githubImage(agentId, src));
        return carried<AgentGitHubImageView>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_INBOX_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const scope = yield* readParams(
          agentInboxScopeSchema,
          params,
          "following an inbox names a plan or an agent",
        );
        const tell = (inbox: AgentInboxChanged["inbox"]) =>
          Effect.sync(() => kernel.emit(GATEWAY_EVENT.INBOX_CHANGED, carried({ scope, inbox })));
        const key = new InboxScopeKey(scope);
        const follow = gate() ? followInbox(inboxes, key, tell) : tell(UNANSWERED);
        yield* FiberMap.run(inboxFollows, key, follow);
        return {};
      }),
    [GATEWAY_METHOD.AGENTS_INBOX_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const scope = yield* readParams(
          agentInboxScopeSchema,
          params,
          "letting an inbox go names a plan or an agent",
        );
        yield* FiberMap.remove(inboxFollows, new InboxScopeKey(scope));
        return {};
      }),
    [GATEWAY_METHOD.AGENTS_INBOX_ATTACHMENT]: (params) =>
      Effect.gen(function* () {
        const { itemId, attachmentId } = yield* readParams(
          agentInboxAttachmentParamsSchema,
          params,
          "reading an inbox item's image names the item and the attachment",
        );
        const answer = yield* asked(client.inboxAttachment(itemId, attachmentId));
        return carried<AgentInboxAttachmentView>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_PICTURE]: (params) =>
      Effect.gen(function* () {
        const { agentId, pictureId, callId } = yield* readParams(
          agentPictureParamsSchema,
          params,
          "reading an agent's picture names the agent and the picture",
        );
        const answer = yield* asked(client.agentPicture(agentId, pictureId, callId));
        return carried<AgentInboxAttachmentView>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_PART]: (params) =>
      Effect.gen(function* () {
        const { agentId, messageId, index, callId } = yield* readParams(
          agentPartParamsSchema,
          params,
          "reading a part of an agent's transcript names the agent, the message, and the part",
        );
        const answer = yield* asked(client.agentPart(agentId, messageId, index, callId));
        return carried<AgentPartView>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_INBOX_ANSWER]: (params) =>
      Effect.gen(function* () {
        const { itemId, ...request } = yield* readParams(
          agentInboxAnswerParamsSchema,
          params,
          "acknowledging an inbox notice names the item, the revision it acknowledges, the acknowledgement, and the nod's key",
        );
        const answer = yield* reads.write(
          {
            kind: INBOX_CHANGE.SETTLED,
            itemId,
            item: (item) => acknowledgedNow(item, reader(), kernel.now()),
          },
          asked(client.answerInbox(itemId, request)),
          writtenOf,
        );
        return carried<AgentInboxAnsweredView>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_INBOX_CLOSE]: (params) =>
      Effect.gen(function* () {
        const { itemId, ...request } = yield* readParams(
          agentInboxCloseParamsSchema,
          params,
          "closing an inbox item names the item, the revision it closes, and the close's key",
        );
        const answer = yield* reads.write(
          {
            kind: INBOX_CHANGE.SETTLED,
            itemId,
            item: (item) => closedNow(item, reader(), kernel.now()),
          },
          asked(client.closeInbox(itemId, request)),
          writtenOf,
        );
        return carried<AgentInboxAnsweredView>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_INBOX_MESSAGE]: (params) =>
      Effect.gen(function* () {
        const { itemId, ...request } = yield* readParams(
          agentInboxMessageParamsSchema,
          params,
          "a message on an inbox item names the item, the words or files, and the message's key",
        );
        // Note that a reply carrying an answer settles the ask, where a plain one only leaves the item read, its words drawn by the window's own box while they go.
        const { answers, clientKey: key, text } = request;
        const answer = yield* reads.write(
          answers === undefined
            ? { kind: INBOX_CHANGE.MARKED, itemIds: new Set([itemId]), unread: false }
            : {
                kind: INBOX_CHANGE.SETTLED,
                itemId,
                item: (item) => answeredNow(item, { key, text, answers }, reader(), kernel.now()),
              },
          asked(client.messageInbox(itemId, request)),
          writtenOf,
        );
        return carried<AgentInboxMessagedView>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_INBOX_START]: (params) =>
      Effect.gen(function* () {
        const request = yield* readParams(
          agentInboxStartParamsSchema,
          params,
          "a new inbox thread names the agent, its subject, the words or files, and the thread's key",
        );
        const answer = yield* asked(client.startInboxThread(request));
        yield* reads.confirmAccountWide("failure" in answer ? undefined : answer.txid);
        return carried<AgentInboxMessagedView>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_INBOX_READ_STATE]: (params) =>
      Effect.gen(function* () {
        const { itemId, unread } = yield* readParams(
          agentInboxReadStateParamsSchema,
          params,
          "marking an inbox item names the item and whether it reads as unread",
        );
        const answer = yield* reads.write(
          { kind: INBOX_CHANGE.MARKED, itemIds: new Set([itemId]), unread },
          asked(unread ? client.markInboxItemUnread(itemId) : client.markInboxItemRead(itemId)),
          writtenOf,
          true,
        );
        return carried<AgentInboxReadStateView>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_INBOX_READ_ALL]: (params) =>
      Effect.gen(function* () {
        const { itemIds, ...request } = yield* readParams(
          agentInboxReadAllParamsSchema,
          params,
          "marking the inbox read names the workspace it lists, where it lists one, and the items it lists there",
        );
        const answer = yield* reads.write(
          { kind: INBOX_CHANGE.MARKED, itemIds: new Set(itemIds), unread: false },
          asked(client.markInboxRead(request)),
          writtenOf,
          true,
        );
        return carried<AgentInboxReadAllView>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_ACCOUNT_INBOX_FOLLOW]: () =>
      Effect.gen(function* () {
        const tell = (answer: AgentAccountInboxAnswerView) =>
          Effect.sync(() => kernel.emit(GATEWAY_EVENT.ACCOUNT_INBOX_CHANGED, carried(answer)));
        const userId = dependencies.accountId();
        const follow =
          gate() && userId !== undefined
            ? followAccountInbox(accounts, userId, tell)
            : tell(UNANSWERED);
        yield* FiberHandle.run(accountFollow, follow);
        return {};
      }),
    [GATEWAY_METHOD.AGENTS_ACCOUNT_INBOX_UNFOLLOW]: () =>
      Effect.as(FiberHandle.clear(accountFollow), {}),
    [GATEWAY_METHOD.AGENTS_INBOX_ITEMS_RETRY]: () =>
      Effect.as(sessionReads.reopen(LIVE_READ.INBOX_ITEMS, followItems), {}),
  };

  const reset = Effect.gen(function* () {
    yield* FiberMap.clear(followed);
    yield* FiberMap.clear(inboxFollows);
    yield* FiberHandle.clear(accountFollow);
    for (const key of yield* RcMap.keys(transcripts)) yield* RcMap.invalidate(transcripts, key);
    yield* held.clear;
    for (const scope of yield* RcMap.keys(inboxes)) yield* RcMap.invalidate(inboxes, scope);
    for (const userId of yield* RcMap.keys(accounts)) yield* RcMap.invalidate(accounts, userId);
    yield* sessionReads.end;
  });

  return {
    methods,
    lifetime: Effect.void,
    open: sessionReads.open(LIVE_READ.INBOX_ITEMS, followItems),
    reset,
  };
}
