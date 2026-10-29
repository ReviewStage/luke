import type { AppAudioSlice } from "@luke/host/app-state";
import type { AppStateStore } from "@luke/host/client";
import type { DesktopService } from "@luke/host/desktop-service";
import {
  MICROPHONE_STATUS,
  type MicrophoneRoute,
  type MicrophoneStatus,
} from "@luke/settings/microphone";
import { Schema } from "effect";
import { systemPreferences } from "electron";
import {
  microphoneRouteWatcher as createMicrophoneRouteWatcher,
  type MicrophoneRouteWatch,
} from "../native/microphone-route";
import type { DesktopConfig } from "./desktop-config";

/** Electron's media-access status word, read as one this build names; Electron documents no other. */
const readMicrophoneStatusWord = Schema.decodeUnknownSync(
  Schema.Literals(Object.values(MICROPHONE_STATUS)),
);

/** The capabilities this node offers the host by name; a capability no node offers is a typed refusal there. */
interface NativeNodeCapabilities {
  /** Hands an address to the operating system; a throw is an open that did not land. */
  openExternal: (url: string) => Promise<void>;
}

interface NativeNodeDependencies {
  config: DesktopConfig;
  /** Where what these devices answer is written; the windows are told from it. */
  state: AppStateStore;
}

export interface NativeNode extends DesktopService {
  readonly capabilities: NativeNodeCapabilities;
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
 * node for by name, the microphone's permission, and the watcher that reports
 * where the developer would be heard from. None of it reads audio or writes a
 * device.
 */
export function createNativeNode(dependencies: NativeNodeDependencies): NativeNode {
  const { config, state } = dependencies;
  let microphoneRouteWatcher: MicrophoneRouteWatch | undefined;

  /** One write of what this machine's own devices answer, into the one document. */
  function writeAudio(patch: {
    microphoneStatus?: MicrophoneStatus;
    microphoneRoute?: MicrophoneRoute | undefined;
  }): void {
    const current = state.snapshot().audio;
    const microphoneRoute =
      "microphoneRoute" in patch ? patch.microphoneRoute : current.microphoneRoute;
    const audio: AppAudioSlice = {
      microphoneStatus: patch.microphoneStatus ?? current.microphoneStatus,
    };
    if (microphoneRoute !== undefined) audio.microphoneRoute = microphoneRoute;
    state.update({ audio });
  }

  function readMicrophoneStatus(): MicrophoneStatus {
    if (config.platform !== "darwin") return MICROPHONE_STATUS.GRANTED;
    return readMicrophoneStatusWord(systemPreferences.getMediaAccessStatus("microphone"));
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
    },
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
      microphoneRouteWatcher?.stop();
      microphoneRouteWatcher = undefined;
    },
  };
}
