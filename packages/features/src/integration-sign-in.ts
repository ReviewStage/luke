import { Duration } from "effect";
import { saidWords } from "./integration-health.js";
import {
  INTEGRATION_NAME,
  INTEGRATION_SIGN_IN_FAILURE,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationSignInFailure,
  type IntegrationStatus,
} from "./integration-wire.js";

/**
 * integration-sign-in.ts -- a Connect sign-in the window waits on, from the press to how it ended: still waiting, failed, or never finished.
 *
 * Settings › Integrations and the composer's MCP servers popover draw it
 * alike (`packages/panel/src/integration-statuses.ts` holds it). A sign-in happens in the
 * browser, and the window learns how it went only by reading where the
 * provider stands again, so this is what each read says of it. A read that
 * finds it connected ends it. A read that names it among the service's
 * sign-in failures ends it as failed with that reason: cancelled on Vercel
 * Connect's own page, or refused with Connect's own line where the service
 * kept one, which the service learns from Connect even of a sign-in that
 * never came back. A read that finds it no longer pending otherwise ends it
 * as failed with no reason, as a sign-in the browser came back from without
 * a grant. The window also stops waiting on its own: each sign-in has its
 * own deadline, three minutes after the press or a few seconds after the
 * developer comes back to the window, and any read past it that still finds
 * it pending ends it as unfinished. A failed or unfinished sign-in stands
 * until it is begun again, until a later read says why it failed, or until
 * a later read finds the provider connected after all.
 */

/** Where a sign-in the window waits on stands. */
export const SIGN_IN = {
  /** The browser is open on it and it has not ended. */
  WAITING: "waiting",
  /** The browser came back from it without a grant. */
  FAILED: "failed",
  /** It never came back: given up on after its wait. */
  UNFINISHED: "unfinished",
} as const;

/** Why a sign-in failed, as the service's read named it. */
type SignInFailure = Omit<IntegrationSignInFailure, "provider">;

export type SignIn =
  | {
      readonly kind: typeof SIGN_IN.WAITING;
      /** The mark taken as it began; only a read issued after it says how it ended. */
      readonly since: number;
      /** When the window gives up on it, in the runtime clock's milliseconds. */
      readonly deadline: number;
      /**
       * Whether the service answers it pending while it is under way, as it
       * does a Connect sign-in; GitHub's own connect it answers disconnected
       * until it lands, so a read can say only that it connected.
       */
      readonly seenPending: boolean;
    }
  | {
      readonly kind: typeof SIGN_IN.FAILED;
      /** The mark of the sign-in it ended, so a read issued before that sign-in says nothing of how it ended. */
      readonly since: number;
      /** Why, where a read named it; nothing for a sign-in that came back without a grant. */
      readonly failure?: SignInFailure;
    }
  | {
      readonly kind: typeof SIGN_IN.UNFINISHED;
      /** The mark of the sign-in it gave up on. */
      readonly since: number;
    };

/** How long a sign-in waits on the browser before the window stops waiting on it. */
export const SIGN_IN_WAIT = Duration.minutes(3);

/** How long a sign-in still under way is given to land once the developer is back in the window. */
export const SIGN_IN_GRACE = Duration.seconds(10);

/** What a row offers for a sign-in. */
export const SIGN_IN_ACTION = {
  CANCEL: "Cancel",
  REOPEN: "Reopen",
  TRY_AGAIN: "Retry",
} as const;

/** One read of where a provider stands, as a sign-in hears it. */
export interface SignInRead {
  readonly status: IntegrationStatus | undefined;
  /** Why the provider's sign-in failed, where the read named it among its sign-in failures. */
  readonly failure?: SignInFailure | undefined;
  /** The mark taken as the read was issued. */
  readonly mark: number;
  /** When it answered, in the runtime clock's milliseconds; a sign-in still pending past its deadline is given up on. */
  readonly at: number;
}

