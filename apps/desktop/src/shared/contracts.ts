import type { FixtureSnapshot, Rectangle, ResolvedNotchGeometry, WindowMode } from "@sidecar/core";

export type { WindowMode } from "@sidecar/core";

export type MicrophoneStatus = "not-determined" | "granted" | "denied" | "restricted" | "unknown";

export interface DisplayDiagnostic {
  id: number;
  label: string;
  bounds: Rectangle;
  workArea: Rectangle;
  scaleFactor: number;
  notch: ResolvedNotchGeometry;
}

export interface AppBootstrap {
  mode: WindowMode;
  profile: string;
  fixture: FixtureSnapshot;
  packaged: boolean;
  platform: string;
  electronVersion: string;
  chromiumVersion: string;
  nodeVersion: string;
  microphoneStatus: MicrophoneStatus;
  display: DisplayDiagnostic;
}

export interface AppBridge {
  getBootstrap(): Promise<AppBootstrap>;
  setExpanded(expanded: boolean): Promise<WindowMode>;
  setPointerInterception(interceptsPointer: boolean): void;
  requestMicrophone(): Promise<MicrophoneStatus>;
  notifyReady(): void;
  quit(): void;
  onLifecycle(callback: (eventName: string) => void): () => void;
  onStartMicrophone(callback: () => void): () => void;
  onDisplayChanged(callback: (display: DisplayDiagnostic) => void): () => void;
}

export const channels = {
  bootstrap: "app:bootstrap",
  setExpanded: "app:set-expanded",
  setPointerInterception: "app:set-pointer-interception",
  requestMicrophone: "app:request-microphone",
  rendererReady: "app:renderer-ready",
  lifecycle: "app:lifecycle",
  startMicrophone: "app:start-microphone",
  displayChanged: "app:display-changed",
  quit: "app:quit",
} as const;
