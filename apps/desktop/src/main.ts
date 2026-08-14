import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  attentionSpeechFromReviews,
  CompositeSessionProviderAdapter,
  DEFAULT_PANEL_FORM_FACTOR,
  fixtureSnapshot,
  InMemorySessionRegistry,
  ISSUE_ACTION_KIND,
  isControllableAdapter,
  isMessageCapableAdapter,
  isPanelFormFactor,
  isRealtimeVoice,
  isRealtimeVoiceSpeed,
  issueCommentText,
  isWorkspaceAgentCapableAdapter,
  isWorkspaceCapableAdapter,
  type NativeNotchGeometry,
  normalizeObservedWorkspaceProjects,
  normalizeTrackedIssue,
  type ObservedWorkspaceProject,
  type PanelFormFactor,
  PROVIDER_CONTROL_RESULT_STATUS,
  PROVIDER_MESSAGE_RESULT_STATUS,
  type ProviderControlResult,
  type ProviderMessageResult,
  type ProviderWorkspaceResult,
  positionNotchWindow,
  realtimeMintExplanation,
  resolveNotchGeometry,
  SessionAttentionReviewer,
  type SessionIdentity,
  type SessionProviderAdapter,
  sessionMessageText,
  TRACKER_ACTION_RESULT_STATUS,
  type TrackedIssue,
  type TrackerActionResult,
  workspaceNameText,
} from "@sidecar/core";

import {
  app,
  BrowserWindow,
  type Display,
  globalShortcut,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  powerMonitor,
  safeStorage,
  screen,
  session,
  shell,
  systemPreferences,
  Tray,
} from "electron";
import { ClaudeCodeSessionAdapter } from "./claude-code-adapter";
import { CodexSessionAdapter } from "./codex-adapter";
import { ConductorSessionAdapter } from "./conductor-adapter";
import { CopilotSessionAdapter } from "./copilot-adapter";
import { CURSOR_PROVIDER, CursorSessionAdapter } from "./cursor-adapter";
import { CursorLocalSessionAdapter } from "./cursor-local-adapter";
import { DevinSessionAdapter } from "./devin-adapter";
import { feedbackDeliveryFromEnvironment } from "./feedback-delivery";
import { JulesSessionAdapter } from "./jules-adapter";
import { LinearIssueTracker } from "./linear-tracker";
import { readMacScreenGeometry } from "./macos-screen-geometry";
import { keepWindowStationary } from "./macos-stationary-window";
import { MediaDuckController } from "./media-duck";
import { openAiAttentionEvaluatorFromEnvironment } from "./openai-attention-evaluator";
import {
  openAiRealtimeCredentialsFromEnvironment,
  unavailableRealtimeDiagnostics,
} from "./openai-realtime-credentials";
import { OpenCodeSessionAdapter } from "./opencode-adapter";
import { OutputVolumeWatcher } from "./output-volume";
import { SettingsStore } from "./settings-store";
import {
  type AppBootstrap,
  type AppSettings,
  channels,
  type DisplayDiagnostic,
  type MicrophoneStatus,
  type OutputAudioState,
  SESSION_OPEN_RESULT_STATUS,
  type SessionOpenResult,
  type SettingsUpdateResult,
  type WindowMode,
} from "./shared/contracts";
import {
  CREDENTIAL_PROVIDER_ID,
  CREDENTIAL_PROVIDERS,
  type CredentialProviderId,
  isCredentialProviderId,
} from "./shared/credential-providers";
import {
  FEEDBACK_KIND,
  FEEDBACK_LIFECYCLE_EVENT,
  type FeedbackResult,
  feedbackSubmission,
  isFeedbackKind,
} from "./shared/feedback";
import {
  askHotkeyCandidates,
  askHotkeyReport,
  parseVoiceHotkey,
  VOICE_HOTKEY_ABSENCE,
  type VoiceHotkeyAbsence,
  voiceHotkeyCandidates,
  voiceHotkeyReport,
} from "./shared/voice-hotkey";
import { TalkKeyWatcher } from "./talk-key";

const captureOutput = argumentValue("--capture-evidence");
const profile = argumentValue("--profile") ?? "idle";
const fixtureName = argumentValue("--fixture");
// Evidence only: the peek answers a pointer and the slot answers a press on a
// link, neither of which a capture run has any way to produce, so both can be
// asked for directly.
const startPeeked = process.argv.includes("--peek");
const startInSlot = process.argv.includes("--slot");
const fixture = fixtureSnapshot(fixtureName ?? "smoke");
const captureMode = captureOutput !== undefined;
// `--fixture` is enough on its own to make a run deterministic: the panel renders
// the fixture snapshot and no provider is observed. Capture runs always imply it.
const fixtureMode = captureMode || fixtureName !== undefined;
const SESSION_REFRESH_INTERVAL_MS = 5_000;
const sessionRegistry = new InMemorySessionRegistry();
// `directory` and the cipher are read lazily so the store can be declared before
// the Electron app is ready.
const settingsStore = new SettingsStore({
  directory: () => app.getPath("userData"),
  cipher: {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plainText) => safeStorage.encryptString(plainText),
    decrypt: (cipherText) => safeStorage.decryptString(cipherText),
  },
});
const conductorAdapter = new ConductorSessionAdapter({
  readApiKey: () => settingsStore.readApiKey(CREDENTIAL_PROVIDER_ID.CONDUCTOR),
});
const copilotAdapter = new CopilotSessionAdapter({
  readApiKey: () => settingsStore.readApiKey(CREDENTIAL_PROVIDER_ID.COPILOT),
});
// Cursor runs sessions in two places: on this machine, which needs no
// credential and is observed from the transcripts Cursor writes for itself, and
// in its cloud, which needs a key. They are one provider wherever they ran, so
// they are observed as one adapter — a provider's sessions are replaced in a
// single commit, and two adapters sharing an id would retire each other's.
const cursorAdapter = new CompositeSessionProviderAdapter({
  provider: CURSOR_PROVIDER,
  adapters: [
    new CursorLocalSessionAdapter(),
    new CursorSessionAdapter({
      readApiKey: () => settingsStore.readApiKey(CREDENTIAL_PROVIDER_ID.CURSOR),
    }),
  ],
});
const devinAdapter = new DevinSessionAdapter({
  readApiKey: () => settingsStore.readApiKey(CREDENTIAL_PROVIDER_ID.DEVIN),
});
const julesAdapter = new JulesSessionAdapter({
  readApiKey: () => settingsStore.readApiKey(CREDENTIAL_PROVIDER_ID.JULES),
});
// Saving a key affects only the provider it belongs to, so this maps each
// credential to the one observer that reads it.
const adapterByCredentialProvider: ReadonlyMap<CredentialProviderId, SessionProviderAdapter> =
  new Map<CredentialProviderId, SessionProviderAdapter>([
    [CREDENTIAL_PROVIDER_ID.CONDUCTOR, conductorAdapter],
    [CREDENTIAL_PROVIDER_ID.COPILOT, copilotAdapter],
    [CREDENTIAL_PROVIDER_ID.CURSOR, cursorAdapter],
    [CREDENTIAL_PROVIDER_ID.DEVIN, devinAdapter],
    [CREDENTIAL_PROVIDER_ID.JULES, julesAdapter],
  ]);
const sessionAdapters = [
  new ClaudeCodeSessionAdapter(),
  new CodexSessionAdapter(),
  conductorAdapter,
  copilotAdapter,
  cursorAdapter,
  devinAdapter,
  julesAdapter,
  new OpenCodeSessionAdapter(),
] as const;
// The issue tracker is not a session provider: its issues feed the voice
// roster rather than the registry, so it stands beside the adapters rather
// than among them.
const linearTracker = new LinearIssueTracker({
  readApiKey: () => settingsStore.readApiKey(CREDENTIAL_PROVIDER_ID.LINEAR),
});
const issueTrackers = [linearTracker] as const;
/** A board changes at the pace of hands, not of models; a minute is current. */
const ISSUE_REFRESH_INTERVAL_MS = 60_000;
/** The latest roster, which is also what every spoken act is validated against. */
let trackedIssues: readonly TrackedIssue[] | undefined;
let issueRefreshTimer: NodeJS.Timeout | undefined;
let issueRefreshRunning = false;
/**
 * Whether a pass was asked for while one was running. A key save or clear
 * must reach the roster on the very next pass, not be swallowed by an
 * interval tick that happened to be in flight — so the guard queues instead
 * of dropping.
 */
let issueRefreshQueued = false;
// A fixture run must stay deterministic and credential-free, so it never builds
// an evaluator — not just capture runs.
const attentionEvaluator = fixtureMode ? undefined : openAiAttentionEvaluatorFromEnvironment();
const attentionReviewer = attentionEvaluator
  ? new SessionAttentionReviewer({
      evaluator: attentionEvaluator,
      currentSession: (identity) => sessionRegistry.get(identity),
    })
  : undefined;
// A fixture run stays credential-free for the same reason attention review
// does: evidence must be reproducible without a key and without a network.
const realtimeCredentials = fixtureMode ? undefined : openAiRealtimeCredentialsFromEnvironment();
// Quiets Music and Spotify while a spoken exchange is live. It lives here
// rather than in the renderer because letting the players back up must survive
// anything the renderer does — and only this process may run a helper.
const mediaDuck = new MediaDuckController();
const feedbackDelivery = feedbackDeliveryFromEnvironment();
/**
 * The output's switches as last read, and the helper that reads them. The
 * state lives here rather than in the renderer so bootstrap can carry the
 * answer a push has already delivered; `undefined` is "cannot be read", which
 * the renderer must draw as audible.
 */
let outputAudio: OutputAudioState | undefined;
let outputVolumeWatcher: OutputVolumeWatcher | undefined;

/**
 * Starts watching whether the Mac's output would let Luke be heard. Not in a
 * fixture or capture run: evidence must not read the machine it happens to
 * run on, and a fixture run has no voice to go unheard — the muted evidence
 * profile asks the renderer for the state directly instead.
 */
function startOutputVolumeWatch(): void {
  if (fixtureMode) return;
  const send = (state: OutputAudioState | undefined) => {
    outputAudio = state;
    // Every display's panel captions the same voice, so every one is told.
    for (const window of panelWindows.values()) {
      window.webContents.send(channels.outputAudioChanged, state);
    }
  };
  outputVolumeWatcher = new OutputVolumeWatcher({
    onState: send,
    onUnavailable: () => send(undefined),
  });
  if (!outputVolumeWatcher.start()) outputVolumeWatcher = undefined;
}

let voiceHotkey: string | undefined;
/**
 * The chord the user chose over the defaults, if any. Read from the settings
 * file before the key is first registered, and moved by the settings panel
 * afterwards; the defaults stay behind it as fallbacks either way.
 */
