import { isDeepStrictEqual } from "node:util";
import {
  type HostedCodingAgentClient,
  type HostedGitHubConnectionClient,
  type HostedTaskClient,
  type HostedWorkspaceClient,
  type PlanDraftFrame,
  type TaskActivityFrame,
  type TaskMarks,
  WORKSPACE_CALL_FAILURE,
  type WorkspaceCallResult,
} from "@luke/features";
import { DRAW_ON_BOARD_TOOL_NAME, LOOK_AT_BOARD_TOOL_NAME } from "@luke/features/board-vocabulary";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentCallFailure,
  type CodingAgentMessagesAnswerView,
} from "@luke/features/coding-agent-view";
import {
  applyMessagesPage,
  CODING_AGENT_STATUS,
  type CodingAgentMessagesAnswer,
  type CodingAgentStatus,
} from "@luke/features/coding-agent-wire";
import { SHOW_PAGE_TOOL_NAME } from "@luke/features/page-wire";
import { PLAN_ACTOR, type Task } from "@luke/features/task-wire";
import {
  IDLE_TASKS_VIEW,
  planningPullRequestParamsSchema,
  TASK_CALL_FAILURE,
  TASK_WORK_STATE,
  TASKS_READ,
  type TaskCodeShowing,
  type TaskShownCode,
  type TasksDocument,
  type TasksEditAnswer,
  type TasksFileAnswer,
  type TasksGitHubDisconnectAnswer,
  type TasksGitHubPageAnswer,
  type TasksIssueAnswer,
  type TasksLinearIssuesAnswer,
  type TasksMoveAnswer,
  type TasksPageAnswer,
  type TasksPictureAnswer,
  type TasksPictureKeepAnswer,
  type TasksPullRequestAnswer,
  type TasksRepositoriesAnswer,
  type TasksRevisionAnswer,
  type TasksRevisionsAnswer,
  type TasksSetRepositoryAnswer,
  type TasksSkillsAnswer,
  type TasksStartAnswer,
  type TasksTreeAnswer,
  type TasksView,
  type TasksWorkspaceAnswer,
  type TasksWorkspaceGitHubConnectAnswer,
  type TasksWorkspaceInvitationAnswer,
  type TasksWorkspaceInvitationsAnswer,
  type TasksWorkspaceLeaveAnswer,
  type TasksWorkspaceMembersAnswer,
  type TasksWorkspacePhotoAnswer,
  type TaskWorkTurn,
  tasksArchiveParamsSchema,
  tasksBoardSaveParamsSchema,
  tasksEditParamsSchema,
  tasksFileParamsSchema,
  tasksIssueParamsSchema,
  tasksLinearIssuesParamsSchema,
  tasksMessagesParamsSchema,
  tasksMoveParamsSchema,
  tasksPageParamsSchema,
  tasksPictureKeepParamsSchema,
  tasksPictureParamsSchema,
  tasksPinParamsSchema,
  tasksPinRepositoryParamsSchema,
  tasksRenameParamsSchema,
  tasksRepositoriesParamsSchema,
  tasksRevisionParamsSchema,
  tasksRevisionsParamsSchema,
  tasksSetRepositoryParamsSchema,
  tasksSkillsParamsSchema,
  tasksStartRequestSchema,
  tasksTreeParamsSchema,
  tasksWorkspaceCreateParamsSchema,
  tasksWorkspaceInvitationCancelParamsSchema,
  tasksWorkspaceInviteParamsSchema,
  tasksWorkspaceLeaveParamsSchema,
  tasksWorkspaceMemberRemoveParamsSchema,
  tasksWorkspaceMemberRoleParamsSchema,
  tasksWorkspaceMembersParamsSchema,
  tasksWorkspaceParamsSchema,
  tasksWorkspacePhotoParamsSchema,
  tasksWorkspacePhotoSetParamsSchema,
  tasksWorkspaceRenameParamsSchema,
  tasksWorkspaceTransferParamsSchema,
} from "@luke/features/tasks-view";
import { EMPTY_TRANSCRIPT } from "@luke/features/transcript-wire";
import type { Workspace } from "@luke/features/workspace-wire";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  invalid,
} from "@luke/gateway";
import { unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import {
  Clock,
  Data,
  Duration,
  Effect,
  FiberHandle,
  Option,
  Queue,
  Result,
  Schedule,
  Schema,
  type Scope,
  Semaphore,
  type SubscriptionRef,
} from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as HttpClient from "effect/http/HttpClient";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import { type ConversationMark, conversationMark, markMoved } from "./conversation-follow.js";
import type { HostKernel } from "./host-kernel.js";
import { type LiveClient, openRealtimeClient } from "./live-follow.js";
import type { RunMode } from "./run-mode.js";
import { codeExcerpt, highlightCode, highlightFile } from "./task-code.js";

/**
 * compose-tasks.ts -- the panel's named plans, read from the service: the list, the one active plan, and its document, drawn as the notetaker writes it during a call.
 *
 * Nothing here writes a document but a restore the developer asks for: the
 * plan's notetaker and coding agents are its writers, on the service. What
 * this concern owes the panel is to show those writes as they happen. Every write happens during a planning call, and the notetaker's
 * drafts arrive on that call's own socket and are drawn in place: the list
 * and the open plan are read when the Plans tab shows, when a plan opens, and
 * when one starts, and never on a clock. The open plan's whiteboard is read
 * with its document, and again whenever the call's activity says a draw by
 * the planning model just settled or the planning model stopped working, since
 * a draw happens only inside its turn; the panel saves the board's scene
 * through here and the view takes the board as the service answered it. What
 * was said on the open plan's calls is read with its document, and again
 * whenever a call about it ends, once at the end and once more when the
 * call's last words have had time to reach the record; while a call stands,
 * its words are the voice window's to report.
 * The loops here are those board and transcript reads. The code Luke puts
 * on screen during a call arrives on the call's socket with its lines, read
 * by the service from the plan's repository, and is coloured here
 * (`task-code.ts`) and drawn in place; nothing of the repository is read on
 * this Mac. What the planning model wrote and ran on the plan's calls, and
 * every code shown on them, are read from the service with the document, so
 * a plan opened after a restart or a switch shows them; its older work is
 * read a page at a time as the Work tab asks, and each turn a call tells and
 * each code it shows lands over those reads and stays past the call's end. The repositories the account reaches, and a plan's repository
 * given or taken away, are the service's too, asked through here, as are a
 * plan pinned or archived: the list holds the archived plans beside the
 * rest, each flagged, and which the window draws where is the window's. A
 * plan's history is read for the version history that asks and held nowhere
 * here; a revision restored is the one write this concern carries to the
 * service on the developer's word, and the view takes the plan it answers.
 * The pages agents wrote for the open plan are listed with its document, by
 * title and newest version alone, and again whenever the call's activity
 * says a page the planning model showed just settled or it stopped working;
 * a page's HTML is answered to the frame that draws it and held nowhere
 * here. Beside the work, the open plan's planning conversation is read as
 * an agent's transcript is, on the service's held read, and held on the
 * view for the Call tab to switch to; a planning worker's transcript is
 * answered to the tab that asks for it and held nowhere here.
 *
 * The workspaces the account is a member of are carried on the view beside
 * the plans and read apart from them, so the plans never wait on them: on
 * the first refresh after a launch or a sign-in, when the panel comes
 * forward, at most once a minute either way, and after a workspace call
 * moved them. A workspace made, renamed, or given a photo, a GitHub
 * organization connected or disconnected, a removal of a member, a
 * member's role changed, a handover, and a leave are carried to the
 * service on the developer's word, and a workspace's members and a
 * connection's install address are answered to the caller that asked and
 * held nowhere here.
 */

/**
 * How long after a call's end its transcript and work are read a second time. Note
 * that the first read can land before the service has written the call's
 * last words, because the service closes the device's socket first and only
 * then waits on the writes it already started, and says nothing once they
 * land; this is that wait's margin.
 */
const TRANSCRIPT_SETTLE = Duration.seconds(5);

/**
 * How long the conversation's read waits after one the service did not
 * answer: the first wait, doubling on each read that fails again, up to the
 * longest.
 */
const CONVERSATION_RETRY = { FIRST: Duration.seconds(1), LONGEST: Duration.seconds(30) } as const;

const CONVERSATION_BACKOFF = Schedule.exponential(CONVERSATION_RETRY.FIRST).pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, CONVERSATION_RETRY.LONGEST)),
  ),
);

/** The statuses a conversation page reads as still writing: a planning turn, or a worker of one, that may add to it. */
const CONVERSATION_WRITING: ReadonlySet<CodingAgentStatus> = new Set([
  CODING_AGENT_STATUS.STARTING,
  CODING_AGENT_STATUS.RUNNING,
]);

/** A read of a plan's conversation the service did not answer, as the backoff retries it. */
class ConversationUnanswered extends Data.TaggedError("ConversationUnanswered")<{
  readonly failure: CodingAgentCallFailure;
}> {}

/** Whether a page says the planner, or a worker of its, may still add to the conversation. */
function conversationWriting(page: CodingAgentMessagesAnswer): boolean {
  return (
    CONVERSATION_WRITING.has(page.status) ||
    (page.subagents ?? []).some((worker) => CONVERSATION_WRITING.has(worker.status))
  );
}

/**
 * The entries held of a conversation's workers with a page's joined in by
 * the call that started each: the page's in place of one held under the
 * same call, and a new one after the rest. Note that the list is joined
 * rather than replaced, because a planning conversation's page names only
 * the workers of the turns it carries and of its newest few.
 */
function joinedByCall<Entry extends { readonly callId: string }>(
  held: readonly Entry[] | undefined,
  page: readonly Entry[] | undefined,
): readonly Entry[] | undefined {
  if (page === undefined || page.length === 0) return held;
  const heard = new Map(page.map((entry) => [entry.callId, entry]));
  const kept = (held ?? []).map((entry) => heard.get(entry.callId) ?? entry);
  const known = new Set((held ?? []).map((entry) => entry.callId));
  return [...kept, ...page.filter((entry) => !known.has(entry.callId))];
}

