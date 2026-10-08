import { PRODUCT_EVENT, type RecordProductEvent } from "@sidecar/analytics";
import { type LiveDiagnostics, liveExchangeActive } from "@sidecar/live";
import { Effect, Option } from "effect";
import type { BrowserWindow, WebContents } from "electron";
import { channels } from "#shared/bridge";
import { ACT_KIND } from "#shared/messages/acts";
import type { ActRows } from "../act-router";
import type { AppStateStore } from "../app-state";
import type { ReportHandlers } from "../bridge-host";
import type { HostOperator } from "../gateway/host-operator";
import type { PanelManager } from "../window/panel-manager";

/** The hidden window the conversation lives in, as much of it as this file needs. */
interface VoiceWindowSurface {
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
  liveDiagnostics: () => Effect.Effect<Option.Option<LiveDiagnostics>>;
  recordProductEvent: RecordProductEvent;
  /** Whether a panel is recording a chord, which holds the talk and stop presses. */
  setShortcutCapturing: (capturing: boolean) => void;
}

type VoiceRuntimeActKind =
  | typeof ACT_KIND.VOICE_COMMAND
  | typeof ACT_KIND.VOICE_CREATE_LIVE_SESSION
  | typeof ACT_KIND.VOICE_END_LIVE_SESSION
  | typeof ACT_KIND.VOICE_REPORT_LIVE_TRANSPORT
  | typeof ACT_KIND.VOICE_REPORT_LIVE_ACTIVITY
  | typeof ACT_KIND.VOICE_STOP_SPEAKING
  | typeof ACT_KIND.VOICE_DIAGNOSTICS
  | typeof ACT_KIND.MICROPHONE_OPEN_SETTINGS;

export function voiceRuntimeActRows(
  dependencies: VoiceRuntimeDependencies,
): Pick<ActRows, VoiceRuntimeActKind> {
  const { voiceWindow, liveSession } = dependencies;
  return {
    // A panel's command to the voice window. The act's schema has already
    // bounded it; here it is checked to come from a panel — the voice window
    // does not command itself — and handed on.
    [ACT_KIND.VOICE_COMMAND]: ({ command }, { panel }) => {
      if (!panel) return;
      voiceWindow.current()?.webContents.send(channels.onVoiceCommand, { command });
    },
    // The peer is the voice window and nothing else: a panel offering an SDP,
    // or reporting a transport it does not hold, is answered nothing.
    [ACT_KIND.VOICE_CREATE_LIVE_SESSION]: ({ sdp, planId }, { voice }) =>
      voice
        ? Effect.map(liveSession.createLiveSession(sdp, planId), Option.getOrUndefined)
        : Effect.succeed(undefined),
    [ACT_KIND.VOICE_END_LIVE_SESSION]: (_payload, { voice }) =>
      voice ? Effect.as(liveSession.endLiveSession(), undefined) : Effect.succeed(undefined),
    [ACT_KIND.VOICE_REPORT_LIVE_TRANSPORT]: (report, { voice }) =>
      voice
        ? Effect.as(liveSession.reportLiveTransport(report), undefined)
        : Effect.succeed(undefined),
    [ACT_KIND.VOICE_REPORT_LIVE_ACTIVITY]: ({ idle }, { voice }) =>
      voice
        ? Effect.as(liveSession.reportLiveActivity(idle), undefined)
        : Effect.succeed(undefined),
    // The stop key, pressed in the voice window that owns the session; a
    // panel has no session to stop and is answered false.
    [ACT_KIND.VOICE_STOP_SPEAKING]: (_payload, { voice }) =>
      voice ? liveSession.stopSpeaking() : Effect.succeed(false),
    [ACT_KIND.VOICE_DIAGNOSTICS]: () =>
      Effect.map(dependencies.liveDiagnostics(), Option.getOrUndefined),
    [ACT_KIND.MICROPHONE_OPEN_SETTINGS]: () =>
      dependencies.openExternal(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
      ),
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