let chosenVoiceHotkey: string | undefined;
let talkKeyWatcher: TalkKeyWatcher | undefined;
/**
 * Whether the key reports being let go of. The helper does and the Electron
 * fallback cannot, and that is the difference between holding a turn and
 * toggling one — so the panel is told which key it actually has rather than
 * describing the one it hoped for.
 */
let voiceHotkeyHeld = true;
// Only read when no key was registered, so it starts at the case that needs no
// explaining beyond itself: every candidate was refused.
let voiceHotkeyAbsence: VoiceHotkeyAbsence = VOICE_HOTKEY_ABSENCE.ALREADY_OWNED;

/**
 * Registers the talk key with the system so it answers from whatever app is
 * frontmost. Electron reports only the press and never the release, so the key
 * is a toggle rather than a hold — which is also what lets one key interrupt a
 * reply that is already playing.
 */
function registerVoiceHotkey(): void {
  if (captureMode) {
    voiceHotkeyAbsence = VOICE_HOTKEY_ABSENCE.CAPTURE_RUN;
    reportVoiceHotkey();
    return;
  }
  // Taking a system-wide key for a feature that cannot run would make every
  // press somewhere else in macOS do nothing, visibly.
  if (!realtimeCredentials) {
    voiceHotkeyAbsence = VOICE_HOTKEY_ABSENCE.NO_CREDENTIAL;
    reportVoiceHotkey();
    return;
  }
  // The helper first, because it is the only one of the two that reports the
  // key being let go of, and a key you hold is the whole point.
  talkKeyWatcher = new TalkKeyWatcher({
    onPress: () => voiceHostWindow()?.webContents.send(channels.voiceHotkeyPress),
    onRelease: () => voiceHostWindow()?.webContents.send(channels.voiceHotkeyRelease),
    onRegistered: (accelerator) => {
      voiceHotkey = accelerator;
      reportVoiceHotkey();
      sendVoiceHotkey();
    },
    onUnavailable: () => {
      talkKeyWatcher = undefined;
      registerToggleHotkey();
      reportVoiceHotkey();
      sendVoiceHotkey();
    },
  });
  if (talkKeyWatcher.start(voiceHotkeyCandidates(chosenVoiceHotkey))) return;
  talkKeyWatcher = undefined;
  registerToggleHotkey();
  reportVoiceHotkey();
}

/**
 * The talk key without a release: a press toggles the turn instead of holding
 * it. This is what answers when the helper cannot — another platform, a build
 * without it — and it is a lesser thing rather than a broken one, so it is
 * worth standing up rather than leaving the user with no key at all.
 */
function registerToggleHotkey(): void {
  for (const accelerator of voiceHotkeyCandidates(chosenVoiceHotkey)) {
    const registered = globalShortcut.register(accelerator, () => {
      voiceHostWindow()?.webContents.send(channels.voiceHotkeyPress);
      // A toggle has only the one edge, so it reports a release immediately and
      // one short enough to read as a tap. Every press then latches or ends a
      // turn, which is the old behaviour exactly.
      voiceHostWindow()?.webContents.send(channels.voiceHotkeyRelease);
    });
    if (!registered) continue;
    voiceHotkey = accelerator;
    voiceHotkeyHeld = false;
    return;
  }
  voiceHotkeyAbsence = VOICE_HOTKEY_ABSENCE.ALREADY_OWNED;
}

let askHotkey: string | undefined;
let chosenAskHotkey: string | undefined;

/**
 * Registers the key that summons the ask field from whatever app is frontmost,
 * on the talk key's own terms: never during a capture run, and never for a
 * conversation that cannot open — a system-wide key that answers nothing is a
 * key taken from every other app for no reason. Electron's registration is
 * enough here, because a summons has no release edge to hear.
 *
 * The press does two things in order: stands the panel up focused, then asks
 * the renderer to put the caret in the field — or, when the caret is already
 * there, the renderer reads the same press as the dismissal, so one key
 * summons and puts away like every launcher does. The panel that answers is
 * the voice host's, the same window every other app-level ask lands in.
 */
function registerAskHotkey(): void {
  // Re-runnable: moving the talk key lets everything go and registers afresh,
  // and a key that could not be re-taken must not still be claimed anywhere.
  askHotkey = undefined;
  if (captureMode) {
    process.stderr.write(`${askHotkeyReport(undefined, VOICE_HOTKEY_ABSENCE.CAPTURE_RUN)}\n`);
    return;
  }
  if (!realtimeCredentials) {
    process.stderr.write(`${askHotkeyReport(undefined, VOICE_HOTKEY_ABSENCE.NO_CREDENTIAL)}\n`);
    return;
  }
  // Every chord the talk key could sit on is taken, not just the one it has
  // announced: its helper falls back through its own candidates after this
  // runs, so a chord it merely might take is already not the ask key's to
  // have — the two Luke keys must never compete.
  for (const accelerator of askHotkeyCandidates(chosenAskHotkey, [
    ...voiceHotkeyCandidates(chosenVoiceHotkey),
    voiceHotkey,
  ])) {
    const registered = globalShortcut.register(accelerator, () => {
      const host = voiceHostWindow();
      const displayId = host ? displayIdFor(host.webContents) : undefined;
      if (displayId === undefined) return;
      setWindowMode(displayId, "expanded", true);
      host?.webContents.send(channels.lifecycle, "ask:focus");
    });
    if (!registered) continue;
    askHotkey = accelerator;
    process.stderr.write(`${askHotkeyReport(askHotkey, VOICE_HOTKEY_ABSENCE.ALREADY_OWNED)}\n`);
    return;
  }
  process.stderr.write(`${askHotkeyReport(undefined, VOICE_HOTKEY_ABSENCE.ALREADY_OWNED)}\n`);
}

/**
 * Tells every renderer the ask key it should be teaching, whenever that
 * changes. The raw accelerator travels, as in bootstrap: the renderer needs
 * both its spellings, and an absent key clears the hint rather than leaving a
 * keycap up for a chord that answers nothing.
 */
function sendAskHotkey(): void {
  for (const window of panelWindows.values()) {
    window.webContents.send(channels.askHotkeyChanged, askHotkey);
  }
}

/**
 * Moves the ask key to whatever `chosenAskHotkey` now says, while the app is
 * running. Only the ask key's own chord is let go of — the talk key's
 * registration must not flicker for a change that is none of its business —
 * and unlike the talk key there is no helper exit to wait for: Electron
 * releases a chord the moment it is asked to.
 */
function applyAskHotkey(): void {
  if (askHotkey) globalShortcut.unregister(askHotkey);
  registerAskHotkey();
  sendAskHotkey();
}

/**
 * Tells every renderer the key it should be showing, whenever that changes.
 * The accelerator rather than its label, on the ask key's terms: the renderer
 * draws the chord as its separate keys and says it as one word, and only the
 * accelerator produces both.
 */
function sendVoiceHotkey(): void {
  for (const window of panelWindows.values()) {
    window.webContents.send(channels.voiceHotkeyChanged, {
      ...(voiceHotkey ? { hotkey: voiceHotkey } : {}),
      held: voiceHotkeyHeld,
    });
  }
}

function reportVoiceHotkey(): void {
  process.stderr.write(`${voiceHotkeyReport(voiceHotkey, voiceHotkeyAbsence)}\n`);
}

/**
 * Moves the talk key to whatever `chosenVoiceHotkey` now says, while the app
 * is running. The old key is let go of in full before the new one is asked
 * for, so the two can never race for the same chord — and letting everything
 * go takes the ask key down with it, because `unregisterAll` is exactly that,
 * so the ask key is registered afresh once the talk key has settled. Letting
 * go means waiting: the system releases the old helper's chord when its
 * process exits, not when the kill is asked for, and the defaults sit in both
 * helpers' candidate lists — a successor that starts too early is refused the
 * very fallback it was promised. The panel keeps showing the old key until
 * the new one actually answers: the helper announces its own registration
 * over stdout, and every path without a helper is decided by the time
 * `registerVoiceHotkey` returns.
 */
async function applyVoiceHotkey(): Promise<void> {
  const released = talkKeyWatcher?.stop();
  talkKeyWatcher = undefined;
  globalShortcut.unregisterAll();
  await released;
  voiceHotkey = undefined;
  voiceHotkeyHeld = true;
  voiceHotkeyAbsence = VOICE_HOTKEY_ABSENCE.ALREADY_OWNED;
  registerVoiceHotkey();
  if (!talkKeyWatcher) sendVoiceHotkey();
  // The ask key went down with `unregisterAll`, and the chord it can have may
  // itself have changed — the talk key may have moved onto or off of one of
  // its candidates — so it is re-taken now and the panel told what it teaches.
  registerAskHotkey();
  sendAskHotkey();
}

/** The mode every window is born in; only the dev and capture flags change it. */
const initialWindowMode: WindowMode = captureMode
  ? process.argv.includes("--compact")
    ? "compact"
    : "expanded"
  : process.argv.includes("--expanded")
    ? "expanded"
    : "compact";
/**
 * One panel window per display Luke stands on, keyed by the display's id, each
 * with its own mode: a panel opened on one monitor must not resize the capsule
 * on another. The collapse timers ride the same key, because a collapse is a
 * single window's affair.
 */
const panelWindows = new Map<number, BrowserWindow>();
const windowModes = new Map<number, WindowMode>();
const collapseTimers = new Map<number, NodeJS.Timeout>();
let tray: Tray | undefined;
/**
 * Whether Luke stands on every display, mirroring the settings file the way
 * the minter mirrors the chosen voice: read once before any panel exists,
 * updated by the same handler that stores a new choice, so every layout
 * decision stays synchronous. Off means the system's main display alone.
 */
let showOnAllDisplays = false;
/** The chosen form for displays without a housing, mirrored the same way. */
let panelFormFactor: PanelFormFactor = DEFAULT_PANEL_FORM_FACTOR;
let nativeScreens = new Map<number, NativeNotchGeometry>();
let sessionRefreshTimer: NodeJS.Timeout | undefined;
let sessionRefreshRunning = false;
let attentionReviewRunning = false;
/**
 * The projects last announced to the renderer, serialized for comparison.
 * Undefined until the first announcement decides what there is to compare.
 */
let lastWorkspaceProjects: string | undefined;

/**
 * Announces where a workspace can be created whenever the offer changes. This
 * cannot ride the registry's own notifications alone: the registry only speaks
 * when the session snapshot changes, and a pass can change the project list
 * while leaving the sessions exactly as they were — a key just added with no
 * workspaces yet, a project connected but not yet worked in — so the check
 * runs on the observation cadence as well as on every commit.
 */
