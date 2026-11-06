import type { SignInFailure } from "@repo/features/words";
import type { Effect, Scope } from "effect";
import type { LoopbackConnectionSource } from "./loopback-page.js";

export const LOOPBACK_CONSENT_CANCELED = "Sign-in was canceled.";

export type LoopbackConsentOutcome<Grant> =
  | Grant
  | { reason: string; failure?: SignInFailure | undefined };

export interface LoopbackConsentCard {
  badge: string;
  title: string;
  body: string;
}

interface LoopbackConsentPages {
  granted: LoopbackConsentCard;
  notGranted: LoopbackConsentCard;
}

interface LoopbackConsentReasons {
  refused: string;
  timedOut: string;
}

export interface LoopbackAuthorization {
  state: string;
  redirectUri: string;
  codeChallenge: string;
}

export interface LoopbackExchange {
  code: string;
  state: string;
  redirectUri: string;
  codeVerifier: string;
  clientId?: string | undefined;
}

export interface LoopbackConsentOptions<Grant> {
  ports?: readonly number[];
  callbackPath: `/${string}`;
  statePrefix?: string;
  source?: LoopbackConnectionSource | undefined;
  pages: LoopbackConsentPages;
  reasons: LoopbackConsentReasons;
  authorizationUrl(input: LoopbackAuthorization): string;
  exchange(input: LoopbackExchange): Effect.Effect<LoopbackConsentOutcome<Grant>>;
  continueTo?(grant: Grant): Effect.Effect<string | undefined>;
  openExternal(url: string): void | Promise<void>;
  isOnline?: (() => boolean) | undefined;
  timeoutMs?: number | undefined;
}

export interface LoopbackConsent<Grant> {
  signInEffect(): Effect.Effect<LoopbackConsentOutcome<Grant>, never, Scope.Scope>;
  cancel(): void;
  reopen(): void;
}

export type OpenConsent = <Grant extends object>(
  options: LoopbackConsentOptions<Grant>,
) => LoopbackConsent<Grant>;
