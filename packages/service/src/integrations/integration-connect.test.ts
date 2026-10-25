import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { INTEGRATION_PROVIDER, INTEGRATION_PROVIDER_LIST } from "@luke/features/integration-wire";
import {
  type ConnectAuthorizationResponse,
  type ConnectTokenResponse,
  UserAuthorizationRequiredError,
} from "@vercel/connect";
import { Duration, Effect, Layer, Redacted, Result } from "effect";
import { TestClock } from "effect/testing";
import { CONNECTOR_ASKED_NOTHING, integrationConnectOf } from "../testing/integration-connect.js";
import {
  ConnectTokenCache,
  type ConnectTokenStore,
  connectTokenCacheOver,
} from "./connect-token-cache.js";
import {
  type ConnectorService,
  type ConnectSdk,
  INTEGRATION_CONNECT_FAILURE,
  revokeIntegrationGrants,
  vercelConnector,
} from "./integration-connect.js";

const SIGN_IN_URL = "https://vercel.com/connect/authorize/req_1";

/** A Connect that begins every sign-in at `url`, and is asked nothing else. */
function beginningAt(url: string) {
  const sdk: ConnectSdk = {
    startAuthorization: () =>
      Promise.resolve({
        url,
        verifier: "connect-verifier-abc",
        request: "req_1",
        expiresAt: 0,
      } satisfies ConnectAuthorizationResponse),
    getTokenResponse: () => Promise.reject(new Error("this suite reads no token")),
    revokeToken: () => Promise.reject(new Error("this suite revokes nothing")),
  };
  return vercelConnector("oauth/granola", sdk);
}

it.effect("beginning a sign-in answers the address the browser opens, and only an https one", () =>
  Effect.gen(function* () {
    const begun = yield* beginningAt(SIGN_IN_URL).authorize("user-1", "https://luke.test/callback");
    assert.deepEqual(begun, { url: SIGN_IN_URL });
    const refused = yield* Effect.result(
      beginningAt("javascript:alert(1)").authorize("user-1", "https://luke.test/callback"),
    );
    assert.ok(Result.isFailure(refused));
    assert.equal(refused.failure.reason, INTEGRATION_CONNECT_FAILURE.UNAVAILABLE);
  }),
);

it.effect(
  "two subjects are two grants: each reads its own token, and revoking one leaves the other",
  () =>
    Effect.gen(function* () {
      // A Connect that holds one grant per subject id, as it holds a grant per (connector, subject).
      const grants = new Map([
        ["user-1", "token-acme"],
        ["subject-2", "token-personal"],
      ]);
      const sdk: ConnectSdk = {
        startAuthorization: () => Promise.reject(new Error("this suite begins no sign-in")),
        getTokenResponse: (_connector, { subject }) => {
          const token = subject.type === "user" ? grants.get(subject.id) : undefined;
          return token === undefined
            ? Promise.reject(
                new UserAuthorizationRequiredError("no grant", {
                  code: "user_authorization_required",
                }),
              )
            : Promise.resolve({
                token,
                expiresAt: 0,
                connector: { id: "c_1", uid: "oauth/notion", type: "oauth" },
              });
        },
        revokeToken: (_connector, { subject }) => {
          if (subject.type === "user") grants.delete(subject.id);
          return Promise.resolve();
        },
      };
      const connector = vercelConnector("oauth/notion", sdk);
      const tokenOf = (subject: string) =>
        Effect.map(Effect.result(connector.token(subject, { fresh: true })), (read) =>
          Result.isSuccess(read) ? Redacted.value(read.success.token) : read.failure.reason,
        );

      assert.deepEqual(
        [yield* tokenOf("user-1"), yield* tokenOf("subject-2")],
        ["token-acme", "token-personal"],
      );
      yield* connector.revoke("subject-2");
      assert.deepEqual(
        [yield* tokenOf("user-1"), yield* tokenOf("subject-2")],
        ["token-acme", INTEGRATION_CONNECT_FAILURE.NOT_AUTHORIZED],
      );
    }),
);

