import { randomUUID } from "node:crypto";
import type { BrainAppActRequest } from "@sidecar/brain/requests-wire";
import { ACT_RESULT_STATUS, type LateRef, lateRef, type WireRecord } from "@sidecar/wire";
import { systemPreferences } from "electron";
import { channels } from "#shared/bridge";
import {
  MICROPHONE_STATUS,
  type MicrophoneRoute,
  type MicrophoneStatus,
  type OutputAudioState,
} from "#shared/messages/audio";
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
  broadcast: <Payload>(channel: string, payload: Payload) => void;
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

export interface NativeNode extends DesktopService {
  link: (links: NativeNodeLinks) => void;
  readonly capabilities: NativeNodeCapabilities;
  readonly mediaDuck: MediaDuckController;
  setMediaDuckEnabled: (enabled: boolean) => void;
  microphoneStatus: () => MicrophoneStatus;
  requestMicrophone: () => Promise<MicrophoneStatus>;
  outputAudio: () => OutputAudioState | undefined;
  microphoneRoute: () => MicrophoneRoute | undefined;
  microphoneRouteWatcher: () => MicrophoneRouteWatch | undefined;
  /** The panel's answer to an act it was carried, matched to the ask that is waiting. */
  answerAppAct: (requestId: string, answer: WireRecord) => void;
}

/**
 * What this machine's own devices answer: the capabilities the host asks this
 * node for by name, and the watchers that report where Luke can be heard and
 * where the developer would be heard from. None of it reads audio, and none
 * of it writes a device beyond the one duck.
 */
export function createNativeNode(config: DesktopConfig): NativeNode {
  const links: LateRef<NativeNodeLinks> = lateRef("the native node's links");
  const mediaDuck = new MediaDuckController();
  const pendingAppActs = new Map<string, (answer: WireRecord) => void>();
  let outputAudio: OutputAudioState | undefined;
  let outputVolumeWatcher: OutputVolumeWatch | undefined;
  let microphoneRoute: MicrophoneRoute | undefined;
  let microphoneRouteWatcher: MicrophoneRouteWatch | undefined;

  function microphoneStatus(): MicrophoneStatus {
    if (config.platform !== "darwin") return MICROPHONE_STATUS.GRANTED;
    // SAFETY: MicrophoneStatus mirrors Electron's documented media-access status union.
    return systemPreferences.getMediaAccessStatus("microphone") as MicrophoneStatus;
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
    microphoneStatus,
    requestMicrophone: async () => {
      if (config.platform !== "darwin") return MICROPHONE_STATUS.GRANTED;
      if (microphoneStatus() === MICROPHONE_STATUS.NOT_DETERMINED) {
        await systemPreferences.askForMediaAccess("microphone");
      }
      const status = microphoneStatus();
      links.get().broadcast(channels.onMicrophoneStatusChanged, status);
      return status;
    },
    outputAudio: () => outputAudio,
    microphoneRoute: () => microphoneRoute,
    microphoneRouteWatcher: () => microphoneRouteWatcher,
    answerAppAct: (requestId, answer) => pendingAppActs.get(requestId)?.(answer),
    start: async () => {
      if (!config.runMode.observesProviders) return;
      const send = (state: OutputAudioState | undefined) => {
        outputAudio = state;
        links.get().broadcast(channels.onOutputAudioChanged, state);
      };
      outputVolumeWatcher = createOutputVolumeWatcher({
        onState: send,
        onUnavailable: () => send(undefined),
      });
      if (!outputVolumeWatcher.start()) outputVolumeWatcher = undefined;
      microphoneRouteWatcher = createMicrophoneRouteWatcher({
        onRoute: (route) => {
          microphoneRoute = route;
        },
        onUnavailable: () => {
          microphoneRoute = undefined;
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
      // An act still waiting on a panel that is going away is refused rather
      // than left open: the host journals a refusal, and never a promise that
      // outlives the window it was asked of.
      for (const settle of pendingAppActs.values()) {
        settle({ status: ACT_RESULT_STATUS.REJECTED, reason: "Luke is quitting." });
      }
      pendingAppActs.clear();
    },
  };
}
