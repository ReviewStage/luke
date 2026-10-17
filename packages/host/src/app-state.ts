import type { AccountSnapshot } from "@luke/credentials/snapshot";
import type { AccountFailedRun } from "@luke/features/account-inbox-wire";
import type { TasksView } from "@luke/features/tasks-view";
import type { SessionReplayBootstrap } from "@luke/gateway/window-session";
import { HOST_CAPABILITY, type HostCapability } from "@luke/settings";
import type { BuildCommit, UpdateSnapshot } from "@luke/settings/update";
import type { AppSettings } from "@luke/settings/wire";
import type { MicrophoneRoute, MicrophoneStatus, OutputAudioState } from "@luke/voice/audio";
import type { AvatarState } from "@luke/voice/avatar";
import type { NotificationsStatus } from "@luke/voice/settings-controls";
import type { VoiceView } from "@luke/voice/voice-view";
import { EXCESS_KEYS, type UnparsedWireValue } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Result, Schema } from "effect";

/**
 * The launch profiles a window answers to. A capture run stages a
 * conversation it has no voice window for: Luke speaking, that with the
 * Mac's output off, and both speakers heard at once; or, in any fixture run,
 * the panel's Tasks tab over a synthetic task. Any other word — the default
 * included — stages nothing.
 */
export const RUN_PROFILE = {
  IDLE: "idle",
  SPEAKING: "speaking",
  MUTED: "muted",
  DUPLEX: "duplex",
  /** The panel's Tasks tab, opened at launch over a synthetic task. */
  TASKS: "tasks",
  /** The same task, opened at launch on the whiteboard Luke drew for it. */
  TASKS_BOARD: "tasks-board",
  /** The same task mid-call, opened at launch on the transcript of what was said on its calls. */
  TASKS_TRANSCRIPT: "tasks-transcript",
  /** The same task mid-call, opened at launch on the work Luke's brain did on its calls. */
  TASKS_WORK: "tasks-work",
  /** The tasks' list, opened at launch on the window's Chat over a synthetic chat. */
  CHAT: "chat",
} as const;

export type RunProfile = (typeof RUN_PROFILE)[keyof typeof RUN_PROFILE];

/**
 * What this launch is, as every window is told it and no event ever changes —
 * save the trace gate, which is the host's answer about this run rather than
 * the launch's own argument.
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
  agentTraceEnabled: boolean;
}

export interface AppAudioSlice {
  microphoneStatus: MicrophoneStatus;
  microphoneRoute?: MicrophoneRoute;
  outputAudio?: OutputAudioState;
}

export interface AppHotkeysSlice {
  /**
   * The accelerator each key was registered as, absent where the system
   * refused one — a chord nothing can trigger must not be drawn as though it
   * works. Raw rather than labelled, because the panel draws the keys apart
   * and says the chord whole.
   */
  talk?: string;
  /**
   * Whether the talk key reports being let go of. Only a key that does can
   * hold a turn open for as long as it is down; the fallback can only toggle
   * one, and the panel says which of the two the developer actually has.
   */
  talkHeld: boolean;
  stop?: string;
}

interface AppVoiceSlice {
  /**
   * The live conversation as the voice window last reported it, so a panel
   * that opens mid-exchange draws the exchange rather than an idle voice.
   * Absent until that window has reported once, and always in a fixture or
   * capture run, which raises no voice window.
   *
   * The loudness beside it is deliberately not here. It is a reading taken
   * twenty times a second that expires in fifty milliseconds, so nothing
   * bootstraps from it and no version of this document could usefully carry
   * one: it travels on `app:voice-level-changed` as the stream it is.
   */
  view?: VoiceView;
  /**
   * Luke's avatar on the call, as the panel reports it: what puts the video
   * tile at the top of the Call tab and what the tile draws. Main's rather than
   * the voice window's, so a replaced voice window leaves it standing.
   */
  avatar: AvatarState;
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
}

/** One task with inbox items waiting on the developer: the task, and its open items, the latest changed first. */
export interface AppInboxTask {
  taskId: string;
  items: readonly AppInboxWaitingItem[];
}

/** One task holding inbox items, waiting or settled: the task, how many, and when the latest changed, by the service's clock. */
export interface AppInboxTaskHolding {
  taskId: string;
  items: number;
  updatedAt: number;
}

/**
 * One inbox item of an agent an automation started with no task, waiting on
 * the developer: the item as a task's are, the agent as its row names it
 * now, and the automation and repository standing where a task would; the
 * automation, and its name, null where the reader may not read it or none
 * stands.
 */
export interface AppInboxTasklessItem extends AppInboxWaitingItem {
  agentTitle: string | null;
  agentModel: string;
  automationId: string | null;
  automationName: string | null;
  repository: string;
  /** The workspace the agent belongs to, whose Inbox lists the item; absent from a service before it. */
  workspaceId?: string;
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
 * sidebar's Inbox counts, and what an item's toast is withdrawn by once it
 * no longer waits. Main's, because main holds that read whichever task is
 * open, and empty while nobody is signed in.
 */
export interface AppInboxSlice {
  waiting: readonly AppInboxTask[];
  /** Every task holding an inbox item, waiting or settled, the task whose item changed latest first: what the window's Inbox lists. */
  tasks: readonly AppInboxTaskHolding[];
  /** The open items of agents with no task, the latest changed first, which wait beside the tasks' and count with them. */
  taskless: readonly AppInboxTasklessItem[];
  /** Every automation holding items of its agents with no task, as `tasks` lists the tasks. */
  automations: readonly AppInboxAutomationHolding[];
  /** The newest run of each of the account's own automations that failed to start lately, the latest first, which marks the window's Automations until that automation is opened. */
  failedRuns: readonly AccountFailedRun[];
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
  update: UpdateSnapshot;
  audio: AppAudioSlice;
  hotkeys: AppHotkeysSlice;
  voice: AppVoiceSlice;
  /**
   * The Tasks tab's named tasks as the host's reads of the service
   * hold them: the list, the one active task, and its saved document. Only
   * the panel's Tasks tab draws it, and the active task is the one a voice
   * session and the talk key bind to.
   */
  tasks: TasksView;
  codingAgents: AppCodingAgentsSlice;
  inbox: AppInboxSlice;
  notifications: AppNotificationsSlice;
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
 * facts beside them. The first delivery is this window's bootstrap and every
 * later one carries a version at least as high, so there is no "which arrived
 * first" for a reader to answer.
 */
export type AppStateSnapshot = AppState & { window: AppWindowFacts };

/**
 * The boundary declaration of a snapshot: what the wire cannot lie about
 * cheaply and every reader depends on. The version that orders deliveries,
 * the window facts, and the capabilities that decide which platform controls
 * stand, each one this build knows, since a bridge other than the desktop's
 * may hand them. The other slices are read by the guards of the vocabularies
 * they came from, where a reader actually uses them, so the read drops what
 * this declaration does not name rather than refusing it.
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

/** What this run may record, as the renderer is handed it. */
export function sessionReplayBootstrap(
  state: Pick<AppState, "run" | "sessionReplay">,
): SessionReplayBootstrap {
  return {
    permitted: state.sessionReplay.permitted && !state.sessionReplay.halted,
    appVersion: state.run.appVersion,
    ...(state.sessionReplay.accountId ? { accountId: state.sessionReplay.accountId } : undefined),
  };
}
