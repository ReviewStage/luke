import assert from "node:assert/strict";
import test from "node:test";
import { LinearCredentials } from "../src/linear-credentials";
import type { LinearGrant } from "../src/linear-oauth";
import {
  HTTP_STATUS,
  jsonResponse,
  type RecordedRequest,
  recordingFetch,
} from "./support/http-fake";

const NOW = 1_760_000_000_000;
const HOUR_MS = 3_600_000;

const ENVIRONMENT: NodeJS.ProcessEnv = { LINEAR_OAUTH_CLIENT_ID: "6f0a2c1e9b3d4f5a" };

/** A store of one grant, standing in for the settings store's own. */
function grantStore(initial: LinearGrant | undefined) {
  const state = { grant: initial, writes: 0, forgets: 0 };
  return {
    state,
    readGrant: async () => state.grant,
    writeGrant: async (grant: LinearGrant) => {
      state.grant = grant;
      state.writes += 1;
    },
    forgetGrant: async () => {
      state.grant = undefined;
      state.forgets += 1;
    },
  };
}

function credentialsFor(
  store: ReturnType<typeof grantStore>,
  respond: (request: RecordedRequest) => Response,
): { credentials: LinearCredentials; requests: RecordedRequest[] } {
  const { fetch: fakeFetch, requests } = recordingFetch(respond);
  const credentials = new LinearCredentials({
    readGrant: store.readGrant,
    writeGrant: store.writeGrant,
    forgetGrant: store.forgetGrant,
    environment: ENVIRONMENT,
    fetchImplementation: fakeFetch as typeof globalThis.fetch,
    now: () => NOW,
  });
  return { credentials, requests };
}

function renewed(): Response {
  return jsonResponse({
    access_token: "renewed-access",
    refresh_token: "renewed-refresh",
    expires_in: 86_400,
  });
}

test("nothing connected sends nothing", async () => {
  const store = grantStore(undefined);
  const { credentials, requests } = credentialsFor(store, () => renewed());

  assert.equal(await credentials.accessToken(), undefined);
  assert.deepEqual(requests, []);
});

test("a token still good is spent rather than renewed", async () => {
  const store = grantStore({
    accessToken: "current-access",
    refreshToken: "current-refresh",
    expiresAt: NOW + HOUR_MS,
  });
  const { credentials, requests } = credentialsFor(store, () => renewed());

  assert.equal(await credentials.accessToken(), "current-access");
  // A rotation is a cost: spending one for a token that had an hour left
  // would burn the grant's only refresh token for nothing.
  assert.deepEqual(requests, []);
});

test("a lapsed token is renewed, and the renewal is stored before it is used", async () => {
  const store = grantStore({
    accessToken: "stale-access",
    refreshToken: "current-refresh",
    expiresAt: NOW - HOUR_MS,
  });
  const { credentials, requests } = credentialsFor(store, () => renewed());

  assert.equal(await credentials.accessToken(), "renewed-access");
  assert.equal(requests.length, 1);
  assert.equal(new URLSearchParams(requests[0]?.body ?? "").get("grant_type"), "refresh_token");
  // Linear consumed the old refresh token, so a renewal that reached nobody's
  // disk would be a grant the developer has to make again.
  assert.equal(store.state.writes, 1);
  assert.deepEqual(store.state.grant, {
    accessToken: "renewed-access",
    refreshToken: "renewed-refresh",
    expiresAt: NOW + 86_400_000,
  });
});

test("two asks at once spend one rotation between them", async () => {
  const store = grantStore({
    accessToken: "stale-access",
    refreshToken: "current-refresh",
    expiresAt: NOW - HOUR_MS,
  });
  const { credentials, requests } = credentialsFor(store, () => renewed());

  // An observation pass and a spoken act can both find the token lapsed. The
  // loser of a race would spend a refresh token Linear had already rotated
  // away, and Linear reads that as a withdrawn grant.
  const [first, second] = await Promise.all([credentials.accessToken(), credentials.accessToken()]);
  assert.equal(first, "renewed-access");
  assert.equal(second, "renewed-access");
  assert.equal(requests.length, 1);
});

test("Linear refusing the renewal disconnects; a network that cannot answer does not", async () => {
  const refused = grantStore({
    accessToken: "stale-access",
    refreshToken: "dead-refresh",
    expiresAt: NOW - HOUR_MS,
  });
  const { credentials: refusedCredentials } = credentialsFor(refused, () =>
    jsonResponse({ error: "invalid_grant" }, HTTP_STATUS.UNAUTHORIZED),
  );
  assert.equal(await refusedCredentials.accessToken(), undefined);
  // The row goes back to offering a connection, which is the only thing that
  // helps: no number of further passes will revive a withdrawn grant.
  assert.equal(refused.state.forgets, 1);
  assert.equal(refused.state.grant, undefined);

  const offline = grantStore({
    accessToken: "stale-access",
    refreshToken: "good-refresh",
    expiresAt: NOW - HOUR_MS,
  });
  const { credentials: offlineCredentials } = credentialsFor(offline, () =>
    jsonResponse({}, HTTP_STATUS.SERVER_ERROR),
  );
  assert.equal(await offlineCredentials.accessToken(), undefined);
  // The grant is exactly where it was: a closed laptop is not a disconnection.
  assert.equal(offline.state.forgets, 0);
  assert.equal(offline.state.grant?.refreshToken, "good-refresh");
});

