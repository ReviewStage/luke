import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { codeChallenge, createCodeVerifier } from "./account-pkce";
import type { AccountProvider } from "./shared/contracts";

const CALLBACK_PATH = "/callback";
const LOOPBACK_HOST = "127.0.0.1";

export interface AccountLoopback {
  redirectUri: string;
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  waitForCode: Promise<string>;
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

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${LOOPBACK_HOST}`);
    const code = url.searchParams.get("code");
    const oauthError = url.searchParams.get("error");
    const returnedState = url.searchParams.get("state");
    if (url.pathname !== CALLBACK_PATH || returnedState !== state) {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("Luke could not verify this sign-in. Return to Luke and try again.");
      return;
    }
    if (accepted) {
      response.writeHead(409, { "content-type": "text/plain; charset=utf-8" });
      response.end("This sign-in has already been used.");
      return;
    }
    if (oauthError) {
      accepted = true;
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("Sign-in was not completed. Return to Luke and try again.");
      reject?.(new Error(`Sign-in was not completed (${oauthError})`));
      reject = undefined;
      return;
    }
    if (!code) {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("Luke could not verify this sign-in. Return to Luke and try again.");
      return;
    }
    accepted = true;
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("Signed in to Luke. You can close this window.");
    settle?.(code);
    settle = undefined;
  });

  await new Promise<void>((resolve, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, LOOPBACK_HOST, () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("Luke could not open a sign-in callback");
  }

  const timer = setTimeout(() => {
    reject?.(new Error("Sign-in timed out"));
    reject = undefined;
    void closeServer(server);
  }, timeoutMs);
  timer.unref();
  void waitForCode.finally(() => clearTimeout(timer)).catch(() => undefined);

  return {
    redirectUri: `http://${LOOPBACK_HOST}:${address.port}${CALLBACK_PATH}`,
    state,
    codeVerifier,
    codeChallenge: codeChallenge(codeVerifier),
    waitForCode,
    close: () => closeServer(server),
  };
}
