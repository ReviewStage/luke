import { randomUUID } from "node:crypto";
import {
  PRODUCT_EVENT,
  type ProductCredentialSource,
  type RecordProductEvent,
} from "@sidecar/analytics";
import { BRAIN_DEFAULTS } from "@sidecar/brain";
import { CREDENTIAL_CONNECTION, CREDENTIAL_PROVIDERS } from "@sidecar/credentials";
import type { AgentWireTrace } from "@sidecar/devtrace/vocabulary";
import type { RealtimeCredentialMinter } from "@sidecar/voice";
import type {
  BrowserWindow,
  IpcMain,
  IpcMainEvent,
  IpcMainInvokeEvent,
  WebContents,
} from "electron";
import { BRIDGE, channels } from "#shared/bridge";
import {
  VOICE_COMMAND,
  VOICE_COMMAND_OUTCOME,
  type VoiceCommandOutcome,
  type VoiceView,
  voiceExchangeActive,
} from "#shared/wire/voice-view";
import { registerBridge } from "../register-bridge";
import type { PanelManager } from "../window/panel-manager";

/**
 * The minter a call will run on and the source its count names, chosen
 * together: two closures deciding independently across the awaited mint could
 * disagree at exactly the transitions the introduction is built around — an
 * account landing, or leaving, while a mint is in flight.
 */
export interface ChosenRealtimeCredentials {
  minter: RealtimeCredentialMinter;
  countedSource: ProductCredentialSource;
}

/** The hidden window the conversation lives in, as much of it as the bridge needs. */
export interface VoiceWindowSurface {
  current(): BrowserWindow | undefined;
  owns(webContents: WebContents): boolean;
}

export interface VoiceRuntimeIpcDependencies {
  ipcMain: Pick<IpcMain, "handle" | "on">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  panels: PanelManager;
  voiceWindow: VoiceWindowSurface;
  /** Hands a payload to every panel and the voice window alike. */
  broadcast: <Payload>(channel: string, payload: Payload) => void;
  openExternal: (url: string) => Promise<void>;
  chooseRealtimeCredentials: () => ChosenRealtimeCredentials | undefined;
  unavailableDiagnostics: () => ReturnType<RealtimeCredentialMinter["diagnostics"]>;
  recordProductEvent: RecordProductEvent;
  /**
   * Takes one tapped wire event into the development trace. On a run without
   * a writer — packaged, fixture, or simply untraced — the renderer's
   * fire-and-forget send lands here and stops.
   */
  recordAgentTrace: (trace: AgentWireTrace) => void;
  /** The voice window's latest snapshot, kept for the next panel to bootstrap. */
  storeVoiceView: (view: VoiceView) => void;
  /**
   * The History Clear, carried out here before the voice window is told, and
   * answering whether the stored thread went — a thread that could not be
   * deleted must not be half-forgotten by a voice window that was told anyway.
   */
  clearConversation: () => boolean;
  /** Whether a panel is recording a chord, which holds the talk and stop presses. */
  setShortcutCapturing: (capturing: boolean) => void;
}

/**
 * How long a forwarded typed ask may wait for the voice window's answer: the
 * brain's own ask deadline, which the voice window awaits before answering,
 * plus the round trips around it. Past this the panel is told refused, and
 * the draft stays the developer's to retry.
 */
export const ASK_ANSWER_TIMEOUT_MS = BRAIN_DEFAULTS.ASK_DEADLINE_MS + 10_000;

