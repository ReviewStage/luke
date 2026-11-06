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

export const SIGN_IN = {
  WAITING: "waiting",
  FAILED: "failed",
  UNFINISHED: "unfinished",
} as const;

type SignInFailure = Omit<IntegrationSignInFailure, "provider">;

export type SignIn =
  | {
      readonly kind: typeof SIGN_IN.WAITING;
      readonly since: number;
      readonly deadline: number;
      readonly seenPending: boolean;
    }
  | {
      readonly kind: typeof SIGN_IN.FAILED;
      readonly since: number;
      readonly failure?: SignInFailure;
    }
  | {
      readonly kind: typeof SIGN_IN.UNFINISHED;
      readonly since: number;
    };

export const SIGN_IN_WAIT = Duration.minutes(3);

export const SIGN_IN_ACTION = {
  CANCEL: "Cancel",
  REOPEN: "Reopen",
  TRY_AGAIN: "Retry",
} as const;

export interface SignInRead {
  readonly status: IntegrationStatus | undefined;
  readonly failure?: SignInFailure | undefined;
  readonly mark: number;
  readonly at: number;
}

export function signInBegun(mark: number, at: number, seenPending: boolean): SignIn {
  return {
    kind: SIGN_IN.WAITING,
    since: mark,
    deadline: at + Duration.toMillis(SIGN_IN_WAIT),
    seenPending,
  };
}

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

export interface SignInLine {
  readonly text: string;
  readonly problem: boolean;
  readonly said?: string;
}

function failedLine(name: string, failure: SignInFailure | undefined): SignInLine {
  if (failure?.reason === INTEGRATION_SIGN_IN_FAILURE.CANCELED) {
    return { text: `You canceled connecting ${name}.`, problem: false };
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
