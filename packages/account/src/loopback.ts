import { randomBytes } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  accountLoopbackPage,
  codeChallenge,
  createCodeVerifier,
  LOOPBACK_PAGE_TONE,
  loopbackContinuePage,
} from "@sidecar/oauth";
import type { AccountProvider } from "./snapshot.js";

const CALLBACK_PATH = "/callback";
/**
 * Where the sign-in starts: the continue page whose link opens the sign-in in
 * a script-closable tab and closes its own — the only arrangement in which
 * the landing page's `window.close()` is honored, because a tab the user
 * navigated through a sign-in refuses it. The path carries a token of its own
 * run so nothing else on this machine can read the page off a guessable
 * address.
 */
const CONTINUE_PATH = "/continue";
const LOOPBACK_HOST = "127.0.0.1";

/**
 * Every answer the callback can give, drawn as the same card the landing page
 * would draw it. The words are fixed by the build; nothing the redirect
 * carried reaches the document.
 */
const LOOPBACK_ANSWER = {
  SIGNED_IN: {
    status: 200,
    page: {
      tone: LOOPBACK_PAGE_TONE.SETTLED,
      badge: "Signed in",
      title: "Signed in to Luke",
      body: "You can close this tab and return to Luke.",
      closesItself: true,
    },
  },
  NOT_VERIFIED: {
    status: 400,
    page: {
      tone: LOOPBACK_PAGE_TONE.ATTENTION,
      badge: "Not verified",
      title: "Luke could not verify this sign-in",
      body: "Return to Luke and try again.",
    },
  },
  NOT_COMPLETED: {
    status: 400,
    page: {
      tone: LOOPBACK_PAGE_TONE.ATTENTION,
      badge: "Not completed",
      title: "Sign-in was not completed",
      body: "Return to Luke and try again.",
    },
  },
  ALREADY_USED: {
    status: 409,
    page: {
      tone: LOOPBACK_PAGE_TONE.SETTLED,
      badge: "Already used",
      title: "This sign-in has already been used",
      body: "You can close this tab and return to Luke.",
    },
  },
} as const;

function answer(
  response: ServerResponse,
  { status, page }: (typeof LOOPBACK_ANSWER)[keyof typeof LOOPBACK_ANSWER],
): void {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(accountLoopbackPage(page));
}

/**
 * The one message a withdrawn sign-in ends with, so the flow's owner can tell
 * a cancellation — a normal outcome — from a failure worth reporting.
 */
export const SIGN_IN_CANCELLED_MESSAGE = "Sign-in was cancelled";

export function isSignInCancellation(error: Error): boolean {
  return error.message === SIGN_IN_CANCELLED_MESSAGE;
}

export interface AccountLoopback {
  redirectUri: string;
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  waitForCode: Promise<string>;
  /**
   * Serves this sign-in's continue page — the flow's own authorization URL
   * behind the one link, and the caller's words on the button — and returns
   * the address to hand the browser.
   */
  serveContinue(input: { authorizationUrl: string; action: string }): string;
  /**
   * Withdraws the wait: `waitForCode` rejects as cancelled and the server
   * closes. A code that already arrived has settled the promise, so a late
   * cancel changes nothing.
   */
  cancel(): void;
  close(): Promise<void>;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** Opens one ephemeral loopback callback and accepts exactly one matching response. */
export async function startAccountLoopback(
  options: { timeoutMs?: number; providerHint?: AccountProvider } = {},
): Promise<AccountLoopback> {
  const randomState = randomBytes(32).toString("base64url");
  const state = options.providerHint ? `${options.providerHint}.${randomState}` : randomState;
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  const codeVerifier = createCodeVerifier();
  let settle: ((code: string) => void) | undefined;
  let reject: ((error: Error) => void) | undefined;
  let accepted = false;
  const waitForCode = new Promise<string>((resolve, rejectPromise) => {
    settle = resolve;
    reject = rejectPromise;
  });

  const continuePath = `${CONTINUE_PATH}/${randomBytes(16).toString("base64url")}`;
  let continuePage: string | undefined;

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${LOOPBACK_HOST}`);
    if (url.pathname === continuePath && continuePage) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(continuePage);
      return;
    }
    const code = url.searchParams.get("code");
    const oauthError = url.searchParams.get("error");
    const returnedState = url.searchParams.get("state");
    if (url.pathname !== CALLBACK_PATH || returnedState !== state) {
      answer(response, LOOPBACK_ANSWER.NOT_VERIFIED);
      return;
    }
    if (accepted) {
      answer(response, LOOPBACK_ANSWER.ALREADY_USED);
      return;
    }
    if (oauthError) {
      accepted = true;
      answer(response, LOOPBACK_ANSWER.NOT_COMPLETED);
      reject?.(new Error(`Sign-in was not completed (${oauthError})`));
      reject = undefined;
      return;
    }
    if (!code) {
      answer(response, LOOPBACK_ANSWER.NOT_VERIFIED);
      return;
    }
    accepted = true;
    answer(response, LOOPBACK_ANSWER.SIGNED_IN);
    settle?.(code);
    settle = undefined;
  });

  await new Promise<void>((resolve, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, LOOPBACK_HOST, () => resolve());
  });
  const address = server.address();
  if (!address) {
    await closeServer(server);
    throw new Error("Luke could not open a sign-in callback");
  }
  // SAFETY: TCP loopback listen returns AddressInfo; Unix socket paths never arise on this host binding.
  const { port } = address as AddressInfo;

  const timer = setTimeout(() => {
    reject?.(new Error("Sign-in timed out"));
    reject = undefined;
    void closeServer(server);
  }, timeoutMs);
  timer.unref();
  void waitForCode.finally(() => clearTimeout(timer)).catch(() => undefined);

  return {
    redirectUri: `http://${LOOPBACK_HOST}:${port}${CALLBACK_PATH}`,
    state,
    codeVerifier,
    codeChallenge: codeChallenge(codeVerifier),
    waitForCode,
    serveContinue: (input) => {
      continuePage = loopbackContinuePage({
        title: "Sign in to Luke",
        body: "The sign-in opens in a tab of its own.",
        action: input.action,
        authorizationUrl: input.authorizationUrl,
      });
      return `http://${LOOPBACK_HOST}:${port}${continuePath}`;
    },
    cancel: () => {
      reject?.(new Error(SIGN_IN_CANCELLED_MESSAGE));
      reject = undefined;
      void closeServer(server);
    },
    close: () => closeServer(server),
  };
}