/** Where each worker stands and what it is titled, the page's joined to those held, each list only where it names one. */
function withWorkers(
  held: CodingAgentMessagesAnswer,
  page: CodingAgentMessagesAnswer,
): Pick<CodingAgentMessagesAnswer, "subagents" | "subagentTitles"> {
  const subagents = joinedByCall(held.subagents, page.subagents);
  const subagentTitles = joinedByCall(held.subagentTitles, page.subagentTitles);
  return {
    ...(subagents === undefined ? undefined : { subagents }),
    ...(subagentTitles === undefined ? undefined : { subagentTitles }),
  };
}

/** A plan's pin, where it stands, and its archive as the list carries them, each only where it stands. */
type TaskMarkStamps = Pick<Task, "pinnedAt" | "pinPosition" | "archivedAt">;

/**
 * How long a read of the account's workspaces stands before a refresh or the
 * panel coming forward reads them again. Note that a teammate's change or an
 * organization connected in the browser reaches this Mac only on a read, and
 * a panel brought forward over and over is not a reason to read each time.
 */
const WORKSPACES_READ_EVERY = Duration.minutes(1);

/** A GitHub page asked behind a closed gate, or of a service that did not answer, which opens nothing. */
const GITHUB_PAGE_UNANSWERED = { failure: TASK_CALL_FAILURE.UNANSWERED } as const;

/** A workspace call behind a closed gate, which never reaches the service. */
const WORKSPACE_UNANSWERED = { failure: WORKSPACE_CALL_FAILURE.UNANSWERED } as const;

/** Opening or deleting a plan names it and nothing else. */
const tasksOpenParamsSchema = Schema.Struct({ taskId: Schema.NonEmptyString });

/** The service's side of the plans, and the workspaces they live in, as this concern asks it. */
export type TasksClient = Pick<
  HostedTaskClient,
  | "list"
  | "open"
  | "create"
  | "delete"
  | "rename"
  | "mark"
  | "repositoryPins"
  | "pinRepository"
  | "readBoard"
  | "saveBoard"
  | "readTranscript"
  | "readWork"
  | "readFile"
  | "readTree"
  | "readSkills"
  | "readRepositoryTree"
  | "readRepositorySkills"
  | "readRepositoryPullRequest"
  | "readRepositoryIssue"
  | "readRevisions"
  | "readRevision"
  | "readPages"
  | "readPageVersion"
  | "readPicture"
  | "keepPicture"
  | "restore"
  | "repositories"
  | "setRepository"
  | "move"
  | "edit"
> & {
  /** The account's workspaces, the ones it may join, and their members. */
  workspaces: Pick<
    HostedWorkspaceClient,
    | "list"
    | "create"
    | "rename"
    | "setPhoto"
    | "githubConnect"
    | "githubDisconnect"
    | "linearConnect"
    | "linearDisconnect"
    | "linearIssues"
    | "people"
    | "photo"
    | "removeMember"
    | "changeRole"
    | "transfer"
    | "leave"
    | "invite"
    | "invitations"
    | "cancelInvitation"
  >;
  /** Whether the account has GitHub connected, and the pages that connect and disconnect it. */
  github: Pick<HostedGitHubConnectionClient, "status" | "connect" | "disconnect">;
};

/** The service's side of a plan's planning conversation, read as an agent's transcript is, and its mark sealed for following over Neon Realtime. */
export type TasksConversationClient = Pick<
  HostedCodingAgentClient,
  "taskMessages" | "taskConversationLive"
>;

export interface TasksDependencies {
  kernel: Pick<HostKernel, "emit" | "now"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  client: TasksClient;
  conversations: TasksConversationClient;
  /** Realtime's client at an address, which the open plan's conversation is followed over; Realtime's own outside a test. */
  openLive?: (url: string) => LiveClient;
  /**
   * Ends the planning call standing about `taskId`, or whatever it is about
   * where none is named, and waits for it to end. A call about another plan
   * is left standing.
   */
  endTaskCall: (taskId: string | undefined) => Effect.Effect<void>;
}

export interface TasksComposer extends Composer {
  /** The view as this Mac holds it now. */
  snapshot: () => TasksView;
  /** The one active plan, which a voice session binds to; nothing while the panel has none open. */
  activeTaskId: () => string | undefined;
  /** Drops everything held, for a sign-out, and tells every client the panel has nothing. */
  reset: Effect.Effect<void>;
  /**
   * Shows a draft of the open plan the service's notetaker sent while a
   * planning call writes it, in place of the document held; a draft of any
   * other plan, or with no document of that plan held, is dropped.
   */
  showDraft: (draft: PlanDraftFrame) => void;
  /**
   * Shows what each part of Luke is doing on the call about the open plan,
   * as the service last said it; a word about any other plan is dropped.
   * Leaving or switching plans clears it, and the call's end says nothing
   * doing.
   */
  showActivity: (activity: TaskActivityFrame) => void;
  /**
   * Puts code on screen as Luke named it on the open plan's call, with the
   * lines the service read from the plan's repository: coloured here and
   * drawn after every code shown before it, where it stays past the call's
   * end. Code about any other plan, or of a call already held, is dropped.
   */
  showCode: (taskId: string, shown: TaskShownCode) => void;
  /**
   * Shows a planning turn's work on the call about the open plan, in place
   * of the same turn as last told, the newest turns kept; work about any
   * other plan is dropped. Leaving or switching plans clears it, and the
   * call's end keeps it.
   */
  showWork: (taskId: string, turn: TaskWorkTurn) => void;
  /** The call about `taskId` ended: its words are read back from the record. */
  callEnded: (taskId: string) => void;
}

/**
 * The panel's plans as one concern. The view is told to every client whole
 * whenever it moves, and exactly one plan is active at a time: opening or
 * starting one replaces whichever was, and a read still out for the replaced
 * plan is dropped when it lands. Only one plan is ever the spoken
 * conversation, so opening another plan, starting one, leaving the open plan,
 * or a sign-out ends the call about the plan that was open before anything
 * else moves. The Plans tab showing reads the list and the open plan again,
 * while the open plan and its call stand through the tab hiding. Behind a
 * closed account gate, or on a run that sends nothing, nothing is read.
 *
 * The open plan's conversation is read the way an agent's tab reads its
 * transcript: its newest page when the plan opens, starts, or is refreshed,
 * then one held read past the cursor after another, which the service holds
 * open while a planning turn or one of its workers runs and nothing new
 * stands. The read follows while the last page says the planner or a worker
 * still writes, and parks once a page says neither, because the service
 * answers an idle conversation at once and asking again would be a loop on
 * no clock at all. Note that it reads the workers the page names rather
 * than the list held, because a worker no page names any more reads as it
 * last did and would keep the read asking. Any word of the open plan's call (its activity, or its
 * end) wakes a parked read, from the cursor held, since a turn begins only
 * on a call and its activity says so. One read stands at a time: opening
 * another plan replaces it, and leaving the plan or a sign-out stops it. A
 * read the service did not answer is asked again after a backoff; a plan the
 * service no longer holds parks it.
 *
 * Where the service seals the conversation's mark for Neon Realtime
 * (`conversation-follow.ts`), the read is held here instead: the host
 * subscribes to the mark while the plan is open, and asks the conversation
 * past its cursor in one look, unheld, each time the mark moves, so the
 * service never looks again on a clock and nothing parks or needs waking.
 * A service that seals nothing, or a subscription that stops, is read as
 * before, from the cursor held.
 */