/** A sign-in begun at `at`, waited on for its whole wait. */
export function signInBegun(mark: number, at: number, seenPending: boolean): SignIn {
  return {
    kind: SIGN_IN.WAITING,
    since: mark,
    deadline: at + Duration.toMillis(SIGN_IN_WAIT),
    seenPending,
  };
}

/** A sign-in as the developer's return to the window at `at` leaves it: one still waited on has the grace at most. */
export function signInGraced(signIn: SignIn, at: number): SignIn {
  if (signIn.kind !== SIGN_IN.WAITING) return signIn;
  return { ...signIn, deadline: Math.min(signIn.deadline, at + Duration.toMillis(SIGN_IN_GRACE)) };
}

/**
 * What a read says of one provider's sign-in. A sign-in pending that the
 * window did not begin, from another surface or before a relaunch, is
 * waited on from the read that found it, and one that read names failed
 * stands failed whether the window waited on it or not; a read issued
 * before a sign-in began says nothing of it, nor of how it ended, so a slow
 * read never puts an earlier sign-in's reason over a later one's; one the service never
 * answers pending cannot be seen to fail, only to connect or to run out of
 * time.
 */
export function signInAfterRead(signIn: SignIn | undefined, read: SignInRead): SignIn | undefined {
  if (read.status === INTEGRATION_STATUS.CONNECTED) return undefined;
  if (signIn !== undefined && read.mark <= signIn.since) return signIn;
  if (read.failure !== undefined) {
    return { kind: SIGN_IN.FAILED, since: signIn?.since ?? read.mark, failure: read.failure };
  }
  if (signIn === undefined) {
    return read.status === INTEGRATION_STATUS.PENDING
      ? signInBegun(read.mark, read.at, true)
      : undefined;
  }
  if (signIn.kind !== SIGN_IN.WAITING) return signIn;
  if (signIn.seenPending && read.status !== INTEGRATION_STATUS.PENDING) {
    return { kind: SIGN_IN.FAILED, since: signIn.since };
  }
  return read.at >= signIn.deadline ? { kind: SIGN_IN.UNFINISHED, since: signIn.since } : signIn;
}

/** The line a row draws for a sign-in. */
export interface SignInLine {
  readonly text: string;
  /** Whether it is a problem, drawn in the attention tint. */
  readonly problem: boolean;
  /** The sign-in's own words, quoted and naming it, for a line under `text`; none where it said none. */
  readonly said?: string;
}

/**
 * The line a failed sign-in draws: the developer's own cancel plainly, and a
 * refusal in our sentence, Connect's own line quoted under it where the read
 * carried one, else why in our words. Note that the line is said as the
 * sign-in's, because it is Connect's or the provider's, and which one is not
 * known here.
 */
function failedLine(name: string, failure: SignInFailure | undefined): SignInLine {
  if (failure?.reason === INTEGRATION_SIGN_IN_FAILURE.CANCELED) {
    return { text: `You cancelled connecting ${name}.`, problem: false };
  }
  if (failure?.message !== undefined) {
    return {
      text: `${name} could not be connected.`,
      problem: true,
      said: saidWords(`${name}'s sign-in`, failure.message),
    };
  }
  const why =
    failure === undefined ? "the sign-in came back without access" : "the sign-in was refused";
  return { text: `${name} could not be connected: ${why}.`, problem: true };
}

/** The line a row draws for a sign-in. */
export function signInLine(provider: IntegrationProvider, signIn: SignIn): SignInLine {
  const name = INTEGRATION_NAME[provider];
  switch (signIn.kind) {
    case SIGN_IN.WAITING:
      return { text: `Waiting for ${name} in your browser…`, problem: false };
    case SIGN_IN.FAILED:
      return failedLine(name, signIn.failure);
    case SIGN_IN.UNFINISHED:
      return { text: "Sign-in didn't finish.", problem: false };
  }
}
