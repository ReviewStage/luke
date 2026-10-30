import type { AccountSnapshot } from "@luke/credentials/snapshot";
import type { AccountFailedRun } from "@luke/features/account-inbox-wire";
import { INBOX_SCOPE_KIND } from "@luke/features/agent-view";
import type { AgentKind } from "@luke/features/agent-wire";
import type { WorkspaceChannels } from "@luke/features/channel-live";
import type { InboxItem } from "@luke/features/inbox-wire";
import { LIVE_READ } from "@luke/features/live-wire";
import { PAGE_OWNER, type PageLine } from "@luke/features/page-wire";
import type { TasksView } from "@luke/features/tasks-view";
import type { SessionReplayBootstrap } from "@luke/gateway/window-session";
import { HOST_CAPABILITY, type HostCapability } from "@luke/settings";
import type { MicrophoneRoute, MicrophoneStatus } from "@luke/settings/microphone";
import type { NotificationsStatus } from "@luke/settings/settings-controls";
import type { BuildCommit, UpdateSnapshot } from "@luke/settings/update";
import type { AppSettings } from "@luke/settings/wire";
import { EXCESS_KEYS, keepIdentity, type UnparsedWireValue } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Equal, Result, Schema } from "effect";
import type { MacCommandAsk } from "./mac-command-ask.js";

export type { MacCommandAsk } from "./mac-command-ask.js";

/**
 * The launch profiles a window answers to. A fixture run stages the panel's
 * Tasks tab over a synthetic task, or over its synthetic coding agent and
 * that agent's tabs; or a synthetic account signed in, on a page of
 * Settings, on Admin, on Automations, or with its Inbox and its own page
 * filled. Any other word — the default included — stages nothing.
 */
export const RUN_PROFILE = {
  IDLE: "idle",
  /** The panel's Tasks tab, opened at launch over a synthetic task. */
  TASKS: "tasks",
  /** The same task mid-call, opened at launch on the transcript of what was said on its calls. */
  TASKS_TRANSCRIPT: "tasks-transcript",
  /** The same task mid-call, opened at launch on the work its agent did on its calls. */
  TASKS_WORK: "tasks-work",
  /** The same task beside its coding agent, opened at launch on its plan, whose words hold comment threads: one answered, one its agent started, one on a whole block, and one resolved. */
  TASKS_COMMENTS: "tasks-comments",
  /** A synthetic account signed in, its tasks holding Inbox items: an ask of each kind, a form, a notice with code, a long thread, an answered item, and a closed one. */
  INBOX: "inbox",
  /** Channels on, signed in as a member of a synthetic Luke workspace whose channels hold threads of every kind (`channels-fixture.ts`). */
  CHANNELS: "channels",
  /** The same workspace's channels, read as the member's teammate. */
  CHANNELS_TEAMMATE: "channels-teammate",
  /** The same account and items, its tasks assigned to it and its agents at work, which its own page lists. */
  PERSON: "person",
  /** The same task on its coding agent, its Pull request tab beside it: checks, reviews, and a merge queued. */
  AGENT_PULL_REQUEST: "agent-pull-request",
  /** The same agent and Pull request tab, the agent's turn long enough that its transcript scrolls. */
  AGENT_TRANSCRIPT: "agent-transcript",
  /** The same agent as an orchestrator days into its run, its transcript thousands of entries long and written to while it is open. */
  AGENT_LONG_RUN: "agent-long-run",
  /** The same agent, its Pull request tab on the checks. */
  AGENT_CHECKS: "agent-checks",
  /** The same agent, its Pull request tab on Files changed. */
  AGENT_FILES: "agent-files",
  /** The same agent, its Pull request tab on Chapters. */
  AGENT_CHAPTERS: "agent-chapters",
  /** The same agent beside a file of its repository opened in a tab of its own. */
  AGENT_FILE: "agent-file",
  /** The same agent beside its Terminal, attached to a shell: one profile per state the tab draws. */
  AGENT_TERMINAL: "agent-terminal",
  AGENT_TERMINAL_CONNECTING: "agent-terminal-connecting",
  AGENT_TERMINAL_RECONNECTING: "agent-terminal-reconnecting",
  AGENT_TERMINAL_IDLE: "agent-terminal-idle",
  AGENT_TERMINAL_EXITED: "agent-terminal-exited",
  AGENT_TERMINAL_STOPPED: "agent-terminal-stopped",
  AGENT_TERMINAL_STARTING: "agent-terminal-starting",
  AGENT_TERMINAL_UNREACHABLE: "agent-terminal-unreachable",
  /** The same agent beside a page it showed, open in a tab of its own. */
  AGENT_PAGE: "agent-page",
  /** A synthetic account signed in, Settings opened at launch on its Account page. */
  SETTINGS_ACCOUNT: "settings-account",
  /** The same account, Settings on its team's workspace: its members and an invitation waiting. */
  SETTINGS_WORKSPACE: "settings-workspace",
  /** The same account, Settings on Agents: its Claude plan connected and its ChatGPT sign-in expired. */
  SETTINGS_AGENTS: "settings-agents",
  /** The same account, Settings on Hosts: a server online, one to upgrade, and one offline. */
  SETTINGS_HOSTS: "settings-hosts",
  /** The same account, Settings on Integrations: some connected, some with their sign-in expired. */
  SETTINGS_INTEGRATIONS: "settings-integrations",
  /** The same account, Settings on Skills: its team's and its own. */
  SETTINGS_SKILLS: "settings-skills",
  /** The same account, Settings on its team's memory. */
  SETTINGS_MEMORY: "settings-memory",
  /** The same account, an admin, opened at launch on Admin's Overview. */
  ADMIN: "admin",
  /** The same account, opened at launch on its Automations: three, the last run of one failed. */
  AUTOMATIONS: "automations",
  /** The same account on one automation's editor, its runs beside it. */
  AUTOMATIONS_EDITOR: "automations-editor",
  /** The same account on the automation whose run failed, that run marked among its runs. */
  AUTOMATIONS_RUNS: "automations-runs",
} as const;

