import type { HostedAgentClient } from "@repo/features";
import {
  AGENT_CALL_FAILURE,
  type AgentAccountInboxAnswerView,
  type AgentAgentAnswer,
  type AgentArchiveParams,
  type AgentChangesAnswerView,
  type AgentChooseParams,
  type AgentDeleteAnswerView,
  type AgentGitHubImageView,
  type AgentInboxAnsweredView,
  type AgentInboxAnswerParams,
  type AgentInboxAttachmentView,
  type AgentInboxCloseParams,
  type AgentInboxItemHomeView,
  type AgentInboxMessagedView,
  type AgentInboxMessageParams,
  type AgentInboxReadAllParams,
  type AgentInboxReadAllView,
  type AgentInboxReadStateParams,
  type AgentInboxReadStateView,
  type AgentInboxRemindParams,
  type AgentListAnswer,
  type AgentMarkReadParams,
  type AgentMessagesAnswerView,
  type AgentPageAnswerView,
  type AgentPartView,
  type AgentPinParams,
  type AgentPullRequestWriteAnswerView,
  type AgentRenameParams,
  type AgentServersParams,
  type AgentStartParams,
  type AgentTranscriptOlderAnswer,
  agentAddRepositoryParamsSchema,
  agentArchiveParamsSchema,
  agentChooseParamsSchema,
  agentDefaultWriteParamsSchema,
  agentGitHubImageParamsSchema,
  agentInboxAnswerParamsSchema,
  agentInboxAttachmentParamsSchema,
  agentInboxCloseParamsSchema,
  agentInboxItemHomeParamsSchema,
  agentInboxMessageParamsSchema,
  agentInboxReadAllParamsSchema,
  agentInboxReadStateParamsSchema,
  agentInboxRemindParamsSchema,
  agentInboxScopeSchema,
  agentInboxStartParamsSchema,
  agentListParamsSchema,
  agentMarkReadParamsSchema,
  agentMessageParamsSchema,
  agentMessagesParamsSchema,
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
  type ChatGptDevicePollAnswerView,
  type ChatGptDeviceStartAnswerView,
  chatGptDeviceLoginParamsSchema,
  chatGptDeviceWaitParamsSchema,
  type DictationTranscribeAnswerView,
  dictationTranscribeParamsSchema,
  type GitHubTokenAnswerView,
  githubTokenSaveParamsSchema,
  hostIdParamsSchema,
  INBOX_SCOPE_KIND,
  memoriesFollowParamsSchema,
  memoryForgetParamsSchema,
  type ProviderKeysAnswerView,
  providerKeyForAgentsParamsSchema,
  providerKeyRemoveParamsSchema,
  providerKeySaveParamsSchema,
  pullRequestPartParamsSchema,
  TRANSCRIPT_KIND,
} from "@repo/features/agent-view";
import {
  AGENT_ARCHIVER,
  type AgentSummary,
  CONTEXT_WINDOW,
  MAC_PRESENCE,
} from "@repo/features/agent-wire";
import { FAILURE_FACT, type FailureFacts, GATE_CLOSED_BY } from "@repo/features/failure-facts";
import { GITHUB_IMAGE_SOURCE, githubImageOf } from "@repo/features/github-image";
import {
  type HostPairingApproveView,
  type HostPairingDenyView,
  type HostPairingView,
  hostPairingParamsSchema,
} from "@repo/features/host-pairing-view";
import type { DevicePresenceAnswer } from "@repo/features/host-wire";
import type { InboxItem } from "@repo/features/inbox-wire";
import {
  acknowledgedNow,
  answeredNow,
  asksOpen,
  closedNow,
  type InboxReader,
} from "@repo/features/inbox-writes";
import { WRITE_UNTAKEN, writeUntakenOf } from "@repo/features/keyed-write";
import { LIVE_READ, type LiveRead } from "@repo/features/live-wire";
import { MODEL_CATALOG_TTL, type ModelsAnswer } from "@repo/features/models-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { CHATGPT_DEVICE_LOGIN, type ProviderKeysAnswer } from "@repo/features/provider-key-wire";
import {
  type PullRequestChaptersAnswerView,
  pullRequestChaptersParamsSchema,
  pullRequestChaptersReadParamsSchema,
} from "@repo/features/pull-request-chapters-view";
import { markedAs } from "@repo/features/read-mark";
import { commitShaSchema } from "@repo/features/task-wire";
import type { WorkspaceToolsAnswer } from "@repo/features/workspace-tools-wire";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  invalid,
  readParams,
} from "@repo/gateway";
import {
  type AnyWrite,
  anyWrite,
  declaredMethod,
  type EntityPool,
  type FieldChange,
  ROW_GONE,
  type WriteDeclaration,
} from "@repo/sync";
import type { WireRecord, WireValue } from "@repo/wire";
import {
  Clock,
  Duration,
  Effect,
  FiberHandle,
  FiberMap,
  Option,
  RcMap,
  Schedule,
  Schema,
  type Scope,
  Stream,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { type AccountInboxes, accountInboxes, followAccountInbox } from "./account-inbox-follow.js";
import { followAccountItems } from "./account-items-follow.js";
import { agentDefaultWritten, heldAccountPreferences } from "./account-preferences-follow.js";
import { type AgentQueues, agentQueues, type QueueWrite } from "./agent-queue-writes.js";
import {
  type AppAccountPreferences,
  type AppAgentOrigins,
  type AppChapters,
  type AppDevicePresence,
  type AppDevicePresences,
  type AppGitHubToken,
  type AppGitHubTokens,
  type AppHolderInboxes,
  type AppHostRead,
  type AppHosts,
  type AppInboxItems,
  type AppMemories,
  type AppModels,
  type AppProviderKeyList,
  type AppProviderKeys,
  type AppTranscript,
  type AppTranscripts,
  type AppWorkspaceTools,
  NO_KEYS_HELD,
  NO_TRANSCRIPTS,
  OWN_TRANSCRIPT,
  UNREAD,
} from "./app-state.js";
import { ChaptersKey, heldChapters } from "./chapters-follow.js";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { HostMethodTable } from "./gateway-door.js";
import { type AccountHeld, accountHeld, type HeldFetch, heldFetch } from "./held-fetch.js";
import type { HostKernel } from "./host-kernel.js";
import { heldHosts, hostRemove } from "./hosts-follow.js";
import {
  type AccountWideReads,
  accountWideReads,
  INBOX_CHANGE,
  INBOX_ITEM,
  type InboxChange,
  type InboxWritten,
  inboxSent,
} from "./inbox-collections.js";
import {
  AgentPictureKey,
  GitHubImageKey,
  InboxAttachmentKey,
  type KeptAnswer,
  type KeptContent,
  type KeptKey,
  keptOfAgent,
} from "./kept-content.js";
import {
  type AccountReads,
  accountReads,
  type HeldRows,
  type HeldSlice,
  heldSlice,
} from "./live-collection.js";
import { heldMemories, memoryForget } from "./memory-follow.js";
import { heldAgentOrigins } from "./origin-follow.js";
import {
  type PullRequestListing,
  type PullRequestParts,
  pullRequestParts,
} from "./pull-request-parts.js";
import { untaken } from "./queued-writes.js";
import type { RunMode } from "./run-mode.js";
import {
  holderInboxes,
  InboxScopeKey,
  type ScopeInboxes,
  scopeInboxes,
} from "./scope-inbox-follow.js";
import { AGENT, type AgentRow } from "./task-list-collections.js";
import {
  followTranscript,
  HELD_BYTES,
  HELD_BYTES_EACH,
  HELD_TRANSCRIPTS,
  heldTranscript,
  type TranscriptFollows,
  TranscriptKey,
  transcriptFollows,
  windowsPage,
  withOlderPage,
} from "./transcript-follow.js";
import type { WindowFocus } from "./window-focus.js";

export type AgentClient = Pick<
  HostedAgentClient,
  | "pullRequestChaptersLive"
  | "agentOriginLive"
  | "generateChapters"
  | "models"
  | "accountPreferencesLive"
  | "writeDefault"
  | "hostsLive"
  | "devicePresence"
  | "removeHost"
  | "readHostPairing"
  | "approveHostPairing"
  | "denyHostPairing"
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
  | "addRepository"
  | "changeQueue"
  | "archive"
  | "pin"
  | "markRead"
  | "stop"
  | "rewind"
  | "delete"
  | "agent"
  | "pullRequest"
  | "changes"
  | "overviewPullRequest"
  | "reviewOptions"
  | "workspaceTools"
  | "overviewChecks"
  | "overviewConversation"
  | "githubImage"
  | "pullRequestAction"
  | "pullRequestViewed"
  | "readProviderKeys"
  | "saveProviderKey"
  | "removeProviderKey"
  | "setProviderKeyForAgents"
  | "startChatGptDeviceLogin"
  | "pollChatGptDeviceLogin"
  | "cancelChatGptDeviceLogin"
  | "readGitHubToken"
  | "saveGitHubToken"
  | "removeGitHubToken"
  | "workspaceMemoriesLive"
  | "forgetMemory"
  | "transcribeDictation"
  | "answerInbox"
  | "closeInbox"
  | "messageInbox"
  | "startInboxThread"
  | "markInboxItemRead"
  | "remindInboxItem"
  | "inboxItemHome"
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
  accountId: () => string | undefined;
  kept: KeptContent;
  focus: WindowFocus;
  reader?: () => InboxReader | undefined;
  listed?: (txid: string | undefined) => Effect.Effect<void>;
  pullRequestListings?: Effect.Effect<Stream.Stream<PullRequestListing>, never, Scope.Scope>;
  pool: EntityPool;
  agentListed?: (agentId: string) => AgentSummary | undefined;
  repositoriesMoved?: Effect.Effect<void>;
}

