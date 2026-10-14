import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, HTTP_STATUS } from "@sidecar/wire/testing";
import { Effect } from "effect";
import { HOSTED_API_ERROR } from "./service-wire.js";
import { HostedWorkspaceClient, WORKSPACE_CALL_FAILURE } from "./workspace-client.js";
import { WORKSPACE_ROLE } from "./workspace-wire.js";

const PERSONAL = {
  id: "org-personal-1",
  name: "Ada Lovelace",
  personal: true,
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};
const ACME = {
  id: "org-acme-1",
  name: "Acme",
  personal: false,
  role: WORKSPACE_ROLE.ADMIN,
  github: { login: "acme", active: false },
};
const INSTALL_URL = "https://github.com/apps/luke/installations/new?state=opaque-intent";

function client(): HostedWorkspaceClient {
  return new HostedWorkspaceClient({
    serviceBaseUrl: "https://tryluke.dev",
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
  });
}

/** A service that refuses the request with the word given. */
function refusing(route: string, error: string, status: number) {
  return fakeCloudApi({ [route]: { answer: () => ({ error }), status } });
}

it.effect(
  "lists the account's workspaces under its bearer, a newer key read past, a malformed list as none",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        "GET /api/workspaces": {
          answer: () => ({ workspaces: [PERSONAL, { ...ACME, logo: null }] }),
        },
      });
      const malformed = fakeCloudApi({
        "GET /api/workspaces": { answer: () => ({ workspaces: [{ ...ACME, role: "guest" }] }) },
      });

      assert.deepEqual(yield* Effect.provide(client().list(), api.layer), {
        workspaces: [PERSONAL, ACME],
      });
      assert.deepEqual(api.credentials(), ["token-1"]);
      assert.equal(yield* Effect.provide(client().list(), malformed.layer), undefined);
    }),
);

it.effect("creates a workspace with its name trimmed, and a blank name never travels", () =>
  Effect.gen(function* () {
    const created = { ...ACME, role: WORKSPACE_ROLE.OWNER, github: null };
    const api = fakeCloudApi({
      "POST /api/workspaces": { answer: () => ({ workspace: created }), status: 201 },
    });

    const answered = yield* Effect.provide(client().create("  Acme  "), api.layer);
    const blank = yield* Effect.provide(client().create("   "), api.layer);

    assert.deepEqual(answered, { ok: true, answer: created });
    assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), { name: "Acme" });
    assert.deepEqual(blank, { ok: false, failure: WORKSPACE_CALL_FAILURE.UNANSWERED });
    assert.equal(api.requests().length, 1);
  }),
);

it.effect("connects GitHub by answering the install address, and names each refusal", () =>
  Effect.gen(function* () {
    const route = "POST /api/workspaces/github/connect";
    const api = fakeCloudApi({ [route]: { answer: () => ({ url: INSTALL_URL }) } });

    const connected = yield* Effect.provide(client().githubConnect(ACME.id), api.layer);
    const member = yield* Effect.provide(
      client().githubConnect(ACME.id),
      refusing(route, HOSTED_API_ERROR.NOT_PERMITTED, 403).layer,
    );
    const stranger = yield* Effect.provide(
      client().githubConnect(ACME.id),
      refusing(route, HOSTED_API_ERROR.NOT_FOUND, HTTP_STATUS.NOT_FOUND).layer,
    );
    const down = yield* Effect.provide(
      client().githubConnect(ACME.id),
      refusing(route, HOSTED_API_ERROR.UNAVAILABLE, HTTP_STATUS.SERVER_ERROR).layer,
    );

    assert.deepEqual(connected, { ok: true, answer: INSTALL_URL });
    assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), { workspaceId: ACME.id });
    assert.deepEqual(member, { ok: false, failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED });
    assert.deepEqual(stranger, { ok: false, failure: WORKSPACE_CALL_FAILURE.NOT_FOUND });
    assert.deepEqual(down, { ok: false, failure: WORKSPACE_CALL_FAILURE.UNANSWERED });
  }),
);

it.effect("disconnects GitHub, answering the workspace with no GitHub account", () =>
  Effect.gen(function* () {
    const disconnected = { ...ACME, github: null };
    const api = fakeCloudApi({
      "POST /api/workspaces/github/disconnect": { answer: () => ({ workspace: disconnected }) },
    });

    const answered = yield* Effect.provide(client().githubDisconnect(ACME.id), api.layer);

    assert.deepEqual(answered, { ok: true, answer: disconnected });
    assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), { workspaceId: ACME.id });
  }),
);
