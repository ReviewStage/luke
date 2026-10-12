import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, HTTP_STATUS } from "@sidecar/wire/testing";
import { Effect } from "effect";
import { HOSTED_API_ERROR } from "./service-wire.js";
import { HostedWorkspaceClient } from "./workspace-client.js";
import { WORKSPACE_ROLE } from "./workspace-wire.js";

const PERSONAL = {
  id: "org-personal-1",
  name: "Ada Lovelace",
  personal: true,
  role: WORKSPACE_ROLE.OWNER,
};
const SHARED = { id: "org-acme-1", name: "acme", personal: false, role: WORKSPACE_ROLE.MEMBER };
const JOINABLE = { installationId: 4_200_017, name: "relay-labs" };

function client(): HostedWorkspaceClient {
  return new HostedWorkspaceClient({
    serviceBaseUrl: "https://tryluke.dev",
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
  });
}

it.effect(
  "lists the account's workspaces and the ones it may join under its bearer, as the service ordered them",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        "GET /api/workspaces": {
          answer: () => ({ workspaces: [PERSONAL, SHARED], available: [JOINABLE] }),
        },
      });

      const read = yield* Effect.provide(client().list(), api.layer);

      assert.deepEqual(read, { workspaces: [PERSONAL, SHARED], available: [JOINABLE] });
      assert.deepEqual(api.credentials(), ["token-1"]);
    }),
);

it.effect("reads a key a newer service added past, and a refusal or a malformed list as none", () =>
  Effect.gen(function* () {
    const newer = fakeCloudApi({
      "GET /api/workspaces": {
        answer: () => ({
          workspaces: [{ ...PERSONAL, logo: null }],
          available: [],
          cursor: "next",
        }),
      },
    });
    const refusing = fakeCloudApi({
      "GET /api/workspaces": {
        answer: () => ({ error: HOSTED_API_ERROR.UNAVAILABLE }),
        status: HTTP_STATUS.SERVER_ERROR,
      },
    });
    const malformed = fakeCloudApi({
      "GET /api/workspaces": {
        answer: () => ({ workspaces: [{ ...SHARED, role: "guest" }], available: [] }),
      },
    });

    assert.deepEqual(yield* Effect.provide(client().list(), newer.layer), {
      workspaces: [PERSONAL],
      available: [],
    });
    assert.equal(yield* Effect.provide(client().list(), refusing.layer), undefined);
    assert.equal(yield* Effect.provide(client().list(), malformed.layer), undefined);
  }),
);

const ADA = { userId: "user-ada", name: "Ada Lovelace", email: "ada@luke.test", role: "owner" };
const GRACE = {
  userId: "user-grace",
  name: "Grace Hopper",
  email: "grace@luke.test",
  role: "member",
};

it.effect(
  "joins an installation's workspace and manages its members, each asked as the service names it",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        "POST /api/workspaces/join": { answer: () => ({ workspace: SHARED }) },
        "GET /api/workspaces/members": { answer: () => ({ members: [ADA, GRACE] }) },
        "POST /api/workspaces/members/remove": { answer: () => ({ members: [ADA] }) },
        "POST /api/workspaces/leave": { answer: () => ({ workspaceId: SHARED.id }) },
      });
      const workspaces = client();

      const joined = yield* Effect.provide(workspaces.join(JOINABLE.installationId), api.layer);
      const members = yield* Effect.provide(workspaces.members(SHARED.id), api.layer);
      const remaining = yield* Effect.provide(
        workspaces.removeMember(SHARED.id, GRACE.userId),
        api.layer,
      );
      const left = yield* Effect.provide(workspaces.leave(SHARED.id), api.layer);

      assert.deepEqual(joined, SHARED);
      assert.deepEqual(members, [ADA, GRACE]);
      assert.deepEqual(remaining, [ADA]);
      assert.equal(left, true);
      assert.deepEqual(
        api.requests().map(({ method, pathname, search, body }) => ({
          route: `${method} ${pathname}${search}`,
          body: body === undefined ? undefined : JSON.parse(body),
        })),
        [
          {
            route: "POST /api/workspaces/join",
            body: { installationId: JOINABLE.installationId },
          },
          { route: `GET /api/workspaces/members?workspaceId=${SHARED.id}`, body: undefined },
          {
            route: "POST /api/workspaces/members/remove",
            body: { workspaceId: SHARED.id, userId: GRACE.userId },
          },
          { route: "POST /api/workspaces/leave", body: { workspaceId: SHARED.id } },
        ],
      );
    }),
);

it.effect("answers nothing, and no leaving, where the service refused", () =>
  Effect.gen(function* () {
    const refusal = {
      answer: () => ({ error: HOSTED_API_ERROR.NOT_PERMITTED }),
      status: HTTP_STATUS.FORBIDDEN,
    };
    const api = fakeCloudApi({
      "POST /api/workspaces/join": refusal,
      "GET /api/workspaces/members": refusal,
      "POST /api/workspaces/members/remove": refusal,
      "POST /api/workspaces/leave": refusal,
    });
    const workspaces = client();

    assert.equal(
      yield* Effect.provide(workspaces.join(JOINABLE.installationId), api.layer),
      undefined,
    );
    assert.equal(yield* Effect.provide(workspaces.members(SHARED.id), api.layer), undefined);
    assert.equal(
      yield* Effect.provide(workspaces.removeMember(SHARED.id, GRACE.userId), api.layer),
      undefined,
    );
    assert.equal(yield* Effect.provide(workspaces.leave(SHARED.id), api.layer), false);
  }),
);
