import {
  ACCOUNT_CHAT_REASON,
  type AccountChatEntry,
  type AccountFailedRun,
  type AccountInboxAnswer,
  type AccountInboxAutomation,
  type AccountInboxEntry,
  type AccountInboxTask,
  type AccountTasklessEntry,
} from "@luke/features/account-inbox-wire";
import { failedRunText } from "@luke/features/automation-list-model";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentListAnswer,
  type CodingAgentPageAnswerView,
  type CodingAgentPullRequestAnswerView,
} from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_STATUS,
  type CodingAgentPullRequest,
  type CodingAgentStatus,
  type CodingAgentSummary,
  type TasklessAgent,
} from "@luke/features/coding-agent-wire";
import { linkLabels } from "@luke/features/mention-link";
import { agentTabLabel, modelLabel } from "@luke/features/model-label";
import type { CatalogModel } from "@luke/features/models-wire";
import type { TasksView } from "@luke/features/tasks-view";
import { scheduleOnce } from "@luke/runtime/effect";
import { Context, Duration, Effect, Queue, Schedule, type Scope, Stream } from "effect";
import type { ChatShown } from "./acts.js";
import type { AppInboxSlice, AppInboxWaitingItem } from "./app-state.js";

/**
 * agent-notices.ts -- tells the developer when a coding agent's turn ends or an inbox item lands: the ledger of where each agent stands, the poll that keeps it current while no tab does, the held read of what waits across the account, and the notification, toast, and badge they announce by.
 *
 * The panel reads an agent's status only while its tab is on screen, so
 * main keeps a ledger of its own, fed by every coding-agent answer that
 * passes through the acts (a list, a Start, a Stop, a transcript page) and
 * by one read of its own: while any agent in the ledger is starting or
 * running, its task's agents are listed again every `WATCH_INTERVAL`, the
 * panel's own list read on a clock rather than a second kind of read, so an
 * agent on a plan the developer has left is still watched. An agent an
 * automation started with no plan is held from the plan list, which carries
 * the account's own beside the plans, and from any answer naming it, and
 * while it works it is read again by itself on the same clock, as its page
 * reads it, having no plan to be listed with. The ledger
 * keys an agent's run by the turn its status is read from (`turnId`): a
 * status that moves from still writing to ended under one turn is that
 * turn's end, announced once, and as the agent's unseen dot, until its tab
 * is shown or the window comes forward on it. It is announced nowhere while
 * the window is focused on that agent's tab; in the window's own toast while
 * the window is focused on anything else, since a notification would come
 * from beside the window the developer is already looking at; and as a
 * notification while the window is behind, unless the developer turned
 * notifications off, which leaves the dot and the toast. A message
 * to an agent that had ended reads it running under the ended turn's id
 * until eve opens the next turn, which is the old run read again and not
 * a new one: the ledger keeps the end it announced, and on the message's
 * own answer keeps the task watched until the new turn's id arrives, whose
 * own end is the next notice. A list that landed late, describing a turn
 * the agent has left behind, says nothing newer. A Stop is the developer's
 * own and announces nothing. The ledger
 * is this launch's and this account's, so an agent that ended before Luke
 * watched it, or while Luke was not running, is not announced, a reload of
 * the window announces nothing twice, and an account that signs out takes
 * its agents with it. Only another account is a change of hands: the
 * account's own session renewing, which it does mid-run, says the same
 * account again and keeps the ledger, or an agent running across the
 * renewal would be first seen again already ended and never announced.
 *
 * The notification says the plan's name, or the automation's for an agent
 * with no plan, the agent's title or else its model's name, and how the turn
 * ended, and nothing of the transcript; the toast says the same, the plan's
 * or the automation's name under it, and its View goes where the
 * notification's click does: the plan on the agent's tab, or the agent's own
 * page for one with no plan. A turn that completed is announced
 * as the pull request it opened where one is found: each end is queued
 * from the ledger's own synchronous path and a fiber on the notices' scope
 * takes it, reads what the agent published once, and posts; an end whose
 * read found nothing, or could not be made, says finished as before. The
 * agent's unseen dot is set as the end is seen, ahead of the read.
 *
 * The sidebar's task rows say which tasks have an agent at work and which
 * a pull request, from the task list, which is read on no clock. So the
 * ledger asks for the list again whenever it sees an agent start or end,
 * and whenever a read of what an agent published, the panel's or the
 * notice's own, finds a pull request other than the one it last saw for
 * that agent, since that read is what the service keeps for the list.
 *
 * The notices hold one more read of their own: what waits on the developer
 * across the account's tasks, every open inbox item, on the service's held
 * read, for as long as an account is signed in, so an item an agent posts
 * is heard whichever task is open, or none, and whichever Mac started the
 * agent. Of those, only the items of agents the account started wait on
 * it, since an agent runs on its starter's keys and asks its starter: each
 * answer is written whole as each task's open items of those, which the
 * sidebar counts, and the Dock's badge is their number, while every task
 * holding any member's item is listed for the Inbox. The first answer
 * for an account is where it stands and announces nothing; after it, an
 * item that opens, newly posted or posted again under the key of one the
 * developer answered or the agent closed, is announced once, by the same
 * doors and the same gates as a turn's end: nowhere while the window is
 * focused on that task's Inbox tab, in the window's toast while it is
 * focused on anything else, and as a notification while it is behind,
 * unless the developer turned notifications off. An item the agent posts
 * again while it is still open is the same ask kept current, and announces
 * nothing, and so does one whose task comes back from the archive, which
 * changed before the last answer was read. What waits in chat rides on the
 * same read (`chat`): an ask someone else posted, or a direct message or a
 * mention of the developer's, each announced once as it first waits, by
 * the same doors and gates, nowhere while the window is focused on its
 * Chat, and counted in the Dock's badge beside the items. A chat
 * announcement says who and why, "@agent-2 messaged you", under the task of
 * the channel it stands in, and nothing of what was said. Another account, or nobody,
 * ends the read held for the last, and lets go of its items, its counts,
 * and its badge before anything of the next is read. A read that did not
 * answer is asked again on the watch's clock.
 *
 * The same read carries the newest run of each of the account's own
 * automations that failed to start lately, which is written for the
 * window's Automations to mark until that automation is opened, and counts
 * on no badge, since nothing answers it. A run that failed since the last
 * answer is announced once by the same doors and gates, in the failed tone,
 * under its automation's name, and its click or its toast's View opens that
 * run, in its automation's workspace; nothing is said while the account has Automations off.
 */