function broadcastWorkspaceProjects(): void {
  const projects = observedWorkspaceProjects();
  const serialized = JSON.stringify(projects);
  if (serialized === lastWorkspaceProjects) return;
  lastWorkspaceProjects = serialized;
  for (const window of panelWindows.values()) {
    window.webContents.send(channels.workspaceProjectsChanged, projects);
  }
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/**
 * Where Luke stands right now: every connected display when asked to stand on
 * all of them, the system's main display alone otherwise. A capture run stays
 * on the main display regardless, where its fixture housing is pinned.
 */
function effectiveDisplayIds(): number[] {
  if (!captureMode && showOnAllDisplays) {
    return screen.getAllDisplays().map((display) => display.id);
  }
  return [screen.getPrimaryDisplay().id];
}

function displayById(displayId: number): Display | undefined {
  return screen.getAllDisplays().find((display) => display.id === displayId);
}

function windowModeFor(displayId: number): WindowMode {
  return windowModes.get(displayId) ?? initialWindowMode;
}

function layoutFor(display: Display, mode: WindowMode) {
  return positionNotchWindow(display, mode, nativeScreens.get(display.id), panelFormFactor);
}

function displayDiagnostic(display: Display): DisplayDiagnostic {
  return {
    id: display.id,
    label: display.label || `Display ${display.id}`,
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
    notch: resolveNotchGeometry(display, nativeScreens.get(display.id), panelFormFactor),
  };
}

/**
 * The one window a spoken conversation lives in. Voice is a single thing —
 * one microphone, one reply, one face speaking — so the talk key and the
 * attention readouts go to a single renderer rather than opening one
 * conversation per display: the main display's window when Luke stands there,
 * else the first window standing anywhere.
 */
function voiceHostWindow(): BrowserWindow | undefined {
  const primary = panelWindows.get(screen.getPrimaryDisplay().id);
  if (primary && !primary.isDestroyed()) return primary;
  for (const window of panelWindows.values()) {
    if (!window.isDestroyed()) return window;
  }
  return undefined;
}

/** The display a renderer message came from, so each window answers for itself. */
function displayIdFor(sender: Electron.WebContents): number | undefined {
  for (const [displayId, window] of panelWindows) {
    if (!window.isDestroyed() && window.webContents === sender) return displayId;
  }
  return undefined;
}

function refreshNativeGeometry(): void {
  nativeScreens = readMacScreenGeometry();
  if (captureMode) {
    const display = screen.getPrimaryDisplay();
    nativeScreens.set(display.id, {
      displayId: display.id,
      safeAreaTop: 38,
      notchWidth: 210,
      hasNotch: true,
      source: "fixture",
    });
  }
}

/**
 * Resizes without AppKit's frame animation. An animated setBounds re-lays out
 * the renderer at a new viewport width on every frame — and its duration scales
 * with the distance moved, so a 482px growth ran far longer than the panel's
 * own motion. The window now snaps to the size the mode needs and the renderer
 * animates the capsule into the panel inside it, where the viewport is constant
 * and the work stays on the compositor.
 */
function positionPanel(displayId: number): void {
  const window = panelWindows.get(displayId);
  if (!window || window.isDestroyed()) return;
  const display = displayById(displayId);
  // A window whose display has gone is the reconciler's to take down, not
  // this function's to guess a home for.
  if (!display) return;
  const layout = layoutFor(display, windowModeFor(displayId));
  window.setBounds({
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height,
  });
  window.webContents.send(channels.displayChanged, displayDiagnostic(display));
}

function positionPanels(): void {
  for (const displayId of panelWindows.keys()) positionPanel(displayId);
}

/**
 * Hands a fresh settings snapshot to every window but the one that asked —
 * that one already holds it in its reply, and must redraw from the reply
 * rather than race a broadcast. One window's change would otherwise leave
 * every other window's rows and guide describing a state the store no longer
 * holds.
 */
function broadcastSettings(settings: AppSettings, except: Electron.WebContents): void {
  for (const window of panelWindows.values()) {
    if (window.isDestroyed() || window.webContents === except) continue;
    window.webContents.send(channels.settingsChanged, settings);
  }
}

/**
 * Makes the windows match the chosen displays: one raised on every chosen
 * display that is connected, none anywhere else. A window whose display went
 * away is moved to a display that needs one rather than destroyed beside a
 * fresh create — a swap of the main display must carry the conversation and
 * the panel's state across, not drop them on the floor. Raising before razing
 * is load-bearing for what remains — a swap must never pass through zero
 * windows, because all windows closed is how this process decides it is done.
 * Everything that changes what the set should be lands here: a switch
 * pressed, a display plugged or unplugged, the stored choice read at launch.
 */
function reconcilePanels(): void {
  const wanted = effectiveDisplayIds();
  const wantedSet = new Set(wanted);
  const missing = wanted.filter((displayId) => !panelWindows.has(displayId));
  const excess = [...panelWindows.keys()].filter((displayId) => !wantedSet.has(displayId));
  // Pair each display that needs a window with a window that lost its display.
  while (missing.length > 0 && excess.length > 0) {
    const toDisplayId = missing.shift();
    const fromDisplayId = excess.shift();
    if (toDisplayId === undefined || fromDisplayId === undefined) break;
    rebindPanel(fromDisplayId, toDisplayId);
  }
  for (const displayId of missing) createPanel(displayId);
  for (const displayId of excess) {
    const window = panelWindows.get(displayId);
    panelWindows.delete(displayId);
    windowModes.delete(displayId);
    clearCollapseTimer(displayId);
    // A window taken down takes its exchange report with it, so a host that
    // goes mid-conversation releases the duck rather than pinning it forever.
    voiceExchanges.delete(displayId);
    applyVoiceExchanges();
    window?.destroy();
  }
  positionPanels();
}

/**
 * Moves a living window to another display, state and all: its mode, its
 * collapse-in-flight, its exchange report, and the renderer behind it — which
 * learns its new ground from the `displayChanged` the repositioning sends,
 * exactly as it would for a geometry change in place.
 */
function rebindPanel(fromDisplayId: number, toDisplayId: number): void {
  const window = panelWindows.get(fromDisplayId);
  if (!window) return;
  panelWindows.delete(fromDisplayId);
  panelWindows.set(toDisplayId, window);
  windowModes.set(toDisplayId, windowModeFor(fromDisplayId));
  windowModes.delete(fromDisplayId);
  // The timer's closure names the old display; the reposition below redraws
  // whatever a cancelled collapse would have.
  clearCollapseTimer(fromDisplayId);
  const exchange = voiceExchanges.get(fromDisplayId);
  voiceExchanges.delete(fromDisplayId);
  if (exchange !== undefined) voiceExchanges.set(toDisplayId, exchange);
  applyVoiceExchanges();
}

function clearCollapseTimer(displayId: number): void {
  const timer = collapseTimers.get(displayId);
  if (!timer) return;
  clearTimeout(timer);
  collapseTimers.delete(displayId);
}

function configurePanelBehavior(window: BrowserWindow): void {
  window.setAlwaysOnTop(true, "pop-up-menu");
  if (process.platform === "darwin") {
    window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    window.setHiddenInMissionControl(true);
    window.setWindowButtonVisibility(false);
    keepWindowStationary(window);
  }
}

/**
 * Brings one panel forward as the key window. An accessory app has no Dock
 * presence, so the app itself has to come forward before one of its windows can
 * take keyboard focus.
 */
function focusPanelWindow(window: BrowserWindow | undefined): void {
  if (!window || window.isDestroyed() || captureMode) return;
  if (process.platform === "darwin") app.focus({ steal: true });
  window.show();
  window.focus();
}

/**
 * The expanded panel owed the keyboard: the one that asked, when the asker is
 * known and still expanded, else whichever panel stands expanded. With two
 * panels open, focus must return to the one the user was typing in rather
 * than to whichever the map happens to list first.
 */
function focusExpandedPanel(preferredDisplayId?: number): void {
  if (preferredDisplayId !== undefined && windowModeFor(preferredDisplayId) === "expanded") {
    const preferred = panelWindows.get(preferredDisplayId);
    if (preferred && !preferred.isDestroyed()) {
      focusPanelWindow(preferred);
      return;
    }
  }
  for (const [displayId, window] of panelWindows) {
    if (windowModeFor(displayId) !== "expanded") continue;
    focusPanelWindow(window);
    return;
  }
}

/**
 * Which windows hold a live spoken exchange, and the single answer the media
 * duck is given: live anywhere is live. Only the voice host ever actually
 * opens one, but every window reports, so the union is what keeps a
 * bystander's idle from ending the host's exchange.
 */
const voiceExchanges = new Map<number, boolean>();

function applyVoiceExchanges(): void {
  mediaDuck.setExchangeActive([...voiceExchanges.values()].some(Boolean));
}

/**
 * `--duration-exit` plus `--duration-shape` in
 * apps/desktop/src/renderer/styles/base.css: the content leaves, then the
 * surface closes on the spring, and only then may the window follow.
 */
const COLLAPSE_ANIMATION_MS = 550;

function collapseDelay(): number {
  if (captureMode) return 0;
  return systemPreferences.getAnimationSettings().prefersReducedMotion ? 0 : COLLAPSE_ANIMATION_MS;
}

/**
 * The two directions are sequenced differently, and the ordering lives here so
 * every caller gets it — the panel, the tray, and the motion recorder alike.
 * Growing needs the window first, or the panel has nowhere to unfold into.
 * Shrinking needs the capsule drawn first, or the window clips the panel out
 * from under its own collapse. One display's window at a time: a panel opened
 * on one monitor is no reason to resize the capsule on another.
 */
function setWindowMode(displayId: number, mode: WindowMode, requestFocus: boolean): WindowMode {
  windowModes.set(displayId, mode);
  const window = panelWindows.get(displayId);
  if (!window || window.isDestroyed()) return mode;

  const expanded = mode === "expanded";
  window.setFocusable(expanded && !captureMode);
  clearCollapseTimer(displayId);
  if (expanded) {
    positionPanel(displayId);
    window.webContents.send(channels.lifecycle, `mode:${mode}`);
  } else {
    window.webContents.send(channels.lifecycle, `mode:${mode}`);
    const delay = collapseDelay();
    if (delay === 0) positionPanel(displayId);
    else {
      collapseTimers.set(
        displayId,
        setTimeout(() => {
          collapseTimers.delete(displayId);
          if (windowModeFor(displayId) === "compact") positionPanel(displayId);
        }, delay),
      );
    }
  }

  if (expanded && requestFocus && !captureMode) {
    focusPanelWindow(window);
  } else {
    window.showInactive();
  }
  return mode;
}

function microphoneStatus(): MicrophoneStatus {
  if (process.platform !== "darwin") return "granted";
  return systemPreferences.getMediaAccessStatus("microphone") as MicrophoneStatus;
}

async function requestMicrophone(): Promise<MicrophoneStatus> {
  if (process.platform !== "darwin") return "granted";
  if (microphoneStatus() === "not-determined") {
    await systemPreferences.askForMediaAccess("microphone");
  }
  return microphoneStatus();
}

function rendererUrl(): string {
  return pathToFileURL(path.join(__dirname, "renderer", "index.html")).href;
}

function trustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? event.sender.getURL();
  return url === rendererUrl();
}

