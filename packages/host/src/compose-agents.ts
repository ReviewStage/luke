import type { HostedAgentClient } from "@repo/features";
import { ACCOUNT_INBOX_REPOSITORYLESS } from "@repo/features/account-inbox-wire";
import { ACCOUNT_PREFERENCES_READ } from "@repo/features/account-preferences-live";
import { AGENT_ORIGIN_READ } from "@repo/features/agent-origin-live";
import { AGENT_TRANSCRIPT_READ } from "@repo/features/agent-transcript-live";
import {
  AGENT_CALL_FAILURE,
  type AgentAccountInboxAnswerView,
  type AgentAgentAnswer,
  type AgentArchiveParams,
  type AgentChooseParams,
  type AgentDeleteAnswerView,
  type AgentInboxAnsweredView,
  type AgentInboxAnswerParams,
  type AgentInboxCloseParams,
  type AgentInboxMessagedView,
  type AgentInboxMessageParams,
  type AgentInboxReadAllParams,
  type AgentInboxReadAllView,
  type AgentInboxReadStateParams,
  type AgentInboxReadStateView,
  type AgentInboxRemindParams,
  type AgentMarkReadParams,
  type AgentPinParams,
  type AgentRenameParams,
  type AgentServersParams,
  type AgentStartParams,
  type AgentTranscriptKey,
  agentInboxAnswerParamsSchema,
  agentInboxCloseParamsSchema,
  agentInboxReadAllParamsSchema,
  agentInboxReadStateParamsSchema,
  agentInboxRemindParamsSchema,
  agentMarkReadParamsSchema,
  agentPinParamsSchema,
  agentRenameParamsSchema,
  agentStartParamsSchema,
  INBOX_SCOPE_KIND,
} from "@repo/features/agent-view";
import { AGENT_ARCHIVER, type AgentSummary, CONTEXT_WINDOW } from "@repo/features/agent-wire";
import { GATE_CLOSED_BY } from "@repo/features/failure-facts";
import { GITHUB_IMAGE_SOURCE, githubImageOf } from "@repo/features/github-image";
import {
  ACCOUNT_INBOX_READ,
  AGENT_INBOX_READ,
  INBOX_ITEMS_READ,
  TASK_INBOX_READ,
} from "@repo/features/inbox-live";
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
import type { ModelsAnswer } from "@repo/features/models-wire";
import { PULL_REQUEST_CHAPTERS_READ } from "@repo/features/pull-request-chapters-live";
import { markedAs } from "@repo/features/read-mark";
import { commitShaSchema } from "@repo/features/task-wire";
import type { WorkspaceToolsAnswer } from "@repo/features/workspace-tools-wire";
import { carried, GATEWAY_EVENT, GATEWAY_METHOD } from "@repo/gateway";
import {
  type AnyWrite,
  anyWrite,
  declaredWrite,
  type EntityPool,
  type FieldChange,
  ROW_GONE,
  type WriteDeclaration,
} from "@repo/sync";
import {
  Deferred,
  Duration,
  Effect,
  FiberHandle,
  Option,
  RcMap,
  Schema,
  type Scope,
  Stream,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";
import {
  type AccountGateDependencies,
  type Asked,
  askedOf,
  closedBy,
  type GateClosed,
  gateClosed,
  gateOf,
} from "./account-gate.js";
import { type AccountInboxes, accountInboxes, followAccountInbox } from "./account-inbox-follow.js";
import { followAccountItems } from "./account-items-follow.js";
import {
  agentDefaultWritten,
  chaptersProviderWritten,
  heldAccountPreferences,
} from "./account-preferences-follow.js";
import { type AgentQueues, agentQueues, type QueueWrite } from "./agent-queue-writes.js";
import {
  type AppAccountPreferences,
  type AppHostRead,
  type AppInboxItems,
  type AppTranscript,
  NO_KEYS_HELD,
  NO_TRANSCRIPTS,
  OWN_TRANSCRIPT,
  UNREAD,
} from "./app-state.js";
import { ChaptersKey, heldChapters } from "./chapters-follow.js";
import type { AccountAsksAgentAct, AccountAsksAgentFollow } from "./compose-account-asks.js";
import type { Composer } from "./composer.js";
import {
  type AGENT_ACTS,
  AGENT_FOLLOWS,
  type AGENT_INBOX_ACTS,
  AGENT_INBOX_FOLLOWS,
  type CHAPTERS_ACTS,
  CHAPTERS_FOLLOWS,
} from "./contract/index.js";
import type { HostMethodTable } from "./gateway-door.js";
import { type AccountHeld, accountHeld, type HeldFetch, heldFetch } from "./held-fetch.js";
import { type HostActTable, liveTold } from "./host-acts.js";
import type { HostKernel } from "./host-kernel.js";
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
import { heldAgentOrigins } from "./origin-follow.js";
import {
  type PullRequestListing,
  type PullRequestParts,
  type PullRequestPartsDependencies,
  pullRequestParts,
} from "./pull-request-parts.js";
import { untaken } from "./queued-writes.js";
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
 * The names the agents' waiting writes are kept under. Note that each is
 * byte for byte the Gateway method the write was once asked through,
 * because a kept write is read back by its name.
 */
const AGENT_QUEUED_WRITE = {
  START: "agents.start",
  RENAME: "agents.rename",
  PIN: "agents.pin",
  MARK_READ: "agents.markRead",
} as const;

/**
 * compose-agents.ts -- a task's coding agents, asked of the service on the window's behalf: the models, the account's default, the agents, one started, one's transcript, one messaged, one's model changed, one stopped, what one published, the task's inbox, one item of it answered, and what waits across the account. The account's own asks are `compose-account-asks.ts`'s.
 *
 * Nothing is held here but the transcripts' subscriptions, the held
 * inboxes' (`scope-inbox-follow.ts`), told on their live follow's slice
 * (`liveTold`) to the app state every window draws, and the reads the host
 * fetches for the windows that hold them (`held-fetch.ts`): the models,
 * a pull request's parts, and an agent's own tools, each told the same way. The window holds the agents it draws and the cursor it reads
 * from, asks when a task opens, when it starts or stops an agent, and while
 * an agent's tab shows its running transcript, and every ask is one call of
 * the service answered whole. An agent's or a worker's transcript is held
 * for the windows whose tab shows it and the few let go lately
 * (`heldSlice`), followed on the service's held poll of what its pages are
 * read from (`transcript-follow.ts`) only while a window holds it, and told
 * on its live follow's slice to the app state every window draws; a
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
 * unanswered (`account-gate.ts`).
 */

/** The service's side of the agents, as this concern asks it. */
export type AgentClient = Pick<
  HostedAgentClient,
  | "generateChapters"
  | "models"
  | "writeDefault"
  | "writeChaptersProvider"
  | "liveRead"
  | "list"
  | "listWorkspace"
  | "start"
  | "startFrom"
  | "messagesNow"
  | "agentPart"
  | "messagesNewest"
  | "messagesBefore"
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
  | "answerInbox"
  | "closeInbox"
  | "messageInbox"
  | "startInboxThread"
  | "markInboxItemRead"
  | "remindInboxItem"
  | "inboxItemHome"
  | "markInboxItemUnread"
  | "markInboxRead"
  | "inboxAttachment"
  | "agentPicture"
>;

export interface AgentsDependencies extends AccountGateDependencies {
  kernel: Pick<HostKernel, "emit" | "now"> & AccountGateDependencies["kernel"];
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
}

/** The acts this composer answers: the Inbox's, every agent act but This Mac's and the hosts', which their own concerns answer, and a pull request's chapters generated; and every agent's live follow but the hosts' and their beats', the Inbox's, and a pull request's chapters. */
type AgentsActs = HostActTable<typeof AGENT_INBOX_ACTS> &
  HostActTable<typeof AGENT_INBOX_FOLLOWS> &
  HostActTable<Omit<typeof AGENT_ACTS, "HOSTS_THIS_MAC_SET" | AccountAsksAgentAct>> &
  HostActTable<Omit<typeof AGENT_FOLLOWS, AccountAsksAgentFollow>> &
  HostActTable<typeof CHAPTERS_ACTS> &
  HostActTable<typeof CHAPTERS_FOLLOWS>;

export interface AgentsComposer extends Composer {
  /** The Inbox's acts, the agents' acts, and a pull request's chapters generated, answered directly as the panel's port asks them. */
  readonly acts: AgentsActs;
  /** The models asked again where a window holds them, as the account's keys moving asks (`compose-account-asks.ts`). */
  readonly modelsMoved: Effect.Effect<void>;
  /** The session's account reads opened for the account signed in, as the gate opening opens them. */
  readonly open: Effect.Effect<void>;
  /** Every transcript's, every plan's and agent's inbox's, the account inbox's, and the account's items' subscription let go, as a sign-out lets them go. */
  readonly reset: Effect.Effect<void>;
  /** The row writes this composer declares that may wait for the service, which a queue kept on disk is laid back by. */
  readonly queueable: readonly AnyWrite[];
  /** Every close a window still holds for its Undo let go as sent, answering once each is answered, so a quit drops none. */
  readonly flushHeldCloses: Effect.Effect<void>;
  /**
   * Every held close let go as sent under the account that held it, as that
   * account leaves, answering once each is answered or
   * `HELD_CLOSE_SETTLE_BOUND` has passed; what is still out then is dropped,
   * so none goes under whoever signs in next.
   */
  readonly letGoHeldCloses: Effect.Effect<void>;
}

/**
 * The longest a held close waits for the window that holds it to let it go
 * before it goes by itself: well past the Undo toast's hold, which a pointer
 * over the toast pauses, so it stands for a window that closed, or a tab
 * reloaded, while its Undo stood.
 */
const HELD_CLOSE_BOUND = Duration.minutes(1);

/**
 * The longest an account's departure waits for the closes it held to be
 * answered before it drops what is still out: a sign-out waits on it, and a
 * close still out past it would be sent again under the next account's
 * credential, which each attempt reads afresh.
 */
const HELD_CLOSE_SETTLE_BOUND = Duration.seconds(5);

/** What a held close its window took back answers: refused, so the pool takes back what it drew and keeps nothing to send again, and the window that undid it reads nothing of it. */
const CLOSE_UNDONE: AgentInboxAnsweredView = { failure: AGENT_CALL_FAILURE.UNANSWERED };

/**
 * The names the Inbox's writes that may wait are queued under, which were
 * their Gateway methods' ids. Note that each is kept byte for byte, and
 * a reminder keeps Snooze's, because a write queued offline is kept on disk
 * by its name, and one under a name no host declares is dropped.
 */
const INBOX_QUEUED_WRITE = {
  ANSWER: "agents.inboxAnswer",
  CLOSE: "agents.inboxClose",
  READ_STATE: "agents.inboxReadState",
  REMIND: "agents.inboxSnooze",
  READ_ALL: "agents.inboxReadAll",
} as const;

/** The transcript a window holds, as the slice keys it. */
function transcriptKeyOf({ agentId, callId }: AgentTranscriptKey): TranscriptKey {
  return new TranscriptKey({ agentId, callId });
}

/** How each part of a Pull request tab is told: on its own slice, which its follow declares beside the pull request's. */
function partsTold(emit: HostKernel["emit"]): PullRequestPartsDependencies["tell"] {
  const follow = AGENT_FOLLOWS.AGENTS_PULL_REQUEST_PART_FOLLOW;
  return {
    [LIVE_READ.PULL_REQUEST]: liveTold(emit, follow),
    [LIVE_READ.PULL_REQUEST_CHECKS]: liveTold(emit, follow, LIVE_READ.PULL_REQUEST_CHECKS),
    [LIVE_READ.PULL_REQUEST_CONVERSATION]: liveTold(
      emit,
      follow,
      LIVE_READ.PULL_REQUEST_CONVERSATION,
    ),
    [LIVE_READ.PULL_REQUEST_PUBLISHED]: liveTold(emit, follow, LIVE_READ.PULL_REQUEST_PUBLISHED),
    [LIVE_READ.REVIEW_OPTIONS]: liveTold(emit, follow, LIVE_READ.REVIEW_OPTIONS),
    [LIVE_READ.PULL_REQUEST_VIEWED]: liveTold(emit, follow, LIVE_READ.PULL_REQUEST_VIEWED),
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
          dependencies.client.liveRead(
            AGENT_TRANSCRIPT_READ,
            {
              id: key.agentId,
              userId,
              ...(cursor === undefined ? undefined : { cursor }),
              ...(key.callId === undefined ? undefined : { call: key.callId }),
            },
            poll ? { after } : undefined,
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
      tell: liveTold(dependencies.kernel.emit, AGENT_FOLLOWS.AGENTS_TRANSCRIPT),
      pause: true,
      budget: { reads: HELD_TRANSCRIPTS, bytes: HELD_BYTES, bytesEach: HELD_BYTES_EACH },
    });
    const accountWide = accountWideReads();
    const inboxes = yield* scopeInboxes({
      seal: (scope, poll, userId, after) =>
        asked(
          scope.kind === INBOX_SCOPE_KIND.PLAN
            ? client.liveRead(
                TASK_INBOX_READ,
                { id: scope.id, userId },
                poll ? { after } : undefined,
              )
            : client.liveRead(
                AGENT_INBOX_READ,
                { id: scope.id, userId },
                poll ? { after } : undefined,
              ),
        ),
      accountId: dependencies.accountId,
      pool: dependencies.pool,
    });
    const accounts = yield* accountInboxes({
      seal: (userId, poll, after) =>
        asked(
          client.liveRead(
            ACCOUNT_INBOX_READ,
            {
              userId,
              [ACCOUNT_INBOX_REPOSITORYLESS.QUERY]: ACCOUNT_INBOX_REPOSITORYLESS.INCLUDE,
            },
            poll ? { after } : undefined,
          ),
        ),
      pool: dependencies.pool,
      accountWide,
    });
    const tellItems = (read: AppHostRead<AppInboxItems>) =>
      Effect.sync(() => dependencies.kernel.emit(GATEWAY_EVENT.INBOX_ITEMS_CHANGED, carried(read)));
    const holders = yield* holderInboxes(inboxes, {
      gate,
      tell: liveTold(dependencies.kernel.emit, AGENT_INBOX_FOLLOWS.AGENTS_INBOX_FOLLOW),
    });
    const chapters = yield* heldChapters({
      seal: (key, poll, userId, after) =>
        asked(
          client.liveRead(
            PULL_REQUEST_CHAPTERS_READ,
            { id: key.agentId, number: String(key.number), userId },
            poll ? { after } : undefined,
          ),
        ),
      accountId: dependencies.accountId,
      gate,
      tell: liveTold(dependencies.kernel.emit, CHAPTERS_FOLLOWS.CHAPTERS_FOLLOW),
    });
    const origins = yield* heldAgentOrigins({
      seal: (agentId, poll, userId, after) =>
        asked(
          client.liveRead(AGENT_ORIGIN_READ, { id: agentId, userId }, poll ? { after } : undefined),
        ),
      accountId: dependencies.accountId,
      gate,
      tell: liveTold(dependencies.kernel.emit, AGENT_FOLLOWS.AGENTS_ORIGIN_FOLLOW),
    });
    // Note that a session's reads close before the window is told it holds none, so nothing the last account drew lands after.
    const sessionReads = yield* accountReads<LiveRead>(
      () => (gate() ? dependencies.accountId() : undefined),
      tellItems(UNREAD),
    );
    const followItems = (userId: string) =>
      followAccountItems(
        {
          // Note that the items are always read polled, their rows inline, and past a sync id the service holds the read until something moves.
          seal: (account, sync) =>
            asked(
              client.liveRead(
                INBOX_ITEMS_READ,
                { userId: account, ...(sync === undefined ? undefined : { sync }) },
                {},
              ),
            ),
          pool: dependencies.pool,
          accountWide,
        },
        userId,
        tellItems,
      );
    const preferences = yield* heldAccountPreferences({
      seal: (userId, poll, after) =>
        asked(client.liveRead(ACCOUNT_PREFERENCES_READ, { userId }, poll ? { after } : undefined)),
      gate,
      pool: dependencies.pool,
      tell: (held: AppAccountPreferences) =>
        dependencies.kernel.emit(GATEWAY_EVENT.ACCOUNT_PREFERENCES_CHANGED, carried(held)),
    });
    // Note that the row is held for the session rather than by a window, so the read stands until the session's reads close.
    const holdPreferences = (userId: string) =>
      Effect.scoped(Effect.andThen(preferences.hold(userId), Effect.never));
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
      tell: partsTold(dependencies.kernel.emit),
    });
    return composed(
      dependencies,
      http,
      { transcripts, slice: transcriptSlice, queues },
      { inboxes, holders, accountWide },
      { accounts, followed: accountFollow },
      { reads: sessionReads, followItems, preferences, holdPreferences },
      { chapters, origins },
      fetched,
      parts,
    );
  });
}

