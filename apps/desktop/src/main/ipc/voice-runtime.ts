import { PRODUCT_EVENT, type RecordProductEvent } from "@luke/features/analytics";
import { actPortFor, type PlatformActProcedures } from "@luke/host/act-port";
import { channels } from "@luke/host/bridge";
import type { AppStateStore } from "@luke/host/client";
import { VOICE_RUNTIME_ACT_KIND } from "@luke/host/contract";
import type { HostOperator } from "@luke/host/host-operator";
import { type LiveDiagnostics, liveExchangeActive } from "@luke/live";
import { callInProgress, IDLE_VOICE_VIEW, VOICE_COMMAND } from "@luke/voice/voice-view";
import { Effect, Option } from "effect";
import type { BrowserWindow, WebContents } from "electron";
import type { ReportHandlers } from "../bridge-host";
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
  | "tasksStopWork"
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

type VoiceRuntimeActKind = (typeof VOICE_RUNTIME_ACT_KIND)[keyof typeof VOICE_RUNTIME_ACT_KIND];

const voicePort = actPortFor<WebContents>();

/** Stop Luke on a task (`luke.stop`): a call about it is told to stop, as the stop key always told it, and his turn on it is stopped on the service, call or no call. */
function stopLuke(dependencies: VoiceRuntimeDependencies, named: string | undefined) {
  const snapshot = dependencies.state.snapshot();
  const view = snapshot.voice.view ?? IDLE_VOICE_VIEW;
  const callTask = callInProgress(view) ? view.callTaskId : undefined;
  const taskId = named ?? callTask ?? snapshot.tasks.activeTaskId;
  if (taskId === undefined) return Effect.void;
  if (callTask === taskId) {
    dependencies.voiceWindow
      .current()
      ?.webContents.send(channels.onVoiceCommand, { command: VOICE_COMMAND.STOP_SPEAKING });
  }
  return dependencies.liveSession.tasksStopWork(taskId);
}

export function voiceRuntimeProcedures(
  dependencies: VoiceRuntimeDependencies,
): Pick<PlatformActProcedures<WebContents>, VoiceRuntimeActKind> {
  const { panels, voiceWindow, liveSession, state } = dependencies;
  return {
    // A panel's or the call window's command to the voice window. The act's
    // schema has already bounded it; here it is checked to come from one of
    // the two — the voice window does not command itself — and handed on.
    [VOICE_RUNTIME_ACT_KIND.VOICE_COMMAND]: voicePort[VOICE_RUNTIME_ACT_KIND.VOICE_COMMAND].handler(
      ({ input, context }) => {
        const { panel, call } = context.actor;
        if (!panel && !call) return;
        voiceWindow
          .current()
          ?.webContents.send(channels.onVoiceCommand, { command: input.command });
      },
    ),
    // The call card's way back, from the floating window or from a panel's
    // own card, names no task: the call's is read here, so it cannot bring
    // forward a task the call is not about.
    [VOICE_RUNTIME_ACT_KIND.CALL_SHOW_TASK]: voicePort[
      VOICE_RUNTIME_ACT_KIND.CALL_SHOW_TASK
    ].handler(({ context }) => {
      const { call, panel } = context.actor;
      const taskId = state.snapshot().voice.view?.callTaskId;
      if ((!call && !panel) || taskId === undefined) return;
      panels.focusExpanded();
      panels.broadcast(channels.onShowTask, { taskId });
    }),
    // The peer is the voice window and nothing else: a panel offering an SDP,
    // or reporting a transport it does not hold, is answered nothing.
    [VOICE_RUNTIME_ACT_KIND.VOICE_CREATE_LIVE_SESSION]: voicePort[
      VOICE_RUNTIME_ACT_KIND.VOICE_CREATE_LIVE_SESSION
    ].effect(function* ({ input, context }) {
      if (!context.actor.voice) return undefined;
      const created = yield* liveSession.createLiveSession(input.sdp, input.taskId);
      return Option.getOrUndefined(created);
    }),
    [VOICE_RUNTIME_ACT_KIND.VOICE_END_LIVE_SESSION]: voicePort[
      VOICE_RUNTIME_ACT_KIND.VOICE_END_LIVE_SESSION
    ].effect(function* ({ input, context }) {
      if (context.actor.voice) yield* liveSession.endLiveSession(input);
      return undefined;
    }),
    [VOICE_RUNTIME_ACT_KIND.VOICE_REPORT_LIVE_TRANSPORT]: voicePort[
      VOICE_RUNTIME_ACT_KIND.VOICE_REPORT_LIVE_TRANSPORT
    ].effect(function* ({ input, context }) {
      if (context.actor.voice) yield* liveSession.reportLiveTransport(input);
      return undefined;
    }),
    [VOICE_RUNTIME_ACT_KIND.VOICE_REPORT_LIVE_ACTIVITY]: voicePort[
      VOICE_RUNTIME_ACT_KIND.VOICE_REPORT_LIVE_ACTIVITY
    ].effect(function* ({ input, context }) {
      if (context.actor.voice) yield* liveSession.reportLiveActivity(input.idle);
      return undefined;
    }),
    // The stop key, pressed in the voice window that owns the session; a
    // panel has no session to stop and is answered false.
    [VOICE_RUNTIME_ACT_KIND.VOICE_STOP_SPEAKING]: voicePort[
      VOICE_RUNTIME_ACT_KIND.VOICE_STOP_SPEAKING
    ].effect(function* ({ context }) {
      if (!context.actor.voice) return false;
      return yield* liveSession.stopSpeaking();
    }),
    [VOICE_RUNTIME_ACT_KIND.LUKE_STOP]: voicePort[VOICE_RUNTIME_ACT_KIND.LUKE_STOP].effect(
      function* ({ input, context }) {
        const { voice, panel, call } = context.actor;
        if (voice || panel || call) yield* stopLuke(dependencies, input.taskId);
      },
    ),
    [VOICE_RUNTIME_ACT_KIND.VOICE_DIAGNOSTICS]: voicePort[
      VOICE_RUNTIME_ACT_KIND.VOICE_DIAGNOSTICS
    ].effect(function* () {
      return Option.getOrUndefined(yield* dependencies.liveDiagnostics());
    }),
    [VOICE_RUNTIME_ACT_KIND.MICROPHONE_OPEN_SETTINGS]: voicePort[
      VOICE_RUNTIME_ACT_KIND.MICROPHONE_OPEN_SETTINGS
    ].effect(function* () {
      yield* Effect.promise(() =>
        dependencies.openExternal(
          "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
        ),
      );
    }),
  };
}

export function voiceRuntimeReports(
  dependencies: VoiceRuntimeDependencies,
): Pick<ReportHandlers, "reportVoiceView" | "setShortcutCapturing"> {
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
    setShortcutCapturing(context, capturing) {
      if (!panels.owns(context.sender)) return;
      dependencies.setShortcutCapturing(capturing);
    },
  };
}
