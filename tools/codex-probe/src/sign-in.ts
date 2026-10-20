/**
 * sign-in.ts -- the probe's one sign-in on the developer's Mac: the loopback listener, the browser, and the protected file the credentials may rest in between the sign-in and the probe.
 *
 * The listener binds `127.0.0.1` alone, on OpenAI's example port where it is
 * free and on any free port otherwise, before the browser opens, and answers
 * the one callback of this attempt; anything else it is sent is refused
 * without ending the wait. The credentials never reach the terminal: they go
 * straight to the probe in the same process, or into a file of a fresh
 * owner-only directory that the probe reads back and refuses where anyone
 * but its owner could read it.
 */

import { execFile } from "node:child_process";
import { on, once } from "node:events";
import { constants } from "node:fs";
import { chmod, mkdtemp, open, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isRecord,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
  valueFromJsonText,
} from "@luke/wire";
import {
  authorizeUrl,
  beginAuthorization,
  type ChatGptCredentials,
  discoverEndpoints,
  exchangeCode,
  type Fetch,
  type PendingAuthorization,
  readCallback,
  SIGN_IN,
  SIGN_IN_REFUSAL,
  SignInRefused,
  verifyIdToken,
} from "./oauth.js";

/** The listener's bounds. */
const LOOPBACK = {
  /** OpenAI's example port; any free one serves, as only the port may vary. */
  PREFERRED_PORT: 1455,
  /** How long the browser has to come back before the attempt is given up. */
  WAIT_MS: 10 * 60 * 1000,
} as const;

/** The file mode the credentials rest under, and the directory's. */
const FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;

/** What the browser is shown once the callback is read. */
const DONE_PAGE =
  "<!doctype html><title>Luke probe</title><p>Signed in. You can close this tab.</p>";

/** A listener on 127.0.0.1, on the preferred port where it is free and on any free port otherwise. */
async function listenOnLoopback(preferredPort: number): Promise<Server> {
  for (const port of [preferredPort, 0]) {
    const server = createServer();
    server.listen(port, "127.0.0.1");
    // Note that `once` rejects on the server's "error" event, so a port already taken settles here as false.
    const bound = await once(server, "listening").then(
      () => true,
      () => false,
    );
    if (bound) return server;
    server.close();
  }
  throw new Error("no loopback port could be bound");
}

/** The port a listening server holds. */
function portOf(server: Server): number {
  // SAFETY: a server listening on a TCP address answers an AddressInfo, never a pipe name.
  return (server.address() as AddressInfo).port;
}

/**
 * Waits for the one request to the callback path and reads it against the
 * pending attempt; a request to another path is answered 404 and the wait
 * goes on, so a browser's own favicon fetch cannot end it.
 */
export async function awaitCallback(
  server: Server,
  pending: PendingAuthorization,
  signal: AbortSignal,
): Promise<ReturnType<typeof readCallback>> {
  for await (const [request, response] of on(server, "request", { signal })) {
    // SAFETY: Node's http server emits each "request" with exactly these two arguments.
    const [incoming, outgoing] = [request as IncomingMessage, response as ServerResponse];
    const url = new URL(incoming.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== SIGN_IN.CALLBACK_PATH) {
      outgoing.writeHead(404).end();
      continue;
    }
    try {
      const grant = readCallback(url.searchParams, pending);
      outgoing.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(DONE_PAGE);
      return grant;
    } catch (cause) {
      outgoing.writeHead(400, { "content-type": "text/plain" }).end("Sign-in refused.");
      throw cause;
    }
  }
  throw new Error("the loopback listener closed before the browser came back");
}

/** Opens the system browser at the URL; the probe also prints it, which carries nothing secret. */
function openBrowser(url: string): void {
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  execFile(opener, [url], () => undefined);
}

/**
 * The whole sign-in: listen, open the browser at a first registration's
 * authorize URL, read the callback, exchange the code under the issued
 * client, and check the ID token against OpenAI's published keys. Answers
 * the credentials for the caller to hand on; prints only the URL and steps.
 */
