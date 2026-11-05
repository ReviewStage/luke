/**
 * paste-back-consent.ts -- a consent trip for a machine whose browser is elsewhere: the authorization page shown as a link, and the redirect it lands on pasted back.
 *
 * The same code flow as the loopback (`loopback-consent.ts`), asked with the
 * same options, so a caller hands either one to the sign-in it words: a
 * verifier and a state minted per trip, the page's URL built on a loopback
 * redirect, and the exchange run on the code the redirect carried. What
 * differs is how the code comes back. Nothing listens on the loopback: the
 * person signs in on a browser of their own, which fails to load the
 * redirect on a machine that is not this one, and pastes the address it was
 * sent to back here. That address is read as the loopback reads a callback
 * (its path and its state this trip's own), so a pasted address from
 * another trip, or one that carried a refusal, is refused before any code is
 * exchanged. The service needs nothing of its own for it, since the
 * redirect is the loopback one the client registered.
 */

import { SIGN_IN_FAILURE } from "@repo/features/words";
import { Effect, Result } from "effect";
import { Base64Url } from "effect/encoding";
import type {
  LoopbackConsent,
  LoopbackConsentOptions,
  LoopbackConsentOutcome,
  OpenConsent,
} from "./consent.js";
import { codeChallenge, createCodeVerifier } from "./pkce.js";

const LOOPBACK_HOST = "127.0.0.1";

/** The ports a pasted-back redirect names where its flow names none: the dynamic range, one picked per trip, since nothing listens on it. */
const DYNAMIC_PORTS = { FIRST: 49_152, COUNT: 16_384 } as const;

/** The state's random bytes, as many as the loopback's. */
const STATE_BYTES = 32;

/** Why a pasted address is not this trip's redirect, in words a terminal shows. */
export const PASTE_BACK_REASON = {
  NOT_AN_ADDRESS: "That is not the address the sign-in page sent you to.",
  OTHER_TRIP: "That address is from another sign-in. Start again and paste the newest one.",
  NOTHING_PASTED: "No address was pasted, so the sign-in was not finished.",
  CHALLENGE: "Could not prepare a secure sign-in on this machine.",
  SHOWN: "Could not show the sign-in page's address.",
} as const;

/** What a pasted address read as: the code to exchange, or why there is none. */
type PastedRead =
  | { readonly code: string }
  | {
      readonly reason: string;
      readonly failure?: (typeof SIGN_IN_FAILURE)[keyof typeof SIGN_IN_FAILURE];
    };

function stateOf(prefix: string | undefined): string {
  const random = Base64Url.encode(crypto.getRandomValues(new Uint8Array(STATE_BYTES)));
  return prefix ? `${prefix}.${random}` : random;
}

function portOf(ports: readonly number[] | undefined): number {
  const [named] = ports ?? [];
  if (named !== undefined) return named;
  const [random = 0] = crypto.getRandomValues(new Uint16Array(1));
  return DYNAMIC_PORTS.FIRST + (random % DYNAMIC_PORTS.COUNT);
}

/**
 * A pasted address read as this trip's redirect: a URL on the trip's own
 * callback path, carrying the trip's own state, and a code rather than a
 * refusal. Its ends are trimmed, since a terminal paste often brings a
 * space or a line with it.
 */
function readPasted(
  pasted: string,
  trip: { readonly state: string; readonly callbackPath: string },
  refused: string,
): PastedRead {
  let url: URL;
  try {
    url = new URL(pasted.trim());
  } catch {
    return { reason: PASTE_BACK_REASON.NOT_AN_ADDRESS };
  }
  if (url.pathname !== trip.callbackPath) return { reason: PASTE_BACK_REASON.NOT_AN_ADDRESS };
  if (url.searchParams.get("state") !== trip.state) return { reason: PASTE_BACK_REASON.OTHER_TRIP };
  const code = url.searchParams.get("code");
  if (url.searchParams.has("error") || !code) {
    return { reason: refused, failure: SIGN_IN_FAILURE.REFUSED };
  }
  return { code };
}

/**
 * Stands up paste-back trips, each reading the pasted address with `paste`:
 * the line the person pasted, or nothing where they pasted none. The page's
 * address goes to the trip's `openExternal`, which shows it rather than
 * opening a browser.
 */
export function pasteBackConsent(paste: Effect.Effect<string | undefined>): OpenConsent {
  return <Grant extends object>(options: LoopbackConsentOptions<Grant>): LoopbackConsent<Grant> => {
    let shown: string | undefined;

    const trip = Effect.fnUntraced(function* (): Effect.fn.Return<LoopbackConsentOutcome<Grant>> {
      const codeVerifier = createCodeVerifier();
      const state = stateOf(options.statePrefix);
      const redirectUri = `http://${LOOPBACK_HOST}:${portOf(options.ports)}${options.callbackPath}`;
      const challenge = yield* Effect.result(codeChallenge(codeVerifier));
      if (Result.isFailure(challenge)) return { reason: PASTE_BACK_REASON.CHALLENGE };
      const page = options.authorizationUrl({
        state,
        redirectUri,
        codeChallenge: challenge.success,
      });
      shown = page;
      const opened = yield* Effect.result(
        Effect.tryPromise(() => Promise.resolve(options.openExternal(page))),
      );
      if (Result.isFailure(opened)) {
        return { reason: PASTE_BACK_REASON.SHOWN, failure: SIGN_IN_FAILURE.BROWSER };
      }
      const pasted = yield* paste;
      if (pasted === undefined || pasted.trim().length === 0) {
        return { reason: PASTE_BACK_REASON.NOTHING_PASTED, failure: SIGN_IN_FAILURE.UNFINISHED };
      }
      const read = readPasted(
        pasted,
        { state, callbackPath: options.callbackPath },
        options.reasons.refused,
      );
      if ("reason" in read) return read;
      return yield* options.exchange({ code: read.code, state, redirectUri, codeVerifier });
    });

    return {
      signInEffect: () => trip(),
      // Note that a trip waits on the person's paste alone, which their own Ctrl-C ends.
      cancel(): void {},
      reopen(): void {
        if (shown !== undefined)
          void Promise.resolve(options.openExternal(shown)).catch(() => undefined);
      },
    };
  };
}
