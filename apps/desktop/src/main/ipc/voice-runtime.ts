import { PRODUCT_EVENT, type RecordProductEvent } from "@sidecar/analytics";
import { CREDENTIAL_CONNECTION, CREDENTIAL_PROVIDERS } from "@sidecar/credentials";
import { type LiveDiagnostics, liveExchangeActive } from "@sidecar/live";
import type { LiveConversationLine } from "@sidecar/session";
import { Effect } from "effect";
import type { BrowserWindow, WebContents } from "electron";
import { channels } from "#shared/bridge";
import { ACT_KIND } from "#shared/messages/acts";
import { VOICE_COMMAND, VOICE_COMMAND_OUTCOME } from "#shared/messages/voice-view";
import type { ActRows } from "../act-router";
import type { AppStateStore } from "../app-state";
import type { ReportHandlers } from "../bridge-host";
import type { HostOperator } from "../gateway/host-operator";
import type { PanelManager } from "../window/panel-manager";

/** The hidden window the conversation lives in, as much of it as this file needs. */
export interface VoiceWindowSurface {
  current(): BrowserWindow | undefined;
  owns(webContents: WebContents): boolean;
}

/** The host's one live session, as the voice window's five acts reach it through the operator client. */
type LiveSessionActs = Pick<
  HostOperator,
  | "createLiveSession"
  | "endLiveSession"
  | "reportLiveTransport"
  | "reportLiveActivity"
  | "stopSpeaking"
>;

export interface VoiceRuntimeDependencies {
  panels: PanelManager;
  voiceWindow: VoiceWindowSurface;
  /** Where the voice window's own reports are written; every panel is told from it. */
  state: AppStateStore;
  openExternal: (url: string) => Promise<void>;
  liveSession: LiveSessionActs;
  liveDiagnostics: () => Effect.Effect<LiveDiagnostics | undefined>;
  recordProductEvent: RecordProductEvent;
  /**
   * The Conversation Clear, begun here as the voice window is told, and
   * answering whether the service took it: the thread every panel draws is the
   * service's, so a false answer is what the panel shows as a Clear that did
   * not go, while the voice window has already retired its own turns at the press.
   */
  clearConversation: () => Effect.Effect<boolean>;
  /** Whether a panel is recording a chord, which holds the talk and stop presses. */
  setShortcutCapturing: (capturing: boolean) => void;
  /**
   * A read of the Conversation asked for now: the voice window's report says
   * a spoken line settled or left with its call, which is when the service
   * writes it, and the panel draws the line until the record shows it.
   */
  refreshConversation: () => void;
}

/**
 * Whether one report says the record is being written under a line the last
 * one carried: a row settled since, or a row left the report — the call
 * closing writes whatever still stood. Either is the moment to read the
 * record rather than wait the poll's cadence out.
 */
export function recordMovedUnderLines(
  previous: readonly LiveConversationLine[],
  next: readonly LiveConversationLine[],
): boolean {
  const settled = (lines: readonly LiveConversationLine[]) =>
    lines.filter((line) => line.settled).length;
  return settled(next) > settled(previous) || next.length < previous.length;
}

type VoiceRuntimeActKind =
  | typeof ACT_KIND.VOICE_COMMAND
  | typeof ACT_KIND.VOICE_CREATE_LIVE_SESSION
  | typeof ACT_KIND.VOICE_END_LIVE_SESSION
  | typeof ACT_KIND.VOICE_REPORT_LIVE_TRANSPORT
  | typeof ACT_KIND.VOICE_REPORT_LIVE_ACTIVITY
  | typeof ACT_KIND.VOICE_STOP_SPEAKING
  | typeof ACT_KIND.VOICE_DIAGNOSTICS
  | typeof ACT_KIND.MICROPHONE_OPEN_SETTINGS
  | typeof ACT_KIND.CREDENTIAL_OPEN_API_KEYS;

