import { randomUUID } from "node:crypto";
import type { BrainAppActRequest } from "@sidecar/brain/requests-wire";
import { ACT_RESULT_STATUS, type LateRef, lateRef, type WireRecord } from "@sidecar/wire";
import { systemPreferences } from "electron";
import { channels } from "#shared/bridge";
import {
  MICROPHONE_STATUS,
  type MicrophoneStatus,
  type OutputAudioState,
} from "#shared/messages/audio";
import type { AppAudioSlice, AppStateStore } from "../app-state";
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
import type { DesktopService } from "./service";

/**
 * How long an app act waits for the panel that alone can carry it. A panel
 * that does not answer within the round trip refuses the act on a clock
 * rather than holding the brain's turn open in the host.
 */
const BRAIN_APP_ACT_TIMEOUT_MS = 10_000;

/** What this machine's devices reach in the windows that draw for them. */
export interface NativeNodeLinks {
  /** The one window an app act is carried to; none open is a refusal, not a wait. */
  sendToPrimaryPanel: (channel: string, payload: BrainAppActRequest) => boolean;
}

/** The capabilities this node offers the host by name; a capability no node offers is a typed refusal there. */
export interface NativeNodeCapabilities {
  openExternal: (url: string) => Promise<void>;
  performAppAct: (action: BrainAppActRequest["action"]) => Promise<WireRecord>;
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
  /** The panel's answer to an act it was carried, matched to the ask that is waiting. */
  answerAppAct: (requestId: string, answer: WireRecord) => void;
  /**
   * Refuses every act still waiting on a panel. Asked for at the top of the
   * quit rather than left to this service's own stop: the panels are going,
   * so nothing can answer one, and the host's drain runs first and would
   * otherwise wait out the act's own clock for a promise that was never
   * going to settle.
   */
  refusePendingActs: () => void;
}

/**
 * What this machine's own devices answer: the capabilities the host asks this
 * node for by name, and the watchers that report where Luke can be heard and
 * where the developer would be heard from. None of it reads audio, and none
 * of it writes a device beyond the one duck.
 */
export function createNativeNode(dependencies: NativeNodeDependencies): NativeNode {
  const { config, state } = dependencies;
  const links: LateRef<NativeNodeLinks> = lateRef("the native node's links");
  const mediaDuck = new MediaDuckController();
  const pendingAppActs = new Map<string, (answer: WireRecord) => void>();
  let outputVolumeWatcher: OutputVolumeWatch | undefined;
  let microphoneRouteWatcher: MicrophoneRouteWatch | undefined;

  /**
   * One write of what this machine's own devices answer. An absence is
   * written as the key's absence rather than as an explicit `undefined`, so
   * a helper that went quiet and one that never spoke are the same document.
   */
  function writeAudio(patch: Partial<AppAudioSlice>): void {
    const next: AppAudioSlice = { ...state.snapshot().audio, ...patch };
    state.update({
      audio: {
        microphoneStatus: next.microphoneStatus,
        ...(next.microphoneRoute ? { microphoneRoute: next.microphoneRoute } : undefined),
        ...(next.outputAudio ? { outputAudio: next.outputAudio } : undefined),
      },
    });
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

  function performAppAct(action: BrainAppActRequest["action"]): Promise<WireRecord> {
    const requestId = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingAppActs.delete(requestId);
        resolve({
          status: ACT_RESULT_STATUS.REJECTED,
          reason: "The panel did not answer in time.",
        });
      }, BRAIN_APP_ACT_TIMEOUT_MS);
      const settle = (answer: WireRecord) => {
        clearTimeout(timer);
        pendingAppActs.delete(requestId);
        resolve(answer);
      };
      pendingAppActs.set(requestId, settle);
      if (!links.get().sendToPrimaryPanel(channels.onBrainAppAct, { requestId, action })) {
        settle({
          status: ACT_RESULT_STATUS.REJECTED,
          reason: "No panel is open to carry that.",
        });
      }
    });
  }

  function refusePendingActs(): void {
    for (const settle of pendingAppActs.values()) {
      settle({ status: ACT_RESULT_STATUS.REJECTED, reason: "Luke is quitting." });
    }
    pendingAppActs.clear();
  }

  return {
    name: "native",
    link: (next) => links.set(next),
    capabilities: {
      openExternal: config.openExternal,
      performAppAct,
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
    answerAppAct: (requestId, answer) => pendingAppActs.get(requestId)?.(answer),
    refusePendingActs,
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
      // other way still leaves no act waiting on a window that is gone.
      refusePendingActs();
    },
  };
}
