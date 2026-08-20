import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Deferred, Effect, Ref } from "effect";
import { accountLoopbackPage, LOOPBACK_PAGE_TONE } from "./account-loopback-page";
import { codeChallenge, createCodeVerifier } from "./account-pkce";
import { Http, type LoopbackFailure } from "./services/http";
import type { AccountProvider } from "./shared/contracts";

const CALLBACK_PATH = "/callback";
const LOOPBACK_HOST = "127.0.0.1";

/**
 // SAFETY: The preceding check establishes the asserted contract.
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
  waitForCode: Effect.Effect<string, Error>;
  /**
   // SAFETY: The preceding check establishes the asserted contract.
   * Withdraws the wait: `waitForCode` rejects as cancelled and the server
   * closes. A code that already arrived has settled the promise, so a late
   * cancel changes nothing.
   */
  cancel(): void;
  close(): Effect.Effect<void, LoopbackFailure, Http>;
}

/** Opens one ephemeral loopback callback and accepts exactly one matching response. */
export function startAccountLoopback(
  options: { timeoutMs?: number; providerHint?: AccountProvider } = {},
): Effect.Effect<AccountLoopback, LoopbackFailure, Http> {
  return Effect.gen(function* () {
    const http = yield* Http;
    const randomState = randomBytes(32).toString("base64url");
    const state = options.providerHint ? `${options.providerHint}.${randomState}` : randomState;
    const timeoutMs = options.timeoutMs ?? 5 * 60_000;
    const codeVerifier = createCodeVerifier();
    const codeDeferred = yield* Deferred.make<string, Error>();
    const accepted = yield* Ref.make(false);

    const { server, port } = yield* http.listenLoopback({
      host: LOOPBACK_HOST,
      port: 0,
      onRequest: (request, response) =>
        handleCallback(request, response, {
          state,
          accepted,
          codeDeferred,
        }),
    });

    const timer = setTimeout(() => {
      void Effect.runPromise(
        Effect.gen(function* () {
          const done = yield* Deferred.isDone(codeDeferred);
          if (done) return;
          yield* Deferred.fail(codeDeferred, new Error("Sign-in timed out"));
          yield* http.closeServer(server);
        }),
      );
    }, timeoutMs);
    timer.unref();

    void Effect.runPromise(
      Deferred.await(codeDeferred).pipe(
        Effect.ensuring(Effect.sync(() => clearTimeout(timer))),
        Effect.catchAll(() => Effect.void),
      ),
    );

    const redirectUri = `http://${LOOPBACK_HOST}:${port}${CALLBACK_PATH}`;

    return {
      redirectUri,
      state,
      codeVerifier,
      codeChallenge: codeChallenge(codeVerifier),
      waitForCode: Deferred.await(codeDeferred),
      cancel: () => {
        void Effect.runPromise(
          Effect.gen(function* () {
            const done = yield* Deferred.isDone(codeDeferred);
            if (done) return;
            yield* Deferred.fail(codeDeferred, new Error(SIGN_IN_CANCELLED_MESSAGE));
            yield* http.closeServer(server);
          }),
        );
      },
      close: () => http.closeServer(server),
    };
  });
}

function handleCallback(
  request: IncomingMessage,
  response: ServerResponse,
  options: {
    state: string;
    accepted: Ref.Ref<boolean>;
    codeDeferred: Deferred.Deferred<string, Error>;
  },
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const url = new URL(request.url ?? "/", `http://${LOOPBACK_HOST}`);
    const code = url.searchParams.get("code");
    const oauthError = url.searchParams.get("error");
    const returnedState = url.searchParams.get("state");
    if (url.pathname !== CALLBACK_PATH || returnedState !== options.state) {
      answer(response, LOOPBACK_ANSWER.NOT_VERIFIED);
      return;
    }
    if (yield* Ref.get(options.accepted)) {
      answer(response, LOOPBACK_ANSWER.ALREADY_USED);
      return;
    }
    if (oauthError) {
      yield* Ref.set(options.accepted, true);
      answer(response, LOOPBACK_ANSWER.NOT_COMPLETED);
      yield* Deferred.fail(
        options.codeDeferred,
        new Error(`Sign-in was not completed (${oauthError})`),
      );
      return;
    }
    if (!code) {
      answer(response, LOOPBACK_ANSWER.NOT_VERIFIED);
      return;
    }
    yield* Ref.set(options.accepted, true);
    answer(response, LOOPBACK_ANSWER.SIGNED_IN);
    yield* Deferred.succeed(options.codeDeferred, code);
  });
}
