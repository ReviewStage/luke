import {
  type CloudFetch,
  HTTP_STATUS,
  type HttpMethod,
  positiveInteger,
  text,
  type UnparsedWireValue,
  unparsedWire,
  withoutTrailingSlash,
} from "@sidecar/wire";
import type { AccountToken } from "./account-token.js";

const ACCOUNT_CALL_DEFAULTS = {
  REQUEST_TIMEOUT_MS: 10_000,
} as const;

/**
 * What authorizes one call, and what may be done about a refusal. Three
 * members rather than a token, because the three questions a refused call
 * asks — what header to send, who can renew it, and who it answers for — are
 * answered by three different owners.
 */
export interface CallCredential {
  /**
   * The header one attempt carries. A credential with no `authorization` at
   * all is an endpoint that takes no identity, so an attempt without a header
   * is its own answer; a credential that has one and reads nothing is a call
   * that cannot be made.
   */
  authorization?: () => Promise<string | undefined>;
  /** Asks whoever owns the credential to renew it; one with nothing to renew omits this. */
  renew?: () => Promise<void>;
  /**
   * Who the credential answers for, as an opaque identity. Read before an
   * attempt and again before its one retry, because the retry re-reads the
   * credential: a sign-out and sign-in between the two must read as the
   * caller's account gone, never as a fresh bearer to carry the old account's
   * payload under.
   */
  holder?: (() => Promise<string | undefined>) | undefined;
}

/** The ends a call reaches before any status is read. */
export const CALL_FAULT = {
  NO_CREDENTIAL: "no-credential",
  HOLDER_CHANGED: "holder-changed",
  NETWORK: "network",
} as const;

type CallFault = (typeof CALL_FAULT)[keyof typeof CALL_FAULT];

/** The service answered; every status, including a refusal, is the caller's to read. */
export interface CallResponse {
  response: Response;
}

export interface CallFailure {
  fault: CallFault;
  /**
   * The kind of error a network fault ended with, never its words, which
   * could carry a credential.
   */
  errorName?: string;
}

export type CallAnswer = CallResponse | CallFailure;

/** Whether the service answered at all, as distinct from the call never reaching it. */
export function callAnswered(answer: CallAnswer): answer is CallResponse {
  return "response" in answer;
}

/** One request, as the build fixes it: nothing here is composed from what a service answered. */
interface CallRequest {
  method: HttpMethod;
  /** The path under the call's own base address. */
  path: string;
  /** The serialized body, which is also what names the request's content type. */
  body?: string | undefined;
  /** Extra headers the build fixes; the authorization and content type are the call's own. */
  headers?: Record<string, string> | undefined;
  /** The caller's own cancellation, joined with the call's deadline. */
  signal?: AbortSignal | undefined;
}

export interface AccountCallOptions {
  /** The service origin; any trailing separator is trimmed once. */
  baseUrl: string;
  credential: CallCredential;
  fetch?: CloudFetch | undefined;
  requestTimeoutMs?: number | undefined;
}

/**
 * One call to Luke's own service, however it is authorized: the base address
 * trimmed once, the credential read fresh for every attempt, the header
 * written once, the deadline joined with the caller's own cancellation once, a
 * fetch that throws read as a network fault by the error's kind alone, and one
 * reading of a 401 — renew the credential and retry exactly once, only on a
 * credential that actually changed and only while it still answers for the
 * same holder.
 */
export interface AccountCall {
  /**
   * The deadline in force. An `AbortSignal.timeout` cannot be read back, so
   * the value the call was built with is what says which deadline a request
   * is under.
   */
  readonly requestTimeoutMs: number;
  /** The address a path is asked at, for a caller that reports its endpoint. */
  address(path: string): string;
  send(request: CallRequest): Promise<CallAnswer>;
  /**
   * The whole of an answer a caller only wants read: anything but a validated
   * body — a fault, a refusal, a body that is not JSON — is no answer.
   */
  ask<Answer>(
    request: CallRequest,
    read: (payload: UnparsedWireValue) => Answer | undefined,
  ): Promise<Answer | undefined>;
}