export const composeTasks = /* @__PURE__ */ Effect.fn("host/composeTasks")(function* (
  dependencies: TasksDependencies,
): Effect.fn.Return<TasksComposer, never, Scope.Scope> {
  const { kernel, account, client, conversations, endTaskCall } = dependencies;
  const idleView = (): TasksView => IDLE_TASKS_VIEW;
  const gate = () => kernel.runMode.sendsNetwork && account.capabilitiesActive();

  /**
   * One read of the service at a time, whichever ask made it. Note that the
   * answers are applied in the order the reads were made, because a list
   * that left before a plan started, or a document read that left before a
   * newer one, would otherwise land last and roll the view back.
   */
  const serial = (yield* Semaphore.make(1)).withPermits(1);

  let view: TasksView = idleView();
  let published: TasksView = view;

  function publish(): void {
    if (isDeepStrictEqual(view, published)) return;
    published = view;
    kernel.emit(GATEWAY_EVENT.TASKS_CHANGED, carried(view));
  }

  function write(next: Partial<TasksView>): void {
    view = { ...view, ...next };
    publish();
  }

  /** The view with no activity, no board, no transcript, no code, no work, no conversation, and no pages read or told, as a plan left behind leaves it. */
  function withoutActivity({
    activity: _activity,
    board: _board,
    transcript: _transcript,
    shownCode: _shownCode,
    work: _work,
    workEarlier: _workEarlier,
    conversation: _conversation,
    pages: _pages,
    ...rest
  }: TasksView): TasksView {
    return rest;
  }

  /** The plans whose board a settled draw may have moved, read one at a time by the loop below. */
  const boardReads = yield* Queue.sliding<string>(1);

  /** The plans whose pages a settled `show_page` may have moved, read one at a time by the loop below. */
  const pageReads = yield* Queue.sliding<string>(1);

  /** The plans a call just ended about, whose transcript and work are read again by the loop below. */
  const callEndReads = yield* Queue.sliding<string>(1);

  /** The one read of the open plan's conversation; running another interrupts it. */
  const conversationRead = yield* FiberHandle.make<void>();

  /** The plans whose call just said something, whose parked conversation read the loop below wakes. */
  const conversationWakes = yield* Queue.sliding<string>(1);

  /**
   * Whether the open plan's call said something since the conversation read
   * last asked. Note that a read already out when a turn began can answer
   * the conversation idle, so the read checks this before it parks rather
   * than miss the turn until the call's next word.
   */
  let conversationWoken = false;

  /** The open plan the service sealed no conversation mark for, read on held reads until it is opened again. */
  let unsealedTaskId: string | undefined;

  /**
   * The plan whose call is telling its turns' work as they run, and the
   * turns that call told, which stand over the record's running copies; none
   * once that call ended, since nothing it told is ahead of the record any
   * more. A turn an earlier call told is not among them.
   */
  let telling: { readonly taskId: string; readonly turnIds: Set<string> } | undefined;

  /**
   * The developer's newest save of an edit, and the plan it was of. A draft
   * the notetaker drew over a save older than it does not hold the edit, so
   * it is dropped rather than drawn: the edit would vanish until the
   * notetaker's next save, which takes it in under the plan's lock.
   */
  let developerSaved: { readonly taskId: string; readonly at: number } | undefined;

  /** The document of `taskId` as held now, if the held one is that plan's. */
  function heldTaskOf(taskId: string): TasksDocument["task"] {
    const held = view.document.task;
    return held?.id === taskId ? held : undefined;
  }

  /** A plan's row of the list: everything but its document and what is written of it. */
  function summaryOf({
    document: _document,
    agentEdits: _agentEdits,
    lastEdit: _lastEdit,
    ...summary
  }: Task): TasksView["tasks"][number] {
    return summary;
  }

  const readList = Effect.gen(function* () {
    const listed = yield* Effect.provide(client.list(), FetchHttpClient.layer);
    // A failed read keeps the list it last read: the panel says the read
    // failed beside the plans it already drew rather than emptying them.
    write(
      listed.ok
        ? {
            tasks: listed.answer.plans,
            tasklessAgents: listed.answer.planlessAgents ?? [],
            listStatus: TASKS_READ.READY,
          }
        : { listStatus: TASKS_READ.FAILED },
    );
  });

  /**
   * When the workspaces were last asked for, none since a sign-out; and the
   * latest read started, which a sign-out also moves past, so a read that
   * answers after a later one began or across a sign-out is dropped.
   */
  let workspacesAskedAt: number | undefined;
  let workspacesRead = 0;

  /**
   * Reads the account's workspaces, and whether its GitHub is connected
   * beside them, apart from the plans, which never wait on it. Note that the
   * connection is read with the workspaces, because both move in the
   * browser and the panel coming forward is when either is read again; each
   * lands on the view as soon as it is read, so a slow connection read never
   * holds back the workspaces. A failed read keeps what it last read, as a
   * failed list read keeps the plans.
   *
   * Note that only the latest read started is drawn, because reads overlap
   * (a refresh, a write's read after it) and an older one answering last
   * would put back what a write since then moved.
   */
  const readWorkspaces = Effect.gen(function* () {
    workspacesRead += 1;
    const read = workspacesRead;
    workspacesAskedAt = yield* Clock.currentTimeMillis;
    const current = () => read === workspacesRead;
    const workspaces = Effect.tap(client.workspaces.list(), (answer) =>
      Effect.sync(() => {
        if (!current()) return;
        // A read that did not answer leaves the workspaces stale, so the next refresh reads them again at once.
        if (answer === undefined) workspacesAskedAt = undefined;
        else write({ workspaces: answer.workspaces });
      }),
    );
    const github = Effect.tap(client.github.status(), (read) =>
      Effect.sync(() => {
        if (current() && read.ok) write({ github: read.answer });
      }),
    );
    yield* Effect.provide(
      Effect.all([workspaces, github], { concurrency: "unbounded", discard: true }),
      FetchHttpClient.layer,
    );
  });

  /** Reads the workspaces where none was asked for since a sign-out, or the last ask is older than its bound. */
  const readWorkspacesWhenStale = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const fresh =
      workspacesAskedAt !== undefined &&
      now - workspacesAskedAt < Duration.toMillis(WORKSPACES_READ_EVERY);
    if (!fresh) yield* readWorkspaces;
  });

  // A failed read keeps the pins it last read, as a failed list read keeps the plans.
  const readRepositoryPins = Effect.gen(function* () {
    const pins = yield* Effect.provide(client.repositoryPins(), FetchHttpClient.layer);
    if (pins !== undefined) write({ repositoryPins: pins });
  });

  /**
   * Reads the active plan's document. A copy of the same plan already held
   * stays drawn while the read is out, and stays drawn through a read that
   * failed, so a save redraws in place and a moment offline blanks nothing;
   * with no copy held, the failure is what the panel draws.
   */
  function readDocument(taskId: string) {
    return Effect.gen(function* () {
      const held = heldTaskOf(taskId);
      if (held === undefined) write({ document: { status: TASKS_READ.READING } });
      const opened = yield* Effect.provide(client.open(taskId), FetchHttpClient.layer);
      // Another plan opened while this read was out: its answer is not the panel's any more.
      if (view.activeTaskId !== taskId) return;
      if (opened.ok) {
        write({ document: { status: TASKS_READ.READY, task: opened.answer } });
        return;
      }
      if (opened.failure === TASK_CALL_FAILURE.NOT_FOUND) {
        write({ document: { status: TASKS_READ.MISSING } });
        return;
      }
      write({
        document:
          held === undefined
            ? { status: TASKS_READ.FAILED }
            : { status: TASKS_READ.READY, task: held },
      });
    });
  }

  /** Reads the active plan's board; a failed read keeps the board drawn. */
  function readBoard(taskId: string) {
    return Effect.gen(function* () {
      const board = yield* Effect.provide(client.readBoard(taskId), FetchHttpClient.layer);
      if (board === undefined || view.activeTaskId !== taskId) return;
      write({ board });
    });
  }

  /**
   * Reads what was said on the active plan's calls. A transcript already
   * held stays drawn while the read is out and through a read that failed,
   * as the document does; with none held, the failure is what the panel
   * draws.
   */
  function readTranscript(taskId: string) {
    return Effect.gen(function* () {
      const held = view.transcript?.transcript;
      if (held === undefined) write({ transcript: { status: TASKS_READ.READING } });
      const transcript = yield* Effect.provide(
        client.readTranscript(taskId),
        FetchHttpClient.layer,
      );
      if (view.activeTaskId !== taskId) return;
      if (transcript !== undefined) {
        write({ transcript: { status: TASKS_READ.READY, transcript } });
        return;
      }
      write({
        transcript:
          held === undefined
            ? { status: TASKS_READ.FAILED }
            : { status: TASKS_READ.READY, transcript: held },
      });
    });
  }

  /**
   * The plan a restore just replaced the content of, and the restore's save,
   * until the notetaker saves after it. Note that the drafts of its turn in
   * flight were written over the content the restore replaced, so a draft,
   * or a save from before the restore landing late, would draw that content
   * back over the restored one; the notetaker's next save is taken over the
   * restored content on the service, and is the first draw to trust again.
   */
  let restoredFence: { readonly taskId: string; readonly at: number } | undefined;

  function showDraft(draft: PlanDraftFrame): void {
    const held = heldTaskOf(draft.planId);
    if (held === undefined || view.activeTaskId !== draft.planId) return;
    if (restoredFence?.taskId === draft.planId) {
      if (draft.savedAt === undefined || draft.savedAt <= restoredFence.at) return;
      restoredFence = undefined;
    }
    const drawnOver = draft.savedAt ?? draft.readAt;
    if (
      drawnOver !== undefined &&
      developerSaved?.taskId === draft.planId &&
      drawnOver < developerSaved.at
    ) {
      return;
    }
    // A saved draft carries its save's instant and who last changed each
    // section as the service names them, so the copy held is the save's,
    // written by the notetaker on this call.
    const task = {
      ...held,
      document: draft.document,
      ...(draft.savedAt === undefined
        ? undefined
        : {
            updatedAt: draft.savedAt,
            lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: draft.savedAt, duringCall: true },
          }),
      ...(draft.sectionEdits === undefined ? undefined : { sectionEdits: draft.sectionEdits }),
    };
    write({ document: { status: TASKS_READ.READY, task } });
  }

  /** Takes the active plan's work as it now stands, and where its next older page is read from, none where no older turn stands. */
  function writeWork(next: Pick<TasksView, "work" | "workEarlier" | "shownCode">): void {
    const { workEarlier: _was, ...rest } = view;
    view = { ...rest, ...next };
    publish();
  }

  /**
   * The held turns with a page the service answered laid among them, in the
   * order the turns began. Note that a turn the open plan's call told stands
   * over the record's copy while that copy still runs and that call still
   * tells, because the call is ahead of the record there; once the call has
   * ended, a turn still running on record, parked on a worker, is the
   * record's, because the record goes on following the worker after the
   * call's last word.
   */
  function withPage(page: readonly TaskWorkTurn[]): TaskWorkTurn[] {
    const calling = telling?.taskId === view.activeTaskId ? telling?.turnIds : undefined;
    const told = new Map((view.work ?? []).map((turn) => [turn.turnId, turn]));
    const recorded = page.map((turn) => {
      const live = told.get(turn.turnId);
      const ahead = calling?.has(turn.turnId) === true && turn.state === TASK_WORK_STATE.RUNNING;
      return ahead && live !== undefined ? live : turn;
    });
    const read = new Set(page.map((turn) => turn.turnId));
    const unread = (view.work ?? []).filter((turn) => !read.has(turn.turnId));
    return [...recorded, ...unread].sort((a, b) => a.startedAt - b.startedAt);
  }

  /** A code shown as the Code tab's card draws it: the lines around those pointed at, coloured. */
  function showingOf({ code, ...shown }: TaskShownCode): TaskCodeShowing {
    return { ...shown, code: highlightCode(codeExcerpt(code)) };
  }

  /**
   * The code the record holds, oldest first, then each a call showed that
   * the record does not hold yet. Note that a showing already held is kept
   * rather than coloured again, because the plan's work is read again on
   * every refresh and colouring the windows is what costs.
   */
  function withShownCode(recorded: readonly TaskShownCode[]): TaskCodeShowing[] {
    const held = view.shownCode ?? [];
    const byCall = new Map(held.map((showing) => [showing.callId, showing]));
    const read = recorded.map((shown) => byCall.get(shown.callId) ?? showingOf(shown));
    const recordedCalls = new Set(recorded.map((shown) => shown.callId));
    return [...read, ...held.filter((showing) => !recordedCalls.has(showing.callId))];
  }

  /**
   * Reads the active plan's pages, each by its newest version. A failed read
   * keeps the pages held, as a failed board read keeps the board.
   */
  function readPages(taskId: string) {
    return Effect.gen(function* () {
      const pages = yield* Effect.provide(client.readPages(taskId), FetchHttpClient.layer);
      if (pages === undefined || view.activeTaskId !== taskId) return;
      const { pages: _held, ...rest } = view;
      view = pages.length === 0 ? rest : { ...rest, pages };
      publish();
    });
  }

  /**
   * Reads the newest page of the active plan's work, and every code shown
   * on it, as the service keeps them. Older pages already read stay, with
   * the place the next one is read from; a plan read for the first time
   * takes the service's. Code a call put on screen that the record does not
   * hold yet stays after the record's. A failed read keeps whatever is held.
   */
  function readWork(taskId: string) {
    return Effect.gen(function* () {
      const stored = yield* Effect.provide(client.readWork(taskId), FetchHttpClient.layer);
      if (stored === undefined || view.activeTaskId !== taskId) return;
      const work = withPage(stored.turns);
      const oldest = work[0]?.turnId;
      const olderHeld =
        oldest !== undefined && !stored.turns.some((turn) => turn.turnId === oldest);
      const workEarlier = olderHeld ? view.workEarlier : stored.earlier;
      const shownCode = withShownCode(stored.code ?? []);
      writeWork({
        ...(work.length === 0 ? undefined : { work }),
        ...(workEarlier === undefined ? undefined : { workEarlier }),
        ...(shownCode.length === 0 ? undefined : { shownCode }),
      });
    });
  }

  /** Reads the page of the active plan's work before the oldest turn held, where one stands; a failed read keeps what is held. */
  function readEarlierWork(taskId: string) {
    return Effect.gen(function* () {
      const before = view.workEarlier;
      if (before === undefined) return;
      const stored = yield* Effect.provide(client.readWork(taskId, before), FetchHttpClient.layer);
      if (stored === undefined || view.activeTaskId !== taskId) return;
      writeWork({
        work: withPage(stored.turns),
        ...(stored.earlier === undefined ? undefined : { workEarlier: stored.earlier }),
      });
    });
  }

  /** One page of a plan's conversation, or why the service did not answer it. */
  function askConversation(
    taskId: string,
    page: { after?: string; before?: string; unheld?: boolean },
  ) {
    return Effect.flatMap(
      Effect.provide(conversations.taskMessages(taskId, page), FetchHttpClient.layer),
      (answer) =>
        "failure" in answer
          ? Effect.fail(new ConversationUnanswered({ failure: answer.failure }))
          : Effect.succeed(answer),
    );
  }

  /**
   * The held conversation with a page read from its newest turns or past its
   * cursor joined in by message id and its workers by call, the cursor and
   * where the planner stands taken from the page. Note that the turn the next older page
   * is read before stays the held one once a page older than this one is
   * held, because the page's own names a turn already read.
   */
  function withForwardPage(page: CodingAgentMessagesAnswer): CodingAgentMessagesAnswer {
    const held = view.conversation;
    if (held === undefined) return page;
    const { earlier: _read, subagents: _workers, subagentTitles: _titles, ...rest } = page;
    const oldest = held.messages[0]?.id;
    const olderHeld =
      oldest !== undefined && !page.messages.some((message) => message.id === oldest);
    const earlier = olderHeld ? held.earlier : page.earlier;
    return {
      ...rest,
      messages: applyMessagesPage(held.messages, page.messages),
      ...withWorkers(held, page),
      ...(earlier === undefined ? undefined : { earlier }),
    };
  }

  /** One page of `taskId`'s conversation, asked again after the backoff while the service does not answer; none where the plan is gone or the gate closed. */
  function readConversation(
    taskId: string,
    page: { after?: string; before?: string; unheld?: boolean },
  ) {
    return askConversation(taskId, page).pipe(
      Effect.retry({
        schedule: CONVERSATION_BACKOFF,
        while: (unanswered) => unanswered.failure !== CODING_AGENT_CALL_FAILURE.NOT_FOUND && gate(),
      }),
      Effect.option,
    );
  }

  /**
   * Follows `taskId`'s conversation on reads the service holds, while it is
   * the open plan: from its newest page, or past `after`, then past each
   * page's cursor while the page says it is still written or the call woke
   * it meanwhile.
   */
  function followHeld(taskId: string, from: string | undefined) {
    return Effect.gen(function* () {
      let after = from;
      while (gate() && view.activeTaskId === taskId) {
        conversationWoken = false;
        const page = yield* readConversation(taskId, after === undefined ? {} : { after });
        if (Option.isNone(page) || view.activeTaskId !== taskId) return;
        write({ conversation: withForwardPage(page.value) });
        if (!conversationWriting(page.value) && !conversationWoken) return;
        after = page.value.cursor;
      }
    });
  }

  /**
   * Follows `taskId`'s conversation on its live mark, while it is the open
   * plan: from its newest page, or past `after`, then past each page's
   * cursor in one look each time the mark moves from where it stood as the
   * read before left. A mark that stops goes on from the cursor held on
   * reads the service holds.
   */
  function followLive(
    taskId: string,
    from: string | undefined,
    mark: SubscriptionRef.SubscriptionRef<ConversationMark>,
  ) {
    return Effect.gen(function* () {
      let after = from;
      let seen: ConversationMark = { kind: "waiting" };
      while (gate() && view.activeTaskId === taskId) {
        if (seen.kind === "broken") return yield* followHeld(taskId, after);
        const page = yield* readConversation(
          taskId,
          after === undefined ? {} : { after, unheld: true },
        );
        if (Option.isNone(page) || view.activeTaskId !== taskId) return;
        write({ conversation: withForwardPage(page.value) });
        after = page.value.cursor;
        seen = yield* markMoved(mark, seen);
      }
    });
  }

  /**
   * Follows `taskId`'s conversation while it is the open plan, from its
   * newest page or past the cursor held: on its live mark where the service
   * seals one, and on held reads otherwise. A plan the service answered no
   * mark for is not asked for one again until it is opened again, since
   * every word of a call would otherwise ask. A read the service did not
   * answer is asked again after the backoff; a plan it no longer holds, or
   * a gate that closed, ends the follow.
   */
  function followConversation(taskId: string, newest: boolean) {
    return Effect.scoped(
      Effect.gen(function* () {
        const after = newest ? undefined : view.conversation?.cursor;
        if (newest) unsealedTaskId = undefined;
        if (unsealedTaskId === taskId || !gate()) return yield* followHeld(taskId, after);
        const sealed = yield* Effect.provide(
          conversations.taskConversationLive(taskId),
          FetchHttpClient.layer,
        );
        if ("failure" in sealed) {
          unsealedTaskId = taskId;
          return yield* followHeld(taskId, after);
        }
        const mark = yield* conversationMark(
          {
            seal: () =>
              gate()
                ? Effect.provide(conversations.taskConversationLive(taskId), FetchHttpClient.layer)
                : Effect.succeed({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
            openLive: dependencies.openLive ?? openRealtimeClient,
            now: kernel.now,
          },
          sealed,
        );
        return yield* followLive(taskId, after, mark);
      }),
    );
  }

  /** Reads `taskId`'s conversation from its newest turns and follows it, in place of any read standing. */
  function openConversation(taskId: string) {
    return Effect.asVoid(FiberHandle.run(conversationRead, followConversation(taskId, true)));
  }

  /** Wakes the open plan's parked conversation read, where `taskId` is the open plan. */
  function wakeConversation(taskId: string): void {
    if (view.activeTaskId !== taskId) return;
    conversationWoken = true;
    Queue.offerUnsafe(conversationWakes, taskId);
  }

  /**
   * Reads the page of the active plan's conversation before the oldest turn
   * held, where one stands, and lays it before the rest, its workers joined
   * by call. Note that the cursor and where the planner stands stay the held
   * read's, because the page's cursor is the conversation's now and would
   * skip what the held read has not heard yet. A failed read keeps what is held.
   */
  function readEarlierConversation(taskId: string) {
    return Effect.gen(function* () {
      const before = view.conversation?.earlier;
      if (before === undefined) return;
      const answer = yield* Effect.provide(
        conversations.taskMessages(taskId, { before }),
        FetchHttpClient.layer,
      );
      const held = view.conversation;
      // The plan was left, or opened again, while this read was out.
      if ("failure" in answer || view.activeTaskId !== taskId || held?.earlier !== before) return;
      const { earlier: _read, subagents: _workers, subagentTitles: _titles, ...rest } = held;
      write({
        conversation: {
          ...rest,
          messages: applyMessagesPage(answer.messages, held.messages),
          ...withWorkers(held, answer),
          ...(answer.earlier === undefined ? undefined : { earlier: answer.earlier }),
        },
      });
    });
  }

  /**
   * Shows the call's activity, and asks for the board again where it says a
   * draw just settled: the planning model's pending call was a draw and is
   * not any more, or the planning model stopped working, which also covers a
   * draw that settled between two words about it. A look that just became
   * the pending call asks too, because a draw made in the same step never
   * shows as pending, and the look waits on the board holding it.
   */
  function showActivity({ type: _type, planId: taskId, ...activity }: TaskActivityFrame): void {
    // The call's own copy is kept whatever plan is open, for the floating
    // call window; the panel's is the active plan's alone.
    if (view.activeTaskId !== taskId) {
      write({ callActivity: activity });
      return;
    }
    wakeConversation(taskId);
    const was = view.activity?.planner;
    const drew = was?.action === DRAW_ON_BOARD_TOOL_NAME && activity.planner?.action !== was.action;
    const stopped = was !== undefined && activity.planner === undefined;
    const looking =
      activity.planner?.action === LOOK_AT_BOARD_TOOL_NAME &&
      was?.action !== LOOK_AT_BOARD_TOOL_NAME;
    write({ activity, callActivity: activity });
    if (drew || stopped || looking) Queue.offerUnsafe(boardReads, taskId);
    // A page shown settles the same way a drawing does, and is read as the board is.
    const paged = was?.action === SHOW_PAGE_TOOL_NAME && activity.planner?.action !== was.action;
    if (paged || stopped) Queue.offerUnsafe(pageReads, taskId);
  }

  function showCode(taskId: string, shown: TaskShownCode): void {
    if (view.activeTaskId !== taskId) return;
    const held = view.shownCode ?? [];
    // A call's code told again is the showing already drawn.
    if (held.some((showing) => showing.callId === shown.callId)) return;
    write({ shownCode: [...held, showingOf(shown)] });
  }

  function showWork(taskId: string, turn: TaskWorkTurn): void {
    if (view.activeTaskId !== taskId) return;
    if (telling?.taskId !== taskId) telling = { taskId, turnIds: new Set() };
    telling.turnIds.add(turn.turnId);
    const held = view.work ?? [];
    // A turn told again stays where it first stood, so the tab never reorders what it drew.
    const turns = held.some((standing) => standing.turnId === turn.turnId)
      ? held.map((standing) => (standing.turnId === turn.turnId ? turn : standing))
      : [...held, turn];
    write({ work: turns });
  }

  function callEnded(taskId: string): void {
    if (telling?.taskId === taskId) telling = undefined;
    const { callActivity: _ended, ...rest } = view;
    view = rest;
    publish();
    if (view.activeTaskId !== taskId) return;
    Queue.offerUnsafe(callEndReads, taskId);
    wakeConversation(taskId);
  }

  /** Draws `task` as the service answered it, in the list's row and in the open document where it is the one held. */
  function takeAnswered(task: Task): void {
    const tasks = view.tasks.map((row) =>
      row.id === task.id ? { ...row, ...summaryOf(task) } : row,
    );
    const held = heldTaskOf(task.id);
    write(
      held === undefined
        ? { tasks }
        : { tasks, document: { status: TASKS_READ.READY, task: { ...held, ...task } } },
    );
  }

  /** The pin and the archive a plan answered carries, each only where it stands. */
  function marksOf(task: Task): TaskMarkStamps {
    return {
      ...(task.pinnedAt === undefined ? undefined : { pinnedAt: task.pinnedAt }),
      ...(task.pinPosition === undefined ? undefined : { pinPosition: task.pinPosition }),
      ...(task.archivedAt === undefined ? undefined : { archivedAt: task.archivedAt }),
    };
  }

  /**
   * Draws the pin and the archive `task` was answered with on its row of the
   * list, and on the open document where it is the one held. Note that the
   * row keeps what the list said of the plan's coding agents, which only the
   * list answers, and the held document keeps everything else it holds,
   * because a draft drawn during a call may be ahead of the copy the service
   * answered.
   */
  function takeMarks(task: Task): void {
    const tasks = view.tasks.map((row) =>
      row.id !== task.id
        ? row
        : {
            ...summaryOf(task),
            ...(row.agents === undefined ? undefined : { agents: row.agents }),
          },
    );
    const held = heldTaskOf(task.id);
    if (held === undefined) {
      write({ tasks });
      return;
    }
    const { pinnedAt: _pinned, pinPosition: _position, archivedAt: _archived, ...kept } = held;
    write({
      tasks,
      document: { status: TASKS_READ.READY, task: { ...kept, ...marksOf(task) } },
    });
  }

  /** Pins or archives one plan on the service, or undoes either, and draws what it answered. */
  function markTask(taskId: string, marks: TaskMarks) {
    return serial(
      Effect.gen(function* () {
        const marked = yield* Effect.provide(client.mark(taskId, marks), FetchHttpClient.layer);
        if (marked === undefined) return { changed: false };
        takeMarks(marked);
        return { changed: true };
      }),
    );
  }

  /**
   * One workspace call, then what it may have moved read again, whatever it
   * answered, since a refusal can find it already moved elsewhere: the
   * workspaces after a workspace made, a disconnection, or a removal, and the
   * plans beside them after a leave, which takes a workspace's plans out of
   * the list.
   */
  function workspaceCall<Answer>(
    call: Effect.Effect<WorkspaceCallResult<Answer>, never, HttpClient.HttpClient>,
    moves: { readonly tasks: boolean },
  ): Effect.Effect<WorkspaceCallResult<Answer>> {
    return Effect.tap(Effect.provide(call, FetchHttpClient.layer), () =>
      moves.tasks
        ? Effect.all([readWorkspaces, serial(readList)], { concurrency: "unbounded" })
        : readWorkspaces,
    );
  }

  /**
   * A write whose answer is the workspace as it then stands, then the
   * workspaces read again. Note that the workspace the service answered
   * lands on the view before the read after it, because that read may fail
   * and keep the workspace as it was, and one that answers is the newer word.
   */
  function workspaceWrite(
    call: Effect.Effect<WorkspaceCallResult<Workspace>, never, HttpClient.HttpClient>,
  ): Effect.Effect<TasksWorkspaceAnswer> {
    return Effect.gen(function* () {
      const written = yield* Effect.provide(call, FetchHttpClient.layer);
      if (written.ok) {
        const answered = written.answer;
        write({
          workspaces: view.workspaces.map((each) => (each.id === answered.id ? answered : each)),
        });
      }
      yield* readWorkspaces;
      return written.ok ? { workspace: written.answer } : { failure: written.failure };
    });
  }

  const methods: GatewayMethodTable = {
    // The workspaces are read beside the plans rather than before them, and
    // only where the last read is stale: the first refresh after a launch or
    // a sign-in reads them, and the rest seldom.
    [GATEWAY_METHOD.TASKS_REFRESH]: () =>
      Effect.gen(function* () {
        if (!gate()) return {};
        const open = view.activeTaskId;
        if (open !== undefined) yield* openConversation(open);
        const tasks = serial(
          Effect.gen(function* () {
            yield* readList;
            yield* readRepositoryPins;
            const taskId = view.activeTaskId;
            if (taskId !== undefined) yield* readDocument(taskId);
            if (taskId !== undefined) yield* readBoard(taskId);
            if (taskId !== undefined) yield* readTranscript(taskId);
            if (taskId !== undefined) yield* readWork(taskId);
            if (taskId !== undefined) yield* readPages(taskId);
          }),
        );
        yield* Effect.all([tasks, readWorkspacesWhenStale], { concurrency: "unbounded" });
        return {};
      }),
    // The panel coming forward, which may follow a teammate's change or an
    // installation made on GitHub, read no oftener than the bound allows.
    [GATEWAY_METHOD.WORKSPACES_REFRESH]: () =>
      Effect.gen(function* () {
        if (gate()) yield* readWorkspacesWhenStale;
        return {};
      }),
    [GATEWAY_METHOD.TASKS_OPEN]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksOpenParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("opening a plan names one plan");
        if (!gate()) return { opened: false };
        const { taskId } = read.success;
        // Note that a call about the plan left behind goes on standing,
        // because the call outlives the plan on screen: moving it to this
        // plan is this plan's own Talk press.
        if (view.activeTaskId !== taskId) {
          view = {
            ...withoutActivity(view),
            activeTaskId: taskId,
            document: { status: TASKS_READ.READING },
          };
          publish();
        }
        yield* openConversation(taskId);
        yield* serial(
          Effect.gen(function* () {
            yield* readDocument(taskId);
            yield* readBoard(taskId);
            yield* readTranscript(taskId);
            yield* readWork(taskId);
            yield* readPages(taskId);
          }),
        );
        return { opened: true };
      }),
    [GATEWAY_METHOD.TASKS_WORK_EARLIER]: () =>
      Effect.gen(function* () {
        const taskId = view.activeTaskId;
        if (!gate() || taskId === undefined) return {};
        yield* serial(readEarlierWork(taskId));
        return {};
      }),
    [GATEWAY_METHOD.TASKS_CONVERSATION_EARLIER]: () =>
      Effect.gen(function* () {
        const taskId = view.activeTaskId;
        if (!gate() || taskId === undefined) return {};
        yield* serial(readEarlierConversation(taskId));
        return {};
      }),
    // A page of a plan's conversation, or of a planning worker's, is answered
    // to the tab that asked and held nowhere: the tab keeps what it read.
    [GATEWAY_METHOD.TASKS_MESSAGES]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksMessagesParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid(
            "reading a plan's conversation names the plan, and a cursor, a turn, or a worker's call",
          );
        }
        if (!gate()) {
          return carried<CodingAgentMessagesAnswerView>({
            failure: CODING_AGENT_CALL_FAILURE.UNANSWERED,
          });
        }
        const { taskId, callId, ...page } = read.success;
        const answer = yield* Effect.provide(
          conversations.taskMessages(taskId, page, callId),
          FetchHttpClient.layer,
        );
        return carried<CodingAgentMessagesAnswerView>(answer);
      }),
    // A file's window is answered to the File tab that asked, coloured here,
    // and held nowhere: the tab keeps the windows it has scrolled through.
    [GATEWAY_METHOD.TASKS_FILE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksFileParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("reading a file names a plan, a path, and a window of its lines");
        }
        if (!gate()) return carried<TasksFileAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const { taskId, ...window } = read.success;
        const answer = yield* Effect.provide(
          client.readFile(taskId, window),
          FetchHttpClient.layer,
        );
        if (answer === undefined) {
          return carried<TasksFileAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        return carried<TasksFileAnswer>(
          "file" in answer ? { file: highlightFile(answer.file) } : answer,
        );
      }),
    // A folder's listing is answered to the tree that asked and held nowhere:
    // the tree keeps the folders it has opened.
    [GATEWAY_METHOD.TASKS_TREE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksTreeParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid(
            "listing a folder names a plan, or a workspace and its repository, and the folder's path",
          );
        }
        if (!gate()) return carried<TasksTreeAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const asked = read.success;
        const folder = {
          path: asked.path,
          ...(asked.recursive === undefined ? undefined : { recursive: asked.recursive }),
        };
        const answer = yield* Effect.provide(
          "planId" in asked
            ? client.readTree(asked.planId, folder)
            : client.readRepositoryTree(asked, folder),
          FetchHttpClient.layer,
        );
        return carried<TasksTreeAnswer>(answer ?? { failure: TASK_CALL_FAILURE.UNANSWERED });
      }),
    // The repository's skills are answered to the window that asked and held
    // nowhere: a skill added on GitHub is chosen on the next read.
    [GATEWAY_METHOD.TASKS_SKILLS]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksSkillsParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid(
            "reading a repository's skills names the plan, or a workspace and its repository",
          );
        }
        if (!gate()) {
          return carried<TasksSkillsAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const asked = read.success;
        const answer = yield* Effect.provide(
          "planId" in asked ? client.readSkills(asked.planId) : client.readRepositorySkills(asked),
          FetchHttpClient.layer,
        );
        return carried<TasksSkillsAnswer>(answer ?? { failure: TASK_CALL_FAILURE.UNANSWERED });
      }),
    // A pull request is answered to the link that asked and held nowhere:
    // its title and where it stands are read again on the next ask.
    [GATEWAY_METHOD.TASKS_PULL_REQUEST]: (params) =>
      Effect.gen(function* () {
        const read = readEither(planningPullRequestParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid(
            "reading a pull request names a workspace, its repository, and the pull request's number",
          );
        }
        if (!gate()) {
          return carried<TasksPullRequestAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const { number, ...place } = read.success;
        const answer = yield* Effect.provide(
          client.readRepositoryPullRequest(place, number),
          FetchHttpClient.layer,
        );
        return carried<TasksPullRequestAnswer>(answer ?? { failure: TASK_CALL_FAILURE.UNANSWERED });
      }),
    // An issue is answered as a pull request is: to the link that asked, and held nowhere.
    [GATEWAY_METHOD.TASKS_ISSUE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksIssueParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid(
            "reading an issue names a workspace, its repository, and the issue's number",
          );
        }
        if (!gate()) {
          return carried<TasksIssueAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const { number, ...place } = read.success;
        const answer = yield* Effect.provide(
          client.readRepositoryIssue(place, number),
          FetchHttpClient.layer,
        );
        return carried<TasksIssueAnswer>(answer ?? { failure: TASK_CALL_FAILURE.UNANSWERED });
      }),
    // A page of the history, and a revision beside the one before it, are
    // answered to the version history that asked and held nowhere: it keeps
    // what it read, and reads again as the plan moves on.
    [GATEWAY_METHOD.TASKS_REVISIONS]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksRevisionsParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid(
            "reading a plan's history names the plan, and where an older page is read from",
          );
        }
        if (!gate()) {
          return carried<TasksRevisionsAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const { taskId, before } = read.success;
        const page = yield* Effect.provide(
          client.readRevisions(taskId, before),
          FetchHttpClient.layer,
        );
        return carried<TasksRevisionsAnswer>(page ?? { failure: TASK_CALL_FAILURE.UNANSWERED });
      }),
    [GATEWAY_METHOD.TASKS_REVISION]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksRevisionParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("reading a revision names a plan and its number");
        if (!gate()) {
          return carried<TasksRevisionAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const revision = yield* Effect.provide(
          client.readRevision(read.success.taskId, read.success.seq),
          FetchHttpClient.layer,
        );
        return carried<TasksRevisionAnswer>(
          revision === undefined ? { failure: TASK_CALL_FAILURE.UNANSWERED } : { revision },
        );
      }),
    // A page's version is answered to the frame that asked and held nowhere,
    // so its HTML never enters the view every window is told.
    [GATEWAY_METHOD.TASKS_PAGE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksPageParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("reading a page names a plan, the page, and its version");
        }
        if (!gate()) return carried<TasksPageAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const { taskId, pageId, version } = read.success;
        const page = yield* Effect.provide(
          client.readPageVersion(taskId, pageId, version),
          FetchHttpClient.layer,
        );
        return carried<TasksPageAnswer>(
          page === undefined ? { failure: TASK_CALL_FAILURE.UNANSWERED } : { page },
        );
      }),
    // A picture's bytes are answered to the window that asked and held
    // nowhere, so they never enter the view every window is told.
    [GATEWAY_METHOD.TASKS_PICTURE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksPictureParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("reading a picture names a plan and the picture");
        if (!gate()) {
          return carried<TasksPictureAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const picture = yield* Effect.provide(
          client.readPicture(read.success.planId, read.success.attachmentId),
          FetchHttpClient.layer,
        );
        return carried<TasksPictureAnswer>(picture);
      }),
    // The picture is kept and its id answered to the editor that took it;
    // the plan's text names it once the editor lays its address in.
    [GATEWAY_METHOD.TASKS_PICTURE_KEEP]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksPictureKeepParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("keeping a picture names a plan and the picture");
        if (!gate()) {
          return carried<TasksPictureKeepAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const kept = yield* Effect.provide(
          client.keepPicture(read.success.planId, read.success.picture),
          FetchHttpClient.layer,
        );
        return carried<TasksPictureKeepAnswer>(kept);
      }),
    // The service answers the plan as restored, so the list's row and the
    // open document take it in place and nothing is read again.
    [GATEWAY_METHOD.TASKS_RESTORE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksRevisionParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("restoring a revision names a plan and its number");
        if (!gate()) return { restored: false };
        const { taskId, seq } = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const restored = yield* Effect.provide(
              client.restore(taskId, seq),
              FetchHttpClient.layer,
            );
            if (restored === undefined) return { restored: false };
            restoredFence = { taskId, at: restored.updatedAt };
            takeAnswered(restored);
            return { restored: true };
          }),
        );
      }),
    // Leaving the plan returns to the list, which was read when the tab
    // showed, and leaves its call standing, as opening another plan does.
    [GATEWAY_METHOD.TASKS_CLOSE]: () =>
      Effect.gen(function* () {
        yield* FiberHandle.clear(conversationRead);
        yield* serial(
          Effect.sync(() => {
            const { activeTaskId: _closed, ...rest } = withoutActivity(view);
            view = { ...rest, document: { status: TASKS_READ.IDLE } };
            publish();
          }),
        );
        return {};
      }),
    [GATEWAY_METHOD.TASKS_START]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksStartRequestSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("starting a plan names it, and its repository where it has one");
        }
        if (!gate()) return carried<TasksStartAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const request = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const started = yield* Effect.provide(client.create(request), FetchHttpClient.layer);
            if (!started.ok) return carried<TasksStartAnswer>({ failure: started.failure });
            const task = started.answer;
            // A plan just started has had no call. A call about another plan
            // is left to the start's own Talk press, which moves it here.
            view = {
              ...withoutActivity(view),
              activeTaskId: task.id,
              document: { status: TASKS_READ.READY, task },
              transcript: { status: TASKS_READ.READY, transcript: EMPTY_TRANSCRIPT },
            };
            publish();
            yield* openConversation(task.id);
            yield* readList;
            return carried<TasksStartAnswer>({ planId: task.id });
          }),
        );
      }),
    // Note that the plan's call ends before the plan is deleted, open or not,
    // because a call still standing would go on writing a document that is gone.
    [GATEWAY_METHOD.TASKS_DELETE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksOpenParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("deleting a plan names one plan");
        if (!gate()) return { deleted: false };
        const { taskId } = read.success;
        yield* endTaskCall(taskId);
        return yield* serial(
          Effect.gen(function* () {
            const deleted = yield* Effect.provide(client.delete(taskId), FetchHttpClient.layer);
            if (!deleted) return { deleted: false };
            const tasks = view.tasks.filter((task) => task.id !== taskId);
            if (view.activeTaskId === taskId) {
              yield* FiberHandle.clear(conversationRead);
              const { activeTaskId: _deleted, ...rest } = withoutActivity(view);
              view = { ...rest, document: { status: TASKS_READ.IDLE } };
            }
            write({ tasks });
            yield* readList;
            return { deleted: true };
          }),
        );
      }),
    // The service answers the plan as renamed, so the list's row and the
    // open document take it in place and nothing is read again.
    [GATEWAY_METHOD.TASKS_RENAME]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksRenameParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("renaming a plan names it and its name");
        if (!gate()) return { renamed: false };
        const { taskId, name } = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const renamed = yield* Effect.provide(
              client.rename(taskId, { name }),
              FetchHttpClient.layer,
            );
            if (renamed === undefined) return { renamed: false };
            const tasks = view.tasks.map((task) =>
              task.id === taskId ? { ...task, name: renamed.name } : task,
            );
            const held = heldTaskOf(taskId);
            write(
              held === undefined
                ? { tasks }
                : {
                    tasks,
                    document: {
                      status: TASKS_READ.READY,
                      task: { ...held, name: renamed.name, document: renamed.document },
                    },
                  },
            );
            return { renamed: true };
          }),
        );
      }),
    [GATEWAY_METHOD.TASKS_PIN]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksPinParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("pinning a plan names it and whether it is pinned");
        }
        if (!gate()) return { changed: false };
        const { taskId, pinned, position } = read.success;
        return yield* markTask(
          taskId,
          position === undefined ? { pinned } : { pinned, pinPosition: position },
        );
      }),
    // The service answers the pins as they then stand, so the view takes its
    // word rather than the window's guess.
    [GATEWAY_METHOD.TASKS_PIN_REPOSITORY]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksPinRepositoryParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("pinning a repository names it and whether it is pinned");
        }
        if (!gate()) return { changed: false };
        const { repository, pinned } = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const pins = yield* Effect.provide(
              client.pinRepository(repository, pinned),
              FetchHttpClient.layer,
            );
            if (pins === undefined) return { changed: false };
            write({ repositoryPins: pins });
            return { changed: true };
          }),
        );
      }),
    // Note that an archived plan stays open where it is the open one: leaving
    // it is the window's to ask, as it is for any plan.
    [GATEWAY_METHOD.TASKS_ARCHIVE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksArchiveParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("archiving a plan names it and whether it is archived");
        }
        if (!gate()) return { changed: false };
        return yield* markTask(read.success.taskId, { archived: read.success.archived });
      }),
    // The list is the service's answer whole, read now and held nowhere: the
    // panel asks again whenever its chip opens, so an App installed meanwhile
    // shows on the next opening.
    [GATEWAY_METHOD.TASKS_REPOSITORIES]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksRepositoriesParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("listing repositories names the workspace they are for, or none");
        }
        if (!gate()) {
          return carried<TasksRepositoriesAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const listed = yield* Effect.provide(
          client.repositories(read.success.workspaceId),
          FetchHttpClient.layer,
        );
        return carried<TasksRepositoriesAnswer>(
          listed.ok ? { repositories: listed.answer } : { failure: listed.failure },
        );
      }),
    // The service answers the plan as changed, so the list's row and the
    // open document take it in place and nothing is read again.
    [GATEWAY_METHOD.TASKS_SET_REPOSITORY]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksSetRepositoryParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("giving a plan its repository names the plan and the repository");
        }
        if (!gate()) {
          return carried<TasksSetRepositoryAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const { taskId, repository } = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const changed = yield* Effect.provide(
              client.setRepository(taskId, repository),
              FetchHttpClient.layer,
            );
            if (!changed.ok) return carried<TasksSetRepositoryAnswer>({ failure: changed.failure });
            takeAnswered(changed.answer);
            return carried<TasksSetRepositoryAnswer>({ repository: changed.answer.repository });
          }),
        );
      }),
    // The service answers the plan as moved, so the list's row and the open
    // document take its workspace in place and nothing is read again.
    [GATEWAY_METHOD.TASKS_MOVE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksMoveParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("moving a plan names the plan and the workspace");
        }
        if (!gate()) {
          return carried<TasksMoveAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const { taskId, workspaceId } = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const moved = yield* Effect.provide(
              client.move(taskId, workspaceId),
              FetchHttpClient.layer,
            );
            if (!moved.ok) return carried<TasksMoveAnswer>({ failure: moved.failure });
            takeAnswered(moved.answer);
            return carried<TasksMoveAnswer>({ workspaceId: moved.answer.workspaceId });
          }),
        );
      }),
    // The plan the service answered is drawn in place, so the edit stands on
    // the document at once and the notetaker's drafts drawn before it drop.
    [GATEWAY_METHOD.TASKS_EDIT]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksEditParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("an edit names a plan, and its document's base and value");
        }
        if (!gate()) return carried<TasksEditAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const { taskId, edit } = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const edited = yield* Effect.provide(client.edit(taskId, edit), FetchHttpClient.layer);
            if (!edited.ok) return carried<TasksEditAnswer>({ failure: edited.failure });
            const answer = edited.answer;
            if ("conflict" in answer)
              return carried<TasksEditAnswer>({ conflict: answer.conflict });
            if ("refused" in answer) return carried<TasksEditAnswer>({ failure: answer.refused });
            developerSaved = { taskId, at: answer.plan.updatedAt };
            takeAnswered(answer.plan);
            return carried<TasksEditAnswer>({ saved: true });
          }),
        );
      }),
    // The browser connects or disconnects GitHub, so the panel coming
    // forward again reads the connection and the workspaces whatever the
    // bound says.
    [GATEWAY_METHOD.GITHUB_CONNECT]: () =>
      Effect.gen(function* () {
        if (!gate()) return carried<TasksGitHubPageAnswer>(GITHUB_PAGE_UNANSWERED);
        const page = yield* Effect.provide(client.github.connect(), FetchHttpClient.layer);
        workspacesAskedAt = undefined;
        return carried<TasksGitHubPageAnswer>(
          page.ok ? { url: page.answer.url } : GITHUB_PAGE_UNANSWERED,
        );
      }),
    // The view takes the connection the service answers at once, so Settings
    // reads disconnected without waiting for the next workspaces read.
    [GATEWAY_METHOD.GITHUB_DISCONNECT]: () =>
      Effect.gen(function* () {
        if (!gate()) return carried<TasksGitHubDisconnectAnswer>(GITHUB_PAGE_UNANSWERED);
        const disconnected = yield* Effect.provide(
          client.github.disconnect(),
          FetchHttpClient.layer,
        );
        workspacesAskedAt = undefined;
        if (!disconnected.ok) {
          return carried<TasksGitHubDisconnectAnswer>({ failure: disconnected.failure });
        }
        // Note that a workspaces read started before the answer is made stale,
        // because the GitHub status it read may predate the unlink.
        workspacesRead += 1;
        write({ github: disconnected.answer });
        return carried<TasksGitHubDisconnectAnswer>({ connection: disconnected.answer });
      }),
    [GATEWAY_METHOD.WORKSPACES_CREATE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceCreateParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("making a workspace names it");
        if (!gate()) return carried<TasksWorkspaceAnswer>(WORKSPACE_UNANSWERED);
        const made = yield* workspaceCall(client.workspaces.create(read.success.name), {
          tasks: false,
        });
        return carried<TasksWorkspaceAnswer>(
          made.ok ? { workspace: made.answer } : { failure: made.failure },
        );
      }),
    // A rename moves no plan, so the workspaces alone are read again, and
    // the new name arrives on the document with them.
    [GATEWAY_METHOD.WORKSPACES_RENAME]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceRenameParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("renaming a workspace names it and its new name");
        }
        if (!gate()) return carried<TasksWorkspaceAnswer>(WORKSPACE_UNANSWERED);
        const { workspaceId, name } = read.success;
        return carried<TasksWorkspaceAnswer>(
          yield* workspaceWrite(client.workspaces.rename(workspaceId, name)),
        );
      }),
    // A photo moves no plan either, so it is a rename's twin: the answered
    // workspace, its photo's new version or none, lands, and the
    // workspaces are read again; the window's tiles read the photo by it.
    [GATEWAY_METHOD.WORKSPACES_PHOTO_SET]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspacePhotoSetParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("setting a workspace's photo names it and a photo or none");
        }
        if (!gate()) return carried<TasksWorkspaceAnswer>(WORKSPACE_UNANSWERED);
        const { workspaceId, photo } = read.success;
        return carried<TasksWorkspaceAnswer>(
          yield* workspaceWrite(client.workspaces.setPhoto(workspaceId, photo)),
        );
      }),
    // The install address is answered to the caller that opens it and held
    // nowhere: the connection lands in the browser, and the workspaces read
    // after it, as the panel comes forward, carry the organization.
    [GATEWAY_METHOD.WORKSPACES_GITHUB_CONNECT]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("connecting GitHub names a workspace");
        if (!gate()) return carried<TasksWorkspaceGitHubConnectAnswer>(WORKSPACE_UNANSWERED);
        const begun = yield* Effect.provide(
          client.workspaces.githubConnect(read.success.workspaceId),
          FetchHttpClient.layer,
        );
        return carried<TasksWorkspaceGitHubConnectAnswer>(
          begun.ok ? { url: begun.answer } : { failure: begun.failure },
        );
      }),
    [GATEWAY_METHOD.WORKSPACES_GITHUB_DISCONNECT]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("disconnecting GitHub names a workspace");
        if (!gate()) return carried<TasksWorkspaceAnswer>(WORKSPACE_UNANSWERED);
        const disconnected = yield* workspaceCall(
          client.workspaces.githubDisconnect(read.success.workspaceId),
          { tasks: false },
        );
        return carried<TasksWorkspaceAnswer>(
          disconnected.ok ? { workspace: disconnected.answer } : { failure: disconnected.failure },
        );
      }),
    // Vercel Connect's address is answered to the caller that opens it and
    // held nowhere: the grant lands in the browser, and the workspaces read
    // after it, as the panel comes forward, carry the connection.
    [GATEWAY_METHOD.WORKSPACES_LINEAR_CONNECT]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("connecting Linear names a workspace");
        if (!gate()) return carried<TasksWorkspaceGitHubConnectAnswer>(WORKSPACE_UNANSWERED);
        const begun = yield* Effect.provide(
          client.workspaces.linearConnect(read.success.workspaceId),
          FetchHttpClient.layer,
        );
        // The sign-in finishes in the browser, so the panel coming forward again reads the workspaces whatever the bound says.
        workspacesAskedAt = undefined;
        return carried<TasksWorkspaceGitHubConnectAnswer>(
          begun.ok ? { url: begun.answer } : { failure: begun.failure },
        );
      }),
    [GATEWAY_METHOD.WORKSPACES_LINEAR_DISCONNECT]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("disconnecting Linear names a workspace");
        if (!gate()) return carried<TasksWorkspaceAnswer>(WORKSPACE_UNANSWERED);
        const disconnected = yield* workspaceCall(
          client.workspaces.linearDisconnect(read.success.workspaceId),
          { tasks: false },
        );
        return carried<TasksWorkspaceAnswer>(
          disconnected.ok ? { workspace: disconnected.answer } : { failure: disconnected.failure },
        );
      }),
    // The issues are answered to the window that asked and held nowhere: a
    // picker reads them as it opens and as its search changes.
    [GATEWAY_METHOD.WORKSPACES_LINEAR_ISSUES]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksLinearIssuesParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("reading Linear issues names a workspace");
        if (!gate()) return carried<TasksLinearIssuesAnswer>(WORKSPACE_UNANSWERED);
        const listed = yield* Effect.provide(
          client.workspaces.linearIssues(read.success),
          FetchHttpClient.layer,
        );
        return carried<TasksLinearIssuesAnswer>(
          listed.ok ? { issues: listed.answer } : { failure: listed.failure },
        );
      }),
    // The members, and who the workspace's work names but left, are answered to the window that asked and held nowhere:
    // it keeps what it read, and reads again as it opens. A read moves
    // nothing, so nothing else is read with it.
    [GATEWAY_METHOD.WORKSPACES_MEMBERS]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceMembersParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("reading members names a workspace");
        if (!gate()) return carried<TasksWorkspaceMembersAnswer>(WORKSPACE_UNANSWERED);
        const people = yield* Effect.provide(
          client.workspaces.people(read.success.workspaceId),
          FetchHttpClient.layer,
        );
        return carried<TasksWorkspaceMembersAnswer>(
          !people.ok
            ? { failure: people.failure }
            : people.answer.former.length === 0
              ? { members: people.answer.members }
              : { members: people.answer.members, former: people.answer.former },
        );
      }),
    // A photo is answered to the window that asked and held nowhere, as
    // the members are: the window keeps it under the version the list
    // named, and the list itself never carries its bytes.
    [GATEWAY_METHOD.WORKSPACES_PHOTO]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspacePhotoParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("reading a photo names a workspace");
        if (!gate()) return carried<TasksWorkspacePhotoAnswer>(WORKSPACE_UNANSWERED);
        const photo = yield* Effect.provide(
          client.workspaces.photo(read.success.workspaceId),
          FetchHttpClient.layer,
        );
        return carried<TasksWorkspacePhotoAnswer>(
          photo.ok ? photo.answer : { failure: photo.failure },
        );
      }),
    [GATEWAY_METHOD.WORKSPACES_MEMBER_REMOVE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceMemberRemoveParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("removing a member names the workspace and the member");
        }
        if (!gate()) return carried<TasksWorkspaceMembersAnswer>(WORKSPACE_UNANSWERED);
        const { workspaceId, userId } = read.success;
        const remaining = yield* workspaceCall(
          client.workspaces.removeMember(workspaceId, userId),
          {
            tasks: false,
          },
        );
        return carried<TasksWorkspaceMembersAnswer>(
          remaining.ok ? { members: remaining.answer } : { failure: remaining.failure },
        );
      }),
    // A role changed moves no plan, so the workspaces alone are read again,
    // as after a removal.
    [GATEWAY_METHOD.WORKSPACES_MEMBER_ROLE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceMemberRoleParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("changing a role names the workspace, the member, and the role");
        }
        if (!gate()) return carried<TasksWorkspaceMembersAnswer>(WORKSPACE_UNANSWERED);
        const { workspaceId, userId, role } = read.success;
        const changed = yield* workspaceCall(
          client.workspaces.changeRole(workspaceId, userId, role),
          { tasks: false },
        );
        return carried<TasksWorkspaceMembersAnswer>(
          changed.ok ? { members: changed.answer } : { failure: changed.failure },
        );
      }),
    // Note that a handover changes the account's own role in the workspace,
    // which the view's workspaces carry and every owner's and admin's act is
    // drawn from, so the workspaces are read again; it moves no plan.
    [GATEWAY_METHOD.WORKSPACES_TRANSFER]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceTransferParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("handing a workspace over names it and the admin");
        }
        if (!gate()) return carried<TasksWorkspaceMembersAnswer>(WORKSPACE_UNANSWERED);
        const { workspaceId, userId } = read.success;
        const handedOver = yield* workspaceCall(client.workspaces.transfer(workspaceId, userId), {
          tasks: false,
        });
        return carried<TasksWorkspaceMembersAnswer>(
          handedOver.ok ? { members: handedOver.answer } : { failure: handedOver.failure },
        );
      }),
    // Note that a leave ends a call about any plan of the workspace left,
    // the open one or one closed since, and closes the open plan where it is
    // that workspace's, as a delete of it does, because the account can no
    // longer read or write a plan of a workspace it left; a refused leave
    // ends and closes nothing.
    [GATEWAY_METHOD.WORKSPACES_LEAVE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceLeaveParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("leaving a workspace names it");
        if (!gate()) return carried<TasksWorkspaceLeaveAnswer>(WORKSPACE_UNANSWERED);
        const { workspaceId } = read.success;
        const openTaskId = view.activeTaskId;
        const openWorkspaceId = view.tasks.find((task) => task.id === openTaskId)?.workspaceId;
        const departedTaskIds = view.tasks
          .filter((task) => task.workspaceId === workspaceId)
          .map((task) => task.id);
        // A standing call is ended only by its own plan's id, so each plan left is named.
        const endDepartedCalls = Effect.forEach(departedTaskIds, (taskId) => endTaskCall(taskId), {
          discard: true,
        });
        const closeOpenTask = Effect.gen(function* () {
          yield* serial(
            Effect.gen(function* () {
              if (view.activeTaskId !== openTaskId) return;
              yield* FiberHandle.clear(conversationRead);
              const { activeTaskId: _left, ...rest } = withoutActivity(view);
              view = { ...rest, document: { status: TASKS_READ.IDLE } };
              publish();
            }),
          );
        });
        const leave = Effect.tap(client.workspaces.leave(workspaceId), (answer) =>
          answer.ok
            ? Effect.andThen(
                endDepartedCalls,
                openWorkspaceId === workspaceId ? closeOpenTask : Effect.void,
              )
            : Effect.void,
        );
        const left = yield* workspaceCall(leave, { tasks: true });
        return carried<TasksWorkspaceLeaveAnswer>(
          left.ok ? { left: true } : { failure: left.failure },
        );
      }),
    // An invitation is answered to the window that asked and held nowhere,
    // and moves no workspace or plan, so nothing else is read with it.
    [GATEWAY_METHOD.WORKSPACES_INVITATIONS]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("reading invitations names a workspace");
        if (!gate()) return carried<TasksWorkspaceInvitationsAnswer>(WORKSPACE_UNANSWERED);
        const pending = yield* Effect.provide(
          client.workspaces.invitations(read.success.workspaceId),
          FetchHttpClient.layer,
        );
        return carried<TasksWorkspaceInvitationsAnswer>(
          pending.ok ? { invitations: pending.answer } : { failure: pending.failure },
        );
      }),
    [GATEWAY_METHOD.WORKSPACES_INVITE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceInviteParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("an invitation names a workspace, an address, and a role");
        }
        if (!gate()) return carried<TasksWorkspaceInvitationAnswer>(WORKSPACE_UNANSWERED);
        const { workspaceId, email, role } = read.success;
        const made = yield* Effect.provide(
          client.workspaces.invite(workspaceId, email, role),
          FetchHttpClient.layer,
        );
        return carried<TasksWorkspaceInvitationAnswer>(
          made.ok ? { invitation: made.answer } : { failure: made.failure },
        );
      }),
    [GATEWAY_METHOD.WORKSPACES_INVITATION_CANCEL]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceInvitationCancelParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("canceling an invitation names the workspace and the invitation");
        }
        if (!gate()) return carried<TasksWorkspaceInvitationsAnswer>(WORKSPACE_UNANSWERED);
        const { workspaceId, invitationId } = read.success;
        const pending = yield* Effect.provide(
          client.workspaces.cancelInvitation(workspaceId, invitationId),
          FetchHttpClient.layer,
        );
        return carried<TasksWorkspaceInvitationsAnswer>(
          pending.ok ? { invitations: pending.answer } : { failure: pending.failure },
        );
      }),
    // A save of another plan than the open one is dropped: its board is not drawn.
    [GATEWAY_METHOD.TASKS_BOARD_SAVE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksBoardSaveParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("saving a board names a plan and its scene");
        const { taskId, elements, appliedDrawing, image } = read.success;
        if (!gate() || view.activeTaskId !== taskId) return { saved: false };
        return yield* serial(
          Effect.gen(function* () {
            const board = yield* Effect.provide(
              client.saveBoard(taskId, elements, appliedDrawing, image),
              FetchHttpClient.layer,
            );
            if (board === undefined) return { saved: false };
            if (view.activeTaskId === taskId) write({ board });
            return { saved: true };
          }),
        );
      }),
  };

  return {
    methods,
    snapshot: () => view,
    activeTaskId: () => view.activeTaskId,
    showDraft,
    showActivity,
    showCode,
    showWork,
    callEnded,
    reset: Effect.gen(function* () {
      yield* endTaskCall(undefined);
      yield* FiberHandle.clear(conversationRead);
      yield* serial(
        Effect.sync(() => {
          workspacesAskedAt = undefined;
          workspacesRead += 1;
          view = idleView();
          publish();
        }),
      );
    }),
    // The board and page reads a settled draw or page asks for, the
    // transcript and work reads a call's end asks for, and the wake of a
    // parked conversation read the call's words ask for; every other read of
    // the plans is an ask's.
    lifetime: Effect.gen(function* () {
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.flatMap(Queue.take(boardReads), (taskId) =>
            gate() ? serial(readBoard(taskId)) : Effect.void,
          ),
        ),
      );
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.flatMap(Queue.take(pageReads), (taskId) =>
            gate() ? serial(readPages(taskId)) : Effect.void,
          ),
        ),
      );
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.flatMap(Queue.take(callEndReads), (taskId) => {
            // The conversation's parked read is woken with each read too, since its last journal may land after the call's end.
            const read = Effect.suspend(() =>
              gate() && view.activeTaskId === taskId
                ? serial(Effect.andThen(readTranscript(taskId), readWork(taskId))).pipe(
                    Effect.andThen(Effect.sync(() => wakeConversation(taskId))),
                  )
                : Effect.void,
            );
            return Effect.andThen(read, Effect.andThen(Effect.sleep(TRANSCRIPT_SETTLE), read));
          }),
        ),
      );
      // Note that a read still following is left alone, because it already
      // reads past what the call just said.
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.flatMap(Queue.take(conversationWakes), (taskId) =>
            Effect.suspend(() =>
              gate() && view.activeTaskId === taskId
                ? Effect.asVoid(
                    FiberHandle.run(conversationRead, followConversation(taskId, false), {
                      onlyIfMissing: true,
                    }),
                  )
                : Effect.void,
            ),
          ),
        ),
      );
    }),
  };
});
