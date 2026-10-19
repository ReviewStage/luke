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
import { AGENT_TOOL } from "@luke/features/agent-tools";
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
import { PLAN_ACTOR, type Task, UNTITLED_TASK_NAME } from "@luke/features/task-wire";
import {
  IDLE_TASKS_VIEW,
  TASK_CALL_FAILURE,
  TASK_WORK_STATE,
  TASKS_READ,
  type TaskCodeShowing,
  type TaskShownCode,
  type TasksCommentAnswer,
  type TasksCommentsAnswer,
  type TasksDocument,
  type TasksEditAnswer,
  type TasksFileAnswer,
  type TasksGitHubDisconnectAnswer,
  type TasksGitHubPageAnswer,
  type TasksIssueAnswer,
  type TasksLinearIssuesAnswer,
  type TasksMoveAnswer,
  type TasksPageAnswer,
  type TasksPagesAnswer,
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
  tasksCommentActParamsSchema,
  tasksCommentStartParamsSchema,
  tasksCommentsParamsSchema,
  tasksEditParamsSchema,
  tasksFileParamsSchema,
  tasksIssueParamsSchema,
  tasksLinearIssuesParamsSchema,
  tasksMessagesParamsSchema,
  tasksMoveParamsSchema,
  tasksPageParamsSchema,
  tasksPagesParamsSchema,
  tasksPictureKeepParamsSchema,
  tasksPictureParamsSchema,
  tasksPinParamsSchema,
  tasksPinRepositoryParamsSchema,
  tasksPullRequestParamsSchema,
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
  tasksWriteSectionParamsSchema,
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
import { isRecord, unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import {
  Clock,
  Data,
  Duration,
  Effect,
  Equal,
  FiberHandle,
  Option,
  Queue,
  Result,
  Schedule,
  Schema,
  type Scope,
  Semaphore,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { HostKernel } from "./host-kernel.js";
import type { RunMode } from "./run-mode.js";
import { codeExcerpt, highlightCode, highlightFile } from "./task-code.js";

/**
 * compose-tasks.ts -- the panel's named tasks, read from the service: the list, the one active task, and its document, drawn as the notetaker writes it during a call.
 *
 * Nothing here writes a document but a restore the developer asks for: the
 * task's notetaker and coding agents are its writers, on the service. What
 * this concern owes the panel is to show those writes as they happen. Every write happens during a task's call, and the notetaker's
 * drafts arrive on that call's own socket and are drawn in place: the list
 * and the open task are read when the Tasks tab shows, when a task opens, and
 * when one starts, and never on a clock. The open task's whiteboard is read
 * with its document, and again whenever the call's activity says a draw by
 * the brain just settled or the brain stopped working, since
 * a draw happens only inside its turn; the panel saves the board's scene
 * through here and the view takes the board as the service answered it. What
 * was said on the open task's calls is read with its document, and again
 * whenever a call about it ends, once at the end and once more when the
 * call's last words have had time to reach the record; while a call stands,
 * its words are the voice window's to report.
 * The loops here are those board and transcript reads. The code Luke puts
 * on screen during a call arrives on the call's socket with its lines, read
 * by the service from the task's repository, and is coloured here
 * (`task-code.ts`) and drawn in place; nothing of the repository is read on
 * this Mac. What the brain wrote and ran on the task's calls, and
 * every code shown on them, are read from the service with the document, so
 * a task opened after a restart or a switch shows them; its older work is
 * read a page at a time as the Work tab asks, and each turn a call tells and
 * each code it shows lands over those reads and stays past the call's end. The repositories the account reaches, and a task's repository
 * given or taken away, are the service's too, asked through here, as are a
 * task pinned or archived: the list holds the archived tasks beside the
 * rest, each flagged, and which the window draws where is the window's. A
 * plan's history is read for the version history that asks and held nowhere
 * here; a revision restored is the one write this concern carries to the
 * service on the developer's word, and the view takes the task it answers.
 * The pages agents wrote for the open task are listed with its document, by
 * title and newest version alone, and again whenever the call's activity
 * says a page the brain showed just settled or it stopped working;
 * a page's HTML is answered to the frame that draws it and held nowhere
 * here. Beside the work, the open task's conversation is read as
 * an agent's transcript is, on the service's held read, and held on the
 * view for the Call tab to switch to; the brain's worker's transcript is
 * answered to the tab that asks for it and held nowhere here.
 *
 * The workspaces the account is a member of are carried on the view beside
 * the tasks and read apart from them, so the tasks never wait on them: on
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
 * How long after the open Untitled task's brain settles a turn the list is
 * read again, for the name the service may give it as one of its first
 * turns completes (`brain-host/task-title.ts`): the naming call is made once
 * the turn is recorded settled and usually answers in a second or two.
 */
const NAME_SETTLE = Duration.seconds(5);

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

/** The statuses a conversation page reads as still writing: a brain's turn, or a worker of one, that may add to it. */
const CONVERSATION_WRITING: ReadonlySet<CodingAgentStatus> = new Set([
  CODING_AGENT_STATUS.STARTING,
  CODING_AGENT_STATUS.RUNNING,
]);

/** A read of a task's conversation the service did not answer, as the backoff retries it. */
class ConversationUnanswered extends Data.TaggedError("ConversationUnanswered")<{
  readonly failure: CodingAgentCallFailure;
}> {}

/** How the SDK spells the type of a part that calls Luke's plan edit. */
const PLAN_EDIT_PART_TYPE = `tool-${AGENT_TOOL.EDIT_PLAN}`;

/**
 * Whether a page carries a turn that wrote the plan. Note that the call's
 * part is journaled with its receipt and the save lands as a task after it,
 * so the document is read again on every page that carries the call, which
 * the turn's later steps amend, and once more when the turn stops writing.
 */
function pageWritesDocument(page: CodingAgentMessagesAnswer): boolean {
  return page.messages.some((message) =>
    message.parts.some((part) => isRecord(part) && part.type === PLAN_EDIT_PART_TYPE),
  );
}

/** Whether a page says the brain, or a worker of its, may still add to the conversation. */
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
 * rather than replaced, because a task's conversation's page names only
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

/** A task's pin, where it stands, and its archive as the list carries them, each only where it stands. */
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

/** Opening or deleting a task names it and nothing else. */
const tasksOpenParamsSchema = Schema.Struct({ taskId: Schema.NonEmptyString });

/** The service's side of the tasks, and the workspaces they live in, as this concern asks it. */
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
  | "taskSections"
  | "writeTaskSection"
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
  | "comments"
  | "startComment"
  | "actOnComment"
  | "restore"
  | "stopWork"
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

/** The service's side of a task's conversation, read as an agent's transcript is. */
export type TasksConversationClient = Pick<HostedCodingAgentClient, "taskMessages">;

export interface TasksDependencies {
  kernel: Pick<HostKernel, "emit"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  client: TasksClient;
  conversations: TasksConversationClient;
  /**
   * Ends the call standing about `taskId`, or whatever it is about
   * where none is named, and waits for it to end. A call about another task
   * is left standing.
   */
  endTaskCall: (taskId: string | undefined) => Effect.Effect<void>;
}

export interface TasksComposer extends Composer {
  /** The view as this Mac holds it now. */
  snapshot: () => TasksView;
  /** The one active task, which a voice session binds to; nothing while the panel has none open. */
  activeTaskId: () => string | undefined;
  /** Drops everything held, for a sign-out, and tells every client the panel has nothing. */
  reset: Effect.Effect<void>;
  /**
   * Shows a draft of the open task the service's notetaker sent while a
   * task's call writes it, in place of the document held; a draft of any
   * other task, or with no document of that task held, is dropped.
   */
  showDraft: (draft: PlanDraftFrame) => void;
  /**
   * Shows what each part of Luke is doing on the call about the open task,
   * as the service last said it; a word about any other task is dropped.
   * Leaving or switching tasks clears it, and the call's end says nothing
   * doing.
   */
  showActivity: (activity: TaskActivityFrame) => void;
  /**
   * Puts code on screen as Luke named it on the open task's call, with the
   * lines the service read from the task's repository: coloured here and
   * drawn after every code shown before it, where it stays past the call's
   * end. Code about any other task, or of a call already held, is dropped.
   */
  showCode: (taskId: string, shown: TaskShownCode) => void;
  /**
   * Shows a brain turn's work on the call about the open task, in place
   * of the same turn as last told, the newest turns kept; work about any
   * other task is dropped. Leaving or switching tasks clears it, and the
   * call's end keeps it.
   */
  showWork: (taskId: string, turn: TaskWorkTurn) => void;
  /** The call about `taskId` ended: its words are read back from the record. */
  callEnded: (taskId: string) => void;
}

/**
 * The panel's tasks as one concern. The view is told to every client whole
 * whenever it moves, and exactly one task is active at a time: opening or
 * starting one replaces whichever was, and a read still out for the replaced
 * task is dropped when it lands. Only one task is ever the spoken
 * conversation, so opening another task, starting one, leaving the open task,
 * or a sign-out ends the call about the task that was open before anything
 * else moves. The Tasks tab showing reads the list and the open task again,
 * while the open task and its call stand through the tab hiding. Behind a
 * closed account gate, or on a run that sends nothing, nothing is read.
 *
 * The open task's conversation is read the way an agent's tab reads its
 * transcript: its newest page when the task opens, starts, or is refreshed,
 * then one held read past the cursor after another, which the service holds
 * open while a brain turn or one of its workers runs and nothing new
 * stands. The read follows while the last page says the brain or a worker
 * still writes, and parks once a page says neither, because the service
 * answers an idle conversation at once and asking again would be a loop on
 * no clock at all. Note that it reads the workers the page names rather
 * than the list held, because a worker no page names any more reads as it
 * last did and would keep the read asking. Any word of the open task's call (its activity, or its
 * end) wakes a parked read, from the cursor held, since a turn begins only
 * on a call and its activity says so. One read stands at a time: opening
 * another task replaces it, and leaving the task or a sign-out stops it. A
 * read the service did not answer is asked again after a backoff; a task the
 * service no longer holds parks it.
 */
export const composeTasks = /* @__PURE__ */ Effect.fn("host/composeTasks")(function* (
  dependencies: TasksDependencies,
): Effect.fn.Return<TasksComposer, never, Scope.Scope | HttpClient.HttpClient> {
  const { kernel, account, client, conversations, endTaskCall } = dependencies;
  const http = yield* HttpClient.HttpClient;
  /** One ask of the service, over the host's own HTTP client. */
  const served = <Answer, Failure>(call: Effect.Effect<Answer, Failure, HttpClient.HttpClient>) =>
    Effect.provideService(call, HttpClient.HttpClient, http);
  const idleView = (): TasksView => IDLE_TASKS_VIEW;
  const gate = () => kernel.runMode.sendsNetwork && account.capabilitiesActive();

  /**
   * One read of the service at a time, whichever ask made it. Note that the
   * answers are applied in the order the reads were made, because a list
   * that left before a task started, or a document read that left before a
   * newer one, would otherwise land last and roll the view back.
   */
  const serial = (yield* Semaphore.make(1)).withPermits(1);

  let view: TasksView = idleView();
  let published: TasksView = view;

  function publish(): void {
    if (Equal.equals(view, published)) return;
    published = view;
    kernel.emit(GATEWAY_EVENT.TASKS_CHANGED, carried(view));
  }

  function write(next: Partial<TasksView>): void {
    view = { ...view, ...next };
    publish();
  }

  /** The view with no activity, no board, no transcript, no code, no work, no conversation, and no pages read or told, as a task left behind leaves it. */
  function withoutActivity({
    activity: _activity,
    board: _board,
    transcript: _transcript,
    shownCode: _shownCode,
    work: _work,
    workEarlier: _workEarlier,
    workStatus: _workStatus,
    conversation: _conversation,
    pages: _pages,
    ...rest
  }: TasksView): TasksView {
    return rest;
  }

  /** The tasks whose board a settled draw may have moved, read one at a time by the loop below. */
  const boardReads = yield* Queue.sliding<string>(1);

  /** The tasks whose pages a settled `show_page` may have moved, read one at a time by the loop below. */
  const pageReads = yield* Queue.sliding<string>(1);

  /** The tasks whose plan one of Luke's plan edits may have moved, read one at a time by the loop below. */
  const documentReads = yield* Queue.sliding<string>(1);

  /** The tasks a call just ended about, whose transcript and work are read again by the loop below. */
  const callEndReads = yield* Queue.sliding<string>(1);

  /** The tasks whose brain just settled a turn, whose new name the loop below reads the list again for. */
  const nameReads = yield* Queue.sliding<string>(1);

  /** The one read of the open task's conversation; running another interrupts it. */
  const conversationRead = yield* FiberHandle.make<void>();

  /** The tasks whose call just said something, whose parked conversation read the loop below wakes. */
  const conversationWakes = yield* Queue.sliding<string>(1);

  /**
   * Whether the open task's call said something since the conversation read
   * last asked. Note that a read already out when a turn began can answer
   * the conversation idle, so the read checks this before it parks rather
   * than miss the turn until the call's next word.
   */
  let conversationWoken = false;

  /**
   * The task whose call is telling its turns' work as they run, and the
   * turns that call told, which stand over the record's running copies; none
   * once that call ended, since nothing it told is ahead of the record any
   * more. A turn an earlier call told is not among them.
   */
  let telling: { readonly taskId: string; readonly turnIds: Set<string> } | undefined;

  /**
   * The developer's newest save of an edit, and the task it was of. A draft
   * the notetaker drew over a save older than it does not hold the edit, so
   * it is dropped rather than drawn: the edit would vanish until the
   * notetaker's next save, which takes it in under the task's lock.
   */
  let developerSaved: { readonly taskId: string; readonly at: number } | undefined;

  /** The document of `taskId` as held now, if the held one is that task's. */
  function heldTaskOf(taskId: string): TasksDocument["task"] {
    const held = view.document.task;
    return held?.id === taskId ? held : undefined;
  }

  /** A task's row of the list: everything but its document and what is written of it. */
  function summaryOf({
    document: _document,
    agentEdits: _agentEdits,
    lastEdit: _lastEdit,
    ...summary
  }: Task): TasksView["tasks"][number] {
    return summary;
  }

  const readList = Effect.gen(function* () {
    const listed = yield* served(client.list());
    // A failed read keeps the list it last read: the panel says the read
    // failed beside the tasks it already drew rather than emptying them.
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
   * beside them, apart from the tasks, which never wait on it. Note that the
   * connection is read with the workspaces, because both move in the
   * browser and the panel coming forward is when either is read again; each
   * lands on the view as soon as it is read, so a slow connection read never
   * holds back the workspaces. A failed read keeps what it last read, as a
   * failed list read keeps the tasks.
   *
   * Note that only the latest read started is drawn, because reads overlap
   * (a refresh, a write's read after it) and an older one answering last
   * would put back what a write since then moved.
   *
   * Note that the read says it is reading only after none or a failed one,
   * because a read that answers what is held tells the window nothing.
   */
  const readWorkspaces = Effect.gen(function* () {
    workspacesRead += 1;
    const read = workspacesRead;
    workspacesAskedAt = yield* Clock.currentTimeMillis;
    const current = () => read === workspacesRead;
    if (view.workspacesStatus !== TASKS_READ.READY) {
      write({ workspacesStatus: TASKS_READ.READING });
    }
    const workspaces = Effect.tap(client.workspaces.list(), (answer) =>
      Effect.sync(() => {
        if (!current()) return;
        // A read that did not answer leaves the workspaces stale, so the next refresh reads them again at once.
        if (answer === undefined) {
          workspacesAskedAt = undefined;
          write({ workspacesStatus: TASKS_READ.FAILED });
        } else {
          write({ workspaces: answer.workspaces, workspacesStatus: TASKS_READ.READY });
        }
      }),
    );
    const github = Effect.tap(client.github.status(), (read) =>
      Effect.sync(() => {
        if (current() && read.ok) write({ github: read.answer });
      }),
    );
    yield* served(Effect.all([workspaces, github], { concurrency: "unbounded", discard: true }));
  });

  /** Reads the workspaces where none was asked for since a sign-out, or the last ask is older than its bound. */
  const readWorkspacesWhenStale = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const fresh =
      workspacesAskedAt !== undefined &&
      now - workspacesAskedAt < Duration.toMillis(WORKSPACES_READ_EVERY);
    if (!fresh) yield* readWorkspaces;
  });

  // A failed read keeps the pins it last read, as a failed list read keeps the tasks.
  const readRepositoryPins = Effect.gen(function* () {
    const pins = yield* served(client.repositoryPins());
    if (pins !== undefined) write({ repositoryPins: pins });
  });

  // A failed read keeps the sections it last read, as the pins' does.
  const readTaskSections = Effect.gen(function* () {
    const sections = yield* served(client.taskSections());
    if (sections !== undefined) write({ taskSections: sections });
  });

  /**
   * Reads the active task's document. A copy of the same task already held
   * stays drawn while the read is out, and stays drawn through a read that
   * failed, so a save redraws in place and a moment offline blanks nothing;
   * with no copy held, the failure is what the panel draws.
   */
  function readDocument(taskId: string) {
    return Effect.gen(function* () {
      const held = heldTaskOf(taskId);
      if (held === undefined) write({ document: { status: TASKS_READ.READING } });
      const opened = yield* served(client.open(taskId));
      // Another task opened while this read was out: its answer is not the panel's any more.
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

  /** Reads the active task's board; a failed read keeps the board drawn. */
  function readBoard(taskId: string) {
    return Effect.gen(function* () {
      const board = yield* served(client.readBoard(taskId));
      if (board === undefined || view.activeTaskId !== taskId) return;
      write({ board });
    });
  }

  /**
   * Reads what was said on the active task's calls. A transcript already
   * held stays drawn while the read is out and through a read that failed,
   * as the document does; with none held, the failure is what the panel
   * draws.
   */
  function readTranscript(taskId: string) {
    return Effect.gen(function* () {
      const held = view.transcript?.transcript;
      if (held === undefined) write({ transcript: { status: TASKS_READ.READING } });
      const transcript = yield* served(client.readTranscript(taskId));
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
   * The task a restore just replaced the content of, and the restore's save,
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

  /** Takes the active task's work as it now stands, and where its next older page is read from, none where no older turn stands. */
  function writeWork(
    next: Pick<TasksView, "work" | "workEarlier" | "shownCode" | "workStatus">,
  ): void {
    const { workEarlier: _was, ...rest } = view;
    view = { ...rest, ...next };
    publish();
  }

  /**
   * The held turns with a page the service answered laid among them, in the
   * order the turns began. Note that a turn the open task's call told stands
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
   * rather than coloured again, because the task's work is read again on
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
   * Reads the active task's pages, each by its newest version. A failed read
   * keeps the pages held, as a failed board read keeps the board.
   */
  function readPages(taskId: string) {
    return Effect.gen(function* () {
      const pages = yield* served(client.readPages(taskId));
      if (pages === undefined || view.activeTaskId !== taskId) return;
      const { pages: _held, ...rest } = view;
      view = pages.length === 0 ? rest : { ...rest, pages };
      publish();
    });
  }

  /**
   * Reads the newest page of the active task's work, and every code shown
   * on it, as the service keeps them. Older pages already read stay, with
   * the place the next one is read from; a task read for the first time
   * takes the service's. Code a call put on screen that the record does not
   * hold yet stays after the record's. A failed read keeps whatever is held,
   * and says so; the read says it is reading only after none or a failed one,
   * as the workspaces' does.
   */
  function readWork(taskId: string) {
    return Effect.gen(function* () {
      if (view.activeTaskId === taskId && view.workStatus !== TASKS_READ.READY) {
        write({ workStatus: TASKS_READ.READING });
      }
      const stored = yield* served(client.readWork(taskId));
      if (view.activeTaskId !== taskId) return;
      if (stored === undefined) {
        write({ workStatus: TASKS_READ.FAILED });
        return;
      }
      const work = withPage(stored.turns);
      const oldest = work[0]?.turnId;
      const olderHeld =
        oldest !== undefined && !stored.turns.some((turn) => turn.turnId === oldest);
      const workEarlier = olderHeld ? view.workEarlier : stored.earlier;
      const shownCode = withShownCode(stored.code ?? []);
      writeWork({
        ...(work.length === 0 ? undefined : { work }),
        ...(workEarlier === undefined ? undefined : { workEarlier }),
        // Note that code is written even where none was shown, because none read is what the Code tab says and none unread is what it waits on.
        shownCode,
        workStatus: TASKS_READ.READY,
      });
    });
  }

  /** Reads the page of the active task's work before the oldest turn held, where one stands; a failed read keeps what is held. */
  function readEarlierWork(taskId: string) {
    return Effect.gen(function* () {
      const before = view.workEarlier;
      if (before === undefined) return;
      const stored = yield* served(client.readWork(taskId, before));
      if (stored === undefined || view.activeTaskId !== taskId) return;
      writeWork({
        work: withPage(stored.turns),
        ...(stored.earlier === undefined ? undefined : { workEarlier: stored.earlier }),
      });
    });
  }

  /** One page of a task's conversation, or why the service did not answer it. */
  function askConversation(taskId: string, page: { after?: string; before?: string }) {
    return Effect.flatMap(served(conversations.taskMessages(taskId, page)), (answer) =>
      "failure" in answer
        ? Effect.fail(new ConversationUnanswered({ failure: answer.failure }))
        : Effect.succeed(answer),
    );
  }

  /**
   * The held conversation with a page read from its newest turns or past its
   * cursor joined in by message id and its workers by call, the cursor and
   * where the brain stands taken from the page. Note that the turn the next older page
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

  /**
   * Follows `taskId`'s conversation while it is the open task: from its
   * newest page, or past the cursor held, then past each page's cursor while
   * the page says it is still written or the call woke it meanwhile. A read
   * the service did not answer is asked again after the backoff; a task it
   * no longer holds, or a gate that closed, ends the follow. A follow of an
   * Untitled task that finds a turn settled, one it saw the brain writing or
   * one a settled page carries words of, asks for the list again, for the
   * name the turn may have given the task, and draws it on the open document.
   */
  function followConversation(taskId: string, newest: boolean) {
    return Effect.gen(function* () {
      let after = newest ? undefined : view.conversation?.cursor;
      let wasWriting = view.conversation !== undefined && conversationWriting(view.conversation);
      let edited = false;
      while (gate() && view.activeTaskId === taskId) {
        conversationWoken = false;
        const page = yield* askConversation(taskId, after === undefined ? {} : { after }).pipe(
          Effect.retry({
            schedule: CONVERSATION_BACKOFF,
            while: (unanswered) =>
              unanswered.failure !== CODING_AGENT_CALL_FAILURE.NOT_FOUND && gate(),
          }),
          Effect.option,
        );
        if (Option.isNone(page) || view.activeTaskId !== taskId) return;
        write({ conversation: withForwardPage(page.value) });
        const writing = conversationWriting(page.value);
        const untitled = view.tasks.some(
          (row) => row.id === taskId && row.name === UNTITLED_TASK_NAME,
        );
        // A turn that settled before this follow's first page is caught by the page's words.
        const settledTurn = wasWriting || page.value.messages.length > 0;
        if (!writing && settledTurn && untitled) Queue.offerUnsafe(nameReads, taskId);
        wasWriting = writing;
        // Luke's plan edits land with no call standing as well as with one, so the document is
        // read again off the conversation's own follow rather than off the call's frames.
        edited ||= pageWritesDocument(page.value);
        if (pageWritesDocument(page.value) || (edited && !writing)) {
          Queue.offerUnsafe(documentReads, taskId);
        }
        if (!writing && !conversationWoken) return;
        after = page.value.cursor;
      }
    });
  }

  /** Reads `taskId`'s conversation from its newest turns and follows it, in place of any read standing. */
  function openConversation(taskId: string) {
    return Effect.asVoid(FiberHandle.run(conversationRead, followConversation(taskId, true)));
  }

  /** Wakes the open task's parked conversation read, where `taskId` is the open task. */
  function wakeConversation(taskId: string): void {
    if (view.activeTaskId !== taskId) return;
    conversationWoken = true;
    Queue.offerUnsafe(conversationWakes, taskId);
  }

  /**
   * Reads the page of the active task's conversation before the oldest turn
   * held, where one stands, and lays it before the rest, its workers joined
   * by call. Note that the cursor and where the brain stands stay the held
   * read's, because the page's cursor is the conversation's now and would
   * skip what the held read has not heard yet. A failed read keeps what is held.
   */
  function readEarlierConversation(taskId: string) {
    return Effect.gen(function* () {
      const before = view.conversation?.earlier;
      if (before === undefined) return;
      const answer = yield* served(conversations.taskMessages(taskId, { before }));
      const held = view.conversation;
      // The task was left, or opened again, while this read was out.
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
   * draw just settled: the brain's pending call was a draw and is
   * not any more, or the brain stopped working, which also covers a
   * draw that settled between two words about it. A look that just became
   * the pending call asks too, because a draw made in the same step never
   * shows as pending, and the look waits on the board holding it.
   */
  function showActivity({ type: _type, planId: taskId, ...activity }: TaskActivityFrame): void {
    // The call's own copy is kept whatever task is open, for the floating
    // call window; the panel's is the active task's alone.
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

  /** The open document of `taskId` given the name its row of the list now reads, where the two differ. */
  function nameHeldAsListed(taskId: string): void {
    const held = heldTaskOf(taskId);
    const listed = view.tasks.find((row) => row.id === taskId);
    if (held === undefined || listed === undefined || listed.name === held.name) return;
    write({ document: { status: TASKS_READ.READY, task: { ...held, name: listed.name } } });
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

  /** The pin and the archive a task answered carries, each only where it stands. */
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
   * row keeps what the list said of the task's coding agents, which only the
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

  /** Pins or archives one task on the service, or undoes either, and draws what it answered. */
  function markTask(taskId: string, marks: TaskMarks) {
    return serial(
      Effect.gen(function* () {
        const marked = yield* served(client.mark(taskId, marks));
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
   * tasks beside them after a leave, which takes a workspace's tasks out of
   * the list.
   */
  function workspaceCall<Answer>(
    call: Effect.Effect<WorkspaceCallResult<Answer>, never, HttpClient.HttpClient>,
    moves: { readonly tasks: boolean },
  ): Effect.Effect<WorkspaceCallResult<Answer>> {
    return Effect.tap(served(call), () =>
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
      const written = yield* served(call);
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
    // The workspaces are read beside the tasks rather than before them, and
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
            yield* readTaskSections;
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
        if (Result.isFailure(read)) return yield* invalid("opening a task names one task");
        if (!gate()) return { opened: false };
        const { taskId } = read.success;
        // Note that a call about the task left behind goes on standing,
        // because the call outlives the task on screen: moving it to this
        // task is this task's own Talk press.
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
    // A page of a task's conversation, or of a brain's worker's, is answered
    // to the tab that asked and held nowhere: the tab keeps what it read.
    [GATEWAY_METHOD.TASKS_MESSAGES]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksMessagesParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid(
            "reading a task's conversation names the task, and a cursor, a turn, or a worker's call",
          );
        }
        if (!gate()) {
          return carried<CodingAgentMessagesAnswerView>({
            failure: CODING_AGENT_CALL_FAILURE.UNANSWERED,
          });
        }
        const { taskId, callId, ...page } = read.success;
        const answer = yield* served(conversations.taskMessages(taskId, page, callId));
        return carried<CodingAgentMessagesAnswerView>(answer);
      }),
    // A file's window is answered to the File tab that asked, coloured here,
    // and held nowhere: the tab keeps the windows it has scrolled through.
    [GATEWAY_METHOD.TASKS_FILE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksFileParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("reading a file names a task, a path, and a window of its lines");
        }
        if (!gate()) return carried<TasksFileAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const { taskId, ...window } = read.success;
        const answer = yield* served(client.readFile(taskId, window));
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
            "listing a folder names a task, or a workspace and its repository, and the folder's path",
          );
        }
        if (!gate()) return carried<TasksTreeAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const asked = read.success;
        const folder = {
          path: asked.path,
          ...(asked.recursive === undefined ? undefined : { recursive: asked.recursive }),
        };
        const answer = yield* served(
          "planId" in asked
            ? client.readTree(asked.planId, folder)
            : client.readRepositoryTree(asked, folder),
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
            "reading a repository's skills names the task, or a workspace and its repository",
          );
        }
        if (!gate()) {
          return carried<TasksSkillsAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const asked = read.success;
        const answer = yield* served(
          "planId" in asked ? client.readSkills(asked.planId) : client.readRepositorySkills(asked),
        );
        return carried<TasksSkillsAnswer>(answer ?? { failure: TASK_CALL_FAILURE.UNANSWERED });
      }),
    // A pull request is answered to the link that asked and held nowhere:
    // its title and where it stands are read again on the next ask.
    [GATEWAY_METHOD.TASKS_PULL_REQUEST]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksPullRequestParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid(
            "reading a pull request names a workspace, its repository, and the pull request's number",
          );
        }
        if (!gate()) {
          return carried<TasksPullRequestAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const { number, ...place } = read.success;
        const answer = yield* served(client.readRepositoryPullRequest(place, number));
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
        const answer = yield* served(client.readRepositoryIssue(place, number));
        return carried<TasksIssueAnswer>(answer ?? { failure: TASK_CALL_FAILURE.UNANSWERED });
      }),
    // A page of the history, and a revision beside the one before it, are
    // answered to the version history that asked and held nowhere: it keeps
    // what it read, and reads again as the task moves on.
    [GATEWAY_METHOD.TASKS_REVISIONS]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksRevisionsParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid(
            "reading a plan's history names the task, and where an older page is read from",
          );
        }
        if (!gate()) {
          return carried<TasksRevisionsAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const { taskId, before } = read.success;
        const page = yield* served(client.readRevisions(taskId, before));
        return carried<TasksRevisionsAnswer>(page ?? { failure: TASK_CALL_FAILURE.UNANSWERED });
      }),
    [GATEWAY_METHOD.TASKS_REVISION]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksRevisionParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("reading a revision names a task and its number");
        if (!gate()) {
          return carried<TasksRevisionAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const revision = yield* served(client.readRevision(read.success.taskId, read.success.seq));
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
          return yield* invalid("reading a page names a task, the page, and its version");
        }
        if (!gate()) return carried<TasksPageAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const { taskId, pageId, version } = read.success;
        const page = yield* served(client.readPageVersion(taskId, pageId, version));
        return carried<TasksPageAnswer>(
          page === undefined ? { failure: TASK_CALL_FAILURE.UNANSWERED } : { page },
        );
      }),
    // A plan's pages are answered to the Inbox that asked and held nowhere,
    // since the view holds the active plan's alone.
    [GATEWAY_METHOD.TASKS_PAGES]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksPagesParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("reading a task's pages names the task");
        if (!gate()) return carried<TasksPagesAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const pages = yield* served(client.readPages(read.success.taskId));
        return carried<TasksPagesAnswer>(
          pages === undefined ? { failure: TASK_CALL_FAILURE.UNANSWERED } : { pages },
        );
      }),
    // A picture's bytes are answered to the window that asked and held
    // nowhere, so they never enter the view every window is told.
    [GATEWAY_METHOD.TASKS_PICTURE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksPictureParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("reading a picture names a task and the picture");
        if (!gate()) {
          return carried<TasksPictureAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const picture = yield* served(
          client.readPicture(read.success.planId, read.success.attachmentId),
        );
        return carried<TasksPictureAnswer>(picture);
      }),
    // A plan's comments are read past the window's cursor, held by the service while nothing changed.
    [GATEWAY_METHOD.TASKS_COMMENTS]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksCommentsParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("reading a plan's comments names the plan and a cursor");
        if (!gate()) return carried<TasksCommentsAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const answer = yield* served(client.comments(read.success.planId, read.success.after));
        return carried<TasksCommentsAnswer>(answer);
      }),
    [GATEWAY_METHOD.TASKS_COMMENT_START]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksCommentStartParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("starting a comment names a plan and the thread");
        if (!gate()) return carried<TasksCommentAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const answer = yield* served(client.startComment(read.success.planId, read.success.start));
        return carried<TasksCommentAnswer>(answer);
      }),
    [GATEWAY_METHOD.TASKS_COMMENT_ACT]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksCommentActParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("changing a comment names a plan, a thread, and what to do");
        if (!gate()) return carried<TasksCommentAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const answer = yield* served(
          client.actOnComment(read.success.planId, read.success.threadId, read.success.action),
        );
        return carried<TasksCommentAnswer>(answer);
      }),
    // The picture is kept and its id answered to the editor that took it;
    // the plan's text names it once the editor lays its address in.
    [GATEWAY_METHOD.TASKS_PICTURE_KEEP]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksPictureKeepParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("keeping a picture names a task and the picture");
        if (!gate()) {
          return carried<TasksPictureKeepAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const kept = yield* served(client.keepPicture(read.success.planId, read.success.picture));
        return carried<TasksPictureKeepAnswer>(kept);
      }),
    // The service answers the task as restored, so the list's row and the
    // open document take it in place and nothing is read again.
    [GATEWAY_METHOD.TASKS_RESTORE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksRevisionParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("restoring a revision names a task and its number");
        if (!gate()) return { restored: false };
        const { taskId, seq } = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const restored = yield* served(client.restore(taskId, seq));
            if (restored === undefined) return { restored: false };
            restoredFence = { taskId, at: restored.updatedAt };
            takeAnswered(restored);
            return { restored: true };
          }),
        );
      }),
    // Stopping Luke reads nothing back: the conversation's follow hears his turn end.
    [GATEWAY_METHOD.TASKS_STOP_WORK]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksPagesParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("stopping Luke names a task");
        if (gate()) yield* served(client.stopWork(read.success.taskId));
        return {};
      }),
    // Leaving the task returns to the list, which was read when the tab
    // showed, and leaves its call standing, as opening another task does.
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
          return yield* invalid("starting a task names it, and its repository where it has one");
        }
        if (!gate()) return carried<TasksStartAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const request = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const started = yield* served(client.create(request));
            if (!started.ok) return carried<TasksStartAnswer>({ failure: started.failure });
            const { task, agent } = started.answer;
            // A task just started has had no call. A call about another task
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
            return carried<TasksStartAnswer>({
              planId: task.id,
              ...(agent === undefined ? undefined : { agentStart: agent }),
            });
          }),
        );
      }),
    // Note that the task's call ends before the task is deleted, open or not,
    // because a call still standing would go on writing a document that is gone.
    [GATEWAY_METHOD.TASKS_DELETE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksOpenParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("deleting a task names one task");
        if (!gate()) return { deleted: false };
        const { taskId } = read.success;
        yield* endTaskCall(taskId);
        return yield* serial(
          Effect.gen(function* () {
            const deleted = yield* served(client.delete(taskId));
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
    // The service answers the task as renamed, so the list's row and the
    // open document take it in place and nothing is read again.
    [GATEWAY_METHOD.TASKS_RENAME]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksRenameParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("renaming a task names it and its name");
        if (!gate()) return { renamed: false };
        const { taskId, name } = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const renamed = yield* served(client.rename(taskId, { name }));
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
          return yield* invalid("pinning a task names it and whether it is pinned");
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
            const pins = yield* served(client.pinRepository(repository, pinned));
            if (pins === undefined) return { changed: false };
            write({ repositoryPins: pins });
            return { changed: true };
          }),
        );
      }),
    // The service answers the sections as they then stand, as it does the pins.
    [GATEWAY_METHOD.TASKS_WRITE_SECTION]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWriteSectionParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("a change to a section names what it changes");
        }
        if (!gate()) return { changed: false };
        const asked = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const sections = yield* served(client.writeTaskSection(asked));
            if (sections === undefined) return { changed: false };
            write({ taskSections: sections });
            return { changed: true };
          }),
        );
      }),
    // Note that an archived task stays open where it is the open one: leaving
    // it is the window's to ask, as it is for any task.
    [GATEWAY_METHOD.TASKS_ARCHIVE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksArchiveParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("archiving a task names it and whether it is archived");
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
        const listed = yield* served(client.repositories(read.success.workspaceId));
        return carried<TasksRepositoriesAnswer>(
          listed.ok ? { repositories: listed.answer } : { failure: listed.failure },
        );
      }),
    // The service answers the task as changed, so the list's row and the
    // open document take it in place and nothing is read again.
    [GATEWAY_METHOD.TASKS_SET_REPOSITORY]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksSetRepositoryParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("giving a task its repository names the task and the repository");
        }
        if (!gate()) {
          return carried<TasksSetRepositoryAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const { taskId, repository } = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const changed = yield* served(client.setRepository(taskId, repository));
            if (!changed.ok) return carried<TasksSetRepositoryAnswer>({ failure: changed.failure });
            takeAnswered(changed.answer);
            return carried<TasksSetRepositoryAnswer>({ repository: changed.answer.repository });
          }),
        );
      }),
    // The service answers the task as moved, so the list's row and the open
    // document take its workspace in place and nothing is read again.
    [GATEWAY_METHOD.TASKS_MOVE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksMoveParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("moving a task names the task and the workspace");
        }
        if (!gate()) {
          return carried<TasksMoveAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const { taskId, workspaceId } = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const moved = yield* served(client.move(taskId, workspaceId));
            if (!moved.ok) return carried<TasksMoveAnswer>({ failure: moved.failure });
            takeAnswered(moved.answer);
            return carried<TasksMoveAnswer>({ workspaceId: moved.answer.workspaceId });
          }),
        );
      }),
    // The task the service answered is drawn in place, so the edit stands on
    // the document at once and the notetaker's drafts drawn before it drop.
    [GATEWAY_METHOD.TASKS_EDIT]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksEditParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("an edit names a task, and its document's base and value");
        }
        if (!gate()) return carried<TasksEditAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const { taskId, edit } = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const edited = yield* served(client.edit(taskId, edit));
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
        const page = yield* served(client.github.connect());
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
        const disconnected = yield* served(client.github.disconnect());
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
    // A rename moves no task, so the workspaces alone are read again, and
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
    // A photo moves no task either, so it is a rename's twin: the answered
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
        const begun = yield* served(client.workspaces.githubConnect(read.success.workspaceId));
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
        const begun = yield* served(client.workspaces.linearConnect(read.success.workspaceId));
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
        const listed = yield* served(client.workspaces.linearIssues(read.success));
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
        const people = yield* served(client.workspaces.people(read.success.workspaceId));
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
        const photo = yield* served(client.workspaces.photo(read.success.workspaceId));
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
    // A role changed moves no task, so the workspaces alone are read again,
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
    // drawn from, so the workspaces are read again; it moves no task.
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
    // Note that a leave ends a call about any task of the workspace left,
    // the open one or one closed since, and closes the open task where it is
    // that workspace's, as a delete of it does, because the account can no
    // longer read or write a task of a workspace it left; a refused leave
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
        // A standing call is ended only by its own task's id, so each task left is named.
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
    // and moves no workspace or task, so nothing else is read with it.
    [GATEWAY_METHOD.WORKSPACES_INVITATIONS]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("reading invitations names a workspace");
        if (!gate()) return carried<TasksWorkspaceInvitationsAnswer>(WORKSPACE_UNANSWERED);
        const pending = yield* served(client.workspaces.invitations(read.success.workspaceId));
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
        const made = yield* served(client.workspaces.invite(workspaceId, email, role));
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
        const pending = yield* served(
          client.workspaces.cancelInvitation(workspaceId, invitationId),
        );
        return carried<TasksWorkspaceInvitationsAnswer>(
          pending.ok ? { invitations: pending.answer } : { failure: pending.failure },
        );
      }),
    // A save of another task than the open one is dropped: its board is not drawn.
    [GATEWAY_METHOD.TASKS_BOARD_SAVE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksBoardSaveParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("saving a board names a task and its scene");
        const { taskId, elements, appliedDrawing, image } = read.success;
        if (!gate() || view.activeTaskId !== taskId) return { saved: false };
        return yield* serial(
          Effect.gen(function* () {
            const board = yield* served(client.saveBoard(taskId, elements, appliedDrawing, image));
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
    // The board and page reads a settled draw or page asks for, the document
    // read one of Luke's plan edits asks for, the
    // transcript and work reads a call's end asks for, the list read a
    // settled turn asks for, for the name it may have given, and the wake of a
    // parked conversation read the call's words ask for; every other read of
    // the tasks is an ask's.
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
          Effect.flatMap(Queue.take(documentReads), (taskId) =>
            gate() && view.activeTaskId === taskId ? serial(readDocument(taskId)) : Effect.void,
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
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.flatMap(Queue.take(nameReads), (taskId) =>
            Effect.andThen(
              Effect.sleep(NAME_SETTLE),
              Effect.suspend(() =>
                gate()
                  ? serial(
                      Effect.andThen(
                        readList,
                        Effect.sync(() => nameHeldAsListed(taskId)),
                      ),
                    )
                  : Effect.void,
              ),
            ),
          ),
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
