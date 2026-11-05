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
  type AgentInboxSnoozeParams,
  type AgentListAnswer,
  type AgentMessagesAnswerView,
  type AgentPageAnswerView,
  type AgentPartView,
  type AgentPinParams,
  type AgentPullRequestWriteAnswerView,
  type AgentRenameParams,
  type AgentServersParams,
  type AgentStartParams,
  type AgentTranscriptOlderAnswer,
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
  agentInboxScopeSchema,
  agentInboxSnoozeParamsSchema,
  agentInboxStartParamsSchema,
  agentListParamsSchema,
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
  type ChatGptSignInAnswerView,
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
  closedNow,
  type InboxReader,
} from "@repo/features/inbox-writes";
import { WRITE_UNTAKEN, writeUntakenOf } from "@repo/features/keyed-write";
import { LIVE_READ, type LiveRead } from "@repo/features/live-wire";
import { MODEL_CATALOG_TTL, type ModelsAnswer } from "@repo/features/models-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import type { ProviderKeysAnswer } from "@repo/features/provider-key-wire";
import {
  chaptersModelWriteParamsSchema,
  type PullRequestChaptersAnswerView,
  pullRequestChaptersParamsSchema,
  pullRequestChaptersReadParamsSchema,
} from "@repo/features/pull-request-chapters-view";
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
  Schema,
  type Scope,
  Stream,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { type AccountInboxes, accountInboxes, followAccountInbox } from "./account-inbox-follow.js";
import { followAccountItems } from "./account-items-follow.js";
import {
  agentDefaultWritten,
  chaptersModelWritten,
  heldAccountPreferences,
} from "./account-preferences-follow.js";
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

/**
 * compose-agents.ts -- a task's coding agents, asked of the service on the window's behalf: the models, the account's default, its own provider keys, the agents, one started, one's transcript, one messaged, one's model changed, one stopped, what one published, a clip dictated into an agent's box heard as words, the task's inbox, one item of it answered, and what waits across the account.
 *
 * Nothing is held here but the transcripts' subscriptions, the held
 * inboxes' (`scope-inbox-follow.ts`), told as `HOLDER_INBOXES_CHANGED`
 * events to the app state every window draws, and the reads the host
 * fetches for the windows that hold them (`held-fetch.ts`): when the
 * account's devices last beat, asked every `MAC_PRESENCE.POLL_MS` while
 * held, and an agent's own tools, each told the same way; and each
 * workspace's memories Settings › Memory holds, followed live into the
 * sync engine's pool (`memory-follow.ts`) and told as `MEMORIES_CHANGED`,
 * a forget drawn gone over them the moment it is asked. The window holds the agents it draws and the cursor it reads
 * from, asks when a task opens, when it starts or stops an agent, and while
 * an agent's tab shows its running transcript, and every ask is one call of
 * the service answered whole. An agent's or a worker's transcript is held
 * for the windows whose tab shows it and the few let go lately
 * (`heldSlice`), followed on the service's held poll of what its pages are
 * read from (`transcript-follow.ts`) only while a window holds it, and told
 * as `TRANSCRIPTS_CHANGED` events to the app state every window draws; a
 * sign-out lets every one go. What waits across the account is followed the same way, on the
 * account's own live read (`account-inbox-follow.ts`), heard as
 * `ACCOUNT_INBOX_CHANGED` events by main's notices rather than a window
 * (`agent-notices.ts`). Every item the account reaches is followed whole
 * on one read of its own (`account-items-follow.ts`) for the signed-in
 * session (`accountReads`), from the gate opening (`open`) until a
 * sign-out, told as `INBOX_ITEMS_CHANGED` events to the app state every
 * window draws. A picture a tool answered an agent, an inbox item's
 * attachment, and an image of a pull request that never changes under its
 * address are answered to the window that asked and kept in this process's
 * memory for the account (`kept-content.ts`), never in app state, so one
 * shown again asks the service nothing. Behind a
 * closed account gate, or on a run that sends nothing, every ask answers
 * unanswered. A provider key passes through on its way to the service and
 * is held nowhere here; no answer carries one back.
 */

