import { randomUUID } from "node:crypto";
import type { BrainAppActionRequest } from "@sidecar/brain/requests-wire";
import type { HostNodeOpenKind } from "@sidecar/host";
import { ACTION_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import { systemPreferences } from "electron";
import { channels } from "#shared/bridge";
import type { AppAudioSlice } from "#shared/messages/app-state";
import {
  MICROPHONE_STATUS,
  type MicrophoneRoute,
  type MicrophoneStatus,
  type OutputAudioState,
} from "#shared/messages/audio";
import type { AppStateStore } from "../app-state";
import { runAppleCalendarHelper } from "../native/apple-calendar-helper";
import { MediaDuckController } from "../native/media-duck";
import {
  microphoneRouteWatcher as createMicrophoneRouteWatcher,
  type MicrophoneRouteWatch,
} from "../native/microphone-route";
import {
  outputVolumeWatcher as createOutputVolumeWatcher,
  type OutputVolumeWatch,
} from "../native/output-volume";
import type { DesktopConfig } from "./desktop-config";
import { createNodeOpen } from "./node-open";
import type { DesktopService } from "./service";

/**
 * How long an app act waits for the panel that alone can carry it. A panel
 * that does not answer within the round trip refuses the action on a clock
 * rather than holding the brain's turn open in the host.
 */
const BRAIN_APP_ACTION_TIMEOUT_MS = 10_000;

/** What this machine's devices reach in the windows that draw for them. */
interface NativeNodeLinks {
  /** The one window an app act is carried to; none open is a refusal, not a wait. */
  sendToPrimaryPanel: (channel: string, payload: BrainAppActionRequest) => boolean;
  /**
   * Every expanded panel back to its capsule, owed by a session opened at an
   * ask of Luke: the press its row would have taken stood no panel down, and
   * Luke floats above the very chat he was asked to bring forward.
   */
  standPanelsDown: () => void;
}

/** The capabilities this node offers the host by name; a capability no node offers is a typed refusal there. */
export interface NativeNodeCapabilities {
  openExternal: (url: string, kind: HostNodeOpenKind) => Promise<void>;
  performAppAction: (action: BrainAppActionRequest["action"]) => Promise<WireRecord>;
  runAppleCalendarHelper: (
    helperArguments: readonly string[],
    timeoutMs: number,
  ) => Promise<string>;
}

export interface NativeNodeDependencies {
  config: DesktopConfig;
  /** Where what these devices answer is written; the windows are told from it. */
  state: AppStateStore;
}

export interface NativeNode extends DesktopService {
  link: (links: NativeNodeLinks) => void;
  readonly capabilities: NativeNodeCapabilities;
  readonly mediaDuck: MediaDuckController;
  setMediaDuckEnabled: (enabled: boolean) => void;
  /**
   * Reads macOS's own answer now and writes it to the document. The
   * permission is the system's to move, and it moves while Luke runs, so
   * every reader takes it afresh rather than trusting what was written last.
   */
  refreshMicrophoneStatus: () => MicrophoneStatus;
  requestMicrophone: () => Promise<MicrophoneStatus>;
  microphoneRouteWatcher: () => MicrophoneRouteWatch | undefined;
  /** The panel's answer to an action it was carried, matched to the ask that is waiting. */
  answerAppAction: (requestId: string, answer: WireRecord) => void;
  /**
   * Refuses every action still waiting on a panel. Asked for at the top of the
   * quit rather than left to this service's own stop: the panels are going,
   * so nothing can answer one, and the host's drain runs first and would
   * otherwise wait out the action's own clock for a promise that was never
   * going to settle.
   */
  refusePendingActions: () => void;
}

/**
 * What this machine's own devices answer: the capabilities the host asks this
 * node for by name, and the watchers that report where Luke can be heard and
 * where the developer would be heard from. None of it reads audio, and none
 * of it writes a device beyond the one duck.
 */
export function createNativeNode(dependencies: NativeNodeDependencies): NativeNode {
  const { config, state } = dependencies;
  let heldLinks: NativeNodeLinks | undefined;
  const links = (): NativeNodeLinks => {
    if (heldLinks === undefined) {
      throw new Error("the native node's links are read before link() has run");
    }
    return heldLinks;
  };
  const mediaDuck = new MediaDuckController();
  const pendingAppActions = new Map<string, (answer: WireRecord) => void>();
  let outputVolumeWatcher: OutputVolumeWatch | undefined;
  let microphoneRouteWatcher: MicrophoneRouteWatch | undefined;

  /** One write of what this machine's own devices answer, into the one document. */
  function writeAudio(patch: {
    microphoneStatus?: MicrophoneStatus;
    microphoneRoute?: MicrophoneRoute | undefined;
    outputAudio?: OutputAudioState | undefined;
  }): void {
    const current = state.snapshot().audio;
    const microphoneRoute =
      "microphoneRoute" in patch ? patch.microphoneRoute : current.microphoneRoute;
    const outputAudio = "outputAudio" in patch ? patch.outputAudio : current.outputAudio;
    const audio: AppAudioSlice = {
      microphoneStatus: patch.microphoneStatus ?? current.microphoneStatus,
    };
    if (microphoneRoute !== undefined) audio.microphoneRoute = microphoneRoute;
    if (outputAudio !== undefined) audio.outputAudio = outputAudio;
    state.update({ audio });
  }

  function readMicrophoneStatus(): MicrophoneStatus {
    if (config.platform !== "darwin") return MICROPHONE_STATUS.GRANTED;
    // SAFETY: MicrophoneStatus mirrors Electron's documented media-access status union.
    return systemPreferences.getMediaAccessStatus("microphone") as MicrophoneStatus;
  }

  function refreshMicrophoneStatus(): MicrophoneStatus {
    const status = readMicrophoneStatus();
    writeAudio({ microphoneStatus: status });
    return status;
  }

  function performAppAction(action: BrainAppActionRequest["action"]): Promise<WireRecord> {
    const requestId = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingAppActions.delete(requestId);
        resolve({
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: "The panel did not answer in time.",
        });
      }, BRAIN_APP_ACTION_TIMEOUT_MS);
      const settle = (answer: WireRecord) => {
        clearTimeout(timer);
        pendingAppActions.delete(requestId);
        resolve(answer);
      };
      pendingAppActions.set(requestId, settle);
      if (!links().sendToPrimaryPanel(channels.onBrainAppAction, { requestId, action })) {
        settle({
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: "No panel is open to carry that.",
        });
      }
    });
  }

  function refusePendingActions(): void {
    for (const settle of pendingAppActions.values()) {
      settle({ status: ACTION_RESULT_STATUS.REJECTED, reason: "Luke is quitting." });
    }
    pendingAppActions.clear();
  }

  return {
    name: "native",
    link: (next) => {
      heldLinks = next;
    },
    capabilities: {
      openExternal: createNodeOpen({
        openExternal: config.openExternal,
        fixtureMode: config.launch.fixtureMode,
        standPanelsDown: () => links().standPanelsDown(),
      }),
      performAppAction,
      runAppleCalendarHelper,
    },
    mediaDuck,
    setMediaDuckEnabled: (enabled) => mediaDuck.setEnabled(enabled),
    refreshMicrophoneStatus,
    requestMicrophone: async () => {
      if (config.platform !== "darwin") return MICROPHONE_STATUS.GRANTED;
      if (refreshMicrophoneStatus() === MICROPHONE_STATUS.NOT_DETERMINED) {
        await systemPreferences.askForMediaAccess("microphone");
      }
      return refreshMicrophoneStatus();
    },
    microphoneRouteWatcher: () => microphoneRouteWatcher,
    answerAppAction: (requestId, answer) => pendingAppActions.get(requestId)?.(answer),
    refusePendingActions,
    start: async () => {
      refreshMicrophoneStatus();
      if (!config.runMode.observesProviders) return;
      const send = (output: OutputAudioState | undefined) => {
        writeAudio({ outputAudio: output });
      };
      outputVolumeWatcher = createOutputVolumeWatcher({
        onState: send,
        onUnavailable: () => send(undefined),
      });
      if (!outputVolumeWatcher.start()) outputVolumeWatcher = undefined;
      microphoneRouteWatcher = createMicrophoneRouteWatcher({
        onRoute: (route) => {
          writeAudio({ microphoneRoute: route });
        },
        onUnavailable: () => {
          writeAudio({ microphoneRoute: undefined });
        },
      });
      if (!microphoneRouteWatcher.start()) microphoneRouteWatcher = undefined;
    },
    stop: async () => {
      outputVolumeWatcher?.stop();
      outputVolumeWatcher = undefined;
      microphoneRouteWatcher?.stop();
      microphoneRouteWatcher = undefined;
      mediaDuck.stop();
      // Ordinarily the quit has already refused these; a stop reached any
      // other way still leaves no action waiting on a window that is gone.
      refusePendingActions();
    },
  };
}
