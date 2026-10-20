import { once } from "node:events";
import { chmod, stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { temporaryDirectory } from "@luke/wire/testing";
import { describe, expect, it } from "vitest";
import {
  beginAuthorization,
  type ChatGptCredentials,
  SIGN_IN_REFUSAL,
  type SignInRefused,
} from "./oauth.js";
import { awaitCallback, readCredentialsFile, writeCredentialsFile } from "./sign-in.js";

const CREDENTIALS: ChatGptCredentials = {
  issuedClientId: "oaiapp_1",
  extAgentHostId: "urn:uuid:11111111-1111-4111-8111-111111111111",
  tokens: {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    idToken: "id-1",
    expiresInSeconds: 3600,
    scopes: ["chatgpt.tokens.use.direct"],
  },
  receivedAt: 1,
};

/** A loopback listener on a free port, closed when the test ends. */
async function loopback(onFinished: (close: () => void) => void) {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  onFinished(() => server.close());
  // SAFETY: a server listening on a TCP address answers an AddressInfo.
  return { server, port: (server.address() as AddressInfo).port };
}

describe("awaitCallback", () => {
  it("answers the grant of the one callback of this attempt, after refusing other paths", async ({
    onTestFinished,
  }) => {
    const { server, port } = await loopback(onTestFinished);
    const pending = beginAuthorization(port, CREDENTIALS.extAgentHostId);
    const waiting = awaitCallback(server, pending, AbortSignal.timeout(5000));
    const favicon = await fetch(`http://127.0.0.1:${port}/favicon.ico`);
    const callback = await fetch(
      `${pending.redirectUri}?state=${pending.state}&code=c&client_id=oaiapp_1`,
    );
    expect(favicon.status).toBe(404);
    expect(callback.status).toBe(200);
    await expect(waiting).resolves.toEqual({ code: "c", issuedClientId: "oaiapp_1" });
  });

  it("refuses a callback carrying another attempt's state", async ({ onTestFinished }) => {
    const { server, port } = await loopback(onTestFinished);
    const pending = beginAuthorization(port, CREDENTIALS.extAgentHostId);
    const waiting = awaitCallback(server, pending, AbortSignal.timeout(5000)).catch(
      (cause: SignInRefused) => cause.kind,
    );
    const callback = await fetch(`${pending.redirectUri}?state=forged&code=c&client_id=oaiapp_1`);
    expect(callback.status).toBe(400);
    await expect(waiting).resolves.toBe(SIGN_IN_REFUSAL.STATE_MISMATCH);
  });
});

describe("the credentials file", () => {
  it("holds the credentials owner-only in a directory of its own and reads them back", async (context) => {
    const root = await temporaryDirectory(context, "codex-probe");
    const file = await writeCredentialsFile(CREDENTIALS, root);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(file))).mode & 0o777).toBe(0o700);
    await expect(readCredentialsFile(file)).resolves.toEqual(CREDENTIALS);
  });

  it("refuses a file another user could read", async (context) => {
    const file = await writeCredentialsFile(
      CREDENTIALS,
      await temporaryDirectory(context, "codex-probe"),
    );
    await chmod(file, 0o644);
    const refused = await readCredentialsFile(file).catch((cause: SignInRefused) => cause.kind);
    expect(refused).toBe(SIGN_IN_REFUSAL.TOKEN_RESPONSE);
  });
});
