import type { AccountSnapshot } from "@luke/credentials/snapshot";
import type { AccountFailedRun } from "@luke/features/account-inbox-wire";
import type { AgentKind } from "@luke/features/agent-wire";
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
 * What this run may record, as its two halves: what the host answered, and
 * whether an action that ended the account it files under has stood recording
 * down for the rest of the run.
 */
interface AppSessionReplaySlice {
  permitted: boolean;
  accountId?: string;
  halted: boolean;
}

/**
 * The coding agents whose turn ended while the developer was not looking at
 * the agent's tab, each until that tab is shown: what the tab's unseen dot
 * is drawn from. Main's, because main is what watches the agents while no
 * tab does, and so a reload of the window does not lose the dots.
 */
interface AppCodingAgentsSlice {
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
  /** The newest run of each of the account's own automations that failed to start lately, the latest first, which marks the window's Automations until that automation is opened. */
  failedRuns: readonly AccountFailedRun[];
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
  codingAgents: AppCodingAgentsSlice;
  inbox: AppInboxSlice;
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
  const moved = names.filter((name) => sent === undefined || !Equal.equals(sent[name], next[name]));
  const gone = moved.filter((name) => next[name] === undefined);
  if (sent !== undefined && moved.length === 0) return undefined;
  return {
    version: next.version,
    entries: Object.fromEntries(
      moved.filter((name) => next[name] !== undefined).map((name) => [name, next[name]]),
    ),
    ...(gone.length === 0 ? undefined : { gone }),
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
  const next: AppStateSnapshot = { ...held, ...entries, version: delivery.version };
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
  };
}

/** The access of nobody, of another account, or of a read that failed: nothing opened. */
export const NO_ACCESS: AppAccessSlice = { admin: false, pending: true };