export async function signIn(input: {
  readonly fetch: Fetch;
  readonly extAgentHostId: string;
  readonly say: (line: string) => void;
}): Promise<ChatGptCredentials> {
  const server = await listenOnLoopback(LOOPBACK.PREFERRED_PORT);
  try {
    const endpoints = await discoverEndpoints(input.fetch);
    const pending = beginAuthorization(portOf(server), input.extAgentHostId);
    const url = authorizeUrl(endpoints, pending);
    input.say(`Opening the browser for Sign in with ChatGPT. If it does not open, visit:\n${url}`);
    openBrowser(url);
    const grant = await awaitCallback(server, pending, AbortSignal.timeout(LOOPBACK.WAIT_MS));
    const tokens = await exchangeCode(input.fetch, endpoints, grant, pending);
    if (tokens.idToken === undefined) {
      throw new SignInRefused(SIGN_IN_REFUSAL.ID_TOKEN, "the token response carried no ID token");
    }
    const jwks = valueFromJsonText(await (await input.fetch(endpoints.jwks, {})).text());
    verifyIdToken({
      idToken: tokens.idToken,
      jwks,
      issuedClientId: grant.issuedClientId,
      nonce: pending.nonce,
      nowSeconds: Math.floor(Date.now() / 1000),
    });
    input.say("Signed in: the grant includes ChatGPT plan usage and the ID token verifies.");
    return {
      issuedClientId: grant.issuedClientId,
      extAgentHostId: input.extAgentHostId,
      tokens,
      receivedAt: Date.now(),
    };
  } finally {
    server.close();
  }
}

/** The credentials as the file holds them; the same fields the probe reads back. */
function credentialsJson(credentials: ChatGptCredentials): string {
  return JSON.stringify({
    issued_client_id: credentials.issuedClientId,
    ext_agent_host_id: credentials.extAgentHostId,
    access_token: credentials.tokens.accessToken,
    refresh_token: credentials.tokens.refreshToken,
    id_token: credentials.tokens.idToken ?? null,
    expires_in: credentials.tokens.expiresInSeconds,
    scopes: credentials.tokens.scopes,
    received_at: credentials.receivedAt,
  });
}

/** The file's JSON read back into credentials, or a refusal naming no value. */
function readCredentialsJson(value: UnparsedWireValue): ChatGptCredentials {
  if (!isRecord(value))
    throw new SignInRefused(SIGN_IN_REFUSAL.TOKEN_RESPONSE, "the credentials file is not JSON");
  const field = (key: string): string => {
    const one = value[key];
    if (!isWireString(one) || one.length === 0) {
      throw new SignInRefused(SIGN_IN_REFUSAL.TOKEN_RESPONSE, `the credentials file lacks ${key}`);
    }
    return one;
  };
  const expiresIn = value.expires_in;
  const receivedAt = value.received_at;
  const scopes = Array.isArray(value.scopes) ? value.scopes.filter(isWireString) : [];
  if (!isWireNumber(expiresIn) || !isWireNumber(receivedAt)) {
    throw new SignInRefused(
      SIGN_IN_REFUSAL.TOKEN_RESPONSE,
      "the credentials file lacks its expiry",
    );
  }
  const idToken = value.id_token;
  return {
    issuedClientId: field("issued_client_id"),
    extAgentHostId: field("ext_agent_host_id"),
    tokens: {
      accessToken: field("access_token"),
      refreshToken: field("refresh_token"),
      idToken: isWireString(idToken) ? idToken : undefined,
      expiresInSeconds: expiresIn,
      scopes,
    },
    receivedAt,
  };
}

/** Writes the credentials to a new file in a fresh owner-only directory and answers its path. */
export async function writeCredentialsFile(
  credentials: ChatGptCredentials,
  root = tmpdir(),
): Promise<string> {
  const directory = await mkdtemp(path.join(root, "luke-codex-probe-"));
  await chmod(directory, DIRECTORY_MODE);
  const file = path.join(directory, "credentials.json");
  await writeFile(file, credentialsJson(credentials), { mode: FILE_MODE, flag: "wx" });
  return file;
}

/** Reads the credentials file back, refusing one another user could read or one its owner did not write. */
export async function readCredentialsFile(file: string): Promise<ChatGptCredentials> {
  // Note that we check and read through one open handle, so the file checked is the file read.
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const facts = await handle.stat();
    if (!facts.isFile() || (facts.mode & 0o077) !== 0 || facts.uid !== process.getuid?.()) {
      throw new SignInRefused(
        SIGN_IN_REFUSAL.TOKEN_RESPONSE,
        "the credentials file is readable by others or not yours; sign in again",
      );
    }
    return readCredentialsJson(valueFromJsonText(await handle.readFile("utf8")));
  } finally {
    await handle.close();
  }
}