export type RunProfile = (typeof RUN_PROFILE)[keyof typeof RUN_PROFILE];

/**
 * What this launch is, as every window is told it and no event ever changes.
 */
interface AppRunFacts {
  /** The `--profile` argument as given, which is {@link RUN_PROFILE.IDLE} when absent. */
  profile: string;
  packaged: boolean;
  platform: string;
  /** What this platform offers, which every control of a platform feature is drawn by. */
  capabilities: readonly HostCapability[];
  appVersion: string;
  /** The commit the build was cut from, for the Updates row to name. */
  commit?: BuildCommit;
  captureMode: boolean;
  fixtureMode: boolean;
  accountRequired: boolean;
}

export interface AppAudioSlice {
  microphoneStatus: MicrophoneStatus;
  microphoneRoute?: MicrophoneRoute;
}

/**
 * What the host answers about recording: whether this run may record, and
 * the signed-in account a recording is filed under, by its opaque id with the
 * name and email the person is shown by. All three are absent while signed
 * out, and are read off one snapshot of the session, so they never name two
 * accounts at once.
 */
export interface SessionReplayState {
  permitted: boolean;
  accountId?: string;
  name?: string;
  email?: string;
}

/**
 * What this run may record, as its two halves: what the host answered, and
 * whether an action that ended the account it files under has stood recording
 * down for the rest of the run.
 */
interface AppSessionReplaySlice extends SessionReplayState {
  halted: boolean;
}

/**
 * The coding agents whose turn ended while the developer was not looking at
 * the agent's tab, each until that tab is shown: what the tab's unseen dot
 * is drawn from. Main's, because main is what watches the agents while no
 * tab does, and so a reload of the window does not lose the dots.
 */
interface AppAgentsSlice {
  unseen: readonly string[];
}