export interface AgentsComposer extends Composer {
  readonly open: Effect.Effect<void>;
  readonly reset: Effect.Effect<void>;
  readonly queueable: readonly AnyWrite[];
}

interface GateClosed {
  readonly failure: typeof AGENT_CALL_FAILURE.UNANSWERED;
  readonly cause: FailureFacts;
}

function closedBy({ kernel, account }: AgentsDependencies): string | undefined {
  if (!kernel.runMode.sendsNetwork) return GATE_CLOSED_BY.NO_NETWORK;
  return account.capabilitiesActive() ? undefined : GATE_CLOSED_BY.NO_ACCOUNT;
}

function gateClosed(by: string): GateClosed {
  return {
    failure: AGENT_CALL_FAILURE.UNANSWERED,
    cause: { _tag: FAILURE_FACT.GATE_CLOSED, code: by },
  };
}

const isCommitSha = Schema.is(commitShaSchema);

function isKeptImage(src: string): boolean {
  const image = githubImageOf(src);
  if (image?.source === GITHUB_IMAGE_SOURCE.ASSET) return true;
  return image?.source === GITHUB_IMAGE_SOURCE.FILE && isCommitSha(image.ref);
}

function deviceSettled(answer: ChatGptDevicePollAnswerView): boolean {
  return "failure" in answer || answer.outcome !== CHATGPT_DEVICE_LOGIN.PENDING;
}

function gateOf(dependencies: AgentsDependencies): () => boolean {
  return () => closedBy(dependencies) === undefined;
}

function askedOf(dependencies: AgentsDependencies, http: HttpClient.HttpClient) {
  return <Answer>(
    call: Effect.Effect<Answer, never, HttpClient.HttpClient>,
  ): Effect.Effect<Answer | GateClosed> => {
    const by = closedBy(dependencies);
    return by === undefined
      ? Effect.provideService(call, HttpClient.HttpClient, http)
      : Effect.succeed(gateClosed(by));
  };
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
    const gate = gateOf(dependencies);
    const queues = yield* agentQueues(dependencies.pool);
    const transcriptSlice = yield* heldSlice<typeof LIVE_READ.TRANSCRIPT, TranscriptKey>({
      empty: NO_TRANSCRIPTS,
      path: (key) => [key.agentId, key.callId ?? OWN_TRANSCRIPT],
      gate,
      follow: (key, answers) =>
        Effect.scoped(
          Effect.flatMap(
            key.callId === undefined
              ? queues.held(key.agentId, answers)
              : Effect.succeed(heldTranscript(answers)),
            (held) =>
              followTranscript(
                transcripts,
                key,
                {
                  newest: () => asked(client.messagesNewest(key.agentId, key.callId, true)),
                  after: (after) => asked(client.messagesNow(key.agentId, after, key.callId, true)),
                },
                held,
              ),
          ),
        ),
      tell: (held: AppTranscripts) =>
        dependencies.kernel.emit(GATEWAY_EVENT.TRANSCRIPTS_CHANGED, carried(held)),
      pause: true,
      budget: { reads: HELD_TRANSCRIPTS, bytes: HELD_BYTES, bytesEach: HELD_BYTES_EACH },
    });
    const transcriptHolds = yield* FiberMap.make<TranscriptKey>();
    const accountWide = accountWideReads();
    const inboxes = yield* scopeInboxes({
      seal: (scope, poll, userId, after) =>
        asked(
          scope.kind === INBOX_SCOPE_KIND.PLAN
            ? client.taskInboxLive(scope.id, userId, poll, after)
            : client.agentInboxLive(scope.id, userId, poll, after),
        ),
      accountId: dependencies.accountId,
      pool: dependencies.pool,
    });
    const accounts = yield* accountInboxes({
      seal: (userId, poll, after) => asked(client.accountInboxLive(userId, poll, after)),
      pool: dependencies.pool,
      accountWide,
    });
    const tellItems = (read: AppHostRead<AppInboxItems>) =>
      Effect.sync(() => dependencies.kernel.emit(GATEWAY_EVENT.INBOX_ITEMS_CHANGED, carried(read)));
    const holders = yield* holderInboxes(inboxes, {
      gate,
      tell: (held: AppHolderInboxes) =>
        dependencies.kernel.emit(GATEWAY_EVENT.HOLDER_INBOXES_CHANGED, carried(held)),
    });
    const chapters = yield* heldChapters({
      seal: (key, poll, userId, after) =>
        asked(client.pullRequestChaptersLive(key.agentId, key.number, userId, poll, after)),
      accountId: dependencies.accountId,
      gate,
      tell: (held: AppChapters) =>
        dependencies.kernel.emit(GATEWAY_EVENT.CHAPTERS_CHANGED, carried(held)),
    });
    const origins = yield* heldAgentOrigins({
      seal: (agentId, poll, userId, after) =>
        asked(client.agentOriginLive(agentId, userId, poll, after)),
      accountId: dependencies.accountId,
      gate,
      tell: (held: AppAgentOrigins) =>
        dependencies.kernel.emit(GATEWAY_EVENT.AGENT_ORIGINS_CHANGED, carried(held)),
    });
    const sessionReads = yield* accountReads<LiveRead>(
      () => (gate() ? dependencies.accountId() : undefined),
      tellItems(UNREAD),
    );
    const followItems = (userId: string) =>
      followAccountItems(
        {
          seal: (account, sync) => asked(client.accountInboxItemsLive(account, sync)),
          pool: dependencies.pool,
          accountWide,
        },
        userId,
        tellItems,
      );
    const preferences = yield* heldAccountPreferences({
      seal: (userId, poll, after) => asked(client.accountPreferencesLive(userId, poll, after)),
      gate,
      pool: dependencies.pool,
      tell: (held: AppAccountPreferences) =>
        dependencies.kernel.emit(GATEWAY_EVENT.ACCOUNT_PREFERENCES_CHANGED, carried(held)),
    });
    const holdPreferences = (userId: string) =>
      Effect.scoped(Effect.andThen(preferences.hold(userId), Effect.never));
    const memories = yield* heldMemories({
      seal: (workspaceId, userId, poll, after) =>
        asked(client.workspaceMemoriesLive(workspaceId, userId, poll, after)),
      accountId: dependencies.accountId,
      gate,
      pool: dependencies.pool,
      tell: (held: AppMemories) =>
        dependencies.kernel.emit(GATEWAY_EVENT.MEMORIES_CHANGED, carried(held)),
    });
    const hosts = yield* heldHosts({
      seal: (userId, poll, after) => asked(client.hostsLive(userId, poll, after)),
      accountId: dependencies.accountId,
      gate,
      pool: dependencies.pool,
      tell: (held: AppHosts) =>
        dependencies.kernel.emit(GATEWAY_EVENT.HOSTS_CHANGED, carried(held)),
    });
    const hostsHold = yield* accountHeld(hosts, dependencies.accountId);
    const inboxHolds = yield* FiberMap.make<InboxScopeKey>();
    const chapterHolds = yield* FiberMap.make<ChaptersKey>();
    const memoryHolds = yield* FiberMap.make<string>();
    const originHolds = yield* FiberMap.make<string>();
    const accountFollow = yield* FiberHandle.make();
    const fetched = yield* fetchedReads(dependencies, asked);
    const parts = yield* pullRequestParts({
      gate,
      focus: dependencies.focus,
      ask: {
        pullRequest: (key) => asked(client.overviewPullRequest(key.agentId, key.number)),
        checks: (key) => asked(client.overviewChecks(key.agentId, key.number)),
        conversation: (key) => asked(client.overviewConversation(key.agentId, key.number)),
        published: (key) => asked(client.pullRequest(key.agentId, key.number)),
        reviewOptions: (key) => asked(client.reviewOptions(key.agentId)),
        viewed: (key) => asked(client.pullRequestViewed(key.agentId, key.number)),
      },
      listings: dependencies.pullRequestListings ?? Effect.succeed(Stream.empty),
      tell: (held) =>
        dependencies.kernel.emit(GATEWAY_EVENT.PULL_REQUEST_PARTS_CHANGED, carried(held)),
    });
    return composed(
      dependencies,
      http,
      { transcripts, slice: transcriptSlice, holds: transcriptHolds, queues },
      { inboxes, holders, holds: inboxHolds, accountWide },
      { accounts, followed: accountFollow },
      { reads: sessionReads, followItems, preferences, holdPreferences },
      { chapters, holds: chapterHolds },
      { memories, holds: memoryHolds },
      { origins, holds: originHolds },
      { hosts, hold: hostsHold },
      fetched,
      parts,
    );
  });
}