/** How often a task with an agent still writing has its agents listed again. */
const WATCH_INTERVAL = Duration.seconds(30);

/**
 * How long before the last answer of what waits was read an item's change
 * still counts as since it: room for the clocks of the service's instances
 * to disagree, so an item written as the last read was made is not missed.
 */
const READ_SKEW = Duration.minutes(1);

/** What the notification is titled for a task main holds no name for. */
const UNNAMED_TASK_TITLE = "Luke";

/** The statuses under which an agent may still write, which is when its task is watched. */
const WRITING_STATUSES: ReadonlySet<CodingAgentStatus> = new Set([
  CODING_AGENT_STATUS.STARTING,
  CODING_AGENT_STATUS.RUNNING,
]);

/** How the notification words each way a turn ends; a Stop is the developer's own and is not announced. */
const ENDED_WORD = {
  [CODING_AGENT_STATUS.COMPLETED]: "finished",
  [CODING_AGENT_STATUS.FAILED]: "failed",
} as const;

/** The notification as the OS posts it: what it says, and what its click does. */
export interface AgentNotice {
  title: string;
  body: string;
  onClick: () => void;
}

/** Where a notification's click takes the developer: the task, on the agent's tab, or the agent's own page for one with no task. */
export interface AgentPlace {
  taskId: string | null;
  agentId: string;
}

/** A turn's end as the window's own toast says it: the words, the plan's or the automation's name under them, whether the turn failed, and where its View goes. */
export interface AgentEndToast {
  place: AgentPlace;
  words: string;
  detail: string;
  failed: boolean;
}

/** Where a failed run's click takes the developer: the run, in its automation, in the workspace it stands in. */
export interface FailedRunPlace {
  automationId: string;
  runId: string;
  workspaceId: string;
}

/** A run that failed to start as the window's own toast says it: the run its View opens, the words, and the automation's name under them. */
export interface FailedRunToast {
  place: FailedRunPlace;
  words: string;
  detail: string;
}

/** What a chat announcement says of who and why, by the reason the message waits. */
const CHAT_NOTICE_WORDS = {
  [ACCOUNT_CHAT_REASON.ASK]: "asked you",
  [ACCOUNT_CHAT_REASON.DIRECT]: "messaged you",
  [ACCOUNT_CHAT_REASON.MENTION]: "mentioned you",
} as const;

/** What a chat announcement is titled where its channel stands in no plan main holds a name for. */
const CHAT_NOTICE_TITLE = "Chat";

/** A chat message that came to wait as the window's own toast says it: the message, the words, and the plan's name under them. */
export interface ChatMessageToast {
  messageId: string;
  /** The workspace whose chat it waits in, whose Chat on screen withdraws the toast. */
  workspaceId: string;
  /** The plan whose channel it waits in, none outside one: that task's Chat tab on screen withdraws it too. */
  taskId: string | null;
  words: string;
  detail: string;
}

/** An inbox item that opened as the window's own toast says it: the task and the item, the words, and the task's name under them. */
export interface InboxItemToast {
  taskId: string;
  itemId: string;
  words: string;
  detail: string;
}

/**
 * The doors an announcement leaves this process through: the OS's
 * notification, the panel's toast for a turn's end or an inbox item, and
 * the Dock's badge. A service rather than a dependency handed in, because
 * it is this process's door to Electron, so a test stands a Layer of its
 * own on it.
 */
export interface AgentNoticeDoorsSurface {
  post(notice: AgentNotice): void;
  toast(end: AgentEndToast): void;
  toastInbox(item: InboxItemToast): void;
  toastFailedRun(run: FailedRunToast): void;
  toastChat(message: ChatMessageToast): void;
  /** How many inbox items and chat messages wait across the account, which the Dock's badge counts; none clears it. */
  badge(count: number): void;
}

export class AgentNoticeDoors extends Context.Service<AgentNoticeDoors, AgentNoticeDoorsSurface>()(
  "@luke/desktop/AgentNoticeDoors",
) {}

