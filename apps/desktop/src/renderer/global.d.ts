import type { AppBridge } from "#shared/bridge";

declare global {
  interface Window {
    sidecar: AppBridge;
  }
}
