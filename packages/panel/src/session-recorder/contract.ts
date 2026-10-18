/**
 * contract.ts -- what session replay and the recorder's bundle say to each other: the one name the client finds it by.
 *
 * The recorder (rrweb and the library's replay engine) is nearly a tenth of
 * what the panel's bundle would otherwise carry, and a window that never
 * records, the voice window and the call window, would parse it for nothing.
 * So it ships as a bundle of its own (`session-recorder.js`, built from
 * `./index.ts`) that `../session-replay.ts` loads before it starts the
 * client, the first time a run is to be recorded. That bundle is the
 * library's own recorder script, the one its full build fetches from the
 * library's host, served as the panel's own chunk instead, since the
 * renderer's policy admits no script from elsewhere. It registers itself
 * where the client looks for it, `window.__PosthogExtensions__`, and this
 * file names that and nothing more: nothing here imports a value, so the
 * panel carries none of the recorder.
 *
 * Masking is none of the recorder's own: the client hands it the options
 * `init` was given, so `SESSION_REPLAY_MASKING` decides what it records
 * whichever bundle it arrived in.
 */

/**
 * Where the library's client looks for a recorder already loaded, which the
 * recorder's script writes as it runs. The library does not declare it;
 * `session-replay.test.ts` asserts the name against the installed recorder.
 */
declare global {
  interface Window {
    __PosthogExtensions__?: { readonly initSessionRecording?: unknown };
  }
}

/** Whether the recorder's bundle has run in this window. */
export function sessionRecorderLoaded(): boolean {
  return window.__PosthogExtensions__?.initSessionRecording !== undefined;
}
