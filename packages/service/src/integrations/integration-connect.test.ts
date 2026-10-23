import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { INTEGRATION_PROVIDER, INTEGRATION_PROVIDER_LIST } from "@luke/features/integration-wire";
import {
  type ConnectAuthorizationResponse,
  type ConnectTokenResponse,
  UserAuthorizationRequiredError,
} from "@vercel/connect";
import { Effect, Redacted, Result } from "effect";
import { CONNECTOR_ASKED_NOTHING, integrationConnectOf } from "../testing/integration-connect.js";
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