/**
 * Whether a renderer message names a session. Both halves are required to be
 * present here because the registry rejects an empty one by throwing, and a
 * malformed message is a broken request rather than something a user can act
 * on.
 */
function isSessionIdentity(value: unknown): value is SessionIdentity {
  if (value === null || typeof value !== "object") return false;
  const { providerId, providerSessionId } = value as Partial<SessionIdentity>;
  return (
    typeof providerId === "string" &&
    providerId.trim().length > 0 &&
    typeof providerSessionId === "string" &&
    providerSessionId.trim().length > 0
  );
}

/**
 * Whether a renderer message is a validated issue act. Like a session
 * identity, a malformed one is a broken request rather than something the
 * user can act on — and everything it names is re-resolved against the
 * latest observation before a tracker client sees any of it.
 */
function isIssueActionAsk(value: unknown): value is {
  kind: "issue-state" | "issue-comment";
  identity: { trackerId: string; identifier: string };
  transition?: { id: string; name: string };
  body?: string;
} {
  if (value === null || typeof value !== "object") return false;
  const { kind, identity } = value as {
    kind?: unknown;
    identity?: { trackerId?: unknown; identifier?: unknown };
  };
  if (kind !== "issue-state" && kind !== "issue-comment") return false;
  return (
    typeof identity?.trackerId === "string" &&
    identity.trackerId.trim().length > 0 &&
    typeof identity.identifier === "string" &&
    identity.identifier.trim().length > 0
  );
}

/**
 * States on startup whether voice is on, and why not when it is off. A packaged
 * app has no visible stderr, but the common case during local testing is a
 * terminal launch — where this is the difference between a one-line answer and
 * guessing at an empty panel.
 */
function reportVoiceAvailability(): void {
  const report = realtimeCredentials?.diagnostics() ?? unavailableRealtimeDiagnostics(fixtureMode);
  if (realtimeCredentials) {
    process.stderr.write(
      `Luke voice: enabled (model ${report.model}, voice ${report.voice}, speed ${report.speed}×)\n`,
    );
    return;
  }
  process.stderr.write(
    `Luke voice: unavailable — ${realtimeMintExplanation(report.lastOutcome)}\n`,
  );
}