export function registerVoiceRuntimeIpc(dependencies: VoiceRuntimeIpcDependencies): void {
  const { panels, voiceWindow } = dependencies;
  const pendingAsks = new Map<string, (outcome: VoiceCommandOutcome) => void>();
  // The same shape `performBrainAppAct` keeps for an act the panel carries:
  // the request travels with an id, the answer comes back under it, and a
  // window that never answers is refused on a clock rather than holding the
  // composer open.
  const forwardAsk = (host: BrowserWindow, text: string): Promise<VoiceCommandOutcome> => {
    const requestId = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingAsks.delete(requestId);
        resolve(VOICE_COMMAND_OUTCOME.REFUSED);
      }, ASK_ANSWER_TIMEOUT_MS);
      pendingAsks.set(requestId, (outcome) => {
        clearTimeout(timer);
        pendingAsks.delete(requestId);
        resolve(outcome);
      });
      host.webContents.send(channels.onVoiceCommand, {
        command: VOICE_COMMAND.ASK_TEXT,
        text,
        requestId,
      });
    });
  };
  registerBridge(
    BRIDGE,
    {
      // A panel's ask of the voice window. The bridge guard has already bounded
      // it; here it is checked to come from a panel — the voice window does
      // not command itself — and handed on. A typed ask is answered: with no
      // voice window standing it is refused at once, and the composer keeps
      // the words. A Clear is carried out here first, because the main
      // process is the thread's store and every panel's relay, and the voice
      // window is told to retire its own turns only once the file has gone.
      voiceCommand(context, command, text) {
        if (!panels.owns(context.sender)) return undefined;
        const host = voiceWindow.current();
        if (command === VOICE_COMMAND.ASK_TEXT) {
          if (!host || text === undefined) return VOICE_COMMAND_OUTCOME.REFUSED;
          return forwardAsk(host, text);
        }
        if (command === VOICE_COMMAND.CLEAR_CONVERSATION && !dependencies.clearConversation()) {
          return VOICE_COMMAND_OUTCOME.REFUSED;
        }
        host?.webContents.send(channels.onVoiceCommand, {
          command,
          text: undefined,
          requestId: undefined,
        });
        return command === VOICE_COMMAND.CLEAR_CONVERSATION
          ? VOICE_COMMAND_OUTCOME.ACCEPTED
          : undefined;
      },
      answerVoiceAsk(context, requestId, outcome) {
        if (!voiceWindow.owns(context.sender)) return;
        pendingAsks.get(requestId)?.(outcome);
      },
      // The voice window's snapshot: kept for a late panel, forwarded to every
      // panel, and read for the one level the main process owns — whether an
      // exchange is live, which the media duck follows on every display. A
      // kind arrives only with the edge that opened the exchange, so its
      // presence is the count and no level change of its own is one.
      reportVoiceView(context, view, countedKind) {
        if (!voiceWindow.owns(context.sender)) return;
        dependencies.storeVoiceView(view);
        dependencies.broadcast(channels.onVoiceViewChanged, view);
        panels.setVoiceExchange(voiceExchangeActive(view.voiceStatus));
        if (countedKind !== undefined) {
          dependencies.recordProductEvent(PRODUCT_EVENT.VOICE_EXCHANGE, {
            exchange_kind: countedKind,
          });
        }
      },
      reportVoiceLevel(context, level) {
        if (!voiceWindow.owns(context.sender)) return;
        dependencies.broadcast(channels.onVoiceLevelChanged, level);
      },
      setShortcutCapturing(context, capturing) {
        if (!panels.owns(context.sender)) return;
        dependencies.setShortcutCapturing(capturing);
      },
      openMicrophoneSettings: () =>
        dependencies.openExternal(
          "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
        ),
      openProviderApiKeys(_context, providerId) {
        const provider = CREDENTIAL_PROVIDERS[providerId];
        if (provider.connection !== CREDENTIAL_CONNECTION.KEY || !provider.apiKeysUrl) return;
        void dependencies.openExternal(provider.apiKeysUrl);
      },
      focusPanel(context) {
        const displayId = panels.displayIdFor(context.sender);
        if (displayId !== undefined) panels.focusIfExpanded(displayId);
      },
      async requestRealtimeCredential() {
        // Chosen once, before the awaited mint: the source counted is the
        // source the credential actually came from, whatever the account did
        // while the request was in flight.
        const chosen = dependencies.chooseRealtimeCredentials();
        const credential = await chosen?.minter.mint();
        if (credential && chosen) {
          dependencies.recordProductEvent(PRODUCT_EVENT.VOICE_CALL_START, {
            credential_source: chosen.countedSource,
          });
        }
        return credential;
      },
      requestRealtimeDiagnostics: () =>
        dependencies.chooseRealtimeCredentials()?.minter.diagnostics() ??
        dependencies.unavailableDiagnostics(),
      recordAgentTrace(_context, trace) {
        dependencies.recordAgentTrace(trace);
      },
    },
    { ipcMain: dependencies.ipcMain, trustedSender: dependencies.trustedSender },
  );
}