interface Transcripts {
  readonly transcripts: TranscriptFollows;
  readonly slice: HeldSlice<TranscriptKey> & HeldRows<TranscriptKey, AppTranscript>;
  readonly holds: FiberMap.FiberMap<TranscriptKey>;
  readonly queues: AgentQueues;
}

interface ScopeFollows {
  readonly inboxes: ScopeInboxes;
  readonly holders: HeldSlice<InboxScopeKey>;
  readonly holds: FiberMap.FiberMap<InboxScopeKey>;
  readonly accountWide: AccountWideReads;
}

interface AccountFollow {
  readonly accounts: AccountInboxes;
  readonly followed: FiberHandle.FiberHandle;
}

interface SessionReads {
  readonly reads: AccountReads<LiveRead>;
  readonly followItems: (userId: string) => Effect.Effect<void>;
  readonly preferences: HeldSlice<string>;
  readonly holdPreferences: (userId: string) => Effect.Effect<void>;
}

interface ChapterFollows {
  readonly chapters: HeldSlice<ChaptersKey>;
  readonly holds: FiberMap.FiberMap<ChaptersKey>;
}

interface MemoryFollows {
  readonly memories: HeldSlice<string>;
  readonly holds: FiberMap.FiberMap<string>;
}

interface OriginFollows {
  readonly origins: HeldSlice<string>;
  readonly holds: FiberMap.FiberMap<string>;
}

interface HostsFollows {
  readonly hosts: HeldSlice<string>;
  readonly hold: AccountHeld;
}

interface FetchedReads {
  readonly presence: HeldFetch<string, AppDevicePresence>;
  readonly presenceHold: AccountHeld;
  readonly tools: HeldFetch<string, WorkspaceToolsAnswer>;
  readonly toolsHolds: FiberMap.FiberMap<string>;
  readonly models: HeldFetch<string, ModelsAnswer>;
  readonly modelsHold: AccountHeld;
  readonly keys: HeldFetch<string, AppProviderKeyList>;
  readonly keysHold: AccountHeld;
  readonly token: HeldFetch<string, AppGitHubToken>;
  readonly tokenHold: AccountHeld;
}

function keyListOf(answer: ProviderKeysAnswer): AppProviderKeyList {
  return answer.subscriptions === undefined
    ? { keys: answer.keys }
    : { keys: answer.keys, subscriptions: answer.subscriptions };
}

function presenceOf(answer: DevicePresenceAnswer, askedAt: number): AppDevicePresence {
  return {
    beats: answer.devices.map(({ deviceId, ageMs }) => ({ deviceId, beatAt: askedAt - ageMs })),
    askedAt,
  };
}

function fetchedReads(
  dependencies: AgentsDependencies,
  asked: ReturnType<typeof askedOf>,
): Effect.Effect<FetchedReads, never, Scope.Scope> {
  return Effect.gen(function* () {
    const { client, kernel, focus, accountId } = dependencies;
    const gate = gateOf(dependencies);
    const presence = yield* heldFetch<typeof LIVE_READ.DEVICE_PRESENCE, string>({
      empty: NO_KEYS_HELD,
      path: (userId) => [userId],
      gate,
      focus,
      every: Duration.millis(MAC_PRESENCE.POLL_MS),
      fetch: (userId, held) =>
        Effect.gen(function* () {
          if (userId !== accountId()) return Option.none();
          const answer = yield* Effect.timeoutOption(
            asked(client.devicePresence()),
            Duration.millis(MAC_PRESENCE.READ_TIMEOUT_MS),
          );
          const askedAt = yield* Clock.currentTimeMillis;
          if (Option.isSome(answer) && !("failure" in answer.value)) {
            return Option.some(presenceOf(answer.value, askedAt));
          }
          return held === undefined
            ? Option.none()
            : Option.some({ beats: held.beats, askedAt, stale: true as const });
        }),
      tell: (held: AppDevicePresences) =>
        kernel.emit(GATEWAY_EVENT.DEVICE_PRESENCE_CHANGED, carried(held)),
    });
    const tools = yield* heldFetch<typeof LIVE_READ.WORKSPACE_TOOLS, string>({
      empty: NO_KEYS_HELD,
      path: (agentId) => [agentId],
      gate,
      focus,
      fetch: (agentId) =>
        Effect.map(asked(client.workspaceTools(agentId)), (answer) =>
          "tools" in answer ? Option.some(answer) : Option.none(),
        ),
      tell: (held: AppWorkspaceTools) =>
        kernel.emit(GATEWAY_EVENT.WORKSPACE_TOOLS_CHANGED, carried(held)),
    });
    const models = yield* heldFetch<typeof LIVE_READ.MODELS, string>({
      empty: NO_KEYS_HELD,
      path: (userId) => [userId],
      gate,
      focus,
      every: MODEL_CATALOG_TTL,
      fetch: (userId) =>
        userId === accountId()
          ? Effect.map(asked(client.models()), (answer) =>
              "failure" in answer ? Option.none() : Option.some(answer),
            )
          : Effect.succeed(Option.none()),
      tell: (held: AppModels) => kernel.emit(GATEWAY_EVENT.MODELS_CHANGED, carried(held)),
    });
    const keys = yield* heldFetch<typeof LIVE_READ.PROVIDER_KEYS, string>({
      empty: NO_KEYS_HELD,
      path: (userId) => [userId],
      gate,
      focus,
      fetch: (userId, held) =>
        userId === accountId()
          ? Effect.flatMap(asked(client.readProviderKeys()), (answer) => {
              if ("failure" in answer) return Effect.succeed(Option.none());
              const list = keyListOf(answer);
              const moved = held !== undefined && JSON.stringify(held) !== JSON.stringify(list);
              return Effect.as(moved ? models.wake(() => true) : Effect.void, Option.some(list));
            })
          : Effect.succeed(Option.none()),
      tell: (held: AppProviderKeys) =>
        kernel.emit(GATEWAY_EVENT.PROVIDER_KEYS_CHANGED, carried(held)),
    });
    const token = yield* heldFetch<typeof LIVE_READ.GITHUB_TOKEN, string>({
      empty: NO_KEYS_HELD,
      path: (userId) => [userId],
      gate,
      focus,
      fetch: (userId) =>
        userId === accountId()
          ? Effect.map(asked(client.readGitHubToken()), (answer) =>
              "failure" in answer ? Option.none() : Option.some({ token: answer.token }),
            )
          : Effect.succeed(Option.none()),
      tell: (held: AppGitHubTokens) =>
        kernel.emit(GATEWAY_EVENT.GITHUB_TOKEN_CHANGED, carried(held)),
    });
    return {
      presence,
      presenceHold: yield* accountHeld(presence, accountId),
      tools,
      toolsHolds: yield* FiberMap.make<string>(),
      models,
      modelsHold: yield* accountHeld(models, accountId),
      keys,
      keysHold: yield* accountHeld(keys, accountId),
      token,
      tokenHold: yield* accountHeld(token, accountId),
    };
  });
}