/** One inbox item waiting on the developer: the item, the agent that posted it, what it asks, and when the agent first posted it, by the service's clock. */
export interface AppInboxWaitingItem {
  id: string;
  agentId: string;
  title: string;
  postedAt: number;
  /** Whether it holds an ask open rather than being a notice; absent from a service before it, which counts it as asking. */
  asking?: boolean;
  /** The channel the thread lives in, which the sidebar counts it under; absent from a service before it. */
  channelId?: string;
}

/** One task with inbox items waiting on the developer: the task, and its open items, the latest changed first. */
export interface AppInboxTask {
  taskId: string;
  items: readonly AppInboxWaitingItem[];
}

/** One task holding inbox items, waiting or settled: the task, how many, how many are the reader's to do, and when the latest changed, by the service's clock. */
export interface AppInboxTaskHolding {
  taskId: string;
  items: number;
  /** How many of its items are questions waiting on the reader: open asks that wait on them; absent from a service before it, which the sidebar counts by the open items alone. */
  toDo?: number;
  updatedAt: number;
}

/**
 * One inbox item of an agent an automation started with no task, waiting on
 * the developer: the item as a task's are, the agent as its row names it
 * now, and the automation and repository standing where a task would; the
 * automation, and its name, null where the reader may not read it or none
 * stands, and the repository null for an agent that works in none, the
 * member's operator above all.
 */
export interface AppInboxTasklessItem extends AppInboxWaitingItem {
  /** When the item last changed, by the service's clock, which a follow of its agent's inbox is current once it holds. */
  updatedAt: number;
  /** What kind of agent posted it, which sets the member's operator apart; absent from a service before it, which reads as a coder. */
  agentKind?: AgentKind;
  agentTitle: string | null;
  agentModel: string;
  automationId: string | null;
  automationName: string | null;
  repository: string | null;
  /** The workspace the agent belongs to, whose Inbox lists the item; absent from a service before it. */
  workspaceId?: string;
  /** The account that started the agent, whom the item waits on; absent where the service does not say, when it is the reader's own. */
  startedBy?: string;
  /** The account the item waits on: the member its agent addressed it to, else its starter; absent from a service before it, which reads as waiting on `startedBy`. */
  waitsOn?: string;
}

/** One automation holding items of its runs' agents with no task, waiting or settled, as a task holding items is listed: how many, and when the latest changed; null for the agents no automation the reader may read names. */
interface AppInboxAutomationHolding {
  automationId: string | null;
  items: number;
  updatedAt: number;
}

/**
 * One agent with no task holding inbox items, waiting or settled, as a task
 * holding items is listed: how many, how many are the reader's to do, and
 * when the latest changed, by the service's clock; and the agent as an item
 * of it names it, since one whose items are all settled has none waiting.
 */
export type AppInboxAgentHolding = Pick<
  AppInboxTasklessItem,
  | "agentId"
  | "agentKind"
  | "agentTitle"
  | "agentModel"
  | "automationId"
  | "automationName"
  | "repository"
  | "workspaceId"
  | "updatedAt"
> & {
  items: number;
  toDo: number;
};

/**
 * What waits on the developer across the account's tasks, as main's own
 * read of it last answered (`@luke/host/agent-notices`): each task with an
 * open inbox item, the task whose item changed latest first. What the
 * sidebar's Inbox counts. Main's, because main holds that read whichever task is
 * open, and empty while nobody is signed in.
 */
export interface AppInboxSlice {
  waiting: readonly AppInboxTask[];
  /** Every task holding an inbox item, waiting or settled, the task whose item changed latest first: what the window's Inbox lists. */
  tasks: readonly AppInboxTaskHolding[];
  /** The open items of agents with no task in the account's workspaces, every member's, the latest changed first, as the window's Inbox lists them; those of the reader's own agents (`startedBy`) alone wait on it and count with the tasks'. */
  taskless: readonly AppInboxTasklessItem[];
  /** Every automation holding items of its agents with no task, as `tasks` lists the tasks. */
  automations: readonly AppInboxAutomationHolding[];
  /** Every agent with no task holding an inbox item, waiting or settled, as `tasks` lists the tasks; none from a service before it. */
  agents: readonly AppInboxAgentHolding[];
  /** The newest run of each of the account's own automations that failed to start lately, the latest first, which marks the window's Automations until that automation is opened. */
  failedRuns: readonly AccountFailedRun[];
}