/** The transcripts' subscriptions the windows share, and the held lifetime over the transcripts the windows hold. */
interface Transcripts {
  readonly transcripts: TranscriptFollows;
  readonly slice: HeldSlice<TranscriptKey> & HeldRows<TranscriptKey, AppTranscript>;
  /** Each agent's queue in the pool, fed from its own transcript, and the change of one. */
  readonly queues: AgentQueues;
}

/** The scopes' subscriptions the windows share, and the held lifetime over them. */
interface ScopeFollows {
  readonly inboxes: ScopeInboxes;
  readonly holders: HeldSlice<InboxScopeKey>;
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

/** The live follows' reads the windows hold (`contract/live-follow.ts`), each held through its stream's scope. */
interface LiveFollows {
  /** Every agent's pull request's chapters, by the agent and the number. */
  readonly chapters: HeldSlice<ChaptersKey>;
  /** Every agent's origin, by the agent. */
  readonly origins: HeldSlice<string>;
}

/** The reads the host fetches for the windows that hold them, and the windows' holds on them. */
interface FetchedReads {
  /** Our own tools each agent is offered, by the agent. */
  readonly tools: HeldFetch<string, WorkspaceToolsAnswer>;
  /** The models a coding agent may run on as the account is offered them, and its devices, by the account. */
  readonly models: HeldFetch<string, ModelsAnswer>;
  /** The windows' hold on the models, under the account signed in. */
  readonly modelsHold: AccountHeld;
}

/**
 * The fetched reads behind the gate, each told whole on its slice. Note
 * that the models are asked for the account signed in now alone, since the
 * service answers that account's.
 */
function fetchedReads(
  dependencies: AgentsDependencies,
  asked: Asked,
): Effect.Effect<FetchedReads, never, Scope.Scope> {
  return Effect.gen(function* () {
    const { client, kernel, focus, accountId } = dependencies;
    const gate = gateOf(dependencies);
    const tools = yield* heldFetch<typeof LIVE_READ.WORKSPACE_TOOLS, string>({
      empty: NO_KEYS_HELD,
      path: (agentId) => [agentId],
      gate,
      focus,
      fetch: (agentId) =>
        Effect.map(asked(client.workspaceTools(agentId)), (answer) =>
          "failure" in answer ? Option.none() : Option.some(answer),
        ),
      tell: liveTold(kernel.emit, AGENT_FOLLOWS.AGENTS_WORKSPACE_TOOLS_FOLLOW),
    });
    const models = yield* heldFetch<typeof LIVE_READ.MODELS, string>({
      empty: NO_KEYS_HELD,
      path: (userId) => [userId],
      gate,
      focus,
      fetch: (userId) =>
        userId === accountId()
          ? Effect.map(asked(client.models()), (answer) =>
              "failure" in answer ? Option.none() : Option.some(answer),
            )
          : Effect.succeed(Option.none()),
      tell: liveTold(kernel.emit, AGENT_FOLLOWS.AGENTS_MODELS_FOLLOW),
    });
    return {
      tools,
      models,
      modelsHold: yield* accountHeld(models, accountId),
    };
  });
}

/** The composer's one table, built from its seams; nothing here starts anything but a transcript's or a scope's inbox subscription, while a window reads it. */
function composed(
  dependencies: AgentsDependencies,
  http: HttpClient.HttpClient,
  { transcripts, slice: transcriptSlice, queues }: Transcripts,
  { inboxes, holders, accountWide }: ScopeFollows,
  /** What waits across the account, and main's one follow of it. */
  { accounts, followed: accountFollow }: AccountFollow,
  /** The session's account reads, every item the account reaches and its preferences among them. */
  { reads: sessionReads, followItems, preferences, holdPreferences }: SessionReads,
  /** The pull requests' chapters and the agents' origins the windows hold. */
  { chapters, origins }: LiveFollows,
  { tools, models, modelsHold }: FetchedReads,
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
  ): WriteDeclaration<AgentRow, FieldChange<AgentRow>, Input, AgentAgentAnswer> => {
    // Note that a write that waits, or one the service took already, answers the agent as the list shows it, which a window reads as kept.
    const keptAs = ({ agentId }: Input): AgentAgentAnswer => {
      const agent = dependencies.agentListed?.(agentId);
      return agent === undefined ? { failure: AGENT_CALL_FAILURE.UNANSWERED } : { agent };
    };
    return {
      kind: AGENT,
      keys: ({ agentId }) => [agentId],
      change,
      send: (input, { key }) =>
        Effect.map(send(input, key), (answered) => {
          if ("agent" in answered) return { answer: answered, txid: answered.txid };
          const refused = answered;
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
    { name: AGENT_QUEUED_WRITE.RENAME, input: agentRenameParamsSchema },
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
    AgentDeleteAnswerView
  > = {
    kind: AGENT,
    keys: ({ agentId }) => [agentId],
    change: () => () => ROW_GONE,
    send: ({ agentId }) =>
      Effect.gen(function* () {
        const answer = yield* asked(client.delete(agentId));
        if (!("deleted" in answer)) return { refused: answer };
        yield* kept.forget(keptOfAgent(agentId));
        return { answer, txid: answer.txid };
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
    { name: AGENT_QUEUED_WRITE.PIN, input: agentPinParamsSchema },
  );
  /** The reader's read mark, drawn on the agent's row at once, and kept once the list carries the service's. */
  const markedRead = agentWrite<AgentMarkReadParams>(
    ({ readMark }) =>
      (row) =>
        markedAs(readMark, row, kernel.now()),
    ({ agentId, ...request }, key) => asked(client.markRead(agentId, request, key)),
    { name: AGENT_QUEUED_WRITE.MARK_READ, input: agentMarkReadParamsSchema },
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
      name: AGENT_QUEUED_WRITE.START,
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
    send: (input: Input, key: string | undefined, waited: boolean) => Effect.Effect<Answer>,
    queue?: {
      readonly name: string;
      readonly input: Schema.Codec<Input, unknown>;
      readonly queued: (input: Input) => Answer;
    },
  ): WriteDeclaration<InboxItem, InboxChange, Input, Answer> => ({
    kind: INBOX_ITEM,
    keys,
    change,
    send: (input, { key, waited }) =>
      Effect.map(send(input, key, waited), (answer) =>
        queue === undefined || !("failure" in answer)
          ? inboxSent(answer, writtenOf(answer))
          : untaken(writeUntakenOf(answer.cause), { kept: queue.queued(input), refused: answer }),
      ),
    ...(queue === undefined ? undefined : { queue }),
  });
  /** A nod or a close that waits, answered as taken over the item as the reads now draw it, or unanswered where none holds it. */
  const settledAs = ({ itemId }: { readonly itemId: string }): AgentInboxAnsweredView => {
    const item = dependencies.pool.row(INBOX_ITEM, itemId);
    return item === undefined ? { failure: AGENT_CALL_FAILURE.UNANSWERED } : { item, taken: true };
  };
  // Note that who and when are read once a write is asked, since its change is drawn again over each answer a read takes while it stands.
  /** A nod to an item, settling it. */
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
      name: INBOX_QUEUED_WRITE.ANSWER,
      input: agentInboxAnswerParamsSchema,
      queued: settledAs,
    },
  );
  /**
   * A close a window holds for its Undo: told once whether it goes to the
   * service, answered once it has, dropped where its account left before it
   * was answered, and the account that held it, which alone may send it.
   */
  interface HeldClose {
    readonly told: Deferred.Deferred<boolean>;
    readonly answered: Deferred.Deferred<void>;
    readonly dropped: Deferred.Deferred<void>;
    readonly holder: string | undefined;
  }
  /** The closes windows hold for their Undo, by each close's key, until each is told. */
  const heldCloses = new Map<string, HeldClose>();
  /** The held closes told to go and not yet answered, which an account's departure drops. */
  const sendingCloses = new Set<HeldClose>();
  /**
   * The account each held close was asked under, by its key, until it comes
   * to be sent. Note that an account's departure keeps it, because a close
   * still waiting behind another write comes to be sent only after, and
   * must not read as one laid back from disk under whoever is signed in then.
   */
  const heldBy = new Map<string, string | undefined>();
  /** The account the close under `clientKey` was asked under, taken so it is read once; the account signed in now where this host did not see it asked, as one laid back from disk. */
  const takeHolder = (clientKey: string): string | undefined => {
    const holder = heldBy.has(clientKey) ? heldBy.get(clientKey) : dependencies.accountId();
    heldBy.delete(clientKey);
    return holder;
  };
  /**
   * What a window decided of a held close before the close came to wait, by
   * its key, with when: as an Undo pressed while an earlier write on the same
   * item was still out, or while the close waited behind writes the service
   * had not answered. The close reads it once it comes to be sent.
   */
  const decidedEarly = new Map<string, { readonly send: boolean; readonly at: number }>();
  /** The held closes already let go, by key, with when, so an Undo that comes after hears it came too late. */
  const letGoAt = new Map<string, number>();
  /** Every early decision and let-go older than `HELD_CLOSE_BOUND` forgotten, since no window asks after one that old. */
  const forgetStale = (now: number) => {
    const bound = Duration.toMillis(HELD_CLOSE_BOUND);
    for (const [key, { at }] of decidedEarly) if (now - at > bound) decidedEarly.delete(key);
    for (const [key, at] of letGoAt) if (now - at > bound) letGoAt.delete(key);
  };
  /** The early decision on the close under `clientKey`, taken so it is read once; none where its window said nothing yet. */
  const takeDecided = (clientKey: string): boolean | undefined => {
    const early = decidedEarly.get(clientKey);
    decidedEarly.delete(clientKey);
    return early?.send;
  };
  /**
   * The held close under `clientKey`, `send` once its window lets it go,
   * once its Undo can no longer be pressed, or is; or, past
   * `HELD_CLOSE_BOUND` with no word from its window, as sent. What `send`
   * answers, or `undone`, it answers. Note that it is answered to a quit's
   * flush however it ends, interrupted too, so the quit never waits on it.
   * Note too that it goes only under the account that held it: one let go
   * once another is signed in, or dropped as its account leaves while it is
   * still out, answers `undone`, so its item stands open again.
   */
  const released = <Answer>(
    clientKey: string,
    holder: string | undefined,
    send: Effect.Effect<Answer>,
    undone: Answer,
  ): Effect.Effect<Answer> =>
    Effect.gen(function* () {
      const held: HeldClose = {
        told: yield* Deferred.make<boolean>(),
        answered: yield* Deferred.make<void>(),
        dropped: yield* Deferred.make<void>(),
        holder,
      };
      heldCloses.set(clientKey, held);
      const settled = Effect.sync(() => {
        heldCloses.delete(clientKey);
        sendingCloses.delete(held);
        letGoAt.set(clientKey, kernel.now());
      }).pipe(Effect.andThen(Deferred.succeed(held.answered, undefined)));
      return yield* Effect.gen(function* () {
        const heard = yield* Effect.timeoutOption(Deferred.await(held.told), HELD_CLOSE_BOUND);
        heldCloses.delete(clientKey);
        const goes = Option.getOrElse(heard, () => true);
        if (!goes || dependencies.accountId() !== held.holder) return undone;
        sendingCloses.add(held);
        return yield* Effect.raceFirst(send, Effect.as(Deferred.await(held.dropped), undone));
      }).pipe(Effect.ensuring(settled));
    });
  // Note that the closes are read before they are told, since telling one takes it out of the map.
  const flushHeldCloses = Effect.suspend(() => {
    const held = [...heldCloses.values()];
    heldCloses.clear();
    return Effect.forEach(
      held,
      ({ told, answered }) =>
        Effect.andThen(Deferred.succeed(told, true), Deferred.await(answered)),
      { concurrency: "unbounded", discard: true },
    );
  });
  /** Every held close not yet answered dropped: told to stay, or, where it is already out, cut off and answered as undone. */
  const dropHeldCloses = Effect.suspend(() => {
    const held = [...heldCloses.values(), ...sendingCloses];
    heldCloses.clear();
    sendingCloses.clear();
    return Effect.forEach(
      held,
      ({ told, dropped }) =>
        Effect.andThen(Deferred.succeed(told, false), Deferred.succeed(dropped, undefined)),
      { discard: true },
    );
  });
  // Note that the closes already out are waited for beside those let go, since each attempt reads the credential afresh and one still out past the departure would go under the next account.
  const letGoHeldCloses = Effect.suspend(() => {
    const out = [...sendingCloses];
    return Effect.timeoutOption(
      Effect.andThen(
        flushHeldCloses,
        Effect.forEach(out, ({ answered }) => Deferred.await(answered), { discard: true }),
      ),
      HELD_CLOSE_SETTLE_BOUND,
    ).pipe(Effect.andThen(dropHeldCloses));
  });
  /**
   * An open item closed without an answer, settling it. A close the window
   * holds for its Undo (`held`) is drawn at once like any other, and goes to
   * the service only once released, so an Undo takes back what was drawn
   * before the service, the agent, or another member hears of it. Note
   * that only its first attempt waits: one sent again from the writes that
   * waited for the service goes by what its window decided meanwhile, if
   * anything, as one its window decided before it came to be sent does.
   */
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
    ({ itemId, held, ...request }, key, waited) =>
      Effect.suspend(() => {
        const send = asked(client.closeInbox(itemId, request, key));
        if (held !== true) return send;
        // Note that a decision its window made before the close came to be sent is the one it goes by, and only under the account that asked it.
        const holder = takeHolder(request.clientKey);
        const decided = takeDecided(request.clientKey);
        if (decided === undefined && !waited)
          return released(request.clientKey, holder, send, CLOSE_UNDONE);
        letGoAt.set(request.clientKey, kernel.now());
        const goes = decided !== false && holder === dependencies.accountId();
        return goes ? send : Effect.succeed(CLOSE_UNDONE);
      }),
    {
      name: INBOX_QUEUED_WRITE.CLOSE,
      input: agentInboxCloseParamsSchema,
      queued: settledAs,
    },
  );
  /**
   * A message on an item's thread. Note that a reply carrying an answer
   * settles the ask while it stands open, where a plain one only leaves the
   * item read, its words drawn by the window's own box while they go. An
   * item whose ask the service has answered already, as one the agent has
   * posted over since and so opened again, is left as it is, or the reply
   * would be drawn a second time under its key below the agent's post.
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
        item: (item) =>
          asksOpen(item, answers.ask)
            ? answeredNow(item, { key, text, answers }, by, at)
            : undefined,
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
      name: INBOX_QUEUED_WRITE.READ_STATE,
      input: agentInboxReadStateParamsSchema,
      queued: ({ itemId, unread }) => ({ id: itemId, unread }),
    },
  );
  /** An item's reminder set for an instant, or canceled, drawn at once; whether it is read stands as it was. */
  const reminded = inboxWrite<AgentInboxRemindParams, AgentInboxReadStateView>(
    ({ itemId }) => [itemId],
    ({ itemId, until }) => ({ kind: INBOX_CHANGE.REMINDED, itemId, until }),
    ({ itemId, until }, key) => asked(client.remindInboxItem(itemId, until, key)),
    {
      name: INBOX_QUEUED_WRITE.REMIND,
      input: agentInboxRemindParamsSchema,
      queued: ({ itemId }) => ({
        id: itemId,
        unread: dependencies.pool.row(INBOX_ITEM, itemId)?.unread === true,
      }),
    },
  );
  /** Every item the inbox lists marked read. */
  const markedAll = inboxWrite<AgentInboxReadAllParams, AgentInboxReadAllView>(
    ({ itemIds }) => itemIds,
    ({ itemIds }) => ({ kind: INBOX_CHANGE.MARKED, itemIds: new Set(itemIds), unread: false }),
    ({ itemIds: _listed, ...request }, key) => asked(client.markInboxRead(request, key)),
    {
      name: INBOX_QUEUED_WRITE.READ_ALL,
      input: agentInboxReadAllParamsSchema,
      queued: ({ itemIds }) => ({ marked: itemIds.length }),
    },
  );

  /** The agent's or worker's transcript a follow names, and the key its subscription and follow are held under. */

  /** The Inbox's acts, the agents' (`AGENT_ACTS`), and a pull request's chapters generated (`CHAPTERS_ACTS`), answered as the panel's port asks them. */
  const acts: AgentsActs = {
    CHAPTERS_GENERATE: ({ agentId, number }) => asked(client.generateChapters(agentId, number)),
    AGENTS_DEFAULT_WRITE: declaredWrite(
      dependencies.pool,
      agentDefaultWritten((choice) => asked(client.writeDefault(choice)), dependencies.accountId),
    ),
    AGENTS_CHAPTERS_PROVIDER_WRITE: declaredWrite(
      dependencies.pool,
      chaptersProviderWritten(
        (provider) => asked(client.writeChaptersProvider(provider)),
        dependencies.accountId,
      ),
    ),
    AGENTS_LIST: ({ taskId, includeArchived }) => asked(client.list(taskId, includeArchived)),
    AGENTS_WORKSPACE_LIST: (listed) => asked(client.listWorkspace(listed)),
    AGENTS_START: (start) =>
      Effect.gen(function* () {
        const answer = yield* dependencies.pool.write(started, start);
        // Note that a Start answers once the task list carries its agent, because the window draws
        // a task's agents from the list alone, so the tab it opens finds its agent there.
        if ("txid" in answer) yield* listed(answer.txid);
        return answer;
      }),
    // Note that the page is read at once, since Copy transcript waits on no hold.
    AGENTS_MESSAGES: ({ agentId, after, callId }) =>
      Effect.map(asked(client.messagesNow(agentId, after, callId)), windowsPage),
    AGENTS_TRANSCRIPT_OLDER: ({ agentId, callId, before }) =>
      Effect.gen(function* () {
        const answer = yield* asked(client.messagesBefore(agentId, before, callId, true));
        if ("failure" in answer) return answer;
        const key = new TranscriptKey({ agentId, callId });
        // Note that the page is laid only while the messages held still begin where it was asked, so one answering after a newer page took their place leaves no gap.
        const laid = withOlderPage(transcriptSlice.rowsOf(key), before, answer);
        if (laid !== undefined) transcriptSlice.lay(key, laid);
        return { landed: laid !== undefined };
      }),
    AGENTS_MESSAGE: ({ agentId, ...request }) =>
      Effect.map(asked(client.message(agentId, request)), (answer) =>
        // Note that a send answers at once rather than once its row reaches the followed transcript,
        // because the window draws the line under the row's id until that row lands, so no page from
        // before the write can take it away, and the next send waits on this answer.
        "agent" in answer ? { agent: answer.agent } : answer,
      ),
    AGENTS_CHOOSE: declaredWrite(dependencies.pool, chosen),
    AGENTS_RENAME: declaredWrite(dependencies.pool, renamed),
    AGENTS_SERVERS: declaredWrite(dependencies.pool, switched),
    AGENTS_QUEUE: declaredWrite(dependencies.pool, queued, {
      read: (read) =>
        Effect.sync((): QueueWrite => ({ ...read, queuedBy: dependencies.accountId() ?? "" })),
    }),
    AGENTS_ARCHIVE: declaredWrite(dependencies.pool, archived),
    AGENTS_PIN: declaredWrite(dependencies.pool, pinned),
    AGENTS_MARK_READ: declaredWrite(dependencies.pool, markedRead),
    // Note that a repository added draws nothing on the agent's row, which lists no repositories, so it is asked and answered alone.
    AGENTS_ADD_REPOSITORY: ({ agentId, addRepository }) =>
      asked(client.addRepository(agentId, { addRepository })),
    AGENTS_STOP: ({ agentId }) => asked(client.stop(agentId)),
    AGENTS_REWIND: ({ agentId, messageId }) => asked(client.rewind(agentId, messageId)),
    AGENTS_DELETE: declaredWrite(dependencies.pool, deleted),
    AGENTS_PAGE: ({ agentId }) => asked(client.agent(agentId)),
    AGENTS_CHANGES: ({ agentId, number }) => asked(client.changes(agentId, number)),
    AGENTS_PULL_REQUEST_ACTION: ({ agentId, number, request }) =>
      asked(client.pullRequestAction(agentId, request, number)),
    AGENTS_GITHUB_IMAGE: ({ agentId, src }) => {
      const call = client.githubImage(agentId, src);
      return isKeptImage(src)
        ? keptAsked(new GitHubImageKey({ agentId, src }), call, (image) =>
            "base64" in image ? image : undefined,
          )
        : asked(call);
    },
    AGENTS_PART: ({ agentId, messageId, index, callId }) =>
      asked(client.agentPart(agentId, messageId, index, callId)),
    // The Inbox's acts (`AGENT_INBOX_ACTS`): each row write drawn over the pool the moment it is asked.
    AGENTS_INBOX_ANSWER: declaredWrite(dependencies.pool, nodded),
    // Note that a held close's account is read as it is asked, since it may come to be sent only after another has signed in.
    AGENTS_INBOX_CLOSE: declaredWrite(dependencies.pool, closed, {
      read: (input: AgentInboxCloseParams) =>
        Effect.sync(() => {
          if (input.held === true) heldBy.set(input.clientKey, dependencies.accountId());
          return input;
        }),
    }),
    AGENTS_INBOX_CLOSE_RELEASE: ({ clientKey, send }) =>
      Effect.gen(function* () {
        const held = heldCloses.get(clientKey);
        if (held !== undefined) {
          heldCloses.delete(clientKey);
          yield* Deferred.succeed(held.told, send);
          return { held: true };
        }
        if (letGoAt.has(clientKey)) return { held: false };
        // Note that a close not yet come to be sent, behind an earlier write on its item or among those waiting for the service, goes by this decision once it is.
        const now = kernel.now();
        forgetStale(now);
        decidedEarly.set(clientKey, { send, at: now });
        return { held: true };
      }),
    AGENTS_INBOX_MESSAGE: declaredWrite(dependencies.pool, messaged),
    AGENTS_INBOX_START: (start) =>
      Effect.tap(asked(client.startInboxThread(start)), (answer) =>
        accountWide.confirm("failure" in answer ? undefined : answer.txid),
      ),
    AGENTS_INBOX_READ_STATE: declaredWrite(dependencies.pool, marked),
    AGENTS_INBOX_REMIND: declaredWrite(dependencies.pool, reminded),
    AGENTS_INBOX_ITEM_HOME: ({ itemId }) => asked(client.inboxItemHome(itemId)),
    AGENTS_INBOX_READ_ALL: declaredWrite(dependencies.pool, markedAll),
    AGENTS_INBOX_ATTACHMENT: ({ itemId, attachmentId }) =>
      keptAsked(
        new InboxAttachmentKey({ itemId, attachmentId }),
        client.inboxAttachment(itemId, attachmentId),
        (attachment) => ("base64" in attachment ? attachment : undefined),
      ),
    AGENTS_PICTURE: ({ agentId, pictureId, callId }) =>
      keptAsked(
        new AgentPictureKey({ agentId, pictureId, callId }),
        client.agentPicture(agentId, pictureId, callId),
        (picture) => ("base64" in picture ? picture : undefined),
      ),
    // An agent's origin is held for a window while its page shows it.
    AGENTS_ORIGIN_FOLLOW: {
      hold: ({ agentId }) => origins.hold(agentId),
      retry: ({ agentId }) => origins.retry(agentId),
    },
    // A pull request's chapters are held for a window while its Pull request tab reads them.
    CHAPTERS_FOLLOW: {
      hold: ({ agentId, number }) => chapters.hold(new ChaptersKey({ agentId, number })),
      retry: ({ agentId, number }) => chapters.retry(new ChaptersKey({ agentId, number })),
    },
    // The models are held for the windows while any draws a model or a device, under the account signed in.
    AGENTS_MODELS_FOLLOW: {
      hold: () => modelsHold.hold,
      retry: () =>
        Effect.suspend(() => {
          const userId = dependencies.accountId();
          return userId === undefined ? Effect.void : models.retry(userId);
        }),
    },
    // A transcript is held for a window while its tab shows it.
    AGENTS_TRANSCRIPT: {
      hold: (transcript) => transcriptSlice.hold(transcriptKeyOf(transcript)),
      retry: (transcript) => transcriptSlice.retry(transcriptKeyOf(transcript)),
    },
    // A Pull request tab's parts are held for the windows while the tab shows.
    AGENTS_PULL_REQUEST_PART_FOLLOW: { hold: parts.hold, retry: parts.retry },
    // An agent's own tools are held for the windows while its servers popover shows.
    AGENTS_WORKSPACE_TOOLS_FOLLOW: {
      hold: ({ agentId }) => tools.hold(agentId),
      retry: ({ agentId }) => tools.retry(agentId),
    },
    // A task's or an agent's inbox is held for the windows while the Inbox shows it.
    AGENTS_INBOX_FOLLOW: {
      hold: (scope) => holders.hold(new InboxScopeKey({ kind: scope.kind, id: scope.id })),
      retry: (scope) => holders.retry(new InboxScopeKey({ kind: scope.kind, id: scope.id })),
    },
    // The session's inbox items, followed again at once, as Try again asks.
    AGENTS_INBOX_ITEMS_RETRY: () => sessionReads.reopen(LIVE_READ.INBOX_ITEMS, followItems),
    // The account's preferences, read again at once for the account signed in, as Try again asks.
    AGENTS_PREFERENCES_RETRY: () =>
      Effect.suspend(() => {
        const userId = dependencies.accountId();
        return userId === undefined ? Effect.void : preferences.retry(userId);
      }),
  };

  const methods: HostMethodTable = {
    // What waits across the account is followed for main's notices, never a window, so it is no live follow: told on its own event, and let go as the notices ask.
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
  };

  // Note that the windows' holds stand through a sign-out, so a session signing in follows them anew (`open`).
  const reset = Effect.gen(function* () {
    // Note that a close the leaving account held is never sent under whoever comes next.
    yield* dropHeldCloses;
    yield* transcriptSlice.end;
    yield* holders.end;
    yield* chapters.end;
    yield* origins.end;
    yield* FiberHandle.clear(accountFollow);
    for (const key of yield* RcMap.keys(transcripts)) yield* RcMap.invalidate(transcripts, key);
    yield* kept.clear;
    for (const scope of yield* RcMap.keys(inboxes)) yield* RcMap.invalidate(inboxes, scope);
    for (const userId of yield* RcMap.keys(accounts)) yield* RcMap.invalidate(accounts, userId);
    yield* sessionReads.end;
    yield* preferences.end;
    yield* tools.end;
    yield* models.end;
    yield* parts.end;
  });

  // Note that the models are held anew under whoever signed in, in place of the hold before, rather than followed again under the account they were held for.
  const open = Effect.gen(function* () {
    yield* sessionReads.open(LIVE_READ.INBOX_ITEMS, followItems);
    yield* sessionReads.open(LIVE_READ.ACCOUNT_PREFERENCES, holdPreferences);
    yield* transcriptSlice.open;
    yield* holders.open;
    yield* chapters.open;
    yield* origins.open;
    yield* modelsHold.open;
    yield* tools.open;
    yield* parts.open;
  });

  return {
    methods,
    acts,
    modelsMoved: models.wake(() => true),
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
    flushHeldCloses,
    letGoHeldCloses,
  };
}