export interface AgentNoticesDependencies {
  /** The plan's agents with their status, as the host answers them: the watch's read of a plan's agents. */
  listAgents: (taskId: string) => Effect.Effect<CodingAgentListAnswer>;
  /** One agent as its own page reads it: the watch's read of an agent with no plan. */
  readAgent: (agentId: string) => Effect.Effect<CodingAgentPageAnswerView>;
  /** What the agent published, read once as a completed turn ends for the pull request the notice names. */
  readPullRequest: (agentId: string) => Effect.Effect<CodingAgentPullRequestAnswerView>;
  /** The task as a notice's title names it (`noticeTaskTitle`), or nothing for a task main holds no name for. */
  taskName: (taskId: string) => string | undefined;
  /** Brings Luke forward on the task with the agent's tab open: the click's whole effect. */
  open: (place: AgentPlace) => void;
  /** Where the unseen agents are written, for the tabs to draw. */
  onUnseenChanged: (unseen: readonly string[]) => void;
  /** The panel window coming forward or going behind, for as long as the subscription stands. */
  onPanelFocusChanged: (listener: (focused: boolean) => void) => () => void;
  /** Whether a notification is posted for an end the window is behind for: the developer's setting. */
  notifying: () => boolean;
  /** Who is signed in now, by the account's own key, or nobody. */
  signedInAs: () => string | undefined;
  /** The signed-in account's id, which an agent's starter is named by; none for an identity stored without one, which is told of every agent. */
  accountId: () => string | undefined;
  /** The account as each change of it says, for as long as the subscription stands: the ledger is no one else's. */
  onAccountChanged: (listener: (signedInAs: string | undefined) => void) => () => void;
  /** An agent started or ended, or a read found it published something new: the task list is read again, so its rows say so. */
  onTaskAgentsMoved: () => void;
  /** What waits across the account followed by the host, heard through `onAccountInboxChanged` until let go: the inbox read's one read. */
  followAccountInbox: () => Effect.Effect<void>;
  /** The account's inbox let go. */
  unfollowAccountInbox: () => Effect.Effect<void>;
  /** What waits across the account, whole, each time it changes while it is followed, for as long as the subscription stands. */
  onAccountInboxChanged: (listener: (inbox: AccountInboxAnswer) => void) => () => void;
  /** Who is signed in, by the account's own key, from where the launch stands and at each change: whose items the inbox read reads. */
  accounts: Stream.Stream<string | undefined>;
  /** Where each task's waiting items, and every task holding an item, are written, for the window's Inbox. */
  onInboxChanged: (inbox: AppInboxSlice) => void;
  /** Brings Luke forward on the task with its Inbox tab open: an inbox notification's click. */
  openInbox: (taskId: string) => void;
  /** Brings Luke forward on the window's Inbox with an item of an agent with no task chosen: that item's notification's click. */
  /** Brings Luke forward on a failed run, in its automation's workspace: its notification's click. */
  openFailedRun: (place: FailedRunPlace) => void;
  openTasklessItem: (item: {
    readonly agentId: string;
    readonly itemId: string;
    /** The workspace whose list holds the item, which the window lists first; absent from a service before it. */
    readonly workspaceId?: string;
  }) => void;
  /** Brings Luke forward on the Chat of the workspace a message waits in: a chat notification's click. */
  openChat: (workspaceId: string) => void;
  /** Whether the window offers Chat, without which nothing waiting in chat is counted or announced. */
  chatOn: () => boolean;
  watchInterval?: Duration.Duration;
  report: (line: string) => void;
}

export interface AgentNotices {
  /** Agents as an answer carried them: a task's list, or the one a Start or a Stop answered. */
  observeAgents(agents: readonly CodingAgentSummary[]): void;
  /** The agents with no plan as the plan list last carried them: the account's own are held, each with its automation's name. */
  observeTaskless(agents: readonly TasklessAgent[]): void;
  /** One agent's status as a transcript page carried it; an agent no answer has named yet is left for the list. */
  observeStatus(agentId: string, status: CodingAgentStatus): void;
  /** One agent's title as a transcript page carried it, which the list that named the agent may have read before the title landed; said whatever the agent's standing. */
  observeTitle(agentId: string, title: string | null): void;
  /** The agent as the answer to a message carried it: running, and with a line awaiting the turn it opens, which keeps its task watched for that turn. */
  observeMessaged(agent: CodingAgentSummary): void;
  /** The catalog as the panel last read it, for the model's name. */
  observeModels(models: readonly CatalogModel[]): void;
  /** What one agent published, as a read of it answered: the pull request, or none. */
  observePublished(agentId: string, pullRequest: CodingAgentPullRequest | null): void;
  /** A task the host no longer holds: its agents are forgotten. */
  observeTaskGone(taskId: string): void;
  /** The panel said which agent's tab it shows, or none. */
  shown(agentId: string | null): void;
  /** The panel said which task's Inbox tab it shows, or none. */
  shownInbox(taskId: string | null): void;
  /** The panel said which Chat it has on screen, or none. */
  shownChat(shown: ChatShown | null): void;
}

/** What the ledger keeps of one agent: enough to watch it, to name it, and to tell one turn's end from the next's. */
interface HeldAgent {
  /** The plan it works on; null for one an automation started with no plan. */
  taskId: string | null;
  model: string;
  /** The agent's title, said in the model's place where it has one. */
  title: string | null;
  /** The automation whose run started it, which an untitled agent goes by (`agentTabLabel`). */
  automationName?: string | undefined;
  status: CodingAgentStatus;
  /** The turn the status is read from; none before the first. */
  turnId: string | null;
  /** Whether a message of the developer's awaits a turn not yet opened, which keeps the task watched past the end already announced. */
  awaiting: boolean;
  /** The turns the agent has left behind, which a list that landed late may still describe. */
  pastTurns: ReadonlySet<string>;
}

/**
 * The task a notice is about, as its title names it: the task's name, led by
 * its workspace's where the account is in more than one, "Acme · Billing
 * export", so a notice from a workspace the window is not listing says
 * whose it is; nothing for a task main holds no name for.
 */
export function noticeTaskTitle(
  tasks: Pick<TasksView, "tasks" | "workspaces" | "document">,
  taskId: string,
): string | undefined {
  const open = tasks.document.task;
  const listed = tasks.tasks.find((task) => task.id === taskId);
  const task = listed ?? (open?.id === taskId ? open : undefined);
  if (task === undefined) return undefined;
  if (tasks.workspaces.length <= 1) return task.name;
  const workspace = tasks.workspaces.find((each) => each.id === task.workspaceId);
  return workspace === undefined ? task.name : `${workspace.name} · ${task.name}`;
}

/** One turn's end as the ledger saw it, waiting to be announced, and whether the window was focused as it ended. */
interface TurnEnd {
  agentId: string;
  agent: HeldAgent;
  focused: boolean;
}

function stillWriting(status: CodingAgentStatus): boolean {
  return WRITING_STATUSES.has(status);
}

/** Whether two reads of what an agent published say the same of it in a task's row: the same pull request, standing the same, of the same size. */
function samePublished(
  a: CodingAgentPullRequest | null,
  b: CodingAgentPullRequest | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.number === b.number &&
    a.title === b.title &&
    a.state === b.state &&
    a.checks === b.checks &&
    a.additions === b.additions &&
    a.deletions === b.deletions
  );
}