/**
 * One read the host holds for the panel (`live-collection.ts`), as every
 * window draws it: its rows as it last answered, absent until it first
 * does, and whether it said it could not answer before it ever had. A read
 * that stops answering once it has keeps its rows, since its next answer
 * brings them up to date. What the panel reads through `useHostRead`.
 */
export interface AppHostRead<Rows> {
  rows?: Rows;
  failed?: true;
}

/** A read that has not answered yet, as every read stands as a session opens. */
export const UNREAD: AppHostRead<never> = {};

/** One value for each holder of inbox items, a plan or an agent, by its kind and then its id, never by a key built from both. */
type ByInboxHolder<Value> = {
  readonly [Kind in InboxHolderKind]: Readonly<Record<string, Value>>;
};

/**
 * Every inbox item the account reaches, settled ones of the read's window
 * among them, by the plan each is on, or its agent where that has no task,
 * each holder's in the order its own read answers them. A holder it holds
 * nothing of holds nothing now.
 */
export type AppInboxItems = ByInboxHolder<readonly InboxItem[]>;

/** The kind of holder an inbox item is on: a plan, or an agent with no task. */
type InboxHolderKind = (typeof INBOX_SCOPE_KIND)[keyof typeof INBOX_SCOPE_KIND];

/** One plan's or agent's own inbox, as the host's read of it stands: its items whole, every open one and the latest settled, once it answered. */
export type AppHolderInbox = AppHostRead<readonly InboxItem[]>;

/**
 * Each plan's or agent's inbox the host holds for the windows
 * (`scope-inbox-follow.ts`): the holders a window chose, and the few let go
 * lately, by kind and then by id, each as its own read stands. A holder
 * absent is held by nobody, so a surface draws it from the account's feed.
 */
export type AppHolderInboxes = ByInboxHolder<AppHolderInbox>;

/** No holder's inbox held, as the host stands before any window chooses one and after the session ends. */
export const NO_HOLDER_INBOXES: AppHolderInboxes = {
  [INBOX_SCOPE_KIND.PLAN]: {},
  [INBOX_SCOPE_KIND.AGENT]: {},
};

/** What pages stand on: a task, or an agent with no task. */
type PageOwnerKind = (typeof PAGE_OWNER)[keyof typeof PAGE_OWNER];

/** One task's or agent's pages, as the host's read of them stands: each page by its newest version, the most recently written first, once it answered. */
export type AppHolderPages = AppHostRead<readonly PageLine[]>;

/**
 * Each task's or agent's pages the host holds for the windows
 * (`compose-tasks.ts`): those a window chose, and the few let go lately, by
 * what they stand on and then its id, each as its own read stands. One
 * absent is held by nobody.
 */
export type AppPages = {
  readonly [Kind in PageOwnerKind]: Readonly<Record<string, AppHolderPages>>;
};

/** No pages held, as the host stands before any window chooses a task or an agent and after the session ends. */
export const NO_PAGES: AppPages = { [PAGE_OWNER.TASK]: {}, [PAGE_OWNER.AGENT]: {} };

/**
 * Each workspace's channels the host holds for the windows
 * (`channel-follow.ts`): the workspaces a window lists or names, and the few
 * let go lately, by id, each as its own read stands, its open channels by
 * name and its archived ones the latest archived first.
 */
export type AppWorkspaceChannels = Readonly<Record<string, AppHostRead<WorkspaceChannels>>>;

/** No workspace's channels held, as the host stands before any window lists one and after the session ends. */
export const NO_WORKSPACE_CHANNELS: AppWorkspaceChannels = {};