function registerIpc(): void {
  ipcMain.handle(channels.bootstrap, async (event): Promise<AppBootstrap> => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    // Each window bootstraps as itself: its own display, its own mode. The
    // roster and the settings are the same everywhere.
    const displayId = displayIdFor(event.sender) ?? effectiveDisplayIds()[0];
    const display =
      (displayId !== undefined ? displayById(displayId) : undefined) ?? screen.getPrimaryDisplay();
    return {
      mode: displayId !== undefined ? windowModeFor(displayId) : initialWindowMode,
      startPeeked,
      startInSlot,
      profile,
      fixture,
      captureMode,
      fixtureMode,
      packaged: app.isPackaged,
      platform: process.platform,
      electronVersion: process.versions.electron,
      chromiumVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      microphoneStatus: microphoneStatus(),
      realtimeAvailable: realtimeCredentials !== undefined,
      // Both keys travel as accelerators rather than labels: the renderer needs
      // both spellings — the keycaps' ⌥ and L drawn apart, and aria's Alt+L —
      // and only the accelerator can produce the pair.
      ...(voiceHotkey ? { voiceHotkey } : {}),
      voiceHotkeyHeld,
      ...(askHotkey ? { askHotkey } : {}),
      ...(outputAudio ? { outputAudio } : {}),
      display: displayDiagnostic(display),
      sessions: fixtureMode ? [] : sessionRegistry.snapshot().sessions,
      workspaceProjects: observedWorkspaceProjects(),
      ...(trackedIssues && !fixtureMode ? { issues: trackedIssues } : {}),
      settings: await settingsStore.snapshot(),
    };
  });

  ipcMain.handle(channels.setExpanded, (event, expanded: unknown, focus: unknown) => {
    if (!trustedSender(event) || typeof expanded !== "boolean") {
      throw new Error("Invalid window mode request");
    }
    // The ask is the sender's own window's: expanding a panel on one display
    // must not unfold one on every other.
    const displayId = displayIdFor(event.sender);
    if (displayId === undefined) throw new Error("Invalid window mode request");
    return setWindowMode(displayId, expanded ? "expanded" : "compact", focus === true);
  });

  // The tray items' feedback gesture, asked for from a renderer — the spoken
  // open rides this so the ordering stays owned here for every caller: the
  // mode event setWindowMode sends and the composer event that follows travel
  // the same lifecycle channel, so the shape that wins is always the
  // composer, never a panel racing it in from another channel. Opening is all
  // this does; a note still arrives only through channels.sendFeedback, from
  // the composer's own Send button.
  ipcMain.handle(channels.summonFeedback, (event, kind: unknown) => {
    if (!trustedSender(event) || !isFeedbackKind(kind)) {
      throw new Error("Invalid composer request");
    }
    const displayId = displayIdFor(event.sender);
    if (displayId === undefined) throw new Error("Invalid composer request");
    setWindowMode(displayId, "expanded", true);
    event.sender.send(channels.lifecycle, FEEDBACK_LIFECYCLE_EVENT[kind]);
  });

  ipcMain.on(channels.setPointerInterception, (event, interceptsPointer: unknown) => {
    if (!trustedSender(event) || typeof interceptsPointer !== "boolean") {
      return;
    }
    // The pointer question is per window too: the hit regions the renderer
    // reported are its own.
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.setIgnoreMouseEvents(!interceptsPointer, { forward: true });
  });

  ipcMain.handle(channels.requestMicrophone, async (event) => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    return requestMicrophone();
  });

  // The renderer can replace or clear a provider's credential but never reads
  // it back; the reply reports only where each key now comes from.
  ipcMain.handle(
    channels.setProviderApiKey,
    async (event, providerId: unknown, apiKey: unknown): Promise<SettingsUpdateResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      // The provider list is fixed by this build, so an id outside it is a
      // malformed request rather than something the user can correct.
      if (!isCredentialProviderId(providerId)) throw new Error("Unknown credential provider");
      if (apiKey !== undefined && typeof apiKey !== "string") {
        throw new Error("Invalid API key request");
      }
      try {
        const result = await settingsStore.setApiKey(providerId, apiKey);
        // Only the provider whose key changed is affected, so the local
        // observers are left alone rather than re-crawling the filesystem on
        // every save.
        const adapter = adapterByCredentialProvider.get(providerId);
        if (!result.reason && adapter) void sessionRegistry.refresh(adapter);
        // The tracker's key connects the tracker, not a session provider, so
        // its save refreshes the roster instead of the registry.
        if (!result.reason && providerId === CREDENTIAL_PROVIDER_ID.LINEAR) {
          void refreshTrackedIssues();
        }
        broadcastSettings(result.settings, event.sender);
        return result;
      } catch {
        // A filesystem failure is not something the user can act on, so it is
        // reported as one line rather than as a raw system error.
        return {
          settings: await settingsStore.snapshot(),
          reason: "Could not save that API key on this system.",
        };
      }
    },
  );

  // The status item follows the stored answer at once: a setting that only
  // took effect on the next launch would read as a toggle that does nothing.
  ipcMain.handle(
    channels.setShowInMenuBar,
    async (event, show: unknown): Promise<SettingsUpdateResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (typeof show !== "boolean") throw new Error("Invalid menu bar request");
      try {
        const result = await settingsStore.setShowInMenuBar(show);
        applyMenuBarVisibility(result.settings.showInMenuBar);
        broadcastSettings(result.settings, event.sender);
        return result;
      } catch {
        // A filesystem failure is not something the user can act on, so it is
        // reported as one line rather than as a raw system error.
        return {
          settings: await settingsStore.snapshot(),
          reason: "Could not save that setting on this system.",
        };
      }
    },
  );

  // The Dock icon follows the stored answer at once, like the status item: a
  // setting that only took effect on the next launch would read as a toggle
  // that does nothing.
  ipcMain.handle(
    channels.setShowInDock,
    async (event, show: unknown): Promise<SettingsUpdateResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (typeof show !== "boolean") throw new Error("Invalid Dock request");
      try {
        const result = await settingsStore.setShowInDock(show);
        applyDockVisibility(result.settings.showInDock, displayIdFor(event.sender));
        broadcastSettings(result.settings, event.sender);
        return result;
      } catch {
        // A filesystem failure is not something the user can act on, so it is
        // reported as one line rather than as a raw system error.
        return {
          settings: await settingsStore.snapshot(),
          reason: "Could not save that setting on this system.",
        };
      }
    },
  );

  // The windows follow the stored answer at once, like the status item: on
  // raises a panel on every connected display, off brings Luke back to the
  // main one alone.
  ipcMain.handle(
    channels.setShowOnAllDisplays,
    async (event, show: unknown): Promise<SettingsUpdateResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (typeof show !== "boolean") throw new Error("Invalid display request");
      try {
        const result = await settingsStore.setShowOnAllDisplays(show);
        showOnAllDisplays = result.settings.showOnAllDisplays;
        reconcilePanels();
        broadcastSettings(result.settings, event.sender);
        return result;
      } catch {
        // A filesystem failure is not something the user can act on, so it is
        // reported as one line rather than as a raw system error.
        return {
          settings: await settingsStore.snapshot(),
          reason: "Could not save that setting on this system.",
        };
      }
    },
  );

  // The form follows the stored answer at once, for the same reason: every
  // window resizes around the housing the shape is about to draw or drop.
  ipcMain.handle(
    channels.setFormFactor,
    async (event, formFactor: unknown): Promise<SettingsUpdateResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (!isPanelFormFactor(formFactor)) throw new Error("Invalid form factor request");
      try {
        const result = await settingsStore.setFormFactor(formFactor);
        panelFormFactor = result.settings.formFactor;
        positionPanels();
        broadcastSettings(result.settings, event.sender);
        return result;
      } catch {
        // A filesystem failure is not something the user can act on, so it is
        // reported as one line rather than as a raw system error.
        return {
          settings: await settingsStore.snapshot(),
          reason: "Could not save that setting on this system.",
        };
      }
    },
  );

  // The voice is a preference rather than a credential, but it travels the
  // same road: the renderer names a value from a set fixed by this build and
  // hears back the settings as they now stand.
  ipcMain.handle(
    channels.setVoice,
    async (event, voice: unknown): Promise<SettingsUpdateResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (!isRealtimeVoice(voice)) throw new Error("Unknown voice");
      try {
        const result = await settingsStore.setVoice(voice);
        // The next credential is minted for the new voice; the renderer makes
        // the change heard now by reopening any conversation already up.
        if (!result.reason) realtimeCredentials?.setVoice(voice);
        broadcastSettings(result.settings, event.sender);
        return result;
      } catch {
        return {
          settings: await settingsStore.snapshot(),
          reason: "Could not save that voice on this system.",
        };
      }
    },
  );
  // The pace travels the voice's road: a value from the set fixed by this
  // build, stored, and handed to the minter for the next conversation.
  ipcMain.handle(
    channels.setVoiceSpeed,
    async (event, speed: unknown): Promise<SettingsUpdateResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (!isRealtimeVoiceSpeed(speed)) throw new Error("Unknown voice speed");
      try {
        const result = await settingsStore.setVoiceSpeed(speed);
        // The next credential is minted for the new pace; the renderer
        // carries the change onto a conversation already open itself.
        if (!result.reason) realtimeCredentials?.setSpeed(speed);
        broadcastSettings(result.settings, event.sender);
        return result;
      } catch {
        return {
          settings: await settingsStore.snapshot(),
          reason: "Could not save that speed on this system.",
        };
      }
    },
  );
  // A plain preference, validated to a boolean the way every renderer value
  // is validated at this boundary. The reply reports what was actually
  // stored, so the switch redraws from the settings rather than the press.
  ipcMain.handle(
    channels.setVoiceCaptions,
    async (event, enabled: unknown): Promise<SettingsUpdateResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (typeof enabled !== "boolean") throw new Error("Invalid caption request");
      try {
        const result = await settingsStore.setVoiceCaptions(enabled);
        broadcastSettings(result.settings, event.sender);
        return result;
      } catch {
        // A filesystem failure is not something the user can act on, so it is
        // reported as one line rather than as a raw system error.
        return {
          settings: await settingsStore.snapshot(),
          reason: "Could not save that setting on this system.",
        };
      }
    },
  );

  // The talk key is the user's to move — a chord another tool already holds,
  // or a hand that does not reach ⌥Space. What arrives is read through the
  // same gate the stored value passes, so only a chord the registrars can
  // actually take is ever stored; omitting one returns the defaults, making
  // reset the absence of a choice rather than a second stored value. The new
  // chord is registered at once — a shortcut that only moved on the next
  // launch would read as a control that does nothing.
  ipcMain.handle(
    channels.setVoiceHotkey,
    async (event, accelerator: unknown): Promise<SettingsUpdateResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (accelerator !== undefined && typeof accelerator !== "string") {
        throw new Error("Invalid shortcut request");
      }
      const chosen = accelerator === undefined ? undefined : parseVoiceHotkey(accelerator);
      // The renderer records chords through the same reader, so one that does
      // not parse is a malformed request rather than a choice to answer.
      if (accelerator !== undefined && chosen === undefined) {
        throw new Error("Invalid shortcut request");
      }
      try {
        const result = await settingsStore.setVoiceHotkey(chosen);
        if (!result.reason) {
          chosenVoiceHotkey = chosen;
          // Awaited so the renderer's controls stay at rest until the swap has
          // finished and the helper's own registration line can say the truth.
          await applyVoiceHotkey();
        }
        broadcastSettings(result.settings, event.sender);
        return result;
      } catch {
        // A filesystem failure is not something the user can act on, so it is
        // reported as one line rather than as a raw system error.
        return {
          settings: await settingsStore.snapshot(),
          reason: "Could not save that shortcut on this system.",
        };
      }
    },
  );

  // The ask key is the user's to move on the talk key's exact terms, read
  // through the same gate and registered at once. The one extra rule is the
  // standing one — the two Luke keys must never compete for a chord — so a
  // chord the talk key sits on is refused with words rather than stored and
  // silently outbid.
  ipcMain.handle(
    channels.setAskHotkey,
    async (event, accelerator: unknown): Promise<SettingsUpdateResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (accelerator !== undefined && typeof accelerator !== "string") {
        throw new Error("Invalid shortcut request");
      }
      const chosen = accelerator === undefined ? undefined : parseVoiceHotkey(accelerator);
      if (accelerator !== undefined && chosen === undefined) {
        throw new Error("Invalid shortcut request");
      }
      // The talk key's whole candidate list is refused, not just the chord it
      // holds now: its helper may fall back to any of them on a later launch,
      // and an ask key stored on one would race it there.
      if (
        chosen &&
        (voiceHotkeyCandidates(chosenVoiceHotkey).includes(chosen) || chosen === voiceHotkey)
      ) {
        return {
          settings: await settingsStore.snapshot(),
          reason: "That chord is reserved for the talk key.",
        };
      }
      try {
        const result = await settingsStore.setAskHotkey(chosen);
        if (!result.reason) {
          chosenAskHotkey = chosen;
          applyAskHotkey();
        }
        broadcastSettings(result.settings, event.sender);
        return result;
      } catch {
        // A filesystem failure is not something the user can act on, so it is
        // reported as one line rather than as a raw system error.
        return {
          settings: await settingsStore.snapshot(),
          reason: "Could not save that shortcut on this system.",
        };
      }
    },
  );

  // The duck follows the stored answer at once, like the menu bar item: off
  // must let a duck currently held go rather than waiting for the next launch.
  ipcMain.handle(
    channels.setDuckOtherMedia,
    async (event, enabled: unknown): Promise<SettingsUpdateResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (typeof enabled !== "boolean") throw new Error("Invalid media duck request");
      try {
        const result = await settingsStore.setDuckOtherMedia(enabled);
        mediaDuck.setEnabled(result.settings.duckOtherMedia);
        broadcastSettings(result.settings, event.sender);
        return result;
      } catch {
        // A filesystem failure is not something the user can act on, so it is
        // reported as one line rather than as a raw system error.
        return {
          settings: await settingsStore.snapshot(),
          reason: "Could not save that setting on this system.",
        };
      }
    },
  );

  // A statement of state, not a request: the renderer says whether a spoken
  // exchange is live, and the duck holds every other decision — the setting,
  // the hangover after an exchange, which players are playing at all. Each
  // window states only its own exchange: a bystander window reporting idle —
  // one just raised on a plugged-in display, say — must never end the duck
  // the speaking window opened, so the duck follows the union of them all.
  ipcMain.on(channels.setVoiceExchange, (event, active: unknown) => {
    if (!trustedSender(event) || typeof active !== "boolean") return;
    const displayId = displayIdFor(event.sender);
    if (displayId === undefined) return;
    voiceExchanges.set(displayId, active);
    applyVoiceExchanges();
  });

  // Where to get a key is a question the panel cannot answer itself, so it
  // hands the question to the browser. The renderer names a provider rather
  // than an address: the pages Luke can open are the ones in the provider
  // registry, and no URL crosses this boundary.
  // The system's own answer is the user's to change, and this is where macOS
  // keeps it. The address is fixed here rather than passed in, so a renderer
  // names the intent and never an address.
  ipcMain.on(channels.openMicrophoneSettings, (event) => {
    if (!trustedSender(event)) return;
    void shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
    );
  });

  ipcMain.on(channels.openProviderApiKeys, (event, providerId: unknown) => {
    if (!trustedSender(event) || !isCredentialProviderId(providerId)) return;
    void shell.openExternal(CREDENTIAL_PROVIDERS[providerId].apiKeysUrl);
  });

  // Pressing a session — on its row, or out loud — hands its provider's own
  // address to the system. Luke does not draw the chat, navigate it, or write
  // to it — the provider opens its own window and Luke has already stood
  // down — so this stays inside what a read-only sidecar may do.
  //
  // The renderer names a session rather than an address, so the set of places
  // Luke can send you is the set of sessions currently observed. The address is
  // read back out of the registry, which holds only normalized sessions: an
  // address a provider reported in a scheme outside `SESSION_LINK_SCHEME` never
  // reached one. A fixture run has an empty registry and so opens nothing,
  // which is what a deterministic capture needs. The answer says what became
  // of the press: a row ignores it, but a spoken ask has to say something, and
  // it must be what happened rather than what was hoped.
  ipcMain.handle(
    channels.openSession,
    async (event, identity: unknown): Promise<SessionOpenResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (!isSessionIdentity(identity)) throw new Error("Invalid session open request");
      const link = sessionRegistry.get(identity)?.detail.link;
      if (!link) return { status: SESSION_OPEN_RESULT_STATUS.UNSUPPORTED };
      try {
        await shell.openExternal(link);
        return { status: SESSION_OPEN_RESULT_STATUS.OPENED };
      } catch {
        return {
          status: SESSION_OPEN_RESULT_STATUS.REJECTED,
          reason: "The system could not open that session.",
        };
      }
    },
  );

  // A reply typed on a row is handed to the session's own provider, through
  // the adapter that observed it — the one component that knows the documented
  // way in. The renderer names a session it is already drawing, the text is
  // bounded before an adapter sees it, and only a session whose latest
  // observation advertised taking messages gets one. Refusals are answers for
  // the row, never thrown: a send is the user's own act, and what became of it
  // belongs beside the field it left.
  ipcMain.handle(
    channels.sendSessionMessage,
    async (event, identity: unknown, text: unknown): Promise<ProviderMessageResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (!isSessionIdentity(identity)) throw new Error("Invalid session message request");
      const messageText = sessionMessageText(text);
      if (!messageText) {
        return {
          status: PROVIDER_MESSAGE_RESULT_STATUS.REJECTED,
          reason: "A message has to be shorter than a document and longer than nothing.",
        };
      }
      // A fixture run has an empty registry, so it refuses every send — a
      // deterministic capture must not reach any provider.
      const session = sessionRegistry.get(identity);
      if (!session?.canReceiveMessage) {
        return { status: PROVIDER_MESSAGE_RESULT_STATUS.UNSUPPORTED };
      }
      const adapter = sessionAdapters.find(
        (candidate) => candidate.provider.id === identity.providerId,
      );
      if (!adapter || !isMessageCapableAdapter(adapter)) {
        return { status: PROVIDER_MESSAGE_RESULT_STATUS.UNSUPPORTED };
      }
      const result = await adapter.sendMessage({
        providerSessionId: identity.providerSessionId,
        text: messageText,
      });
      // A message that landed changes what the session is doing, so the row
      // should catch up as soon as its provider will say.
      if (result.status === PROVIDER_MESSAGE_RESULT_STATUS.ACCEPTED) {
        void sessionRegistry.refresh(adapter);
      }
      return result;
    },
  );

  // A control runs the same gauntlet a message does, and one more: the id the
  // renderer names must be a control the session's latest observation actually
  // advertised. The registry is what advertised it, so the registry is what
  // answers whether it stands.
  ipcMain.handle(
    channels.executeSessionControl,
    async (event, identity: unknown, controlId: unknown): Promise<ProviderControlResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (!isSessionIdentity(identity) || typeof controlId !== "string" || !controlId.trim()) {
        throw new Error("Invalid session control request");
      }
      const session = sessionRegistry.get(identity);
      const control = session?.controls.find((candidate) => candidate.id === controlId);
      if (!control) return { status: PROVIDER_CONTROL_RESULT_STATUS.UNSUPPORTED };
      const adapter = sessionAdapters.find(
        (candidate) => candidate.provider.id === identity.providerId,
      );
      if (!adapter || !isControllableAdapter(adapter)) {
        return { status: PROVIDER_CONTROL_RESULT_STATUS.UNSUPPORTED };
      }
      const result = await adapter.executeControl({
        providerSessionId: identity.providerSessionId,
        control,
      });
      if (result.status === PROVIDER_CONTROL_RESULT_STATUS.ACCEPTED) {
        void sessionRegistry.refresh(adapter);
      }
      return result;
    },
  );

  // A new workspace runs the same gauntlet a message does, against the list
  // that offered it: the renderer names a project rather than a repository, and
  // only a project an adapter reported on its latest pass — read back here from
  // the adapter itself, never from the request — reaches the provider's
  // documented creation endpoint. A fixture run offers no projects at all, so
  // it refuses every ask without touching a network.
  ipcMain.handle(
    channels.createSessionWorkspace,
    async (
      event,
      providerId: unknown,
      providerProjectId: unknown,
      name: unknown,
      task: unknown,
    ): Promise<ProviderWorkspaceResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (
        typeof providerId !== "string" ||
        !providerId.trim() ||
        typeof providerProjectId !== "string" ||
        !providerProjectId.trim() ||
        (name !== undefined && typeof name !== "string") ||
        (task !== undefined && typeof task !== "string")
      ) {
        throw new Error("Invalid workspace creation request");
      }
      if (fixtureMode) return { status: PROVIDER_MESSAGE_RESULT_STATUS.UNSUPPORTED };
      const adapter = sessionAdapters.find((candidate) => candidate.provider.id === providerId);
      if (!adapter || !isWorkspaceCapableAdapter(adapter)) {
        return { status: PROVIDER_MESSAGE_RESULT_STATUS.UNSUPPORTED };
      }
      const offered = adapter
        .workspaceProjects()
        .some((project) => project.providerProjectId === providerProjectId);
      if (!offered) return { status: PROVIDER_MESSAGE_RESULT_STATUS.UNSUPPORTED };
      const workspaceName = name === undefined ? undefined : workspaceNameText(name);
      if (name !== undefined && workspaceName === undefined) {
        return {
          status: PROVIDER_MESSAGE_RESULT_STATUS.REJECTED,
          reason: "A workspace name has to be short enough to say and longer than nothing.",
        };
      }
      // The task's own bound, and its fit to the project, are answered by the
      // adapter, which validates both against the projects it actually offers.
      const openingTask = task === undefined ? undefined : sessionMessageText(task);
      if (task !== undefined && openingTask === undefined) {
        return {
          status: PROVIDER_MESSAGE_RESULT_STATUS.REJECTED,
          reason: "A task has to be shorter than a document and longer than nothing.",
        };
      }
      const result = await adapter.createWorkspace({
        providerProjectId,
        ...(workspaceName ? { name: workspaceName } : {}),
        ...(openingTask ? { task: openingTask } : {}),
      });
      // A workspace that landed is a session the panel should be showing, so
      // the next look must actually ask rather than serve the cache. A
      // rejection refreshes too: a workspace can stand with its opening task
      // undelivered, and the adapter answers a rejection that never reached
      // the network from its cache anyway.
      if (result.status !== PROVIDER_MESSAGE_RESULT_STATUS.UNSUPPORTED) {
        void sessionRegistry.refresh(adapter);
      }
      return result;
    },
  );

  // A spoken issue act runs the same gauntlet a session act does, in the same
  // two halves: the renderer refused anything its roster did not advertise,
  // and here every named thing is resolved again from the latest observation —
  // the issue by its identity, the transition by the id the tracker itself
  // listed — so what reaches a tracker client is built from observed state,
  // never from what a model composed.
  ipcMain.handle(
    channels.executeIssueAction,
    async (event, action: unknown): Promise<TrackerActionResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (!isIssueActionAsk(action)) throw new Error("Invalid issue action request");
      // A fixture run observes no tracker, so it refuses every act — a
      // deterministic capture must not reach Linear.
      const issue = trackedIssues?.find(
        (candidate) =>
          candidate.trackerId === action.identity.trackerId &&
          candidate.identifier === action.identity.identifier,
      );
      if (!issue) return { status: TRACKER_ACTION_RESULT_STATUS.UNSUPPORTED };
      const tracker = issueTrackers.find((candidate) => candidate.tracker.id === issue.trackerId);
      if (!tracker) return { status: TRACKER_ACTION_RESULT_STATUS.UNSUPPORTED };

      let result: TrackerActionResult;
      if (action.kind === "issue-state") {
        const transition = issue.transitions.find(
          (candidate) => candidate.id === action.transition?.id,
        );
        if (!transition) return { status: TRACKER_ACTION_RESULT_STATUS.UNSUPPORTED };
        result = await tracker.execute({
          kind: ISSUE_ACTION_KIND.SET_STATE,
          trackerIssueId: issue.trackerIssueId,
          transition,
        });
      } else {
        if (!issue.canComment) return { status: TRACKER_ACTION_RESULT_STATUS.UNSUPPORTED };
        const body = issueCommentText(action.body);
        if (!body) {
          return {
            status: TRACKER_ACTION_RESULT_STATUS.REJECTED,
            reason: "A comment has to be shorter than a document and longer than nothing.",
          };
        }
        result = await tracker.execute({
          kind: ISSUE_ACTION_KIND.COMMENT,
          trackerIssueId: issue.trackerIssueId,
          body,
        });
      }
      // An act that landed changes the board, so the roster should catch up
      // as soon as Linear will say.
      if (result.status === TRACKER_ACTION_RESULT_STATUS.ACCEPTED) {
        void refreshTrackedIssues();
      }
      return result;
    },
  );

  // Another agent in an observed workspace runs the gauntlet a control does,
  // and one more: the agent kind the renderer names must be one the session's
  // latest observation actually listed. The registry is what advertised it, so
  // the registry is what answers whether it stands; the adapter then reads the
  // workspace back from its own last pass.
  ipcMain.handle(
    channels.addWorkspaceAgent,
    async (
      event,
      identity: unknown,
      agent: unknown,
      name: unknown,
      task: unknown,
    ): Promise<ProviderWorkspaceResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (
        !isSessionIdentity(identity) ||
        typeof agent !== "string" ||
        !agent.trim() ||
        (name !== undefined && typeof name !== "string") ||
        (task !== undefined && typeof task !== "string")
      ) {
        throw new Error("Invalid workspace agent request");
      }
      // A fixture run has an empty registry, so it refuses every ask.
      const session = sessionRegistry.get(identity);
      const advertised = session?.spawnableAgents.find((candidate) => candidate === agent.trim());
      if (!advertised) return { status: PROVIDER_MESSAGE_RESULT_STATUS.UNSUPPORTED };
      const adapter = sessionAdapters.find(
        (candidate) => candidate.provider.id === identity.providerId,
      );
      if (!adapter || !isWorkspaceAgentCapableAdapter(adapter)) {
        return { status: PROVIDER_MESSAGE_RESULT_STATUS.UNSUPPORTED };
      }
      const sessionName = name === undefined ? undefined : workspaceNameText(name);
      if (name !== undefined && sessionName === undefined) {
        return {
          status: PROVIDER_MESSAGE_RESULT_STATUS.REJECTED,
          reason: "A session name has to be short enough to say and longer than nothing.",
        };
      }
      const openingTask = task === undefined ? undefined : sessionMessageText(task);
      if (task !== undefined && openingTask === undefined) {
        return {
          status: PROVIDER_MESSAGE_RESULT_STATUS.REJECTED,
          reason: "A task has to be shorter than a document and longer than nothing.",
        };
      }
      const result = await adapter.spawnWorkspaceAgent({
        providerSessionId: identity.providerSessionId,
        agent: advertised,
        ...(sessionName ? { name: sessionName } : {}),
        ...(openingTask ? { task: openingTask } : {}),
      });
      // A new agent is a session the panel should be showing, so the next
      // look must actually ask rather than serve the cache — on a rejection
      // too, for the same reason a partial workspace creation refreshes.
      if (result.status !== PROVIDER_MESSAGE_RESULT_STATUS.UNSUPPORTED) {
        void sessionRegistry.refresh(adapter);
      }
      return result;
    },
  );

  // A note to the founders travels one road: typed in the composer, validated
  // here as a whole, and handed to the courier whose destination is fixed by
  // this build. Only what the user wrote and attached crosses — no session
  // material, no identifiers, nothing observed — and a refusal comes back as an
  // answer for the composer rather than a throw, because sending is the user's
  // own act and its outcome belongs beside the field it left.
  ipcMain.handle(
    channels.sendFeedback,
    async (event, submission: unknown): Promise<FeedbackResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      const parsed = feedbackSubmission(submission);
      if (!parsed) throw new Error("Invalid feedback submission");
      // A fixture run must be reproducible without a network, so it refuses
      // rather than sending — and says so, because the composer still draws.
      if (fixtureMode) {
        return { delivered: false, reason: "A fixture run sends nothing." };
      }
      return feedbackDelivery.deliver(parsed);
    },
  );

  // The panel is normally shown without stealing focus. A text field cannot be
  // typed into that way, so the renderer asks for focus when it opens one —
  // for its own window, which is the one holding the field.
  ipcMain.on(channels.focusPanel, (event) => {
    if (!trustedSender(event)) return;
    const displayId = displayIdFor(event.sender);
    if (displayId === undefined || windowModeFor(displayId) !== "expanded") return;
    focusPanelWindow(panelWindows.get(displayId));
  });

  ipcMain.handle(channels.requestRealtimeCredential, async (event) => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    // Returning nothing rather than throwing keeps "no credentials configured"
    // and "the mint failed" on the same explicit, non-fatal path.
    return realtimeCredentials?.mint();
  });

  ipcMain.on(channels.quit, (event) => {
    if (trustedSender(event)) app.quit();
  });

  ipcMain.on(channels.rendererReady, async (event) => {
    if (!trustedSender(event) || !captureOutput) return;
    // A capture run holds a single window, and the ready message is its own.
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed()) return;
    await new Promise((resolve) => setTimeout(resolve, 350));
    const image = await window.webContents.capturePage(undefined, {
      stayHidden: true,
      stayAwake: true,
    });
    const destination = path.resolve(captureOutput);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, image.toPNG());
    process.stdout.write(`Electron evidence: ${destination}\n`);
    app.quit();
  });
}

