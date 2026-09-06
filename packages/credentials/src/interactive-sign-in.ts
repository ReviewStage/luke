/**
 * The stages of a sign-in Luke runs on the developer's behalf through a
 * provider's own CLI: the CLI opens its page in the browser and hands back a
 * one-time code, the code is exchanged, and where the login spans several
 * scopes (Superset's organizations) the developer chooses one and the CLI
 * switches to it. The stages are the wire vocabulary the renderer's slot
 * draws from, so they live below every flow that produces them.
 */
export const INTERACTIVE_SIGN_IN_STAGE = {
  IDLE: "idle",
  BROWSER_CODE: "browser-code",
  EXCHANGING: "exchanging",
  SCOPE: "scope",
  SWITCHING: "switching",
  FAILURE: "failure",
  CONNECTED: "connected",
} as const;

export type InteractiveSignInStage =
  (typeof INTERACTIVE_SIGN_IN_STAGE)[keyof typeof INTERACTIVE_SIGN_IN_STAGE];

export interface InteractiveSignInScope {
  id: string;
  name: string;
  slug: string;
}

export interface InteractiveSignInSnapshot {
  stage: InteractiveSignInStage;
  failure?: string;
  scopes: readonly InteractiveSignInScope[];
}

/** One CLI login flow, driven by the row's presses and the slot's field. */
export interface InteractiveSignIn {
  current(): InteractiveSignInSnapshot;
  begin(): Promise<InteractiveSignInSnapshot>;
  submitCode(code: string): InteractiveSignInSnapshot;
  chooseScope(slug: string): Promise<InteractiveSignInSnapshot>;
  reopen(): void;
  cancel(): void;
  shutdown(): void;
}

/** The edges of a sign-in a row may count, each under its own vocabulary. */
export const SIGN_IN_EDGE = {
  START: "start",
  COMPLETE: "complete",
  CANCEL: "cancel",
  DISCONNECT: "disconnect",
} as const;

export type SignInEdge = (typeof SIGN_IN_EDGE)[keyof typeof SIGN_IN_EDGE];

/**
 * What a consent page hands back: an access token, the refresh token that
 * renews it where the service issues one, and when the access token lapses.
 * Stored encrypted like a key, and never sent to a renderer.
 */
export interface ConsentGrant {
  accessToken: string;
  refreshToken?: string;
  /** When the access token stops being honoured, as epoch milliseconds. */
  expiresAt: number;
}

export interface ConsentSignInRefusal {
  reason: string;
}

/**
 * A sign-in that runs whole in the browser and the main process — the
 * consent page, the loopback redirect, the exchange — and hands back one
 * grant, which the caller stores, or the reason it did not.
 */
export interface ConsentSignIn<Grant> {
  signIn(): Promise<Grant | ConsentSignInRefusal>;
  cancel(): void;
  reopen(): void;
}