function composed(
  dependencies: AgentsDependencies,
  http: HttpClient.HttpClient,
  { transcripts, slice: transcriptSlice, holds: transcriptHolds, queues }: Transcripts,
  { inboxes, holders, holds: inboxHolds, accountWide }: ScopeFollows,
  { accounts, followed: accountFollow }: AccountFollow,
  { reads: sessionReads, followItems, preferences, holdPreferences }: SessionReads,
  { chapters, holds: chapterHolds }: ChapterFollows,
  { memories, holds: memoryHolds }: MemoryFollows,
  { origins, holds: originHolds }: OriginFollows,
  { hosts, hold: hostsHold }: HostsFollows,
  {
    presence,
    presenceHold,
    tools,
    toolsHolds,
    models,
    modelsHold,
    keys,
    keysHold,
    token,
    tokenHold,
  }: FetchedReads,
  parts: PullRequestParts,
): AgentsComposer {
  const { client, kernel, kept } = dependencies;
  const gate = gateOf(dependencies);
  const gateKept = () => gateClosed(closedBy(dependencies) ?? GATE_CLOSED_BY.NO_ACCOUNT);
  const asked = askedOf(dependencies, http);
  const keptAsked = <Key extends KeptKey, Answer>(
    key: Key,
    call: Effect.Effect<Answer, never, HttpClient.HttpClient>,
    carries: (answer: Answer | GateClosed) => KeptAnswer<Key> | undefined,
  ) => (gate() ? kept.answer(key, dependencies.accountId, asked(call), carries) : asked(call));
  const listed = dependencies.listed ?? (() => Effect.void);
  const agentWrite = <Input extends { readonly agentId: string }>(
    change: (input: Input) => FieldChange<AgentRow>,
    send: (input: Input, key: string | undefined) => Effect.Effect<AgentAgentAnswer>,
    queue?: { readonly name: string; readonly input: Schema.Codec<Input, unknown> },
  ): WriteDeclaration<AgentRow, FieldChange<AgentRow>, Input, WireValue> => {
    const keptAs = ({ agentId }: Input): WireValue => {
      const agent = dependencies.agentListed?.(agentId);
      return carried<AgentAgentAnswer>(
        agent === undefined ? { failure: AGENT_CALL_FAILURE.UNANSWERED } : { agent },
      );
    };
    return {
      kind: AGENT,
      keys: ({ agentId }) => [agentId],
      change,
      send: (input, { key }) =>
        Effect.map(send(input, key), (answered) => {
          if ("agent" in answered) {
            return { answer: carried<AgentAgentAnswer>(answered), txid: answered.txid };
          }
          const refused = carried<AgentAgentAnswer>(answered);
          if (queue === undefined) return { refused };
          return untaken(writeUntakenOf(answered.cause), { kept: keptAs(input), refused });
        }),
      ...(queue === undefined ? undefined : { queue: { ...queue, queued: keptAs } }),
    };
  };
  const chosen = agentWrite<AgentChooseParams>(
    (choice) => () => ({
      model: choice.model,
      effort: choice.effort,
      contextWindow: choice.contextWindow ?? CONTEXT_WINDOW.LONG,
    }),
    ({ agentId, ...choice }) => asked(client.choose(agentId, choice)),
  );
  const renamed = agentWrite<AgentRenameParams>(
    (request) => () => ({ title: request.title.length === 0 ? null : request.title }),
    ({ agentId, ...request }, key) => asked(client.rename(agentId, request, key)),
    { name: GATEWAY_METHOD.AGENTS_RENAME, input: agentRenameParamsSchema },
  );
  const switched = agentWrite<AgentServersParams>(
    (request) => () => ({ disabledServers: request.disabledServers }),
    ({ agentId, ...request }) => asked(client.switchServers(agentId, request)),
  );
  const archived = agentWrite<AgentArchiveParams>(
    ({ archived: archive }) => {
      const archiver = reader();
      const at = kernel.now();
      return () =>
        archive
          ? {
              archivedAt: at,
              archivedBy:
                archiver === undefined
                  ? null
                  : { by: AGENT_ARCHIVER.MEMBER, userId: archiver.userId },
              archiverName: archiver?.name ?? null,
            }
          : { archivedAt: null, archivedBy: null, archiverName: null };
    },
    ({ agentId, ...request }) =>
      Effect.tap(asked(client.archive(agentId, request)), (answer) =>
        "agent" in answer
          ? Effect.andThen(
              transcriptSlice.drop((key) => key.agentId === agentId),
              kept.forget(keptOfAgent(agentId)),
            )
          : Effect.void,
      ),
  );
  const queued = queues.write((agentId, change) => asked(client.changeQueue(agentId, change)));
  const deleted: WriteDeclaration<
    AgentRow,
    FieldChange<AgentRow>,
    { readonly agentId: string },
    WireValue
  > = {
    kind: AGENT,
    keys: ({ agentId }) => [agentId],
    change: () => () => ROW_GONE,
    send: ({ agentId }) =>
      Effect.gen(function* () {
        const answer = yield* asked(client.delete(agentId));
        if (!("deleted" in answer)) return { refused: carried<AgentDeleteAnswerView>(answer) };
        yield* kept.forget(keptOfAgent(agentId));
        return { answer: carried<AgentDeleteAnswerView>(answer), txid: answer.txid };
      }),
  };
  const pinned = agentWrite<AgentPinParams>(
    (request) => (row) =>
      request.pinned
        ? {
            pinnedAt: row.pinnedAt ?? kernel.now(),
            pinPosition: request.position ?? (row.pinnedAt === null ? null : row.pinPosition),
          }
        : { pinnedAt: null, pinPosition: null },
    ({ agentId, ...request }, key) => asked(client.pin(agentId, request, key)),
    { name: GATEWAY_METHOD.AGENTS_PIN, input: agentPinParamsSchema },
  );
  const markedRead = agentWrite<AgentMarkReadParams>(
    ({ readMark }) =>
      (row) =>
        markedAs(readMark, row, kernel.now()),
    ({ agentId, ...request }, key) => asked(client.markRead(agentId, request, key)),
    { name: GATEWAY_METHOD.AGENTS_MARK_READ, input: agentMarkReadParamsSchema },
  );
  const started: WriteDeclaration<
    AgentRow,
    FieldChange<AgentRow>,
    AgentStartParams,
    AgentAgentAnswer
  > = {
    kind: AGENT,
    keys: () => [],
    change: () => () => ({}),
    send: ({ taskId, ...request }) =>
      Effect.map(
        asked(taskId === undefined ? client.startFrom(request) : client.start(taskId, request)),
        (answered) => {
          if ("agent" in answered) return { answer: answered, txid: answered.txid };
          return writeUntakenOf(answered.cause) === WRITE_UNTAKEN.UNANSWERED
            ? { refused: answered, unanswered: true as const }
            : { refused: answered };
        },
      ),
    queue: {
      name: GATEWAY_METHOD.AGENTS_START,
      input: agentStartParamsSchema,
      queued: () => ({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
      holds: () => true,
    },
  };

  const reader = () => dependencies.reader?.();

  const writtenOf = (
    answer:
      | { readonly failure: unknown; readonly cause?: Parameters<typeof writeUntakenOf>[0] }
      | { readonly txid?: string; readonly item?: InboxItem; readonly taken?: boolean },
  ): InboxWritten =>
    "failure" in answer
      ? { txid: undefined, item: undefined, kept: false }
      : { txid: answer.txid, item: answer.item, kept: answer.taken !== false };

  const inboxWrite = <Input, Answer extends Parameters<typeof writtenOf>[0]>(
    keys: (input: Input) => readonly string[],
    change: (input: Input) => InboxChange,
    send: (input: Input, key: string | undefined) => Effect.Effect<Answer>,
    queue?: {
      readonly name: string;
      readonly input: Schema.Codec<Input, unknown>;
      readonly queued: (input: Input) => Answer;
    },
  ): WriteDeclaration<InboxItem, InboxChange, Input, WireValue> => {
    const keptAs =
      queue === undefined ? undefined : (input: Input) => carried<Answer>(queue.queued(input));
    return {
      kind: INBOX_ITEM,
      keys,
      change,
      send: (input, { key }) =>
        Effect.map(send(input, key), (answer) => {
          const answered = carried<Answer>(answer);
          if (keptAs === undefined || !("failure" in answer)) {
            return inboxSent(answered, writtenOf(answer));
          }
          return untaken(writeUntakenOf(answer.cause), { kept: keptAs(input), refused: answered });
        }),
      ...(queue === undefined || keptAs === undefined
        ? undefined
        : { queue: { name: queue.name, input: queue.input, queued: keptAs } }),
    };
  };
  const settledAs = ({ itemId }: { readonly itemId: string }): AgentInboxAnsweredView => {
    const item = dependencies.pool.row(INBOX_ITEM, itemId);
    return item === undefined ? { failure: AGENT_CALL_FAILURE.UNANSWERED } : { item, taken: true };
  };
  const nodded = inboxWrite<AgentInboxAnswerParams, AgentInboxAnsweredView>(
    ({ itemId }) => [itemId],
    ({ itemId, revision }) => {
      const [by, at] = [reader(), kernel.now()];
      return {
        kind: INBOX_CHANGE.SETTLED,
        itemId,
        item: (item) => (item.revision === revision ? acknowledgedNow(item, by, at) : undefined),
      };
    },
    ({ itemId, ...request }, key) => asked(client.answerInbox(itemId, request, key)),
    {
      name: GATEWAY_METHOD.AGENTS_INBOX_ANSWER,
      input: agentInboxAnswerParamsSchema,
      queued: settledAs,
    },
  );
  const closed = inboxWrite<AgentInboxCloseParams, AgentInboxAnsweredView>(
    ({ itemId }) => [itemId],
    ({ itemId, revision }) => {
      const [by, at] = [reader(), kernel.now()];
      return {
        kind: INBOX_CHANGE.SETTLED,
        itemId,
        item: (item) => (item.revision === revision ? closedNow(item, by, at) : undefined),
      };
    },
    ({ itemId, ...request }, key) => asked(client.closeInbox(itemId, request, key)),
    {
      name: GATEWAY_METHOD.AGENTS_INBOX_CLOSE,
      input: agentInboxCloseParamsSchema,
      queued: settledAs,
    },
  );
  const messaged = inboxWrite<AgentInboxMessageParams, AgentInboxMessagedView>(
    ({ itemId }) => [itemId],
    ({ itemId, answers, clientKey: key, text }) => {
      if (answers === undefined) {
        return { kind: INBOX_CHANGE.MARKED, itemIds: new Set([itemId]), unread: false };
      }
      const [by, at] = [reader(), kernel.now()];
      return {
        kind: INBOX_CHANGE.SETTLED,
        itemId,
        item: (item) =>
          asksOpen(item, answers.ask)
            ? answeredNow(item, { key, text, answers }, by, at)
            : undefined,
      };
    },
    ({ itemId, ...request }) => asked(client.messageInbox(itemId, request)),
  );
  const marked = inboxWrite<AgentInboxReadStateParams, AgentInboxReadStateView>(
    ({ itemId }) => [itemId],
    ({ itemId, unread }) => ({ kind: INBOX_CHANGE.MARKED, itemIds: new Set([itemId]), unread }),
    ({ itemId, unread }, key) =>
      asked(
        unread ? client.markInboxItemUnread(itemId, key) : client.markInboxItemRead(itemId, key),
      ),
    {
      name: GATEWAY_METHOD.AGENTS_INBOX_READ_STATE,
      input: agentInboxReadStateParamsSchema,
      queued: ({ itemId, unread }) => ({ id: itemId, unread }),
    },
  );
  const reminded = inboxWrite<AgentInboxRemindParams, AgentInboxReadStateView>(
    ({ itemId }) => [itemId],
    ({ itemId, until }) => ({ kind: INBOX_CHANGE.REMINDED, itemId, until, at: kernel.now() }),
    ({ itemId, until }, key) => asked(client.remindInboxItem(itemId, until, key)),
    {
      name: GATEWAY_METHOD.AGENTS_INBOX_REMIND,
      input: agentInboxRemindParamsSchema,
      queued: ({ itemId }) => ({
        id: itemId,
        unread: dependencies.pool.row(INBOX_ITEM, itemId)?.unread === true,
      }),
    },
  );
  const markedAll = inboxWrite<AgentInboxReadAllParams, AgentInboxReadAllView>(
    ({ itemIds }) => itemIds,
    ({ itemIds }) => ({ kind: INBOX_CHANGE.MARKED, itemIds: new Set(itemIds), unread: false }),
    ({ itemIds: _listed, ...request }, key) => asked(client.markInboxRead(request, key)),
    {
      name: GATEWAY_METHOD.AGENTS_INBOX_READ_ALL,
      input: agentInboxReadAllParamsSchema,
      queued: ({ itemIds }) => ({ marked: itemIds.length }),
    },
  );

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

  const keysWritten = (answer: ProviderKeysAnswerView) =>
    Effect.as(keysAnswered(answer), carried<ProviderKeysAnswerView>(answer));
  const keysAnswered = (answer: ProviderKeysAnswerView) =>
    Effect.suspend(() => {
      const userId = dependencies.accountId();
      return userId === undefined || !("keys" in answer)
        ? Effect.void
        : Effect.andThen(
            keys.answered(userId, keyListOf(answer)),
            models.wake(() => true),
          );
    });

  const deviceAnswered = (answer: ChatGptDevicePollAnswerView) =>
    Effect.as(
      "keys" in answer && answer.keys !== undefined ? keysAnswered(answer.keys) : Effect.void,
      carried<ChatGptDevicePollAnswerView>(answer),
    );

  const tokenWritten = (answer: GitHubTokenAnswerView) =>
    Effect.as(
      Effect.suspend(() => {
        if ("failure" in answer) return Effect.void;
        const userId = dependencies.accountId();
        return Effect.andThen(
          dependencies.repositoriesMoved ?? Effect.void,
          userId === undefined ? Effect.void : token.answered(userId, { token: answer.token }),
        );
      }),
      carried<GitHubTokenAnswerView>(answer),
    );

  const methods: HostMethodTable = {
    [GATEWAY_METHOD.AGENTS_MODELS_FOLLOW]: () => Effect.as(modelsHold.follow, {}),
    [GATEWAY_METHOD.AGENTS_MODELS_UNFOLLOW]: () => Effect.as(modelsHold.unfollow, {}),
    [GATEWAY_METHOD.AGENTS_MODELS_RETRY]: () =>
      Effect.suspend(() => {
        const userId = dependencies.accountId();
        return Effect.as(userId === undefined ? Effect.void : models.retry(userId), {});
      }),
    [GATEWAY_METHOD.AGENTS_DEFAULT_WRITE]: declaredMethod(
      dependencies.pool,
      agentDefaultWritten((choice) => asked(client.writeDefault(choice)), dependencies.accountId),
      (params: WireRecord) =>
        readParams(
          agentDefaultWriteParamsSchema,
          params,
          "the default names a model and its effort",
        ),
    ),
    [GATEWAY_METHOD.HOSTS_FOLLOW]: () => Effect.as(hostsHold.follow, {}),
    [GATEWAY_METHOD.HOSTS_UNFOLLOW]: () => Effect.as(hostsHold.unfollow, {}),
    [GATEWAY_METHOD.HOSTS_RETRY]: () =>
      Effect.suspend(() => {
        const userId = dependencies.accountId();
        return Effect.as(userId === undefined ? Effect.void : hosts.retry(userId), {});
      }),
    [GATEWAY_METHOD.HOSTS_PRESENCE_FOLLOW]: () => Effect.as(presenceHold.follow, {}),
    [GATEWAY_METHOD.HOSTS_PRESENCE_UNFOLLOW]: () => Effect.as(presenceHold.unfollow, {}),
    [GATEWAY_METHOD.HOSTS_PRESENCE_REFRESH]: () =>
      Effect.gen(function* () {
        yield* presence.wake(() => true);
        return {};
      }),
    [GATEWAY_METHOD.HOSTS_REMOVE]: declaredMethod(
      dependencies.pool,
      hostRemove((id) => asked(client.removeHost(id))),
      (params: WireRecord) =>
        Effect.map(
          readParams(hostIdParamsSchema, params, "a remove names a host"),
          (read) => read.id,
        ),
    ),
    [GATEWAY_METHOD.HOSTS_PAIRING_READ]: (params) =>
      Effect.gen(function* () {
        const { code } = yield* readParams(hostPairingParamsSchema, params, "a read names a code");
        return carried<HostPairingView>(yield* asked(client.readHostPairing(code)));
      }),
    [GATEWAY_METHOD.HOSTS_PAIRING_APPROVE]: (params) =>
      Effect.gen(function* () {
        const { code } = yield* readParams(
          hostPairingParamsSchema,
          params,
          "an approve names a code",
        );
        return carried<HostPairingApproveView>(yield* asked(client.approveHostPairing(code)));
      }),
    [GATEWAY_METHOD.HOSTS_PAIRING_DENY]: (params) =>
      Effect.gen(function* () {
        const { code } = yield* readParams(hostPairingParamsSchema, params, "a deny names a code");
        return carried<HostPairingDenyView>(yield* asked(client.denyHostPairing(code)));
      }),
    [GATEWAY_METHOD.PROVIDER_KEYS_FOLLOW]: () => Effect.as(keysHold.follow, {}),
    [GATEWAY_METHOD.PROVIDER_KEYS_UNFOLLOW]: () => Effect.as(keysHold.unfollow, {}),
    [GATEWAY_METHOD.PROVIDER_KEYS_RETRY]: () =>
      Effect.suspend(() => {
        const userId = dependencies.accountId();
        return Effect.as(userId === undefined ? Effect.void : keys.retry(userId), {});
      }),
    [GATEWAY_METHOD.PROVIDER_KEYS_SAVE]: (params) =>
      Effect.gen(function* () {
        const save = yield* readParams(
          providerKeySaveParamsSchema,
          params,
          "a save names a provider and a key",
        );
        return yield* keysWritten(yield* asked(client.saveProviderKey(save)));
      }),
    [GATEWAY_METHOD.MEMORIES_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const { workspaceId } = yield* readParams(
          memoriesFollowParamsSchema,
          params,
          "following memories names a workspace",
        );
        yield* FiberMap.run(
          memoryHolds,
          workspaceId,
          Effect.scoped(Effect.andThen(memories.hold(workspaceId), Effect.never)),
          { onlyIfMissing: true },
        );
        return {};
      }),
    [GATEWAY_METHOD.MEMORIES_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const { workspaceId } = yield* readParams(
          memoriesFollowParamsSchema,
          params,
          "letting memories go names a workspace",
        );
        yield* FiberMap.remove(memoryHolds, workspaceId);
        return {};
      }),
    [GATEWAY_METHOD.MEMORIES_RETRY]: (params) =>
      Effect.gen(function* () {
        const { workspaceId } = yield* readParams(
          memoriesFollowParamsSchema,
          params,
          "reading memories again names a workspace",
        );
        yield* memories.retry(workspaceId);
        return {};
      }),
    [GATEWAY_METHOD.MEMORIES_FORGET]: declaredMethod(
      dependencies.pool,
      memoryForget((forget) => asked(client.forgetMemory(forget))),
      (params: WireRecord) =>
        readParams(
          memoryForgetParamsSchema,
          params,
          "a forget names a workspace and a memory's id",
        ),
    ),
    [GATEWAY_METHOD.DICTATION_TRANSCRIBE]: (params) =>
      Effect.gen(function* () {
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
        return yield* keysWritten(yield* asked(client.removeProviderKey(removal)));
      }),
    [GATEWAY_METHOD.PROVIDER_KEYS_FOR_AGENTS]: (params) =>
      Effect.gen(function* () {
        const change = yield* readParams(
          providerKeyForAgentsParamsSchema,
          params,
          "a default names a provider, a plan, and on or off",
        );
        return yield* keysWritten(yield* asked(client.setProviderKeyForAgents(change)));
      }),
    [GATEWAY_METHOD.CHATGPT_DEVICE_START]: () =>
      Effect.map(asked(client.startChatGptDeviceLogin()), (answer) =>
        carried<ChatGptDeviceStartAnswerView>(answer),
      ),
    [GATEWAY_METHOD.CHATGPT_DEVICE_WAIT]: (params) =>
      Effect.gen(function* () {
        const { loginId, intervalSeconds } = yield* readParams(
          chatGptDeviceWaitParamsSchema,
          params,
          "a wait names a login and its interval",
        );
        const interval = Duration.seconds(intervalSeconds);
        const poll = Effect.suspend(() => asked(client.pollChatGptDeviceLogin({ loginId })));
        const answer = yield* Effect.andThen(
          Effect.sleep(interval),
          Effect.repeat(poll, { schedule: Schedule.spaced(interval), until: deviceSettled }),
        );
        return yield* deviceAnswered(answer);
      }),
    [GATEWAY_METHOD.CHATGPT_DEVICE_CANCEL]: (params) =>
      Effect.gen(function* () {
        const login = yield* readParams(
          chatGptDeviceLoginParamsSchema,
          params,
          "a cancel names a login",
        );
        return yield* deviceAnswered(yield* asked(client.cancelChatGptDeviceLogin(login)));
      }),
    [GATEWAY_METHOD.GITHUB_TOKEN_FOLLOW]: () => Effect.as(tokenHold.follow, {}),
    [GATEWAY_METHOD.GITHUB_TOKEN_UNFOLLOW]: () => Effect.as(tokenHold.unfollow, {}),
    [GATEWAY_METHOD.GITHUB_TOKEN_RETRY]: () =>
      Effect.suspend(() => {
        const userId = dependencies.accountId();
        return Effect.as(userId === undefined ? Effect.void : token.retry(userId), {});
      }),
    [GATEWAY_METHOD.GITHUB_TOKEN_SAVE]: (params) =>
      Effect.gen(function* () {
        const save = yield* readParams(githubTokenSaveParamsSchema, params, "a save names a token");
        return yield* tokenWritten(yield* asked(client.saveGitHubToken(save)));
      }),
    [GATEWAY_METHOD.GITHUB_TOKEN_REMOVE]: () =>
      Effect.flatMap(asked(client.removeGitHubToken()), tokenWritten),
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
        const start = yield* readParams(
          agentStartParamsSchema,
          params,
          "starting an agent names a task or an agent to start from, and the press's own key",
        );
        const answer = yield* dependencies.pool.write(started, start);
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
        const answer = yield* asked(client.messagesNow(agentId, after, callId));
        return carried<AgentMessagesAnswerView>(windowsPage(answer));
      }),
    [GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const { key } = yield* agentTranscriptOf(params);
        yield* FiberMap.run(
          transcriptHolds,
          key,
          Effect.scoped(Effect.andThen(transcriptSlice.hold(key), Effect.never)),
          { onlyIfMissing: true },
        );
        return {};
      }),
    [GATEWAY_METHOD.AGENTS_TRANSCRIPT_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const { key } = yield* agentTranscriptOf(params);
        yield* FiberMap.remove(transcriptHolds, key);
        return {};
      }),
    [GATEWAY_METHOD.AGENTS_TRANSCRIPT_RETRY]: (params) =>
      Effect.gen(function* () {
        const { key } = yield* agentTranscriptOf(params);
        yield* transcriptSlice.retry(key);
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
        if ("failure" in answer) return carried<AgentTranscriptOlderAnswer>(answer);
        const key = new TranscriptKey({ agentId, callId });
        const laid = withOlderPage(transcriptSlice.rowsOf(key), before, answer);
        if (laid !== undefined) transcriptSlice.lay(key, laid);
        return carried<AgentTranscriptOlderAnswer>({ landed: laid !== undefined });
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
        return carried<AgentAgentAnswer>({ agent: answer.agent });
      }),
    [GATEWAY_METHOD.AGENTS_CHOOSE]: declaredMethod(
      dependencies.pool,
      chosen,
      (params: WireRecord) =>
        readParams(
          agentChooseParamsSchema,
          params,
          "changing an agent's model names the agent, a model, and its effort",
        ),
    ),
    [GATEWAY_METHOD.AGENTS_RENAME]: declaredMethod(
      dependencies.pool,
      renamed,
      (params: WireRecord) =>
        readParams(
          agentRenameParamsSchema,
          params,
          "renaming an agent names the agent and its title",
        ),
    ),
    [GATEWAY_METHOD.AGENTS_SERVERS]: declaredMethod(
      dependencies.pool,
      switched,
      (params: WireRecord) =>
        readParams(
          agentServersParamsSchema,
          params,
          "switching an agent's MCP servers names the agent and the servers off",
        ),
    ),
    [GATEWAY_METHOD.AGENTS_QUEUE]: declaredMethod(dependencies.pool, queued, (params: WireRecord) =>
      Effect.map(
        readParams(
          agentQueueParamsSchema,
          params,
          "changing an agent's queue names the agent and the change",
        ),
        (read): QueueWrite => ({ ...read, queuedBy: dependencies.accountId() ?? "" }),
      ),
    ),
    [GATEWAY_METHOD.AGENTS_ARCHIVE]: declaredMethod(
      dependencies.pool,
      archived,
      (params: WireRecord) =>
        readParams(
          agentArchiveParamsSchema,
          params,
          "archiving an agent names the agent and whether it is archived",
        ),
    ),
    [GATEWAY_METHOD.AGENTS_PIN]: declaredMethod(dependencies.pool, pinned, (params: WireRecord) =>
      readParams(
        agentPinParamsSchema,
        params,
        "pinning an agent names the agent and whether it is pinned",
      ),
    ),
    [GATEWAY_METHOD.AGENTS_MARK_READ]: declaredMethod(
      dependencies.pool,
      markedRead,
      (params: WireRecord) =>
        readParams(
          agentMarkReadParamsSchema,
          params,
          "marking an agent read names the agent and how its mark moves",
        ),
    ),
    [GATEWAY_METHOD.AGENTS_ADD_REPOSITORY]: (params) =>
      Effect.gen(function* () {
        const { agentId, addRepository } = yield* readParams(
          agentAddRepositoryParamsSchema,
          params,
          "adding a repository to an agent names the agent and the repository",
        );
        const answer = yield* asked(client.addRepository(agentId, { addRepository }));
        return carried<AgentAgentAnswer>(answer);
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
    [GATEWAY_METHOD.AGENTS_DELETE]: declaredMethod(
      dependencies.pool,
      deleted,
      (params: WireRecord) =>
        readParams(agentStopParamsSchema, params, "deleting an agent names one agent"),
    ),
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
    [GATEWAY_METHOD.AGENTS_ORIGIN_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const { agentId } = yield* readParams(
          agentPageParamsSchema,
          params,
          "following the run that started an agent names one agent",
        );
        yield* FiberMap.run(
          originHolds,
          agentId,
          Effect.scoped(Effect.andThen(origins.hold(agentId), Effect.never)),
          { onlyIfMissing: true },
        );
        return {};
      }),
    [GATEWAY_METHOD.AGENTS_ORIGIN_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const { agentId } = yield* readParams(
          agentPageParamsSchema,
          params,
          "letting the run that started an agent go names one agent",
        );
        yield* FiberMap.remove(originHolds, agentId);
        return {};
      }),
    [GATEWAY_METHOD.AGENTS_ORIGIN_RETRY]: (params) =>
      Effect.gen(function* () {
        const { agentId } = yield* readParams(
          agentPageParamsSchema,
          params,
          "reading the run that started an agent again names one agent",
        );
        yield* origins.retry(agentId);
        return {};
      }),
    [GATEWAY_METHOD.AGENTS_PULL_REQUEST_PART_FOLLOW]: (params) =>
      Effect.as(
        Effect.flatMap(
          readParams(
            pullRequestPartParamsSchema,
            params,
            "following a pull request's part names the part and one agent",
          ),
          parts.follow,
        ),
        {},
      ),
    [GATEWAY_METHOD.AGENTS_PULL_REQUEST_PART_UNFOLLOW]: (params) =>
      Effect.as(
        Effect.flatMap(
          readParams(
            pullRequestPartParamsSchema,
            params,
            "letting a pull request's part go names the part and one agent",
          ),
          parts.unfollow,
        ),
        {},
      ),
    [GATEWAY_METHOD.AGENTS_PULL_REQUEST_PART_RETRY]: (params) =>
      Effect.as(
        Effect.flatMap(
          readParams(
            pullRequestPartParamsSchema,
            params,
            "reading a pull request's part again names the part and one agent",
          ),
          parts.retry,
        ),
        {},
      ),
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
    [GATEWAY_METHOD.AGENTS_CHAPTERS_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const key = new ChaptersKey(
          yield* readParams(
            pullRequestChaptersReadParamsSchema,
            params,
            "following a pull request's chapters names one agent and its pull request's number",
          ),
        );
        yield* FiberMap.run(
          chapterHolds,
          key,
          Effect.scoped(Effect.andThen(chapters.hold(key), Effect.never)),
          { onlyIfMissing: true },
        );
        return {};
      }),
    [GATEWAY_METHOD.AGENTS_CHAPTERS_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const key = new ChaptersKey(
          yield* readParams(
            pullRequestChaptersReadParamsSchema,
            params,
            "letting a pull request's chapters go names one agent and its pull request's number",
          ),
        );
        yield* FiberMap.remove(chapterHolds, key);
        return {};
      }),
    [GATEWAY_METHOD.AGENTS_CHAPTERS_RETRY]: (params) =>
      Effect.gen(function* () {
        const key = new ChaptersKey(
          yield* readParams(
            pullRequestChaptersReadParamsSchema,
            params,
            "reading a pull request's chapters again names one agent and its pull request's number",
          ),
        );
        yield* chapters.retry(key);
        return {};
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
    [GATEWAY_METHOD.AGENTS_WORKSPACE_TOOLS_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const { agentId } = yield* readParams(
          agentPullRequestParamsSchema,
          params,
          `following an agent's ${PRODUCT_NAME} tools names one agent`,
        );
        yield* FiberMap.run(
          toolsHolds,
          agentId,
          Effect.scoped(Effect.andThen(tools.hold(agentId), Effect.never)),
          { onlyIfMissing: true },
        );
        return {};
      }),
    [GATEWAY_METHOD.AGENTS_WORKSPACE_TOOLS_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const { agentId } = yield* readParams(
          agentPullRequestParamsSchema,
          params,
          `letting an agent's ${PRODUCT_NAME} tools go names one agent`,
        );
        yield* FiberMap.remove(toolsHolds, agentId);
        return {};
      }),
    [GATEWAY_METHOD.AGENTS_WORKSPACE_TOOLS_RETRY]: (params) =>
      Effect.gen(function* () {
        const { agentId } = yield* readParams(
          agentPullRequestParamsSchema,
          params,
          `reading an agent's ${PRODUCT_NAME} tools again names one agent`,
        );
        yield* tools.retry(agentId);
        return {};
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
    [GATEWAY_METHOD.AGENTS_GITHUB_IMAGE]: (params) =>
      Effect.gen(function* () {
        const { agentId, src } = yield* readParams(
          agentGitHubImageParamsSchema,
          params,
          "reading an image of an agent's pull request names the agent and the image's address",
        );
        const call = client.githubImage(agentId, src);
        const answer = yield* isKeptImage(src)
          ? keptAsked(new GitHubImageKey({ agentId, src }), call, (image) =>
              "base64" in image ? image : undefined,
            )
          : asked(call);
        return carried<AgentGitHubImageView>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_INBOX_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const scope = yield* readParams(
          agentInboxScopeSchema,
          params,
          "following an inbox names a plan or an agent",
        );
        const key = new InboxScopeKey(scope);
        yield* FiberMap.run(
          inboxHolds,
          key,
          Effect.scoped(Effect.andThen(holders.hold(key), Effect.never)),
          { onlyIfMissing: true },
        );
        return {};
      }),
    [GATEWAY_METHOD.AGENTS_INBOX_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const scope = yield* readParams(
          agentInboxScopeSchema,
          params,
          "letting an inbox go names a plan or an agent",
        );
        yield* FiberMap.remove(inboxHolds, new InboxScopeKey(scope));
        return {};
      }),
    [GATEWAY_METHOD.AGENTS_INBOX_RETRY]: (params) =>
      Effect.gen(function* () {
        const scope = yield* readParams(
          agentInboxScopeSchema,
          params,
          "reading an inbox again names a plan or an agent",
        );
        yield* holders.retry(new InboxScopeKey(scope));
        return {};
      }),
    [GATEWAY_METHOD.AGENTS_INBOX_ATTACHMENT]: (params) =>
      Effect.gen(function* () {
        const { itemId, attachmentId } = yield* readParams(
          agentInboxAttachmentParamsSchema,
          params,
          "reading an inbox item's image names the item and the attachment",
        );
        const answer = yield* keptAsked(
          new InboxAttachmentKey({ itemId, attachmentId }),
          client.inboxAttachment(itemId, attachmentId),
          (attachment) => ("base64" in attachment ? attachment : undefined),
        );
        return carried<AgentInboxAttachmentView>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_PICTURE]: (params) =>
      Effect.gen(function* () {
        const { agentId, pictureId, callId } = yield* readParams(
          agentPictureParamsSchema,
          params,
          "reading an agent's picture names the agent and the picture",
        );
        const answer = yield* keptAsked(
          new AgentPictureKey({ agentId, pictureId, callId }),
          client.agentPicture(agentId, pictureId, callId),
          (picture) => ("base64" in picture ? picture : undefined),
        );
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
    [GATEWAY_METHOD.AGENTS_INBOX_ANSWER]: declaredMethod(
      dependencies.pool,
      nodded,
      (params: WireRecord) =>
        readParams(
          agentInboxAnswerParamsSchema,
          params,
          "acknowledging an inbox notice names the item, the revision it acknowledges, the acknowledgment, and the nod's key",
        ),
    ),
    [GATEWAY_METHOD.AGENTS_INBOX_CLOSE]: declaredMethod(
      dependencies.pool,
      closed,
      (params: WireRecord) =>
        readParams(
          agentInboxCloseParamsSchema,
          params,
          "closing an inbox item names the item, the revision it closes, the close's key, and the note it may carry",
        ),
    ),
    [GATEWAY_METHOD.AGENTS_INBOX_MESSAGE]: declaredMethod(
      dependencies.pool,
      messaged,
      (params: WireRecord) =>
        readParams(
          agentInboxMessageParamsSchema,
          params,
          "a message on an inbox item names the item, the words or files, and the message's key",
        ),
    ),
    [GATEWAY_METHOD.AGENTS_INBOX_START]: (params) =>
      Effect.gen(function* () {
        const request = yield* readParams(
          agentInboxStartParamsSchema,
          params,
          "a new inbox thread names the agent, its subject, the words or files, and the thread's key",
        );
        const answer = yield* asked(client.startInboxThread(request));
        yield* accountWide.confirm("failure" in answer ? undefined : answer.txid);
        return carried<AgentInboxMessagedView>(answer);
      }),
    [GATEWAY_METHOD.AGENTS_INBOX_READ_STATE]: declaredMethod(
      dependencies.pool,
      marked,
      (params: WireRecord) =>
        readParams(
          agentInboxReadStateParamsSchema,
          params,
          "marking an inbox item names the item and whether it reads as unread",
        ),
    ),
    [GATEWAY_METHOD.AGENTS_INBOX_REMIND]: declaredMethod(
      dependencies.pool,
      reminded,
      (params: WireRecord) =>
        readParams(
          agentInboxRemindParamsSchema,
          params,
          "setting an inbox item's reminder names the item and when, or none to cancel it",
        ),
    ),
    [GATEWAY_METHOD.AGENTS_INBOX_ITEM_HOME]: (params) =>
      Effect.gen(function* () {
        const { itemId } = yield* readParams(
          agentInboxItemHomeParamsSchema,
          params,
          "finding where an inbox item stands names the item",
        );
        return carried<AgentInboxItemHomeView>(yield* asked(client.inboxItemHome(itemId)));
      }),
    [GATEWAY_METHOD.AGENTS_INBOX_READ_ALL]: declaredMethod(
      dependencies.pool,
      markedAll,
      (params: WireRecord) =>
        readParams(
          agentInboxReadAllParamsSchema,
          params,
          "marking the inbox read names the workspace it lists, where it lists one, and the items it lists there",
        ),
    ),
    [GATEWAY_METHOD.AGENTS_ACCOUNT_INBOX_FOLLOW]: () =>
      Effect.gen(function* () {
        const tell = (answer: AgentAccountInboxAnswerView) =>
          Effect.sync(() => kernel.emit(GATEWAY_EVENT.ACCOUNT_INBOX_CHANGED, carried(answer)));
        const userId = dependencies.accountId();
        const follow =
          gate() && userId !== undefined
            ? followAccountInbox(accounts, userId, tell)
            : tell(gateKept());
        yield* FiberHandle.run(accountFollow, follow);
        return {};
      }),
    [GATEWAY_METHOD.AGENTS_ACCOUNT_INBOX_UNFOLLOW]: () =>
      Effect.as(FiberHandle.clear(accountFollow), {}),
    [GATEWAY_METHOD.AGENTS_INBOX_ITEMS_RETRY]: () =>
      Effect.as(sessionReads.reopen(LIVE_READ.INBOX_ITEMS, followItems), {}),
    [GATEWAY_METHOD.AGENTS_PREFERENCES_RETRY]: () =>
      Effect.suspend(() => {
        const userId = dependencies.accountId();
        return Effect.as(userId === undefined ? Effect.void : preferences.retry(userId), {});
      }),
  };

  const reset = Effect.gen(function* () {
    yield* transcriptSlice.end;
    yield* holders.end;
    yield* chapters.end;
    yield* memories.end;
    yield* origins.end;
    yield* hosts.end;
    yield* FiberHandle.clear(accountFollow);
    for (const key of yield* RcMap.keys(transcripts)) yield* RcMap.invalidate(transcripts, key);
    yield* kept.clear;
    for (const scope of yield* RcMap.keys(inboxes)) yield* RcMap.invalidate(inboxes, scope);
    for (const userId of yield* RcMap.keys(accounts)) yield* RcMap.invalidate(accounts, userId);
    yield* sessionReads.end;
    yield* preferences.end;
    yield* presence.end;
    yield* tools.end;
    yield* models.end;
    yield* keys.end;
    yield* token.end;
    yield* parts.end;
  });

  const open = Effect.gen(function* () {
    yield* sessionReads.open(LIVE_READ.INBOX_ITEMS, followItems);
    yield* sessionReads.open(LIVE_READ.ACCOUNT_PREFERENCES, holdPreferences);
    yield* transcriptSlice.open;
    yield* holders.open;
    yield* chapters.open;
    yield* memories.open;
    yield* origins.open;
    yield* presenceHold.open;
    yield* hostsHold.open;
    yield* modelsHold.open;
    yield* keysHold.open;
    yield* tokenHold.open;
    yield* tools.open;
    yield* parts.open;
  });

  return {
    methods,
    lifetime: Effect.void,
    open,
    reset,
    queueable: [
      anyWrite(started),
      anyWrite(renamed),
      anyWrite(pinned),
      anyWrite(nodded),
      anyWrite(closed),
      anyWrite(marked),
      anyWrite(reminded),
      anyWrite(markedAll),
    ],
  };
}