interface Identity {
  holder: string | undefined;
  authorization: string | undefined;
}

export function createAccountCall(options: AccountCallOptions): AccountCall {
  const baseUrl = text(options.baseUrl);
  if (!baseUrl) throw new Error("A call's base URL must not be empty");
  const address = withoutTrailingSlash(baseUrl);
  const credential = options.credential;
  const cloudFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const requestTimeoutMs = positiveInteger(
    options.requestTimeoutMs,
    ACCOUNT_CALL_DEFAULTS.REQUEST_TIMEOUT_MS,
  );

  async function attempt(
    request: CallRequest,
    authorization: string | undefined,
  ): Promise<CallAnswer> {
    try {
      const response = await cloudFetch(`${address}${request.path}`, {
        method: request.method,
        headers: {
          ...request.headers,
          ...(authorization === undefined ? undefined : { authorization }),
          ...(request.body === undefined ? undefined : { "content-type": "application/json" }),
        },
        ...(request.body === undefined ? undefined : { body: request.body }),
        signal: deadline(requestTimeoutMs, request.signal),
      });
      return { response };
    } catch (error) {
      return {
        fault: CALL_FAULT.NETWORK,
        ...(error instanceof Error ? { errorName: error.name } : undefined),
      };
    }
  }

  /**
   * Who the credential answers for and what one attempt carries, read
   * together. A credential that cannot be read at all — a store that failed,
   * not an account that is absent — reads as nothing rather than throwing,
   * because a caller that took work off a queue to send it has to be able to
   * put it back.
   */
  async function identify(): Promise<Identity | undefined> {
    try {
      const holder = await credential.holder?.();
      const authorization = await credential.authorization?.();
      if (credential.authorization && authorization === undefined) return undefined;
      return { holder, authorization };
    } catch {
      return undefined;
    }
  }

  async function send(request: CallRequest): Promise<CallAnswer> {
    const identity = await identify();
    if (!identity) return { fault: CALL_FAULT.NO_CREDENTIAL };

    const answer = await attempt(request, identity.authorization);
    if (!callAnswered(answer) || answer.response.status !== HTTP_STATUS.UNAUTHORIZED) {
      return answer;
    }

    // Routine expiry of an hour-lived token inside a day-lived app. A renewal
    // that itself fails, or that produced the same credential, leaves the
    // refusal standing: retrying it would only repeat the no.
    await credential.renew?.().catch(() => undefined);
    const renewal = await identify();
    if (!renewal || renewal.authorization === identity.authorization) return answer;
    if (renewal.holder !== identity.holder) return { fault: CALL_FAULT.HOLDER_CHANGED };
    return attempt(request, renewal.authorization);
  }

  return {
    requestTimeoutMs,
    address: (path) => `${address}${path}`,
    send,
    async ask(request, read) {
      const answer = await send(request);
      if (!callAnswered(answer) || !answer.response.ok) return undefined;
      const payload = await answer.response.json().catch(() => undefined);
      return payload === undefined ? undefined : read(unparsedWire(payload));
    },
  };
}

/** The signed-in account's bearer, read fresh for every attempt and renewed by the account lifecycle. */
export function accountBearer(token: AccountToken): CallCredential {
  return {
    authorization: async () => {
      const accessToken = await token.readAccessToken();
      return accessToken ? bearer(accessToken) : undefined;
    },
    renew: token.refreshAccount,
    holder: token.readAccountKey,
  };
}

/** A credential the build or the developer fixed: one header, one attempt, nothing to renew. */
export function fixedBearer(credential: string): CallCredential {
  const authorization = bearer(credential);
  return { authorization: () => Promise.resolve(authorization) };
}

/** An endpoint that takes no identity: nothing to send, nothing to renew, nobody to answer for. */
export const NO_CREDENTIAL: CallCredential = {};

function bearer(credential: string): string {
  return `Bearer ${credential}`;
}

function deadline(timeoutMs: number, cancellation: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return cancellation ? AbortSignal.any([timeout, cancellation]) : timeout;
}