/**
 * What the notification says, built in one place: the plan's name, or the
 * automation's for an agent with no plan, over the agent as its tab names it
 * (`agentTabLabel`), and the word for how the turn ended, or the
 * pull request it opened once a reader of the agent's pull request hands one
 * in. Nothing for a status that is not a turn's end, or for a Stop.
 */
function noticeText(input: {
  subject: string | undefined;
  model: string;
  title: string | null;
  automationName?: string | undefined;
  status: CodingAgentStatus;
  models: readonly CatalogModel[] | undefined;
  pullRequest?: number;
}): Pick<AgentNotice, "title" | "body"> | undefined {
  const { status } = input;
  if (status !== CODING_AGENT_STATUS.COMPLETED && status !== CODING_AGENT_STATUS.FAILED) {
    return undefined;
  }
  const name = agentTabLabel(input, input.models);
  const ended =
    input.pullRequest !== undefined && status === CODING_AGENT_STATUS.COMPLETED
      ? `opened #${input.pullRequest}`
      : ENDED_WORD[status];
  return { title: input.subject ?? UNNAMED_TASK_TITLE, body: `${name} ${ended}` };
}

/**
 * What an inbox item's announcement says: the task's name over the agent,
 * by its title or else its model's name, and the item's title, a link in
 * it said by its name rather than its address (`linkLabels`), and nothing
 * of what the item details.
 */
function inboxNoticeText(
  item: AccountInboxEntry,
  taskName: string | undefined,
  models: readonly CatalogModel[] | undefined,
): Pick<AgentNotice, "title" | "body"> {
  const agent = item.agentTitle ?? modelLabel(item.agentModel, models);
  return { title: taskName ?? UNNAMED_TASK_TITLE, body: `${agent}: ${linkLabels(item.title)}` };
}

/**
 * The answer as it waits on the account: the items of the agents it
 * started, a task's and one with no task alike, since an agent runs on its starter's keys and asks its starter,
 * and the tasks holding any item whole, since every member's Inbox lists
 * them. An item whose starter the service does not say, or an account whose
 * id is not known, is the account's own, as every item was before. Note that
 * what counts and is announced is this, while the window lists every
 * member's items of agents with no task (`sliceOf`), as it does a task's.
 */
function startedBy(answer: AccountInboxAnswer, accountId: string | undefined): AccountInboxAnswer {
  if (accountId === undefined) return answer;
  const ownOf = (item: { readonly startedBy?: string }) =>
    item.startedBy === undefined || item.startedBy === accountId;
  return {
    ...answer,
    items: answer.items.filter(ownOf),
    ...(answer.planless === undefined ? undefined : { planless: answer.planless.filter(ownOf) }),
  };
}

/** What a chat message's announcement says: who and why, under the plan of its channel, and nothing of what was said. */
function chatNoticeText(
  entry: AccountChatEntry,
  taskName: string | undefined,
): Pick<AgentNotice, "title" | "body"> {
  return {
    title: taskName ?? CHAT_NOTICE_TITLE,
    body: `@${entry.from} ${CHAT_NOTICE_WORDS[entry.reason]}`,
  };
}

/** Whether a waiting message is on the Chat shown: anywhere in a workspace's whole Chat, or in its plan's channel on a task's Chat tab. */
function chatShows(shown: ChatShown | null, entry: AccountChatEntry): boolean {
  if (shown === null || shown.workspaceId !== entry.workspaceId) return false;
  return shown.taskId === null || shown.taskId === entry.planId;
}

/** The items each task holds waiting, the task whose item changed latest first, as the read answered them latest first. */
function waitingTasks(items: readonly AccountInboxEntry[]): AppInboxSlice["waiting"] {
  const tasks = new Map<string, AppInboxWaitingItem[]>();
  for (const item of items) {
    const waiting = {
      id: item.id,
      agentId: item.agentId,
      title: item.title,
      postedAt: item.postedAt,
    };
    const held = tasks.get(item.planId);
    if (held === undefined) tasks.set(item.planId, [waiting]);
    else held.push(waiting);
  }
  return [...tasks].map(([taskId, held]) => ({ taskId, items: held }));
}

/** The open items of agents with no task as the window holds them: each with its agent, who started it, and the automation and repository standing in a task's place. */
function waitingTaskless(items: readonly AccountTasklessEntry[]): AppInboxSlice["taskless"] {
  return items.map((item) => ({
    id: item.id,
    agentId: item.agentId,
    title: item.title,
    postedAt: item.postedAt,
    agentTitle: item.agentTitle,
    agentModel: item.agentModel,
    automationId: item.automationId,
    automationName: item.automationName,
    repository: item.repository,
    ...(item.startedBy === undefined ? undefined : { startedBy: item.startedBy }),
    ...(item.workspaceId === undefined ? undefined : { workspaceId: item.workspaceId }),
  }));
}

/**
 * What an announcement of an item of an agent with no task says: the
 * automation's name, or the repository where the reader may not read it,
 * over the agent and the item's title, as a task's item says its task.
 */
function tasklessNoticeText(
  item: AccountTasklessEntry,
  models: readonly CatalogModel[] | undefined,
): Pick<AgentNotice, "title" | "body"> {
  const agent = item.agentTitle ?? modelLabel(item.agentModel, models);
  return {
    title: item.automationName ?? item.repository,
    body: `${agent}: ${linkLabels(item.title)}`,
  };
}

/** What an answer of the inbox read carries that the window and the Dock are told of. */
type InboxAnswered = Pick<
  AccountInboxAnswer,
  "items" | "plans" | "planless" | "automations" | "failedRuns" | "chat"
>;

/** Whether two answers say alike everything the window draws of each item of an agent with no task: its agent's title and model, the automation and repository standing in a task's place, and the workspace whose list it stands in, which change without the item's stamp moving, a service first naming the workspace among them. */
function sameTaskless(
  one: readonly AccountTasklessEntry[],
  other: readonly AccountTasklessEntry[],
): boolean {
  return (
    one.length === other.length &&
    one.every((item, at) => {
      const was = other[at];
      return (
        was !== undefined &&
        was.id === item.id &&
        was.agentTitle === item.agentTitle &&
        was.agentModel === item.agentModel &&
        was.automationId === item.automationId &&
        was.automationName === item.automationName &&
        was.repository === item.repository &&
        was.workspaceId === item.workspaceId
      );
    })
  );
}