/** The rows of each read the host holds for the panel, by its name: a keyed read's are one key's rows. */
export interface AppHostReads {
  [LIVE_READ.INBOX_ITEMS]: AppInboxItems;
  [LIVE_READ.HOLDER_INBOX]: readonly InboxItem[];
  [LIVE_READ.PAGES]: readonly PageLine[];
  [LIVE_READ.CHANNELS]: WorkspaceChannels;
}

/**
 * The commands agents asked to run on this Mac that wait on the developer's
 * answer, the earliest first, as the host holds them while Settings › This
 * Mac asks every time (`compose-mac-commands.ts`): what the panel's prompt
 * draws. Main's, because the host holds the command whichever window is
 * open, and empty wherever this platform runs no commands.
 */
interface AppMacCommandsSlice {
  asks: readonly MacCommandAsk[];
}

/**
 * What macOS answered the last notification Luke posted, which is the only
 * word Electron gives of notifications being off for Luke in System Settings:
 * unknown until one is shown or refused, and kept for the launch alone.
 */
interface AppNotificationsSlice {
  status: NotificationsStatus;
}

/**
 * Whether this machine has a network, as its platform last answered
 * (`client/network-watch.ts`): online until a probe says otherwise. An
 * answer of offline is a reliable one; online says nothing of whether the
 * service itself answers.
 */
interface AppNetworkSlice {
  online: boolean;
}

/**
 * What the signed-in account may open in the app, as the host last read it
 * from the service for that account (`account-access-client.ts`): whether
 * it is an admin, which the sidebar offers the admin dashboard by. Not while
 * nobody is signed in, for another account than the one read, or where the
 * read failed. A window draws by it and authorizes nothing:
 * the dashboard's own gate on the service decides every admin read.
 */
export interface AppAccessSlice {
  admin: boolean;
  /**
   * Whether the access is not read yet for whoever is signed in, as it is
   * for a moment after a sign-in or a launch: a window holds back on what it
   * would refuse a reader who is no admin, such as a reloaded Admin address,
   * until it is. Absent once read, a failed read among them.
   */
  pending?: true;
}

/**
 * Everything main keeps of what the host tells it and what this machine
 * answers for itself: one document, read whole and replaced a slice at a
 * time, so the state a window is handed and the state main answers a call
 * from cannot differ.
 *
 * Per-window facts — the mode, the display, the role — are deliberately not
 * here: they belong to the window they describe, the panels own them, and
 * they ride the snapshot a window is handed rather than the document.
 */
export interface AppState {
  /** 0 before any patch; +1 per applied patch, monotone and never reset. */
  readonly version: number;
  run: AppRunFacts;
  settings?: AppSettings;
  account: AccountSnapshot;
  access: AppAccessSlice;
  update: UpdateSnapshot;
  audio: AppAudioSlice;
  /**
   * The Tasks tab's named tasks as the host's reads of the service
   * hold them: the list, the one active task, and its saved document. Only
   * the panel's Tasks tab draws it.
   */
  tasks: TasksView;
  agents: AppAgentsSlice;
  inbox: AppInboxSlice;
  /** Every inbox item the account reaches, held for the signed-in session: what the window's Inbox, its search, and a person's page list. */
  [LIVE_READ.INBOX_ITEMS]: AppHostRead<AppInboxItems>;
  /** Each plan's or agent's inbox the windows chose, held while a window holds it and a while after: what a chosen item's pane, a task's Inbox tab, and an agent's page read past the feed. */
  [LIVE_READ.HOLDER_INBOX]: AppHolderInboxes;
  /** Each task's or agent's pages the windows chose, held while a window holds them and a while after: what the panel beside an Inbox item, and beside an agent's page, lists. */
  [LIVE_READ.PAGES]: AppPages;
  /** Each workspace's channels, open and archived, held while a window holds them and a while after: what the sidebar's channels, the Inbox's head, the palette, and a `#channel` chip read. */
  [LIVE_READ.CHANNELS]: AppWorkspaceChannels;
  macCommands: AppMacCommandsSlice;
  notifications: AppNotificationsSlice;
  network: AppNetworkSlice;
  sessionReplay: AppSessionReplaySlice;
}

