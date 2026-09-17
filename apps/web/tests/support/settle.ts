// settle.ts -- the waits a voice suite makes on the real clock against the real store.
import { polled } from "@sidecar/voice/testing";

/**
 * The voice suites stand the service on the store's own runtime, whose clock
 * is the real one, so a wait here is real time and a suite holding one runs
 * under `it.live`. A wait on a row a real database has to land is a poll on a
 * `Schedule` (`settled`, which is `polled` under the name the suites read); a
 * wait on something a callback announces is event-driven and polls nothing
 * (`arrival`, beside it in `@sidecar/voice/testing`); a wait for nothing more
 * to arrive is the one wait that is a plain `Effect.sleep`, bounded and stated
 * at its site.
 */
export const settled = polled;