it.effect(
  "deleting an account revokes the first account's grant at every provider under its user id, rows or none, and every other account's under its own subject",
  () =>
    Effect.gen(function* () {
      const revoked: string[] = [];
      const recording = (provider: string): ConnectorService => ({
        ...CONNECTOR_ASKED_NOTHING,
        revoke: (subject) =>
          Effect.sync(() => {
            revoked.push(`${provider} ${subject}`);
          }),
      });
      yield* revokeIntegrationGrants("user-1", [
        { provider: INTEGRATION_PROVIDER.NOTION, connectSubject: "user-1" },
        { provider: INTEGRATION_PROVIDER.NOTION, connectSubject: "subject-2" },
      ]).pipe(Effect.provide(integrationConnectOf(recording)));

      assert.deepEqual(
        revoked.toSorted(),
        [
          ...INTEGRATION_PROVIDER_LIST.map((provider) => `${provider} user-1`),
          `${INTEGRATION_PROVIDER.NOTION} subject-2`,
        ].toSorted(),
      );
    }),
);

it.effect(
  "a grant's workspace name is the account's name at the provider, and nothing shaped like a credential or the connector's own id is",
  () =>
    Effect.gen(function* () {
      const answering = (fields: Partial<ConnectTokenResponse>) => {
        const sdk: ConnectSdk = {
          startAuthorization: () => Promise.reject(new Error("this suite begins no sign-in")),
          getTokenResponse: () =>
            Promise.resolve({
              token: "token-acme",
              expiresAt: 0,
              connector: { id: "c_1", uid: "oauth/notion", type: "oauth" },
              ...fields,
            }),
          revokeToken: () => Promise.reject(new Error("this suite revokes nothing")),
        };
        return Effect.map(
          vercelConnector("oauth/notion", sdk).token("user-1", { fresh: true }),
          (issued) => issued.accountName,
        );
      };
      assert.equal(yield* answering({ metadata: { workspace_name: "Acme" } }), "Acme");
      assert.equal(yield* answering({ metadata: { team: { name: "Acme Eng" } } }), "Acme Eng");
      assert.equal(yield* answering({ name: "oauth/notion" }), undefined);
      assert.equal(yield* answering({ metadata: { workspace_name: "Bearer 0000" } }), undefined);
      assert.equal(yield* answering({}), undefined);
    }),
);

/** The deployment's provider-key ring, as the shared token cache derives its keys from it. */
const KEY_RING = Redacted.make(`1:${Buffer.alloc(32, 7).toString("base64")}`);

/** One region's Runtime Cache as every instance reads it: a map of what was written, and nothing else. */
function sharedStore() {
  const entries = new Map<string, string>();
  const store: ConnectTokenStore = {
    get: (key) => Promise.resolve(entries.get(key) ?? null),
    set: (key, value) => {
      entries.set(key, value);
      return Promise.resolve();
    },
    delete: (key) => {
      entries.delete(key);
      return Promise.resolve();
    },
    expireTag: () => Promise.resolve(),
  };
  return {
    entries,
    layer: Layer.succeed(ConnectTokenCache, connectTokenCacheOver(KEY_RING, store)),
  };
}

/** A Runtime Cache that refuses every call, as one that cannot be reached does. */
const UNREACHABLE_STORE: ConnectTokenStore = {
  get: () => Promise.reject(new Error("the cache is down")),
  set: () => Promise.reject(new Error("the cache is down")),
  delete: () => Promise.reject(new Error("the cache is down")),
  expireTag: () => Promise.reject(new Error("the cache is down")),
};

/**
 * One function instance's Connect: it holds the grants `grants` names,
 * issues each a token good for ten minutes from the test clock's start, and
 * counts every token it is asked for, as each ask is one Connect bills.
 */