/**
 * What one window answers for and the document cannot: whether it stands in
 * full screen, where macOS hides its traffic lights and the title bar's
 * buttons take their place. Decided in the main process by which window
 * asked, never by anything a renderer could claim about itself. Which
 * surface a window draws is not here: each role has an entry of its own
 * (`window-root.tsx`), so no reader of the document needs telling.
 */
export interface AppWindowFacts {
  fullScreen: boolean;
}

/**
 * The document as one window is handed it: every slice, and that window's own
 * facts beside them. Its first read is this window's bootstrap, and every
 * delivery after it (`AppStateDelivery`) carries what moved under a version
 * at least as high, so there is no "which arrived first" for a reader to
 * answer.
 */
export type AppStateSnapshot = AppState & { window: AppWindowFacts };

/**
 * The boundary declaration of a snapshot: what the wire cannot lie about
 * cheaply and every reader depends on. The version that orders deliveries,
 * the window facts, and the capabilities that decide which platform controls
 * stand, each one this build knows, since a bridge other than the desktop's
 * may hand them. The other slices are read by the guards of the vocabularies
 * they came from, where a reader actually uses them, so the read tolerates
 * the slices this declaration does not name rather than refusing them. The
 * read only answers yes or no: the delivered value is passed on untouched,
 * never the decoded one, which would carry only what is declared here.
 */
const appStateSnapshotSchema = Schema.Struct({
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  run: Schema.Struct({
    capabilities: Schema.Array(Schema.Literals(Object.values(HOST_CAPABILITY))),
  }),
  window: Schema.Struct({ fullScreen: Schema.Boolean }),
});

const readAppStateSnapshot = readEither(appStateSnapshotSchema, { excess: EXCESS_KEYS.DROP });

/** The boundary parse for a snapshot, as the window's bridge holds every delivery to it. */
export function isAppStateSnapshot(value: UnparsedWireValue): boolean {
  return Result.isSuccess(readAppStateSnapshot(value));
}

/** What a delivery replaces whole: every slice and the window's facts. */
type AppStateEntry = Exclude<keyof AppStateSnapshot, "version">;

/**
 * One push of the document to a window: what moved in it since the last that
 * window was handed, under the version it moved to. Each entry in `entries`
 * is replaced whole, each in `gone` is no longer held, and every entry named
 * in neither is the one the window holds. An entry that went is named in a
 * list of its own rather than as undefined, because the push is JSON and
 * JSON keeps no key whose value is undefined. A window's first delivery
 * names every entry it draws.
 */
export interface AppStateDelivery {
  readonly version: number;
  readonly entries: { readonly [Entry in AppStateEntry]?: AppStateSnapshot[Entry] };
  readonly gone?: readonly AppStateEntry[];
  /** Each holder of the account's feed that moved since the window's last delivery, whole, one gone as null, in place of the feed's entry, where the window held its rows and still does. */
  readonly inboxHolders?: InboxHoldersMoved<readonly InboxItem[]>;
  /** Each held inbox that moved since the window's last delivery, its read whole, one let go as null, in place of the held inboxes' entry, where the window held the entry. */
  readonly holderInboxes?: InboxHoldersMoved<AppHolderInbox>;
}

/** The holders that moved, by kind: each whole, or null where it is gone, which an empty value is not. */
type InboxHoldersMoved<Value extends object> = ByInboxHolder<Value | null>;

/**
 * Each holder that moved from `before` to `after`, whole, and each gone as
 * null; none where none moved. Note that a change crosses as the holders
 * it moved, since the largest workspace's feed is megabytes, a held inbox
 * is a task's whole, and a change moves one holder's. A holder is compared
 * by reference alone, because the document keeps the identity of every
 * holder a patch did not move, so one that is not the very value sent is
 * one that moved.
 */
