import type { AppBridge } from "#shared/contracts";

declare global {
  interface Window {
    sidecar: AppBridge;
  }
}