export function voiceRuntimeActRows(
  dependencies: VoiceRuntimeDependencies,
): Pick<ActRows, VoiceRuntimeActKind> {
  const { voiceWindow, liveSession } = dependencies;
  return {
    // A panel's command to the voice window. The act's schema has already
    // bounded it; here it is checked to come from a panel — the voice window
    // does not command itself — and handed on. A Clear reaches the service
    // from here, because the main process is every panel's relay to the
    // service that holds the thread; the voice window is told to retire its
    // own turns at the press, whatever the service later answers, and the
    // panel hears whether the Clear went.
    [ACT_KIND.VOICE_COMMAND]: ({ command }, { panel }) =>
      Effect.gen(function* () {
        if (!panel) return undefined;
        // The voice window is told in this act's synchronous prefix — before
        // the service is waited on — so its turns, marks, and context retire
        // at the press. The answer, the service's, comes after and goes to
        // the panel alone.
        voiceWindow.current()?.webContents.send(channels.onVoiceCommand, { command });
        if (command !== VOICE_COMMAND.CLEAR_CONVERSATION) return undefined;
        return (yield* dependencies.clearConversation())
          ? VOICE_COMMAND_OUTCOME.ACCEPTED
          : VOICE_COMMAND_OUTCOME.REFUSED;
      }),
    // The peer is the voice window and nothing else: a panel offering an SDP,
    // or reporting a transport it does not hold, is answered nothing.
    [ACT_KIND.VOICE_CREATE_LIVE_SESSION]: ({ sdp }, { voice }) =>
      voice ? liveSession.createLiveSession(sdp) : Effect.succeed(undefined),
    [ACT_KIND.VOICE_END_LIVE_SESSION]: (_payload, { voice }) =>
      voice ? Effect.as(liveSession.endLiveSession(), undefined) : Effect.succeed(undefined),
    [ACT_KIND.VOICE_REPORT_LIVE_TRANSPORT]: ({ state }, { voice }) =>
      voice
        ? Effect.as(liveSession.reportLiveTransport(state), undefined)
        : Effect.succeed(undefined),
    [ACT_KIND.VOICE_REPORT_LIVE_ACTIVITY]: ({ idle }, { voice }) =>
      voice
        ? Effect.as(liveSession.reportLiveActivity(idle), undefined)
        : Effect.succeed(undefined),
    // The stop key, pressed in the voice window that owns the session; a
    // panel has no session to stop and is answered false.
    [ACT_KIND.VOICE_STOP_SPEAKING]: (_payload, { voice }) =>
      voice ? liveSession.stopSpeaking() : Effect.succeed(false),
    [ACT_KIND.VOICE_DIAGNOSTICS]: () => dependencies.liveDiagnostics(),
    [ACT_KIND.MICROPHONE_OPEN_SETTINGS]: () =>
      dependencies.openExternal(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
      ),
    [ACT_KIND.CREDENTIAL_OPEN_API_KEYS]: ({ providerId }) => {
      const provider = CREDENTIAL_PROVIDERS[providerId];
      if (provider.connection !== CREDENTIAL_CONNECTION.KEY || !provider.apiKeysUrl) return;
      void dependencies.openExternal(provider.apiKeysUrl);
    },
  };
}

export function voiceRuntimeReports(
  dependencies: VoiceRuntimeDependencies,
): Pick<ReportHandlers, "reportVoiceView" | "reportVoiceLevel" | "setShortcutCapturing"> {
  const { panels, voiceWindow } = dependencies;
  return {
    // The voice window's snapshot: written to the document, from which every
    // panel is told and a late one bootstraps, and read for the one level the
    // main process owns — whether an exchange is live, which the media duck
    // follows on every display. A kind arrives only with the edge that opened
    // the exchange, so its presence is the count and no level change of its
    // own is one.
    reportVoiceView(context, view, countedKind) {
      if (!voiceWindow.owns(context.sender)) return;
      const { state } = dependencies;
      const held = state.snapshot().voice;
      state.update({ voice: { ...held, view } });
      panels.setVoiceExchange(liveExchangeActive(view));
      if (
        recordMovedUnderLines(held.view?.liveConversationLines ?? [], view.liveConversationLines)
      ) {
        dependencies.refreshConversation();
      }
      if (countedKind !== undefined) {
        dependencies.recordProductEvent(PRODUCT_EVENT.VOICE_EXCHANGE, {
          exchange_kind: countedKind,
        });
      }
    },
    // Relayed to the panels rather than written to the document: a loudness is
    // a reading that expires before the next one arrives, so no panel
    // bootstraps from it and no version of the document should carry one.
    reportVoiceLevel(context, levels) {
      if (!voiceWindow.owns(context.sender)) return;
      panels.broadcast(channels.onVoiceLevelChanged, levels);
    },
    setShortcutCapturing(context, capturing) {
      if (!panels.owns(context.sender)) return;
      dependencies.setShortcutCapturing(capturing);
    },
  };
}
