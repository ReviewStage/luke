declare global {
  interface Window {
    __PosthogExtensions__?: { readonly initSessionRecording?: unknown };
  }
}

export function sessionRecorderLoaded(): boolean {
  return window.__PosthogExtensions__?.initSessionRecording !== undefined;
}