/** The service's side of the agents, as this concern asks it. */
export type AgentClient = Pick<
  HostedAgentClient,
  | "pullRequestChaptersLive"
  | "agentOriginLive"
  | "generateChapters"
  | "writeChaptersModel"
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
  | "changeQueue"
  | "archive"
  | "pin"
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
  | "snoozeInboxItem"
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
  /** The account signed in now, by its id, which every live read names; none where nobody is. */
  accountId: () => string | undefined;
  /** The content this host keeps under keys it never changes under, which a picture's, an attachment's, and an image's reads answer from (`kept-content.ts`). */
  kept: KeptContent;
  /** The windows coming forward, on which every fetched read a window holds is asked again. */
  focus: WindowFocus;
  /** The member signed in now, as an answer or a close drawn before the service says how it stands names them; none where nobody is. */
  reader?: () => InboxReader | undefined;
  /**
   * Waits for a write's transaction to arrive on the task list followed
   * live, which holds every agent's row (`TasksComposer.listed`), so a
   * Start is answered once the list carries it; none waits for nothing.
   */
  listed?: (txid: string | undefined) => Effect.Effect<void>;
  /** The task list as each drawing of it stands, from the caller's listening on (`TasksComposer.pullRequestListings`), on which the Pull request tabs' parts are asked again; none moves nothing. */
  pullRequestListings?: Effect.Effect<Stream.Stream<PullRequestListing>, never, Scope.Scope>;
  /**
   * The sync engine's pool, which an agent's row of the task list stands in
   * and a rename, an archive, a pin, a change of model, or a switch of MCP
   * servers is drawn over (`task-list-collections.ts`).
   */
  pool: EntityPool;
  /** The agent as the task list shows it now, which a rename or a pin waiting for the service answers its caller with; none where the list shows no such agent. */
  agentListed?: (agentId: string) => AgentSummary | undefined;
  /** Every workspace's repositories the windows hold asked again, as a token saved or removed moves them (`TasksComposer.repositoriesMoved`); none asks nothing. */
  repositoriesMoved?: Effect.Effect<void>;
}

export interface AgentsComposer extends Composer {
  /** The session's account reads opened for the account signed in, as the gate opening opens them. */
  readonly open: Effect.Effect<void>;
  /** The account's keys as an answer of the service's leaves them, as a ChatGPT sign-in answers them, laid where the windows hold them; nothing where it carries none. */
  readonly keysAnswered: (
    answer: ProviderKeysAnswerView | ChatGptSignInAnswerView,
  ) => Effect.Effect<void>;
  /** Every transcript's, every plan's and agent's inbox's, the account inbox's, and the account's items' subscription let go, as a sign-out lets them go. */
  readonly reset: Effect.Effect<void>;
  /** The row writes this composer declares that may wait for the service, which a queue kept on disk is laid back by. */
  readonly queueable: readonly AnyWrite[];
}

/** What a call the closed gate kept from the service answers: unanswered, as the window draws it, with why the host asked nothing. */
interface GateClosed {
  readonly failure: typeof AGENT_CALL_FAILURE.UNANSWERED;
  readonly cause: FailureFacts;
}

/** Why the service may not be asked now: a run that sends nothing, or no account behind the gate; none where it may. */
function closedBy({ kernel, account }: AgentsDependencies): string | undefined {
  if (!kernel.runMode.sendsNetwork) return GATE_CLOSED_BY.NO_NETWORK;
  return account.capabilitiesActive() ? undefined : GATE_CLOSED_BY.NO_ACCOUNT;
}

/** The answer of a call the gate kept from the service, saying why, so it is never reported as a service that did not answer. */
function gateClosed(by: string): GateClosed {
  return {
    failure: AGENT_CALL_FAILURE.UNANSWERED,
    cause: { _tag: FAILURE_FACT.GATE_CLOSED, code: by },
  };
}