function inboxHoldersMoved<Value extends object>(
  before: ByInboxHolder<Value>,
  after: ByInboxHolder<Value>,
): InboxHoldersMoved<Value> | undefined {
  const ofKind = (kind: InboxHolderKind) =>
    Object.fromEntries([
      ...Object.entries(after[kind]).filter(([id, value]) => before[kind][id] !== value),
      ...Object.keys(before[kind])
        .filter((id) => !Object.hasOwn(after[kind], id))
        .map((id) => [id, null]),
    ]);
  const patch = {
    [INBOX_SCOPE_KIND.PLAN]: ofKind(INBOX_SCOPE_KIND.PLAN),
    [INBOX_SCOPE_KIND.AGENT]: ofKind(INBOX_SCOPE_KIND.AGENT),
  };
  return Object.values(patch).some((holders) => Object.keys(holders).length > 0)
    ? patch
    : undefined;
}

/** The holders once `patch` lands on `held`: each moved laid in, keeping what of it did not move, each gone dropped, and every other the very value held. */
function withInboxHoldersMoved<Value extends object>(
  held: ByInboxHolder<Value> | undefined,
  patch: InboxHoldersMoved<Value>,
): ByInboxHolder<Value> {
  const ofKind = (kind: InboxHolderKind) => {
    const next: Record<string, Value> = { ...held?.[kind] };
    for (const [id, value] of Object.entries(patch[kind])) {
      const was = next[id];
      if (value === null) Reflect.deleteProperty(next, id);
      else next[id] = was === undefined ? value : keepIdentity(was, value);
    }
    return next;
  };
  return {
    [INBOX_SCOPE_KIND.PLAN]: ofKind(INBOX_SCOPE_KIND.PLAN),
    [INBOX_SCOPE_KIND.AGENT]: ofKind(INBOX_SCOPE_KIND.AGENT),
  };
}

/** Each holder of the account's feed that moved from `sent` to `next`; none where either holds no rows, which crosses whole. */
function inboxHoldersPatch(
  sent: AppHostRead<AppInboxItems> | undefined,
  next: AppHostRead<AppInboxItems> | undefined,
): InboxHoldersMoved<readonly InboxItem[]> | undefined {
  const [before, after] = [sent?.rows, next?.rows];
  return before === undefined || after === undefined ? undefined : inboxHoldersMoved(before, after);
}

/**
 * The delivery that brings a window holding `sent` to `next`, or none where
 * nothing it is handed moved. Note that the document keeps the identity of
 * every part a patch did not move, so an untouched entry is answered at its
 * first comparison and only an entry that moved is walked.
 */
export function appStateDelivery(
  sent: AppStateSnapshot | undefined,
  next: AppStateSnapshot,
): AppStateDelivery | undefined {
  // SAFETY: `Object.keys` of a snapshot names its own entries and its version, the last dropped here.
  const names = [...new Set([...Object.keys(sent ?? {}), ...Object.keys(next)])].filter(
    (name) => name !== "version",
  ) as AppStateEntry[];
  const holders = inboxHoldersPatch(sent?.[LIVE_READ.INBOX_ITEMS], next[LIVE_READ.INBOX_ITEMS]);
  const heldBefore = sent?.[LIVE_READ.HOLDER_INBOX];
  const holderInboxes =
    heldBefore === undefined
      ? undefined
      : inboxHoldersMoved(heldBefore, next[LIVE_READ.HOLDER_INBOX]);
  // Note that the feed's entry, and the held inboxes', are compared by their holders alone where they cross as them, so neither whole is walked twice.
  const moved = names.filter(
    (name) =>
      (holders === undefined || name !== LIVE_READ.INBOX_ITEMS) &&
      (heldBefore === undefined || name !== LIVE_READ.HOLDER_INBOX) &&
      (sent === undefined || !Equal.equals(sent[name], next[name])),
  );
  const gone = moved.filter((name) => next[name] === undefined);
  if (
    sent !== undefined &&
    moved.length === 0 &&
    holders === undefined &&
    holderInboxes === undefined
  ) {
    return undefined;
  }
  return {
    version: next.version,
    entries: Object.fromEntries(
      moved.filter((name) => next[name] !== undefined).map((name) => [name, next[name]]),
    ),
    ...(gone.length === 0 ? undefined : { gone }),
    ...(holders === undefined ? undefined : { inboxHolders: holders }),
    ...(holderInboxes === undefined ? undefined : { holderInboxes }),
  };
}