test("a transient renewal failure can still use an access token until it lapses", async () => {
  const store = grantStore({
    accessToken: "nearly-lapsed-access",
    refreshToken: "good-refresh",
    expiresAt: NOW + 30_000,
  });
  const { credentials } = credentialsFor(store, () => jsonResponse({}, HTTP_STATUS.SERVER_ERROR));

  assert.equal(await credentials.accessToken(), "nearly-lapsed-access");
  assert.equal(store.state.forgets, 0);
});

test("a lapsed grant with nothing to renew it is let go", async () => {
  const store = grantStore({ accessToken: "stale-access", expiresAt: NOW - HOUR_MS });
  const { credentials, requests } = credentialsFor(store, () => renewed());

  assert.equal(await credentials.accessToken(), undefined);
  // Nothing to send, so nothing is sent; the row says connect rather than
  // sitting there failing every pass.
  assert.deepEqual(requests, []);
  assert.equal(store.state.forgets, 1);
});

test("disconnecting revokes at Linear and forgets here either way", async () => {
  const store = grantStore({
    accessToken: "current-access",
    refreshToken: "current-refresh",
    expiresAt: NOW + HOUR_MS,
  });
  const { credentials, requests } = credentialsFor(store, () => jsonResponse({}, HTTP_STATUS.OK));

  await credentials.disconnect();
  const revokeBody = new URLSearchParams(requests[0]?.body ?? "");
  assert.equal(revokeBody.get("token"), "current-refresh");
  assert.equal(revokeBody.get("token_type_hint"), "refresh_token");
  assert.equal(store.state.grant, undefined);

  const stubborn = grantStore({
    accessToken: "current-access",
    refreshToken: "current-refresh",
    expiresAt: NOW + HOUR_MS,
  });
  const { credentials: stubbornCredentials } = credentialsFor(stubborn, () => {
    throw new Error("offline");
  });
  await stubbornCredentials.disconnect();
  // The developer asked to disconnect. A network that cannot carry the
  // revocation is no reason to keep the grant on this machine.
  assert.equal(stubborn.state.grant, undefined);
});

test("disconnecting while a refresh is in flight cannot restore the grant", async () => {
  const store = grantStore({
    accessToken: "stale-access",
    refreshToken: "current-refresh",
    expiresAt: NOW - HOUR_MS,
  });
  let finishRefresh: ((response: Response) => void) | undefined;
  const refreshResponse = new Promise<Response>((resolve) => {
    finishRefresh = resolve;
  });
  const requests: RecordedRequest[] = [];
  const credentials = new LinearCredentials({
    readGrant: store.readGrant,
    writeGrant: store.writeGrant,
    forgetGrant: store.forgetGrant,
    environment: ENVIRONMENT,
    fetchImplementation: (async (input, init) => {
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      return requests.length === 1 ? refreshResponse : jsonResponse({}, HTTP_STATUS.OK);
    }) as typeof globalThis.fetch,
    now: () => NOW,
  });

  const access = credentials.accessToken();
  while (requests.length === 0) await new Promise((resolve) => setImmediate(resolve));
  const disconnect = credentials.disconnect();
  while (requests.length < 2) await new Promise((resolve) => setImmediate(resolve));
  finishRefresh?.(renewed());

  await disconnect;
  assert.equal(await access, undefined);
  assert.equal(store.state.grant, undefined);
  assert.equal(store.state.writes, 0);
});

test("a refresh cannot start while disconnect is revoking the grant", async () => {
  const store = grantStore({
    accessToken: "stale-access",
    refreshToken: "current-refresh",
    expiresAt: NOW - HOUR_MS,
  });
  let finishRevocation: ((response: Response) => void) | undefined;
  const revocationResponse = new Promise<Response>((resolve) => {
    finishRevocation = resolve;
  });
  const requests: RecordedRequest[] = [];
  const credentials = new LinearCredentials({
    readGrant: store.readGrant,
    writeGrant: store.writeGrant,
    forgetGrant: store.forgetGrant,
    environment: ENVIRONMENT,
    fetchImplementation: (async (input, init) => {
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      return revocationResponse;
    }) as typeof globalThis.fetch,
    now: () => NOW,
  });

  const disconnect = credentials.disconnect();
  while (requests.length === 0) await new Promise((resolve) => setImmediate(resolve));

  assert.equal(await credentials.accessToken(), undefined);
  assert.equal(requests.length, 1);
  finishRevocation?.(jsonResponse({}, HTTP_STATUS.OK));
  await disconnect;
  assert.equal(store.state.grant, undefined);
  assert.equal(store.state.writes, 0);
});