/** Whether a commit names a read, by the rule a File tab's read at a commit is held to. */
const isCommitSha = Schema.is(commitShaSchema);

/**
 * Whether an image of a pull request never changes under its address: an
 * upload, by its asset's id, or a file at a commit. A file on a branch, or a
 * public image, may. Note that the ref is checked here, because
 * `githubImageOf` leaves it as written, and a branch kept as if it were a
 * commit would answer what it held once.
 */
function isKeptImage(src: string): boolean {
  const image = githubImageOf(src);
  if (image?.source === GITHUB_IMAGE_SOURCE.ASSET) return true;
  return image?.source === GITHUB_IMAGE_SOURCE.FILE && isCommitSha(image.ref);
}

/** Whether the service may be asked now: a run that sends, behind an open account gate. */
function gateOf(dependencies: AgentsDependencies): () => boolean {
  return () => closedBy(dependencies) === undefined;
}

/** The service asked behind the gate, over the host's own HTTP client. */
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
    // Note that a transcript no window holds stops following, its messages standing for a window that steps back to it, since a working agent nobody looks at would otherwise stream its journal on.
    const transcriptSlice = yield* heldSlice<typeof LIVE_READ.TRANSCRIPT, TranscriptKey>({
      empty: NO_TRANSCRIPTS,
      path: (key) => [key.agentId, key.callId ?? OWN_TRANSCRIPT],
      gate,
      // The window draws a followed page, so its heavy parts come cut, each fetched whole as it opens; an agent's own carries its queue, which stands in the pool.
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
    // Note that a session's reads close before the window is told it holds none, so nothing the last account drew lands after.
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
    // Note that the row is held for the session rather than by a window, so the read stands until the session's reads close.
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

/** The transcripts' subscriptions the windows share, the held lifetime over the transcripts the windows hold, and the windows' holds, one fiber per transcript held. */
interface Transcripts {
  readonly transcripts: TranscriptFollows;
  readonly slice: HeldSlice<TranscriptKey> & HeldRows<TranscriptKey, AppTranscript>;
  readonly holds: FiberMap.FiberMap<TranscriptKey>;
  /** Each agent's queue in the pool, fed from its own transcript, and the change of one. */
  readonly queues: AgentQueues;
}

/** The scopes' subscriptions the windows share, the held lifetime over them, and the windows' holds, one fiber per scope held. */
interface ScopeFollows {
  readonly inboxes: ScopeInboxes;
  readonly holders: HeldSlice<InboxScopeKey>;
  readonly holds: FiberMap.FiberMap<InboxScopeKey>;
  /** The account's own reads, which a thread started, drawing nothing, waits on. */
  readonly accountWide: AccountWideReads;
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
  /** The account's preferences row, held for the session by `holdPreferences`. */
  readonly preferences: HeldSlice<string>;
  readonly holdPreferences: (userId: string) => Effect.Effect<void>;
}

/** The held lifetime over every agent's pull request's chapters the windows hold, and the windows' holds, one fiber per pull request held. */
interface ChapterFollows {
  readonly chapters: HeldSlice<ChaptersKey>;
  readonly holds: FiberMap.FiberMap<ChaptersKey>;
}

/** The held lifetime over every workspace's memories the windows hold, and the windows' holds, one fiber per workspace held. */
interface MemoryFollows {
  readonly memories: HeldSlice<string>;
  readonly holds: FiberMap.FiberMap<string>;
}

/** The held lifetime over every agent's origin the windows hold, and the windows' holds, one fiber per agent held. */
interface OriginFollows {
  readonly origins: HeldSlice<string>;
  readonly holds: FiberMap.FiberMap<string>;
}

/** The account's hosts the windows hold, and the windows' one hold on them under the account signed in. */
interface HostsFollows {
  readonly hosts: HeldSlice<string>;
  readonly hold: AccountHeld;
}

/** The reads the host fetches for the windows that hold them, and the windows' holds on them. */
interface FetchedReads {
  /** When the account's own devices last beat, by the account. */
  readonly presence: HeldFetch<string, AppDevicePresence>;
  /** The windows' hold on the beats, under the account signed in. */
  readonly presenceHold: AccountHeld;
  /** Our own tools each agent is offered, by the agent. */
  readonly tools: HeldFetch<string, WorkspaceToolsAnswer>;
  /** The windows' hold on each agent's tools, one fiber standing until let go. */
  readonly toolsHolds: FiberMap.FiberMap<string>;
  /** The models a coding agent may run on as the account is offered them, and its devices, by the account. */
  readonly models: HeldFetch<string, ModelsAnswer>;
  /** The windows' hold on the models, under the account signed in. */
  readonly modelsHold: AccountHeld;
  /** The account's own provider keys, by the account. */
  readonly keys: HeldFetch<string, AppProviderKeyList>;
  /** The windows' hold on the keys, under the account signed in. */
  readonly keysHold: AccountHeld;
  /** The account's own GitHub token, by the account. */
  readonly token: HeldFetch<string, AppGitHubToken>;
  /** The windows' hold on the token, under the account signed in. */
  readonly tokenHold: AccountHeld;
}

/** The keys and plans an answer of the service's says the account holds, without what it says of the one write. */
function keyListOf(answer: ProviderKeysAnswer): AppProviderKeyList {
  return answer.subscriptions === undefined
    ? { keys: answer.keys }
    : { keys: answer.keys, subscriptions: answer.subscriptions };
}

/** The beats as the service answered them, each aged at `askedAt`, the host's instant as the answer landed. */
function presenceOf(answer: DevicePresenceAnswer, askedAt: number): AppDevicePresence {
  return {
    beats: answer.devices.map(({ deviceId, ageMs }) => ({ deviceId, beatAt: askedAt - ageMs })),
    askedAt,
  };
}

/**
 * The fetched reads behind the gate, each told whole on its slice. Note
 * that the beats, the models, the keys, and the GitHub token are asked for
 * the account signed in now alone, since the service answers that
 * account's; that the models are asked again as the keys move, since a key,
 * a plan, or a plan's default moves which models no credential pays for;
 * and that
 * an ask of the beats which fails, or runs past
 * `MAC_PRESENCE.READ_TIMEOUT_MS`, after one answered keeps the beats it
 * answered, marked stale, under the new instant, so a window says it cannot
 * check rather than that a device left.
 */
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
          // Note that a read past its bound counts as one that failed, so a window says it cannot check rather than letting every device age away while it hangs.
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
              // Note that the first answer asks nothing of the models, which are asked as a window holds them.
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

/** The composer's one table, built from its seams; nothing here starts anything but a transcript's or a scope's inbox subscription, while a window reads it. */
function composed(
  dependencies: AgentsDependencies,
  http: HttpClient.HttpClient,
  { transcripts, slice: transcriptSlice, holds: transcriptHolds, queues }: Transcripts,
  { inboxes, holders, holds: inboxHolds, accountWide }: ScopeFollows,
  /** What waits across the account, and main's one follow of it. */
  { accounts, followed: accountFollow }: AccountFollow,
  /** The session's account reads, every item the account reaches and its preferences among them. */
  { reads: sessionReads, followItems, preferences, holdPreferences }: SessionReads,
  /** The pull requests' chapters the windows hold. */
  { chapters, holds: chapterHolds }: ChapterFollows,
  /** The workspaces' memories Settings › Memory holds. */
  { memories, holds: memoryHolds }: MemoryFollows,
  /** The agents' origins the windows hold. */
  { origins, holds: originHolds }: OriginFollows,
  /** The account's hosts Settings › Hosts holds. */
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
  /** The parts of the pull requests the windows' Pull request tabs hold. */
  parts: PullRequestParts,
): AgentsComposer {
  const { client, kernel, kept } = dependencies;
  const gate = gateOf(dependencies);
  /** What a follow the gate keeps from the service is told; no account where the gate stands open but names none. */
  const gateKept = () => gateClosed(closedBy(dependencies) ?? GATE_CLOSED_BY.NO_ACCOUNT);
  const asked = askedOf(dependencies, http);
  /** Content the service answers under a key it never changes under: asked behind the gate, as every ask is, and kept once it carries some. */
  const keptAsked = <Key extends KeptKey, Answer>(
    key: Key,
    call: Effect.Effect<Answer, never, HttpClient.HttpClient>,
    carries: (answer: Answer | GateClosed) => KeptAnswer<Key> | undefined,
  ) => (gate() ? kept.answer(key, dependencies.accountId, asked(call), carries) : asked(call));
  const listed = dependencies.listed ?? (() => Effect.void);
  /**
   * A write to an agent's row of the task list, as the agents' own writes
   * declare it: drawn at once over the row, sent as `send` asks, and kept on
   * the transaction the service names, or refused.
   */
  const agentWrite = <Input extends { readonly agentId: string }>(
    change: (input: Input) => FieldChange<AgentRow>,
    send: (input: Input, key: string | undefined) => Effect.Effect<AgentAgentAnswer>,
    queue?: { readonly name: string; readonly input: Schema.Codec<Input, unknown> },
  ): WriteDeclaration<AgentRow, FieldChange<AgentRow>, Input, WireValue> => {
    // Note that a write that waits, or one the service took already, answers the agent as the list shows it, which a window reads as kept.
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
  /** A change of model, drawn on the agent's row at once, on the model's whole window where it names none. */
  const chosen = agentWrite<AgentChooseParams>(
    (choice) => () => ({
      model: choice.model,
      effort: choice.effort,
      contextWindow: choice.contextWindow ?? CONTEXT_WINDOW.LONG,
    }),
    ({ agentId, ...choice }) => asked(client.choose(agentId, choice)),
  );
  /** A rename, drawn on the agent's row at once, an empty title clearing it. */
  const renamed = agentWrite<AgentRenameParams>(
    (request) => () => ({ title: request.title.length === 0 ? null : request.title }),
    ({ agentId, ...request }, key) => asked(client.rename(agentId, request, key)),
    { name: GATEWAY_METHOD.AGENTS_RENAME, input: agentRenameParamsSchema },
  );
  /** A switch of MCP servers, drawn on the agent's row at once, the whole list of those off. */
  const switched = agentWrite<AgentServersParams>(
    (request) => () => ({ disabledServers: request.disabledServers }),
    ({ agentId, ...request }) => asked(client.switchServers(agentId, request)),
  );
  /**
   * An archive, drawn on the agent's row at once, stamped now by the member,
   * a dialog's that asked first among them. Note that an agent archived
   * closes its transcript and its workers' that no window holds any longer,
   * and lets go of their content kept; one a window holds stays drawn.
   */
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
  /** A change of an agent's queue, drawn over its own transcript's queue at once and standing until a page carries it. */
  const queued = queues.write((agentId, change) => asked(client.changeQueue(agentId, change)));
  /**
   * An agent deleted once its question was answered, drawn gone from the
   * list at once and kept once the list carries it; a refusal puts it back.
   * Note that an agent deleted lets go of its content kept, and its
   * workers'.
   */
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
  /** A pin, drawn on the agent's row at once, newest pinned and standing where it was dragged, and kept once the list carries it. */
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
  /**
   * A Start, on a task or from another agent, which draws no row, since
   * only the service names its agent, which the list then carries. Where
   * the service did not answer, it waits as the row writes waiting do and
   * holds its window's call until it is sent, so the window draws the Start
   * as under way until its agent or its refusal comes. Note that the press's
   * own key in its request keeps one sent again to one agent, which the
   * service answers with, so it carries no key of the pool's.
   */
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
        // A Start from another agent that names no task goes where that agent is, its task or its workspace.
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

  /** The member signed in now, whom a write drawn before the service answers names. */
  const reader = () => dependencies.reader?.();

  /** What the service answered of a write on items: its transaction, the item it names, and whether it was kept, as a nod or a close is only where taken. */
  const writtenOf = (
    answer:
      | { readonly failure: unknown; readonly cause?: Parameters<typeof writeUntakenOf>[0] }
      | { readonly txid?: string; readonly item?: InboxItem; readonly taken?: boolean },
  ): InboxWritten =>
    "failure" in answer
      ? { txid: undefined, item: undefined, kept: false }
      : { txid: answer.txid, item: answer.item, kept: answer.taken !== false };

  /**
   * A member's write on inbox items, as the inbox's writes declare it: its
   * change drawn at once over every read holding its items
   * (`inbox-collections.ts`), sent as `send` asks, and kept, refused, or
   * landed on the service's item as its answer says. One that may wait
   * (`queue`) is sent under its idempotency key and, where the service did
   * not answer it, goes on standing and is sent again once it answers, its
   * caller answered at once what `queue.queued` says, as if it were kept.
   */
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
  /** A nod or a close that waits, answered as taken over the item as the reads now draw it, or unanswered where none holds it. */
  const settledAs = ({ itemId }: { readonly itemId: string }): AgentInboxAnsweredView => {
    const item = dependencies.pool.row(INBOX_ITEM, itemId);
    return item === undefined ? { failure: AGENT_CALL_FAILURE.UNANSWERED } : { item, taken: true };
  };
  // Note that who and when are read once a write is asked, since its change is drawn again over each answer a read takes while it stands.
  /** A nod to an item, settling it. */
  const nodded = inboxWrite<AgentInboxAnswerParams, AgentInboxAnsweredView>(
    ({ itemId }) => [itemId],
    ({ itemId }) => {
      const [by, at] = [reader(), kernel.now()];
      return { kind: INBOX_CHANGE.SETTLED, itemId, item: (item) => acknowledgedNow(item, by, at) };
    },
    ({ itemId, ...request }, key) => asked(client.answerInbox(itemId, request, key)),
    {
      name: GATEWAY_METHOD.AGENTS_INBOX_ANSWER,
      input: agentInboxAnswerParamsSchema,
      queued: settledAs,
    },
  );
  /** An open item closed without an answer, settling it. */
  const closed = inboxWrite<AgentInboxCloseParams, AgentInboxAnsweredView>(
    ({ itemId }) => [itemId],
    ({ itemId }) => {
      const [by, at] = [reader(), kernel.now()];
      return { kind: INBOX_CHANGE.SETTLED, itemId, item: (item) => closedNow(item, by, at) };
    },
    ({ itemId, ...request }, key) => asked(client.closeInbox(itemId, request, key)),
    {
      name: GATEWAY_METHOD.AGENTS_INBOX_CLOSE,
      input: agentInboxCloseParamsSchema,
      queued: settledAs,
    },
  );
  /**
   * A message on an item's thread. Note that a reply carrying an answer
   * settles the ask, where a plain one only leaves the item read, its words
   * drawn by the window's own box while they go.
   */
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
        item: (item) => answeredNow(item, { key, text, answers }, by, at),
      };
    },
    ({ itemId, ...request }) => asked(client.messageInbox(itemId, request)),
  );
  /** An item marked read or unread. */
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
  /** An item snoozed until an instant, or its snooze ended. Note that snoozing marks it read, which is drawn at once, while the snooze itself arrives with the read its transaction reaches. */
  const snoozed = inboxWrite<AgentInboxSnoozeParams, AgentInboxReadStateView>(
    ({ itemId }) => [itemId],
    ({ itemId }) => ({ kind: INBOX_CHANGE.MARKED, itemIds: new Set([itemId]), unread: false }),
    ({ itemId, until }, key) => asked(client.snoozeInboxItem(itemId, until, key)),
    {
      name: GATEWAY_METHOD.AGENTS_INBOX_SNOOZE,
      input: agentInboxSnoozeParamsSchema,
      queued: ({ itemId }) => ({ id: itemId, unread: false }),
    },
  );
  /** Every item the inbox lists marked read. */
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

  /** A write's answer of the account's keys, laid as the keys stand where it carries them, and answered whole to the window that asked. */
  const keysWritten = (answer: ProviderKeysAnswerView) =>
    Effect.as(keysAnswered(answer), carried<ProviderKeysAnswerView>(answer));
  /** The keys as an answer of the service's leaves them, laid for the account signed in where it carries them, and the models asked again, whose marks they move. */
  const keysAnswered = (answer: ProviderKeysAnswerView | ChatGptSignInAnswerView) =>
    Effect.suspend(() => {
      const userId = dependencies.accountId();
      return userId === undefined || !("keys" in answer)
        ? Effect.void
        : Effect.andThen(
            keys.answered(userId, keyListOf(answer)),
            models.wake(() => true),
          );
    });

  /**
   * A token's write answered whole to the window that asked; where the
   * service took it, its answer laid on the held token for the account
   * signed in, and the repositories every list holds asked again, since what
   * the token reaches moved.
   */
  const tokenWritten = (answer: GitHubTokenAnswerView) =>
    Effect.as(
      Effect.suspend(() => {
        if ("failure" in answer) return Effect.void;
        const userId = dependencies.accountId();
        return Effect.andThen(
          userId === undefined ? Effect.void : token.answered(userId, { token: answer.token }),
          dependencies.repositoriesMoved ?? Effect.void,
        );
      }),
      carried<GitHubTokenAnswerView>(answer),
    );

  const methods: HostMethodTable = {
    // The models are held for the windows while any draws a model or a device, under the account signed in, and told only on the app state (`MODELS_CHANGED`).
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
    // The hosts are held for the windows while Settings › Hosts draws them, under the account signed in, and told only on the app state (`HOSTS_CHANGED`); a removal is drawn gone over them the moment it is asked.
    [GATEWAY_METHOD.HOSTS_FOLLOW]: () => Effect.as(hostsHold.follow, {}),
    [GATEWAY_METHOD.HOSTS_UNFOLLOW]: () => Effect.as(hostsHold.unfollow, {}),
    [GATEWAY_METHOD.HOSTS_RETRY]: () =>
      Effect.suspend(() => {
        const userId = dependencies.accountId();
        return Effect.as(userId === undefined ? Effect.void : hosts.retry(userId), {});
      }),
    // The beats are held for the windows while any draws a device's standing, under the account signed in, and told only on the app state (`DEVICE_PRESENCE_CHANGED`).
    [GATEWAY_METHOD.HOSTS_PRESENCE_FOLLOW]: () => Effect.as(presenceHold.follow, {}),
    [GATEWAY_METHOD.HOSTS_PRESENCE_UNFOLLOW]: () => Effect.as(presenceHold.unfollow, {}),
    // Note that the beats are asked again only where a window holds them, as a window coming forward asks them.
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
    // The keys are held for the windows while any draws them, under the account signed in, and told only on the app state (`PROVIDER_KEYS_CHANGED`); each write's own answer is laid there too.
    [GATEWAY_METHOD.PROVIDER_KEYS_FOLLOW]: () => Effect.as(keysHold.follow, {}),
    [GATEWAY_METHOD.PROVIDER_KEYS_UNFOLLOW]: () => Effect.as(keysHold.unfollow, {}),
    [GATEWAY_METHOD.PROVIDER_KEYS_RETRY]: () =>
      Effect.suspend(() => {
        const userId = dependencies.accountId();
        return Effect.as(userId === undefined ? Effect.void : keys.retry(userId), {});
      }),
    [GATEWAY_METHOD.PROVIDER_KEYS_SAVE]: (params) =>
      Effect.gen(function* () {
        // Note that the sentence names the shape and never the value, because the value is a key.
        const save = yield* readParams(
          providerKeySaveParamsSchema,
          params,
          "a save names a provider and a key",
        );
        return yield* keysWritten(yield* asked(client.saveProviderKey(save)));
      }),
    // A workspace's memories are held for the windows while Settings › Memory shows them, and told only on the app state (`MEMORIES_CHANGED`). Note that the windows' hold is one fiber standing until let go, so a window holding it again holds nothing anew.
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
    // The token is held for the windows while any draws it, under the account signed in, and told only on the app state (`GITHUB_TOKEN_CHANGED`); a save's and a removal's own answer is laid there too.
    [GATEWAY_METHOD.GITHUB_TOKEN_FOLLOW]: () => Effect.as(tokenHold.follow, {}),
    [GATEWAY_METHOD.GITHUB_TOKEN_UNFOLLOW]: () => Effect.as(tokenHold.unfollow, {}),
    [GATEWAY_METHOD.GITHUB_TOKEN_RETRY]: () =>
      Effect.suspend(() => {
        const userId = dependencies.accountId();
        return Effect.as(userId === undefined ? Effect.void : token.retry(userId), {});
      }),
    [GATEWAY_METHOD.GITHUB_TOKEN_SAVE]: (params) =>
      Effect.gen(function* () {
        // Note that the sentence names the shape and never the value, because the value is a token.
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
    // A transcript is held for a window while its tab shows it, and told only on the app state (`TRANSCRIPTS_CHANGED`). Note that the windows' hold is one fiber standing until let go, so a window holding it again holds nothing anew.
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
        // Note that the page is laid only while the messages held still begin where it was asked, so one answering after a newer page took their place leaves no gap.
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
        // Note that a send answers at once rather than once its row reaches the followed transcript,
        // because the window draws the line under the row's id until that row lands, so no page from
        // before the write can take it away, and the next send waits on this answer.
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
    // An agent's origin is held for a window while its page shows it, and told only on the app state (`AGENT_ORIGINS_CHANGED`). Note that the windows' hold is one fiber standing until let go, so a window holding it again holds nothing anew.
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
    // A Pull request tab's parts are held for the windows while the tab shows, and told only on the app state (`PULL_REQUEST_PARTS_CHANGED`). Note that the windows' hold on each is one fiber standing until let go, so a window holding it again holds nothing anew.
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
    // A pull request's chapters are held for a window while its Pull request tab reads them, and told only on the app state (`CHAPTERS_CHANGED`). Note that the windows' hold is one fiber standing until let go, so a window holding it again holds nothing anew.
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
    [GATEWAY_METHOD.CHAPTERS_MODEL_WRITE]: declaredMethod(
      dependencies.pool,
      chaptersModelWritten(
        (write) => asked(client.writeChaptersModel(write.model)),
        dependencies.accountId,
      ),
      (params: WireRecord) =>
        readParams(
          chaptersModelWriteParamsSchema,
          params,
          "the chapters model names one of the models Settings offers",
        ),
    ),
    // An agent's own tools are held for the windows while its servers popover shows, and told only on the app state (`WORKSPACE_TOOLS_CHANGED`). Note that the windows' hold is one fiber standing until let go, so a window holding it again holds nothing anew.
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
    // Note that the windows' hold on a scope is one fiber standing until let go, so a window holding it again holds nothing anew.
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
    [GATEWAY_METHOD.AGENTS_INBOX_SNOOZE]: declaredMethod(
      dependencies.pool,
      snoozed,
      (params: WireRecord) =>
        readParams(
          agentInboxSnoozeParamsSchema,
          params,
          "snoozing an inbox item names the item and until when, or none to end its snooze",
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

  // Note that the windows' holds stand through a sign-out, so a session signing in follows them anew (`open`).
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

  // Note that the beats, the keys, and the token are held anew under whoever signed in, in place of the hold before, rather than followed again under the account they were held for.
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
    keysAnswered,
    queueable: [
      anyWrite(started),
      anyWrite(renamed),
      anyWrite(pinned),
      anyWrite(nodded),
      anyWrite(closed),
      anyWrite(marked),
      anyWrite(snoozed),
      anyWrite(markedAll),
    ],
  };
}