function instanceConnect(grants: Map<string, string>) {
  const asked = { tokens: 0 };
  const sdk: ConnectSdk = {
    startAuthorization: () =>
      Promise.resolve({ url: SIGN_IN_URL, verifier: "v", request: "req_1", expiresAt: 0 }),
    getTokenResponse: (_connector, { subject }) => {
      asked.tokens += 1;
      const token = subject.type === "user" ? grants.get(subject.id) : undefined;
      return token === undefined
        ? Promise.reject(
            new UserAuthorizationRequiredError("no grant", { code: "user_authorization_required" }),
          )
        : Promise.resolve({
            token,
            expiresAt: Duration.toMillis(Duration.minutes(10)),
            connector: { id: "c_1", uid: "oauth/notion", type: "oauth" },
          });
    },
    revokeToken: (_connector, { subject }) => {
      if (subject.type === "user") grants.delete(subject.id);
      return Promise.resolve();
    },
  };
  return { asked, sdk };
}

it.effect(
  "a token one instance asked Connect for, another reuses until a minute before it expires, and the cache holds it sealed",
  () => {
    const { entries, layer } = sharedStore();
    return Effect.gen(function* () {
      const cache = yield* ConnectTokenCache;
      const grants = new Map([["user-1", "token-acme"]]);
      const first = instanceConnect(grants);
      const second = instanceConnect(grants);
      const tokenOn = (sdk: ConnectSdk) =>
        Effect.map(
          vercelConnector("oauth/notion", sdk, cache).token("user-1", { fresh: false }),
          (issued) => Redacted.value(issued.token),
        );

      assert.equal(yield* tokenOn(first.sdk), "token-acme");
      assert.equal(yield* tokenOn(second.sdk), "token-acme");
      assert.deepEqual([first.asked.tokens, second.asked.tokens], [1, 0]);
      for (const [key, value] of entries) {
        for (const plain of ["token-acme", "user-1", "oauth/notion"]) {
          assert.ok(!key.includes(plain) && !value.includes(plain));
        }
      }

      yield* TestClock.adjust(Duration.seconds(9 * 60 + 1));
      assert.equal(yield* tokenOn(second.sdk), "token-acme");
      assert.equal(second.asked.tokens, 1);
    }).pipe(Effect.provide(layer));
  },
);

it.effect("a new sign-in and a revoke each drop the account's cached token at once", () => {
  const { layer } = sharedStore();
  return Effect.gen(function* () {
    const cache = yield* ConnectTokenCache;
    const grants = new Map([["user-1", "token-acme"]]);
    const first = instanceConnect(grants);
    const second = instanceConnect(grants);
    const connector = vercelConnector("oauth/notion", first.sdk, cache);
    const readOnSecond = Effect.result(
      vercelConnector("oauth/notion", second.sdk, cache).token("user-1", { fresh: false }),
    );

    yield* connector.token("user-1", { fresh: false });
    yield* connector.authorize("user-1", "https://luke.test/callback");
    yield* readOnSecond;
    assert.equal(second.asked.tokens, 1);

    yield* connector.revoke("user-1");
    const revoked = yield* readOnSecond;
    assert.ok(Result.isFailure(revoked));
    assert.equal(revoked.failure.reason, INTEGRATION_CONNECT_FAILURE.NOT_AUTHORIZED);
    assert.equal(second.asked.tokens, 2);
  }).pipe(Effect.provide(layer));
});

it.effect("a cache that cannot be reached falls back to asking Connect, never to an error", () =>
  Effect.gen(function* () {
    const cache = yield* ConnectTokenCache;
    const { asked, sdk } = instanceConnect(new Map([["user-1", "token-acme"]]));
    const connector = vercelConnector("oauth/notion", sdk, cache);

    const issued = yield* connector.token("user-1", { fresh: false });
    yield* connector.revoke("user-1");

    assert.equal(Redacted.value(issued.token), "token-acme");
    assert.equal(asked.tokens, 1);
  }).pipe(
    Effect.provide(
      Layer.succeed(ConnectTokenCache, connectTokenCacheOver(KEY_RING, UNREACHABLE_STORE)),
    ),
  ),
);