/** Whether two answers list the same automations holding items, alike in order, count, and instant. */
function sameAutomations(
  one: readonly AccountInboxAutomation[],
  other: readonly AccountInboxAutomation[],
): boolean {
  return (
    one.length === other.length &&
    one.every((held, at) => {
      const was = other[at];
      return (
        was !== undefined &&
        was.automationId === held.automationId &&
        was.items === held.items &&
        was.updatedAt === held.updatedAt
      );
    })
  );
}

/** Whether two answers list the same tasks holding items, alike in order, count, and instant. */
function sameTasks(one: readonly AccountInboxTask[], other: readonly AccountInboxTask[]): boolean {
  return (
    one.length === other.length &&
    one.every((task, at) => {
      const was = other[at];
      return (
        was !== undefined &&
        was.planId === task.planId &&
        was.items === task.items &&
        was.updatedAt === task.updatedAt
      );
    })
  );
}

/**
 * The notices, built on the ambient scope: the watch forks into it and the
 * focus subscription is given back when it closes, so both end with the
 * launch rather than with a handle a caller had to remember.
 */
export const createAgentNotices = /* @__PURE__ */ Effect.fn("desktop/createAgentNotices")(
  function* (
    dependencies: AgentNoticesDependencies,
  ): Effect.fn.Return<AgentNotices, never, Scope.Scope | AgentNoticeDoors> {
    const { listAgents, readPullRequest, taskName, open, onUnseenChanged, report } = dependencies;
    const doors = yield* AgentNoticeDoors;
    const ledger = new Map<string, HeldAgent>();
    /** What each agent with no plan is announced under, by agent: its automation's name, or its repository where the reader may not read the automation. */
    const tasklessSubjects = new Map<string, string>();
    /** What each agent was last read to have published, by agent. */
    const published = new Map<string, CodingAgentPullRequest | null>();
    const unseen = new Set<string>();
    const ends = yield* Queue.unbounded<TurnEnd>();
    const interval = dependencies.watchInterval ?? WATCH_INTERVAL;
    let models: readonly CatalogModel[] | undefined;
    let shownAgent: string | null = null;
    let focused = false;
    /** Whose agents the ledger holds: read as it takes its first, and moved only by another account. */
    let holder: string | undefined;
    /** The inbox read's last answer for the account signed in, as it waits on the account (`startedBy`), every member's items of agents with no task the window lists, and its items and chat messages by id; none before its first. */
    let waiting:
      | {
          readonly answer: AccountInboxAnswer;
          readonly listed: readonly AccountTasklessEntry[];
          readonly items: ReadonlySet<string>;
          readonly chat: ReadonlySet<string>;
        }
      | undefined;
    /** The highest revision any answer for the account held of each item, so one back unchanged is known. */
    const seenRevision = new Map<string, number>();
    let shownInbox: string | null = null;
    /** The Chat the panel has on screen, none where no Chat is: a message waiting there is read there. */
    let shownChat: ChatShown | null = null;

    function publishUnseen(): void {
      onUnseenChanged([...unseen]);
    }

    /** A turn ended: dot its tab and queue the announcement, unless the developer is looking at it. */
    function ended(agentId: string, agent: HeldAgent): void {
      if (
        agent.status !== CODING_AGENT_STATUS.COMPLETED &&
        agent.status !== CODING_AGENT_STATUS.FAILED
      ) {
        return;
      }
      if (focused && shownAgent === agentId) return;
      unseen.add(agentId);
      publishUnseen();
      Queue.offerUnsafe(ends, { agentId, agent, focused });
    }

    /** A read of what the agent published answered: the list is read again where it found other than the last read did, or a pull request where none was read before. */
    function observePublished(agentId: string, pullRequest: CodingAgentPullRequest | null): void {
      const was = published.get(agentId) ?? null;
      published.set(agentId, pullRequest);
      if (!samePublished(was, pullRequest)) dependencies.onTaskAgentsMoved();
    }

    /** The pull request a completed turn opened, where the read finds one; nothing for any other end, or a read that did not answer. */
    const pullRequestOf = (end: TurnEnd): Effect.Effect<number | undefined> =>
      end.agent.status !== CODING_AGENT_STATUS.COMPLETED
        ? Effect.succeed(undefined)
        : readPullRequest(end.agentId).pipe(
            Effect.map((answer) => {
              if (!("pullRequest" in answer)) return undefined;
              observePublished(end.agentId, answer.pullRequest);
              return answer.pullRequest?.number;
            }),
            Effect.catchDefect((defect) =>
              Effect.sync(() => {
                report(
                  `the agent's pull request could not be read for its notice: ${defect instanceof Error ? defect.message : String(defect)}`,
                );
                return undefined;
              }),
            ),
          );

    /**
     * One end announced: what the agent published read, then the toast shown
     * where the window was focused as the turn ended and still is, or else
     * the notification posted. Note that focus is read on both sides of the
     * read, because a toast to a window gone behind while it was out would
     * play to nobody, and a window come forward meanwhile had already been
     * told nothing of the end it missed.
     */
    const announce = Effect.gen(function* () {
      const end = yield* Queue.take(ends);
      const pullRequest = yield* pullRequestOf(end);
      const text = noticeText({
        subject:
          end.agent.taskId === null
            ? tasklessSubjects.get(end.agentId)
            : taskName(end.agent.taskId),
        model: end.agent.model,
        title: end.agent.title,
        automationName: end.agent.automationName,
        status: end.agent.status,
        models,
        ...(pullRequest === undefined ? undefined : { pullRequest }),
      });
      if (text === undefined) return;
      const place = { taskId: end.agent.taskId, agentId: end.agentId };
      if (end.focused && focused) {
        doors.toast({
          place,
          words: text.body,
          detail: text.title,
          failed: end.agent.status === CODING_AGENT_STATUS.FAILED,
        });
        return;
      }
      if (dependencies.notifying()) doors.post({ ...text, onClick: () => open(place) });
    });
    // Each announce suspends on the queue itself, so the loop need not yield between ends: the ends queued together are posted together.
    yield* Effect.forkScoped(Effect.forever(announce, { disableYield: true }));

    /**
     * What the window holds of an answer: each task's items waiting on the
     * account and every task holding one, and beside them the items of
     * agents with no task, every member's listed as a task's are, and the
     * automations holding them.
     */
    function sliceOf(
      answer: InboxAnswered,
      listed: readonly AccountTasklessEntry[],
    ): AppInboxSlice {
      return {
        waiting: waitingTasks(answer.items),
        tasks: answer.plans.map(({ planId: taskId, ...holding }) => ({
          ...holding,
          taskId,
        })),
        taskless: waitingTaskless(listed),
        automations: answer.automations ?? [],
        failedRuns: answer.failedRuns ?? [],
      };
    }

    /** What waits in chat that the window offers, none while Chat is off. */
    function chatOf(answer: InboxAnswered): readonly AccountChatEntry[] {
      return dependencies.chatOn() ? (answer.chat ?? []) : [];
    }

    /** Writes what waits for the window, and its number, a task's items, an agent's with no task, and chat messages alike, the account's own alone, for the Dock. */
    function publishWaiting(answer: InboxAnswered, listed: readonly AccountTasklessEntry[]): void {
      dependencies.onInboxChanged(sliceOf(answer, listed));
      doors.badge(answer.items.length + (answer.planless?.length ?? 0) + chatOf(answer).length);
    }

    /** An item of an agent with no task opened: told nowhere in front, since the window's toast opens a task and the window's Inbox lists it, and as a notification behind, which opens the window's Inbox on the item, where it is answered. */
    function announceTaskless(item: AccountTasklessEntry): void {
      if (focused) return;
      if (dependencies.notifying()) {
        const text = tasklessNoticeText(item, models);
        doors.post({
          ...text,
          onClick: () =>
            dependencies.openTasklessItem({
              agentId: item.agentId,
              itemId: item.id,
              ...(item.workspaceId === undefined ? undefined : { workspaceId: item.workspaceId }),
            }),
        });
      }
    }

    /** A run failed to start: told in the toast in front, and as a notification behind, each opening its automation. */
    function announceFailedRun(run: AccountFailedRun): void {
      const words = failedRunText(run.reason);
      const place = { automationId: run.automationId, runId: run.id, workspaceId: run.workspaceId };
      if (focused) {
        doors.toastFailedRun({ place, words, detail: run.automationName });
        return;
      }
      if (dependencies.notifying()) {
        doors.post({
          title: run.automationName,
          body: words,
          onClick: () => dependencies.openFailedRun(place),
        });
      }
    }

    /** A chat message came to wait: told nowhere on Chat in front, in the toast elsewhere in front, and as a notification behind. */
    function announceChat(entry: AccountChatEntry): void {
      if (focused && chatShows(shownChat, entry)) return;
      const text = chatNoticeText(
        entry,
        entry.planId === null ? undefined : taskName(entry.planId),
      );
      if (focused) {
        doors.toastChat({
          messageId: entry.messageId,
          workspaceId: entry.workspaceId,
          taskId: entry.planId,
          words: text.body,
          detail: text.title,
        });
        return;
      }
      if (dependencies.notifying()) {
        doors.post({ ...text, onClick: () => dependencies.openChat(entry.workspaceId) });
      }
    }

    /** An item opened: told nowhere on its task's Inbox in front, in the toast elsewhere in front, and as a notification behind. */
    function announceItem(item: AccountInboxEntry): void {
      if (focused && shownInbox === item.planId) return;
      const text = inboxNoticeText(item, taskName(item.planId), models);
      if (focused) {
        doors.toastInbox({
          taskId: item.planId,
          itemId: item.id,
          words: text.body,
          detail: text.title,
        });
        return;
      }
      if (dependencies.notifying()) {
        doors.post({ ...text, onClick: () => dependencies.openInbox(item.planId) });
      }
    }

    /**
     * An answer of the inbox read: written whole, and each item that opened
     * since the last answer announced, unless this is the first. Note that
     * an item opened since is one the last answer did not hold, at a
     * revision no answer for the account held, that changed after the last
     * answer was read, because a task brought back from the archive brings
     * its items back unchanged, and they are not news; an item posted again
     * after it was answered or closed moves its revision on, and is. Only
     * what waits on the account (`startedBy`) is counted and announced, while
     * every member's items of agents with no task are written for the window.
     */
    function observeWaiting(read: AccountInboxAnswer): void {
      const answer = startedBy(read, dependencies.accountId());
      const listed = read.planless ?? [];
      const was = waiting;
      // Note that an answer at the same cursor holding fewer of the account's own items is news, because the account's id, which picks them, may have arrived since.
      if (
        was?.answer.cursor === answer.cursor &&
        was.answer.items.length === answer.items.length &&
        (was.answer.planless?.length ?? 0) === (answer.planless?.length ?? 0) &&
        was.listed.length === listed.length
      ) {
        // Note that the tasks and automations holding items, and what an item with no task is named
        // by, may move with nothing waiting moving, an archive, a rename, or a hold let go, so they are written alone.
        if (
          sameTasks(was.answer.plans, answer.plans) &&
          sameAutomations(was.answer.automations ?? [], answer.automations ?? []) &&
          sameTaskless(was.listed, listed)
        ) {
          return;
        }
        const moved = {
          ...was.answer,
          plans: answer.plans,
          automations: answer.automations ?? [],
          planless: answer.planless ?? [],
        };
        waiting = { ...was, answer: moved, listed };
        dependencies.onInboxChanged(sliceOf(moved, listed));
        return;
      }
      const taskless = answer.planless ?? [];
      const chat = chatOf(answer);
      waiting = {
        answer,
        listed,
        items: new Set([...answer.items, ...taskless].map((item) => item.id)),
        chat: new Set(chat.map((entry) => entry.messageId)),
      };
      publishWaiting(answer, listed);
      const since =
        was === undefined ? undefined : was.answer.readAt - Duration.toMillis(READ_SKEW);
      // A chat message is news once, as it first waits: the first answer is where the account stands.
      // Note that an ask changed before the last answer was read, as an open one of a workspace just
      // joined, is no news, where a direct message or a mention is: it waits only once its person was
      // stamped, which may be well after it was posted, and a stamp is always news.
      for (const entry of chat) {
        if (since === undefined || was?.chat.has(entry.messageId) === true) continue;
        if (entry.reason !== ACCOUNT_CHAT_REASON.ASK || entry.updatedAt > since)
          announceChat(entry);
      }
      for (const item of answer.items) {
        const known = seenRevision.get(item.id);
        seenRevision.set(item.id, Math.max(known ?? 0, item.revision));
        if (since === undefined || was?.items.has(item.id) === true) continue;
        if ((known ?? 0) < item.revision && item.updatedAt > since) announceItem(item);
      }
      for (const item of taskless) {
        const known = seenRevision.get(item.id);
        seenRevision.set(item.id, Math.max(known ?? 0, item.revision));
        if (since === undefined || was?.items.has(item.id) === true) continue;
        if ((known ?? 0) < item.revision && item.updatedAt > since) announceTaskless(item);
      }
      // A run settles once, so one the last answer did not hold that failed since it was read is news.
      const told = new Set((was?.answer.failedRuns ?? []).map((run) => run.id));
      for (const run of answer.failedRuns ?? []) {
        if (since === undefined || told.has(run.id) || run.failedAt <= since) continue;
        announceFailedRun(run);
      }
    }

    /**
     * What waits for one account, followed for as long as it stays signed
     * in: whatever the last account left is let go first, and nobody's is
     * nothing to follow. The host follows it, over Neon Realtime where the
     * service seals it, and each change is heard as one answer whole. Note
     * that an answer is let go where the account it was read for is no
     * longer signed in, because one may land in the tick before the change
     * ends the follow. Letting go of the follow ends both the subscription
     * to its answers and the host's follow.
     */
    const waitingOf = (reader: string | undefined): Effect.Effect<void> =>
      Effect.suspend(() => {
        waiting = undefined;
        seenRevision.clear();
        publishWaiting({ items: [], plans: [] }, []);
        if (reader === undefined) return Effect.void;
        return Effect.scoped(
          Effect.gen(function* () {
            yield* Effect.acquireRelease(
              Effect.sync(() =>
                dependencies.onAccountInboxChanged((answer) => {
                  if (dependencies.signedInAs() !== reader) return;
                  // An answer that could not be observed is reported, and the next change is heard as it lands.
                  try {
                    observeWaiting(answer);
                  } catch (defect) {
                    report(
                      `the inbox read failed: ${defect instanceof Error ? defect.message : String(defect)}`,
                    );
                  }
                }),
              ),
              (unsubscribe) => Effect.sync(unsubscribe),
            );
            yield* Effect.acquireRelease(dependencies.followAccountInbox(), () =>
              dependencies.unfollowAccountInbox(),
            );
            return yield* Effect.never;
          }),
        );
      });

    /** One agent as an answer carried it, against where the ledger last had it. */
    function observe(agentId: string, next: HeldAgent): void {
      const was = ledger.get(agentId);
      // An agent first seen ended ended before Luke watched it; one first seen at work may have just started.
      if (was === undefined) {
        if (ledger.size === 0) holder = dependencies.signedInAs();
        ledger.set(agentId, next);
        if (stillWriting(next.status)) dependencies.onTaskAgentsMoved();
        return;
      }
      // The reads overlap, so a list can land after a newer read moved the
      // ledger on: one describing a turn the agent has left behind, or no
      // turn yet, says nothing newer and is let go whole.
      if (next.turnId === null ? was.turnId !== null : was.pastTurns.has(next.turnId)) return;
      if (was.turnId === next.turnId) {
        // A turn that ended stays ended, so an end is never a second turn's,
        // and running again under the ended turn's id is a late read or a
        // message awaiting the next turn, which its own answer says.
        if (!stillWriting(was.status)) return;
        ledger.set(agentId, { ...next, pastTurns: was.pastTurns });
        if (stillWriting(next.status)) return;
        ended(agentId, next);
        dependencies.onTaskAgentsMoved();
        return;
      }
      // A new turn: the one before it is left behind, and its own end is the next notice.
      const pastTurns = new Set(was.pastTurns);
      if (was.turnId !== null) pastTurns.add(was.turnId);
      ledger.set(agentId, { ...next, pastTurns });
      if (!stillWriting(next.status)) ended(agentId, next);
      dependencies.onTaskAgentsMoved();
    }

    /** Lets go of every agent `keep` refuses, their dots with them, as a plan or an agent deleted or an account left has no tab to clear one. */
    function forget(keep: (agent: HeldAgent, agentId: string) => boolean): void {
      let dotted = false;
      for (const [agentId, agent] of ledger) {
        if (keep(agent, agentId)) continue;
        ledger.delete(agentId);
        published.delete(agentId);
        tasklessSubjects.delete(agentId);
        if (unseen.delete(agentId)) dotted = true;
      }
      if (dotted) publishUnseen();
    }

    function seen(agentId: string | null): void {
      if (agentId === null || !unseen.delete(agentId)) return;
      publishUnseen();
    }

    /** Whether the agent is still writing, or awaits the turn a message opens, which keeps it watched. */
    function watched(agent: HeldAgent): boolean {
      return stillWriting(agent.status) || agent.awaiting;
    }

    /** The plans with an agent watched, each listed again on the watch's clock. */
    function watchedTasks(): readonly string[] {
      const tasks = new Set<string>();
      for (const agent of ledger.values()) {
        if (agent.taskId !== null && watched(agent)) tasks.add(agent.taskId);
      }
      return [...tasks];
    }

    /** The agents with no plan watched, each read again by itself on the watch's clock. */
    function watchedTaskless(): readonly string[] {
      return [...ledger]
        .filter(([, agent]) => agent.taskId === null && watched(agent))
        .map(([agentId]) => agentId);
    }

    /** The agent as the ledger holds it, on a plan or with none. */
    function heldOf(
      agent: Pick<
        CodingAgentSummary,
        "planId" | "model" | "title" | "automationName" | "status" | "turnId"
      >,
    ): HeldAgent {
      return {
        taskId: agent.planId,
        model: agent.model,
        title: agent.title,
        automationName: agent.automationName,
        status: agent.status,
        turnId: agent.turnId,
        awaiting: false,
        pastTurns: new Set(),
      };
    }

    /**
     * Whether the ledger holds the agent: one on a plan as every plan read
     * names it, and one with no plan only where the account started it.
     * Note that a teammate's is left to its starter, because it asks its
     * starter, whose key it runs on, and the plan list carries every
     * member's, as an act on a teammate's agent's page answers it.
     */
    function heldHere(agent: Pick<CodingAgentSummary, "planId" | "startedBy">): boolean {
      const accountId = dependencies.accountId();
      return (
        agent.planId !== null || accountId === undefined || agent.startedBy?.userId === accountId
      );
    }

    /** Keeps what an agent with no plan is announced under, where the answer names its automation. */
    function noteSubject(
      agent: Pick<CodingAgentSummary, "id" | "planId" | "automationName">,
    ): void {
      if (agent.planId === null && agent.automationName !== undefined) {
        tasklessSubjects.set(agent.id, agent.automationName);
      }
    }

    const notices: AgentNotices = {
      observeAgents: (agents) => {
        for (const agent of agents) {
          if (!heldHere(agent)) continue;
          noteSubject(agent);
          observe(agent.id, heldOf(agent));
        }
      },
      observeTaskless: (agents) => {
        for (const agent of agents) {
          if (!heldHere(agent)) continue;
          tasklessSubjects.set(agent.id, agent.automationName ?? agent.repository);
          observe(agent.id, heldOf(agent));
        }
      },
      observeMessaged: (agent) => {
        if (!heldHere(agent)) return;
        noteSubject(agent);
        observe(agent.id, heldOf(agent));
        // The line awaits the turn it opens: the task is watched until that turn names itself.
        const held = ledger.get(agent.id);
        if (held !== undefined && !stillWriting(held.status) && !held.awaiting) {
          ledger.set(agent.id, { ...held, awaiting: true });
          // The service reads the agent running from the message on, so the list is read again now.
          dependencies.onTaskAgentsMoved();
        }
      },
      observeStatus: (agentId, status) => {
        const held = ledger.get(agentId);
        if (held !== undefined) observe(agentId, { ...held, status });
      },
      observeTitle: (agentId, title) => {
        const held = ledger.get(agentId);
        if (held !== undefined && held.title !== title) ledger.set(agentId, { ...held, title });
      },
      observeModels: (next) => {
        models = next;
      },
      observePublished,
      observeTaskGone: (taskId) => forget((agent) => agent.taskId !== taskId),
      shown: (agentId) => {
        shownAgent = agentId;
        seen(agentId);
      },
      shownChat: (shown) => {
        shownChat = shown;
      },
      shownInbox: (taskId) => {
        shownInbox = taskId;
      },
    };

    /** One tick of the watch: each watched plan listed again, read as the panel's own list is, and each watched agent with no plan read as its page is. */
    const tick = Effect.suspend(() =>
      Effect.andThen(
        Effect.forEach(
          watchedTasks(),
          (taskId) =>
            Effect.map(listAgents(taskId), (answer) => {
              if ("agents" in answer) notices.observeAgents(answer.agents);
              else if (answer.failure === CODING_AGENT_CALL_FAILURE.NOT_FOUND) {
                notices.observeTaskGone(taskId);
              }
            }),
          { discard: true },
        ),
        Effect.forEach(
          watchedTaskless(),
          (agentId) =>
            Effect.map(dependencies.readAgent(agentId), (answer) => {
              if ("agent" in answer) observe(agentId, heldOf(answer.agent));
              else if (answer.failure === CODING_AGENT_CALL_FAILURE.NOT_FOUND) {
                forget((_agent, held) => held !== agentId);
              }
            }),
          { discard: true },
        ),
      ),
    );
    // A tick that died is reported rather than left to end the watch: a
    // repeat that failed once would never list again for the rest of the run.
    const watch = Effect.catchDefect(tick, (defect) =>
      Effect.sync(() => {
        report(
          `the coding-agent watch failed: ${defect instanceof Error ? defect.message : String(defect)}`,
        );
      }),
    );
    // The watch never fires at the fork itself: nothing is in the ledger at
    // launch, so the first tick is one interval on, and each after it.
    yield* scheduleOnce(
      Duration.toMillis(interval),
      Effect.repeat(watch, Schedule.spaced(interval)),
    );
    // Each account's inbox read in turn, the read held for the last one
    // ended as the next is signed in, so nothing of one is read for another.
    yield* Effect.forkScoped(
      Stream.runDrain(
        Stream.switchMap(Stream.changes(dependencies.accounts), (reader) =>
          Stream.fromEffect(waitingOf(reader)),
        ),
      ),
    );
    // Coming forward on the shown agent's tab is seeing it.
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        dependencies.onPanelFocusChanged((next) => {
          focused = next;
          if (focused) seen(shownAgent);
        }),
      ),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    // Another account leaves the ledger no one's: nothing of the account
    // that left is announced to whoever signs in next, and an answer still on
    // its way lands as a first sighting, which announces nothing.
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        dependencies.onAccountChanged((signedInAs) => {
          if (ledger.size === 0 || signedInAs === holder) return;
          forget(() => false);
        }),
      ),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    return notices;
  },
);