/**
 * Where a workspace can be created right now, as the adapters offer it: each
 * capable adapter's latest project list, stamped with its provider and bounded
 * once here so the panel and the conversation are handed the same list. A
 * fixture run offers nothing, for the same reason it observes nothing.
 */
function observedWorkspaceProjects(): readonly ObservedWorkspaceProject[] {
  if (fixtureMode) return [];
  return normalizeObservedWorkspaceProjects(
    sessionAdapters.flatMap((adapter) =>
      isWorkspaceCapableAdapter(adapter)
        ? adapter.workspaceProjects().map((project) => ({
            ...project,
            providerId: adapter.provider.id,
            providerName: adapter.provider.displayName,
          }))
        : [],
    ),
  );
}

async function refreshProviderSessions(): Promise<void> {
  if (fixtureMode || sessionRefreshRunning) return;
  sessionRefreshRunning = true;
  try {
    // Providers are observed concurrently and reported independently: the
    // registry commits each provider atomically, so one that is slow or failing
    // can neither delay nor cancel the others. A network provider would
    // otherwise hold up the local ones for as long as its requests take.
    await Promise.all(
      sessionAdapters.map(async (adapter) => {
        try {
          await sessionRegistry.refresh(adapter);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          process.stderr.write(`Session observation failed (${adapter.provider.id}): ${message}\n`);
        }
      }),
    );
  } finally {
    sessionRefreshRunning = false;
  }
  // The registry only spoke if the sessions themselves changed, and a pass can
  // change the project list while leaving them exactly as they were.
  broadcastWorkspaceProjects();
  // Attention review runs outside the observation guard so a slow model call
  // never delays the next provider snapshot.
  void reviewSessionAttention();
}