/**
 * The document a window holds once a delivery lands on it: each entry named
 * replaced, keeping the identity of every part of it that did not move, so a
 * memo keyed on a part the delivery left alone still holds; each entry gone
 * held no more; and every other entry the very object held.
 */
export function withAppStateDelivery(
  held: AppStateSnapshot,
  delivery: AppStateDelivery,
): AppStateSnapshot {
  const entries = Object.fromEntries(
    Object.entries(delivery.entries).map(([name, value]) => [
      name,
      // SAFETY: a delivery's entries are keyed by the snapshot's own entry names.
      keepIdentity(held[name as AppStateEntry], value),
    ]),
  );
  const holders =
    delivery.inboxHolders === undefined
      ? undefined
      : {
          [LIVE_READ.INBOX_ITEMS]: {
            rows: withInboxHoldersMoved(held[LIVE_READ.INBOX_ITEMS].rows, delivery.inboxHolders),
          },
        };
  const holderInboxes =
    delivery.holderInboxes === undefined
      ? undefined
      : {
          [LIVE_READ.HOLDER_INBOX]: withInboxHoldersMoved(
            held[LIVE_READ.HOLDER_INBOX],
            delivery.holderInboxes,
          ),
        };
  const next: AppStateSnapshot = {
    ...held,
    ...entries,
    ...holders,
    ...holderInboxes,
    version: delivery.version,
  };
  // Note that an entry gone is held as no key at all, as the document holds it.
  for (const name of delivery.gone ?? []) Reflect.deleteProperty(next, name);
  return next;
}

/**
 * The boundary declaration of a delivery, held to the same terms as a
 * snapshot's: the version, and the window facts and capabilities where it
 * carries them, each one this build knows.
 */
const appStateDeliverySchema = Schema.Struct({
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  entries: Schema.Struct({
    run: Schema.optional(
      Schema.Struct({
        capabilities: Schema.Array(Schema.Literals(Object.values(HOST_CAPABILITY))),
      }),
    ),
    window: Schema.optional(Schema.Struct({ fullScreen: Schema.Boolean })),
  }),
  gone: Schema.optional(Schema.Array(Schema.String)),
});

const readAppStateDelivery = readEither(appStateDeliverySchema, { excess: EXCESS_KEYS.DROP });

/** The boundary parse for a delivery, as the window's push stream holds every one to it. */
export function isAppStateDelivery(value: UnparsedWireValue): boolean {
  return Result.isSuccess(readAppStateDelivery(value));
}

/**
 * What this run may record, as the renderer is handed it. Note that an
 * unpackaged run never records, whatever its bundle was built with, because
 * `pnpm start` builds the renderer in whatever shell it is run from, and one
 * left holding the release's replay key would otherwise record a development
 * run into production's project.
 */
export function sessionReplayBootstrap(
  state: Pick<AppState, "run" | "sessionReplay">,
): SessionReplayBootstrap {
  return {
    permitted: state.run.packaged && state.sessionReplay.permitted && !state.sessionReplay.halted,
    appVersion: state.run.appVersion,
    packaged: state.run.packaged,
    ...(state.sessionReplay.accountId ? { accountId: state.sessionReplay.accountId } : undefined),
    ...(state.sessionReplay.name ? { name: state.sessionReplay.name } : undefined),
    ...(state.sessionReplay.email ? { email: state.sessionReplay.email } : undefined),
  };
}

/** The access of nobody, of another account, or of a read that failed: nothing opened. */
export const NO_ACCESS: AppAccessSlice = { admin: false, pending: true };
