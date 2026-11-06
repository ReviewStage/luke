import type { AppAudioSlice } from "@repo/host/app-state";
import type { AppStateStore } from "@repo/host/client";
import type { DesktopService } from "@repo/host/desktop-service";
import {
  MICROPHONE_STATUS,
  type MicrophoneRoute,
  type MicrophoneStatus,
} from "@repo/settings/microphone";
import { Schema } from "effect";
import { systemPreferences } from "electron";
import {
  microphoneRouteWatcher as createMicrophoneRouteWatcher,
  type MicrophoneRouteWatch,
} from "../native/microphone-route";
import type { DesktopConfig } from "./desktop-config";

const readMicrophoneStatusWord = Schema.decodeUnknownSync(
  Schema.Literals(Object.values(MICROPHONE_STATUS)),
);

interface NativeNodeCapabilities {
  openExternal: (url: string) => Promise<void>;
}

interface NativeNodeDependencies {
  config: DesktopConfig;
  state: AppStateStore;
}

export interface NativeNode extends DesktopService {
  readonly capabilities: NativeNodeCapabilities;
  refreshMicrophoneStatus: () => MicrophoneStatus;
  requestMicrophone: () => Promise<MicrophoneStatus>;
  microphoneRouteWatcher: () => MicrophoneRouteWatch | undefined;
}

export function createNativeNode(dependencies: NativeNodeDependencies): NativeNode {
  const { config, state } = dependencies;
  let microphoneRouteWatcher: MicrophoneRouteWatch | undefined;

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