async function reviewSessionAttention(): Promise<void> {
  if (!attentionReviewer || attentionReviewRunning) return;
  attentionReviewRunning = true;
  try {
    const reviews = await attentionReviewer.review(sessionRegistry.list());
    for (const review of reviews) {
      sessionRegistry.setAttention(review, review.decision);
    }
    // `decision` says the session needs attention, which the panel shows;
    // `outcome` says whether to voice it now, which only these reviews do.
    const speech = attentionSpeechFromReviews(reviews);
    if (speech.length > 0) {
      // Spoken once, by the one window that holds the voice: every display
      // already shows the same session as needing attention.
      voiceHostWindow()?.webContents.send(channels.attentionSpeech, speech);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Attention review failed: ${message}\n`);
  } finally {
    attentionReviewRunning = false;
  }
}

function startSessionObservation(): void {
  if (fixtureMode) return;
  sessionRegistry.subscribe((snapshot) => {
    for (const window of panelWindows.values()) {
      window.webContents.send(channels.sessionsChanged, snapshot.sessions);
    }
    // A commit is the earliest a write-triggered refresh can have changed the
    // offer, so the announcement rides it rather than waiting for the timer.
    broadcastWorkspaceProjects();
  });
  void refreshProviderSessions();
  sessionRefreshTimer = setInterval(() => {
    void refreshProviderSessions();
  }, SESSION_REFRESH_INTERVAL_MS);
  sessionRefreshTimer.unref();
}

/**
 * Reads the issue roster from every connected tracker. A failing pass keeps
 * the roster it has rather than blanking it — a tracker that cannot answer is
 * not a board with nothing on it — and a tracker with no key stays absent,
 * which is how the renderer knows there is nothing to advertise.
 */
async function refreshTrackedIssues(): Promise<void> {
  if (fixtureMode) return;
  if (issueRefreshRunning) {
    issueRefreshQueued = true;
    return;
  }
  issueRefreshRunning = true;
  try {
    const collected: TrackedIssue[] = [];
    let connected = false;
    for (const tracker of issueTrackers) {
      const observations = await tracker.observe();
      if (!observations) continue;
      connected = true;
      for (const observation of observations) {
        collected.push(normalizeTrackedIssue(tracker.tracker, observation));
      }
    }
    trackedIssues = connected ? collected : undefined;
    for (const window of panelWindows.values()) {
      window.webContents.send(channels.issuesChanged, trackedIssues);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Issue observation failed: ${message}\n`);
  } finally {
    issueRefreshRunning = false;
    if (issueRefreshQueued) {
      issueRefreshQueued = false;
      void refreshTrackedIssues();
    }
  }
}

function startIssueObservation(): void {
  if (fixtureMode) return;
  void refreshTrackedIssues();
  issueRefreshTimer = setInterval(() => {
    void refreshTrackedIssues();
  }, ISSUE_REFRESH_INTERVAL_MS);
  issueRefreshTimer.unref();
}

/** Whether some panel window's renderer is asking, whichever display it is on. */
function isPanelWebContents(webContents: Electron.WebContents): boolean {
  for (const window of panelWindows.values()) {
    if (!window.isDestroyed() && window.webContents === webContents) return true;
  }
  return false;
}

function configurePermissions(): void {
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, _origin, details) =>
      webContents !== null &&
      isPanelWebContents(webContents) &&
      permission === "media" &&
      details.mediaType === "audio",
  );
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const mediaTypes = "mediaTypes" in details ? (details.mediaTypes ?? []) : [];
      callback(
        isPanelWebContents(webContents) &&
          permission === "media" &&
          mediaTypes.length > 0 &&
          mediaTypes.every((mediaType: string) => mediaType === "audio"),
      );
    },
  );
}

function createPanel(displayId: number): void {
  const display = displayById(displayId);
  if (!display) return;
  windowModes.set(displayId, initialWindowMode);
  const layout = layoutFor(display, initialWindowMode);

  const window = new BrowserWindow({
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height,
    title: "Luke",
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    roundedCorners: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: initialWindowMode === "expanded" && !captureMode,
    acceptFirstMouse: true,
    type: process.platform === "darwin" ? "panel" : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !captureMode,
      backgroundThrottling: false,
    },
  });
  panelWindows.set(displayId, window);

  configurePanelBehavior(window);
  window.setIgnoreMouseEvents(true, { forward: true });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== rendererUrl()) event.preventDefault();
  });
  window.once("ready-to-show", () => {
    if (!captureMode && !window.isDestroyed()) window.showInactive();
  });
  // The reconciler deletes before it destroys, so this answers only a window
  // that went down some other way — and it must not leave a ghost in the map,
  // nor a phantom exchange holding the duck down. Found by the window rather
  // than the id it was born under, because a rebind may have moved it.
  window.on("closed", () => {
    for (const [id, candidate] of [...panelWindows]) {
      if (candidate !== window) continue;
      panelWindows.delete(id);
      windowModes.delete(id);
      clearCollapseTimer(id);
      voiceExchanges.delete(id);
      applyVoiceExchanges();
    }
  });
  void window.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function trayMenu(): Electron.Menu {
  return Menu.buildFromTemplate([
    {
      // The ellipsis is the macOS convention for an item that opens somewhere
      // rather than acting, and the accelerator is shown rather than registered:
      // Command-, belongs to whichever app is frontmost, so Luke claims it only
      // inside its own window, where the renderer handles it.
      //
      // No icon: a menu item takes a NativeImage sized in points, and the
      // system's named gear arrives at its natural size, which draws far too
      // large beside the text. Apple's own menu bar menus label these items
      // rather than picture them, so this follows them.
      label: "Settings…",
      accelerator: "CommandOrControl+,",
      registerAccelerator: false,
      click: () => {
        // The menu bar item lives on whichever display the user opened it
        // from, but the panel it opens is the voice host's: one Settings, on
        // the same window every other app-level ask lands in.
        const host = voiceHostWindow();
        const displayId = host ? displayIdFor(host.webContents) : undefined;
        if (displayId === undefined) return;
        setWindowMode(displayId, "expanded", true);
        host?.webContents.send(channels.lifecycle, "tab:settings");
      },
    },
    { type: "separator" },
    {
      // The same door the bottom of the settings tab offers, for whoever lives
      // in the menu bar instead: the panel comes up on the composer, already
      // set to the kind that was asked for — on the voice host's window, the
      // same one every other app-level ask lands in.
      label: "Send Feedback…",
      click: () => {
        const host = voiceHostWindow();
        const displayId = host ? displayIdFor(host.webContents) : undefined;
        if (displayId === undefined) return;
        setWindowMode(displayId, "expanded", true);
        host?.webContents.send(
          channels.lifecycle,
          FEEDBACK_LIFECYCLE_EVENT[FEEDBACK_KIND.FEEDBACK],
        );
      },
    },
    {
      label: "Submit a Prompt…",
      click: () => {
        const host = voiceHostWindow();
        const displayId = host ? displayIdFor(host.webContents) : undefined;
        if (displayId === undefined) return;
        setWindowMode(displayId, "expanded", true);
        host?.webContents.send(channels.lifecycle, FEEDBACK_LIFECYCLE_EVENT[FEEDBACK_KIND.PROMPT]);
      },
    },
    { type: "separator" },
    { label: "Quit Luke", role: "quit" },
  ]);
}

/**
 * Luke's face, as macOS wants a status item drawn: a template image, which is
 * pure black plus alpha and is recoloured by the system rather than by us, so it
 * follows the menu bar through light, dark, and the inverted highlight a press
 * draws. The `@2x` file beside it is picked up from the same call, which is what
 * keeps the item sharp on a Retina display.
 */
function trayImage(): Electron.NativeImage {
  const image = nativeImage.createFromPath(path.join(__dirname, "menubar", "lukeTemplate.png"));
  image.setTemplateImage(true);
  return image;
}

