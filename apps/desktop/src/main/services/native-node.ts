import { systemPreferences } from "electron";
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
import type { DesktopService } from "./service";

/** The capabilities this node offers the host by name; a capability no node offers is a typed refusal there. */
export interface NativeNodeCapabilities {
  /** Hands an address to the operating system; a throw is an open that did not land. */
  openExternal: (url: string) => Promise<void>;
  runAppleCalendarHelper: (
    helperArguments: readonly string[],
    timeoutMs: number,
  ) => Promise<string>;
}

interface NativeNodeDependencies {
  config: DesktopConfig;
  /** Where what these devices answer is written; the windows are told from it. */
  state: AppStateStore;
}

export interface NativeNode extends DesktopService {
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
}

/**
 * What this machine's own devices answer: the capabilities the host asks this
 * node for by name, and the watchers that report where Luke can be heard and
 * where the developer would be heard from. None of it reads audio, and none
 * of it writes a device beyond the one duck.
 */
export function createNativeNode(dependencies: NativeNodeDependencies): NativeNode {
  const { config, state } = dependencies;
  const mediaDuck = new MediaDuckController();
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

  return {
    name: "native",
    capabilities: {
      openExternal: config.openExternal,
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
    },
  };
}
