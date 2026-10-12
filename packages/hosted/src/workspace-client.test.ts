import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, HTTP_STATUS } from "@sidecar/wire/testing";
import { Effect } from "effect";
import { WORKSPACE_CALL_FAILURE } from "./planning-view.js";
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

      assert.deepEqual(joined, { ok: true, answer: SHARED });
      assert.deepEqual(members, { ok: true, answer: [ADA, GRACE] });
      assert.deepEqual(remaining, { ok: true, answer: [ADA] });
      assert.deepEqual(left, { ok: true, answer: SHARED.id });
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

it.effect("tells a refusal the account's role earned apart from one that is no answer at all", () =>
  Effect.gen(function* () {
    const refusal = (error: string, status: number) => ({ answer: () => ({ error }), status });
    const forbidden = refusal(HOSTED_API_ERROR.NOT_PERMITTED, HTTP_STATUS.FORBIDDEN);
    const notPermitted = fakeCloudApi({
      "POST /api/workspaces/join": forbidden,
      "GET /api/workspaces/members": forbidden,
      "POST /api/workspaces/members/remove": forbidden,
      "POST /api/workspaces/leave": forbidden,
    });
    const missing = refusal(HOSTED_API_ERROR.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    const notFound = fakeCloudApi({
      "POST /api/workspaces/join": missing,
      "GET /api/workspaces/members": missing,
      "POST /api/workspaces/members/remove": missing,
      "POST /api/workspaces/leave": missing,
    });
    const workspaces = client();
    const every = (layer: typeof notPermitted.layer) =>
      Effect.provide(
        Effect.all([
          workspaces.join(JOINABLE.installationId),
          workspaces.members(SHARED.id),
          workspaces.removeMember(SHARED.id, GRACE.userId),
          workspaces.leave(SHARED.id),
        ]),
        layer,
      );

    const refused = { ok: false, failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED };
    const unanswered = { ok: false, failure: WORKSPACE_CALL_FAILURE.UNANSWERED };
    assert.deepEqual(yield* every(notPermitted.layer), [refused, refused, refused, refused]);
    assert.deepEqual(yield* every(notFound.layer), [
      unanswered,
      unanswered,
      unanswered,
      unanswered,
    ]);
  }),
);