function createTray(): void {
  if (process.platform !== "darwin") return;
  const image = trayImage();
  tray = new Tray(image);
  // A status item that draws nothing is a status item no one can find, and this
  // one is the quickest way to reach Settings or to quit. If the artwork is
  // ever missing from a build, the name it used to carry stands in for it.
  if (image.isEmpty()) tray.setTitle("Luke");
  tray.setToolTip("Luke");
  // Clicking opens the menu and nothing else. The capsule is how the panel is
  // opened; a menu bar item that also toggled it made one of them a surprise.
  tray.setContextMenu(trayMenu());
}

function destroyTray(): void {
  tray?.destroy();
  tray = undefined;
}

/**
 * Draws or removes the status item to match the setting. Hiding it loses no
 * capability — Settings and Quit are both in the panel — which is what makes
 * this the user's choice rather than Luke's.
 */
function applyMenuBarVisibility(show: boolean): void {
  if (show) {
    if (!tray) createTray();
    return;
  }
  destroyTray();
}

/**
 * The Dock tile per theme: the porcelain tile for a light desktop, the
 * space-black one for a dark. The bundle's `.icns` is cut from the dark tile
 * and cannot follow the theme, and an unpackaged run has only Electron's stock
 * icon, so the running app draws the Dock image itself from these.
 */
const DOCK_ICON_FILES = {
  LIGHT: "luke-icon-light.png",
  DARK: "luke-icon-dark.png",
} as const;

/**
 * Draws Luke's own face in the Dock, matched to the theme. Called at startup,
 * on every theme change, and after every `dock.show()` — showing the icon
 * transforms the process, and macOS draws the fresh tile from the bundle's
 * icon (in a dev run, Electron's stock one), forgetting any image set while
 * there was no tile to wear it. Artwork missing from a build draws nothing,
 * leaving the bundle icon (or the stock one) in place rather than an empty
 * tile.
 */
function applyDockIcon(): void {
  if (!app.dock) return;
  const file = nativeTheme.shouldUseDarkColors ? DOCK_ICON_FILES.DARK : DOCK_ICON_FILES.LIGHT;
  const image = nativeImage.createFromPath(path.join(__dirname, "icon", file));
  if (!image.isEmpty()) app.dock.setIcon(image);
}

/**
 * macOS ignores a `dock.hide()` within a second of the last Dock change, so a
 * switch pressed twice cannot be honoured call by call; the applier below
 * paces itself to this instead, which is Electron's documented floor.
 */
const DOCK_SETTLE_MS = 1100;

/** The Dock state last asked for, and whether the applier is chasing it. */
let dockDesired = false;
let dockSettling = false;
/** The display whose panel asked for the last Dock change, when one did. */
let dockAskedFrom: number | undefined;

/**
 * Puts Luke in the Dock or takes him back out, to match the setting. He ships
 * as an accessory app — the notch is his fixed point — so the icon is a second
 * door like the status item, losing nothing when it is hidden. `askedFrom` is
 * the display whose panel held the switch, so the caret goes back where the
 * press was made rather than to whichever panel stands first.
 */
function applyDockVisibility(show: boolean, askedFrom?: number): void {
  if (process.platform !== "darwin") return;
  dockDesired = show;
  dockAskedFrom = askedFrom;
  void settleDock();
}

/**
 * Chases the desired state rather than relaying each press: a hide within a
 * second of the last Dock change is silently ignored by macOS, so the icon is
 * re-checked after every change and asked again until it matches — the switch
 * and the file must not end a quick on-and-off disagreeing with the Dock.
 */
async function settleDock(): Promise<void> {
  if (dockSettling || !app.dock) return;
  dockSettling = true;
  try {
    while (app.dock.isVisible() !== dockDesired) {
      if (dockDesired) {
        await app.dock.show();
        // The show rebuilt the tile from the bundle icon; put Luke's face
        // back on it.
        applyDockIcon();
      } else {
        app.dock.hide();
      }
      // Either direction transforms the process type, which can deactivate
      // the app; the panel the switch was pressed in is brought back forward
      // rather than left to lose its caret.
      focusExpandedPanel(dockAskedFrom);
      await new Promise((resolve) => setTimeout(resolve, DOCK_SETTLE_MS));
    }
  } finally {
    dockSettling = false;
  }
}

function handleDisplayChange(): void {
  setTimeout(() => {
    refreshNativeGeometry();
    // The set of displays may have changed, not just their geometry: a chosen
    // display arriving raises its window, one leaving takes its window down.
    reconcilePanels();
  }, 100);
}

if (!app.requestSingleInstanceLock()) {
  // Luke runs as an accessory app, so a second launch otherwise exits silently
  // and looks like the launcher did nothing.
  process.stderr.write(
    "Luke is already running; the existing panel was refreshed instead of starting a second copy.\n",
  );
  app.quit();
} else {
  // A repeat launch is usually someone checking the notch capsule, so re-assert
  // the panel where it already is. Expanding hides the compact capsule, which is
  // the one thing the relaunch was meant to show. An explicit `--expanded` is a
  // stated intent rather than a side effect, so it is still honoured.
  app.on("second-instance", (_event, argv) => {
    refreshNativeGeometry();
    if (argv.includes("--expanded")) {
      const host = voiceHostWindow();
      const displayId = host ? displayIdFor(host.webContents) : undefined;
      if (displayId !== undefined) setWindowMode(displayId, "expanded", true);
      return;
    }
    reconcilePanels();
    for (const window of panelWindows.values()) {
      if (!window.isDestroyed()) window.showInactive();
    }
  });
  void app.whenReady().then(async () => {
    if (process.platform === "darwin") app.setActivationPolicy("accessory");
    Menu.setApplicationMenu(null);
    refreshNativeGeometry();
    registerIpc();
    // Resolving settings touches the filesystem, and the OS keychain only for a
    // provider that already has a stored key to decrypt. Starting it here keeps
    // that work off the renderer's first paint, which blocks on the bootstrap
    // reply.
    void settingsStore.snapshot();
    // The status item waits only for the settings file, never for the keychain
    // behind the stored keys: a locked or slow Keychain must not delay the one
    // fixed point Luke has outside the notch. A file that cannot be read
    // leaves the item shown, the same answer a file that has never said gives.
    void settingsStore.showInMenuBar().then(
      (show) => applyMenuBarVisibility(show),
      () => applyMenuBarVisibility(true),
    );
    // The Dock wears Luke's own face from the start, and keeps wearing the
    // right one as the desktop changes mode — whether the icon is shown yet
    // is a separate question, answered by the setting below.
    applyDockIcon();
    nativeTheme.on("updated", applyDockIcon);
    // The Dock icon reads the same file under the opposite default: it is
    // opt-in, so a file that cannot be read leaves Luke out of the Dock — the
    // accessory app the launch just asserted. Nothing to do until it says so.
    void settingsStore.showInDock().then(
      (show) => {
        if (show) applyDockVisibility(true);
      },
      () => undefined,
    );
    // Armed from the settings file alone, like the status item, and for the
    // same reason. A file that cannot be read leaves the duck on, the same
    // answer a file that has never said gives.
    void settingsStore.duckOtherMedia().then(
      (enabled) => mediaDuck.setEnabled(enabled),
      () => mediaDuck.setEnabled(true),
    );
    // Awaited, so the chosen voice reaches the minter before the renderer
    // exists to ask for a credential: the first conversation must already
    // speak with it. A file that cannot be read means no choice was kept — it
    // must not keep the panel, the hotkey, or observation from starting.
    const storedVoice = await settingsStore.readVoice().catch(() => undefined);
    if (storedVoice) realtimeCredentials?.setVoice(storedVoice);
    // The chosen pace rides the same await, for the same reason.
    const storedSpeed = await settingsStore.readVoiceSpeed().catch(() => undefined);
    if (storedSpeed) realtimeCredentials?.setSpeed(storedSpeed);
    // Awaited so the panels are created on the chosen displays in their
    // chosen form, rather than appearing on the main display and jumping. A
    // file that cannot be read means no choice was kept — the main display,
    // the default form — and must not keep the panels from starting.
    showOnAllDisplays = await settingsStore.readShowOnAllDisplays().catch(() => false);
    panelFormFactor =
      (await settingsStore.readFormFactor().catch(() => undefined)) ?? DEFAULT_PANEL_FORM_FACTOR;
    reportVoiceAvailability();
    // Awaited for the same reason the voice is: the chosen chord has to be in
    // hand before the key is registered, or the first registration would take
    // the default away from the user who moved off it. A file that cannot be
    // read means no choice was kept, and the defaults answer.
    chosenVoiceHotkey = await settingsStore.readVoiceHotkey().catch(() => undefined);
    chosenAskHotkey = await settingsStore.readAskHotkey().catch(() => undefined);
    // The report is not made here: the helper answers over its own stdout a
    // moment later, and a line printed now would state an absence that only
    // exists because nobody has answered yet.
    registerVoiceHotkey();
    registerAskHotkey();
    // Read-only, like everything else that watches: what it learns decides
    // what the renderer draws while Luke speaks unheard, and nothing more.
    startOutputVolumeWatch();
    reconcilePanels();
    configurePermissions();
    startSessionObservation();
    startIssueObservation();

    screen.on("display-added", handleDisplayChange);
    screen.on("display-removed", handleDisplayChange);
    screen.on("display-metrics-changed", handleDisplayChange);
    for (const eventName of ["resume", "unlock-screen", "user-did-become-active"] as const) {
      const handlePowerEvent = () => {
        handleDisplayChange();
        for (const window of panelWindows.values()) {
          window.webContents.send(channels.lifecycle, eventName);
        }
      };
      if (eventName === "resume") powerMonitor.on("resume", handlePowerEvent);
      if (eventName === "unlock-screen") {
        powerMonitor.on("unlock-screen", handlePowerEvent);
      }
      if (eventName === "user-did-become-active") {
        powerMonitor.on("user-did-become-active", handlePowerEvent);
      }
    }
  });
}

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  // The helper is a process of Luke's own, so it does not outlive the app that
  // spawned it and leave a key registered against nothing. Nothing succeeds it
  // during quit, so its exit is not waited on.
  void talkKeyWatcher?.stop();
  talkKeyWatcher = undefined;
  // The same rule: a process of Luke's own does not outlive the app.
  outputVolumeWatcher?.stop();
  outputVolumeWatcher = undefined;
  // The duck helper outlives this by one fade: closing its stdin is what asks
  // it to bring the players back up, so quitting mid-sentence costs the user
  // nothing.
  mediaDuck.stop();
});

app.on("before-quit", () => {
  if (sessionRefreshTimer) clearInterval(sessionRefreshTimer);
  if (issueRefreshTimer) clearInterval(issueRefreshTimer);
  for (const displayId of [...collapseTimers.keys()]) clearCollapseTimer(displayId);
});

app.on("window-all-closed", () => app.quit());
