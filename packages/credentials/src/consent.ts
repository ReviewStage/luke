/**
 * consent.ts -- what a consent trip is asked and answers, apart from how a platform takes it.
 *
 * The account session manager words a trip — its pages, its reasons, the
 * authorization page's URL, the exchange — and hands it to an `OpenConsent`
 * it was given. The desktop's is the loopback in `@luke/credentials/node`,
 * which reaches `node:http`; nothing here does, so the manager loads where
 * Node does not.
 */
import type { Effect, Scope } from "effect";
import type { LoopbackConnectionSource } from "./loopback-page.js";

/**
 * What a withdrawn trip settles as. A caller that must tell a cancellation —
 * an ordinary outcome — from a failure worth reporting compares against this.
 */
export const LOOPBACK_CONSENT_CANCELLED = "Sign-in was cancelled.";

/** What one finished consent trip settled on. `reason` is a sentence for a row. */
export type LoopbackConsentOutcome<Grant> = Grant | { reason: string };

/** One landing card's words. The tone and the mark are the flow's own. */
export interface LoopbackConsentCard {
  /** The pill's one word or two: "Signed in", "Not connected". */
  badge: string;
  title: string;
  body: string;
}

/** The two cards a trip can end on, worded by the flow that owns it. */
interface LoopbackConsentPages {
  granted: LoopbackConsentCard;
  notGranted: LoopbackConsentCard;
}

/** The two sentences a row shows that name the flow's own provider. */
interface LoopbackConsentReasons {
  /** The provider's redirect carried a refusal, or carried no code. */
  refused: string;
  /** Nothing came back before the wait expired. */
  timedOut: string;
}

export interface LoopbackAuthorization {
  /** This trip's own state, which the callback is matched against. */
  state: string;
  /** The bound loopback address the provider must send the code back to. */
  redirectUri: string;
  /** The S256 challenge for the verifier the exchange will be handed. */
  codeChallenge: string;
}

export interface LoopbackExchange {
  code: string;
  /** This trip's own state, which the callback carried back. */
  state: string;
  redirectUri: string;
  /** The verifier whose challenge the authorization page was shown. */
  codeVerifier: string;
}

export interface LoopbackConsentOptions<Grant> {
  /**
   * The registered ports to try in order, first that binds. Omitted means one
   * ephemeral port, which is what a provider documenting loopback redirects as
   * exempt from exact matching allows — and the safe default, because a fixed
   * port a provider was never told about fails at the redirect instead.
   */
  ports?: readonly number[];
  /** The path the redirect must land on; anything else is refused. */
  callbackPath: `/${string}`;
  /**
   * Prefixed onto this trip's random state, for a route that reads the prefix
   * back off the state it issued. The entropy after it is unreduced.
   */
  statePrefix?: string;
  /** Whose mark the landing card carries; omitted draws Luke's alone. */
  source?: LoopbackConnectionSource | undefined;
  pages: LoopbackConsentPages;
  reasons: LoopbackConsentReasons;
  /** The consent page's URL, built from the state and the bound redirect. */
  authorizationUrl(input: LoopbackAuthorization): string;
  /** Trades the code for a grant, or names why not. Never fails. */
  exchange(input: LoopbackExchange): Effect.Effect<LoopbackConsentOutcome<Grant>>;
  /**
   * Where the browser goes on to after a grant, in place of the granted
   * card: the next page of a sign-in that continues past this trip, or
   * nothing to end on the card. Never fails.
   */
  continueTo?(grant: Grant): Effect.Effect<string | undefined>;
  /**
   * Opens the consent page in the user's own browser. Injected so the caller
   * hands in the shell and tests hand in a recorder — this module never
   * reaches for Electron itself.
   */
  openExternal(url: string): void | Promise<void>;
  timeoutMs?: number | undefined;
}

export interface LoopbackConsent<Grant> {
  /**
   * One trip, press to grant, whose `Scope` is the listener's: closing it
   * stops the loopback, whether the trip settled, timed out, or was
   * interrupted. A second call while one waits answers with why.
   */
  signInEffect(): Effect.Effect<LoopbackConsentOutcome<Grant>, never, Scope.Scope>;
  /**
   * Ends the trip now waiting, if any. The browser tab is left where it is —
   * closing another app's window is not Luke's to do — but the loopback stops
   * listening, so a grant given after this lands nowhere. A callback already
   * claimed is left to finish: that is a code in hand, not an open door.
   */
  cancel(): void;
  /**
   * Opens the waiting trip's consent page again — the very URL, state and
   * challenge included, the trip is already listening for — for a tab lost
   * behind other windows or closed by mistake. With nothing waiting there is
   * no page to reopen, and nothing happens.
   */
  reopen(): void;
}

/**
 * Stands up one consent trip from its options. `Grant` is an object so a
 * refusal can be told from a grant by the one field a refusal has and no
 * grant may.
 */
export type OpenConsent = <Grant extends object>(
  options: LoopbackConsentOptions<Grant>,
) => LoopbackConsent<Grant>;
