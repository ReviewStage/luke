import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, HTTP_STATUS, jsonResponse, recordingHttpClient } from "@luke/wire/testing";
import { Effect } from "effect";
import { HOSTED_API_ERROR } from "./service-wire.js";
import { WORKSPACE_CALL_FAILURE } from "./workspace-call.js";
import { HostedWorkspaceClient, type HostedWorkspaceClientOptions } from "./workspace-client.js";
import { WORKSPACE_ROLE } from "./workspace-wire.js";

const PERSONAL = {
  id: "org-personal-1",
  name: "Ada Lovelace",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};
const ACME = {
  id: "org-acme-1",
  name: "Acme",
  role: WORKSPACE_ROLE.ADMIN,
  github: { login: "acme", active: false },
};
const INSTALL_URL = "https://github.com/apps/luke/installations/new?state=opaque-intent";

/** The client over an account holding OAuth token `token-1` and, unless told otherwise, session `session-1`. */
function client(
  session: Pick<HostedWorkspaceClientOptions, "readSessionToken" | "obtainSession"> = {
    readSessionToken: () => Effect.succeed("session-1"),
    obtainSession: () => Effect.void,
  },
): HostedWorkspaceClient {
  return new HostedWorkspaceClient({
    serviceBaseUrl: "https://tryluke.dev",
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
    readAccountKey: () => Effect.succeed("ada@example.com"),
    ...session,
  });
}

/** A session the hand-off replaces: none or `before` until asked for, then `after`. */
function handedOff(before: string | undefined, after: string) {
  let current = before;
  let asked = 0;
  return {
    session: {
      readSessionToken: () => Effect.sync(() => current),
      obtainSession: () =>
        Effect.sync(() => {
          asked += 1;
          current = after;
        }),
    },
    asked: () => asked,
  };
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

const ADA = { userId: "user-ada", name: "Ada Lovelace", email: "ada@luke.test", role: "owner" };
const GRACE = {
  userId: "user-grace",
  name: "Grace Hopper",
  email: "grace@luke.test",
  role: "member",
};

it.effect("reads a workspace's members under the workspace's id, as the service ordered them", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "GET /api/workspaces/members": { answer: () => ({ members: [ADA, GRACE] }) },
    });

    const members = yield* Effect.provide(client().members(ACME.id), api.layer);

    assert.deepEqual(members, { ok: true, answer: [ADA, GRACE] });
    assert.deepEqual(
      api.requests().map(({ method, pathname, search }) => `${method} ${pathname}${search}`),
      [`GET /api/workspaces/members?workspaceId=${ACME.id}`],
    );
  }),
);

it.effect("names a members read the service refused: not permitted, or not a member", () =>
  Effect.gen(function* () {
    const route = "GET /api/workspaces/members";

    const notPermitted = yield* Effect.provide(
      client().members(PERSONAL.id),
      refusing(route, HOSTED_API_ERROR.NOT_PERMITTED, HTTP_STATUS.FORBIDDEN).layer,
    );
    const outsider = yield* Effect.provide(
      client().members(ACME.id),
      refusing(route, HOSTED_API_ERROR.NOT_FOUND, HTTP_STATUS.NOT_FOUND).layer,
    );

    assert.deepEqual(notPermitted, { ok: false, failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED });
    assert.deepEqual(outsider, { ok: false, failure: WORKSPACE_CALL_FAILURE.NOT_FOUND });
  }),
);

it.effect(
  "removes a member and leaves a workspace, answered with those who remain and the workspace left",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        "POST /api/workspaces/members/remove": { answer: () => ({ members: [ADA] }) },
        "POST /api/workspaces/leave": { answer: () => ({ workspaceId: ACME.id }) },
      });
      const workspaces = client();

      const remaining = yield* Effect.provide(
        workspaces.removeMember(ACME.id, GRACE.userId),
        api.layer,
      );
      const left = yield* Effect.provide(workspaces.leave(ACME.id), api.layer);

      assert.deepEqual(remaining, { ok: true, answer: [ADA] });
      assert.deepEqual(left, { ok: true, answer: ACME.id });
      // Both write through Better Auth, so both carry the Mac's session, never its OAuth token.
      assert.deepEqual(api.credentials(), ["session-1", "session-1"]);
      assert.deepEqual(
        api.requests().map(({ method, pathname, body }) => ({
          route: `${method} ${pathname}`,
          body: body === undefined ? undefined : JSON.parse(body),
        })),
        [
          {
            route: "POST /api/workspaces/members/remove",
            body: { workspaceId: ACME.id, userId: GRACE.userId },
          },
          { route: "POST /api/workspaces/leave", body: { workspaceId: ACME.id } },
        ],
      );
    }),
);

it.effect(
  "names a removal or a leave the service refused, and reads a malformed answer as none",
  () =>
    Effect.gen(function* () {
      const refusal = (error: string, status: number) => ({ answer: () => ({ error }), status });
      const forbidden = refusal(HOSTED_API_ERROR.NOT_PERMITTED, HTTP_STATUS.FORBIDDEN);
      const notPermitted = fakeCloudApi({
        "POST /api/workspaces/members/remove": forbidden,
        "POST /api/workspaces/leave": forbidden,
      });
      const missing = refusal(HOSTED_API_ERROR.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
      const notFound = fakeCloudApi({
        "POST /api/workspaces/members/remove": missing,
        "POST /api/workspaces/leave": missing,
      });
      const elsewhere = fakeCloudApi({
        "POST /api/workspaces/members/remove": {
          answer: () => ({ members: [{ ...ADA, role: "guest" }] }),
        },
        "POST /api/workspaces/leave": { answer: () => ({ workspaceId: PERSONAL.id }) },
      });
      const workspaces = client();
      const both = (layer: typeof notPermitted.layer) =>
        Effect.provide(
          Effect.all([workspaces.removeMember(ACME.id, GRACE.userId), workspaces.leave(ACME.id)]),
          layer,
        );

      const refused = { ok: false, failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED };
      const outside = { ok: false, failure: WORKSPACE_CALL_FAILURE.NOT_FOUND };
      const unanswered = { ok: false, failure: WORKSPACE_CALL_FAILURE.UNANSWERED };
      assert.deepEqual(yield* both(notPermitted.layer), [refused, refused]);
      assert.deepEqual(yield* both(notFound.layer), [outside, outside]);
      assert.deepEqual(yield* both(elsewhere.layer), [unanswered, unanswered]);
    }),
);

it.effect(
  "with no session yet, a removal asks for one through the hand-off and is sent on it",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        "POST /api/workspaces/members/remove": { answer: () => ({ members: [ADA] }) },
      });
      const handOff = handedOff(undefined, "session-2");

      const remaining = yield* Effect.provide(
        client(handOff.session).removeMember(ACME.id, GRACE.userId),
        api.layer,
      );

      assert.deepEqual(remaining, { ok: true, answer: [ADA] });
      assert.equal(handOff.asked(), 1);
      assert.deepEqual(api.credentials(), ["session-2"]);
    }),
);

it.effect(
  "a session the service no longer takes is replaced through the hand-off, and the leave sent once more",
  () =>
    Effect.gen(function* () {
      const service = recordingHttpClient((request) =>
        request.authorization === "Bearer session-2"
          ? jsonResponse({ workspaceId: ACME.id })
          : jsonResponse({ error: HOSTED_API_ERROR.INVALID_TOKEN }, HTTP_STATUS.UNAUTHORIZED),
      );
      const handOff = handedOff("session-1", "session-2");

      const left = yield* Effect.provide(client(handOff.session).leave(ACME.id), service.layer);

      assert.deepEqual(left, { ok: true, answer: ACME.id });
      assert.equal(handOff.asked(), 1);
      assert.deepEqual(
        service.requests.map((request) => request.authorization),
        ["Bearer session-1", "Bearer session-2"],
      );
    }),
);

it.effect("an account that changes during the hand-off sends nothing under the new one", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "POST /api/workspaces/members/remove": { answer: () => ({ members: [ADA] }) },
    });
    let holder = "ada@example.com";
    let session: string | undefined;
    const switched = new HostedWorkspaceClient({
      serviceBaseUrl: "https://tryluke.dev",
      readAccessToken: () => Effect.succeed("token-1"),
      refreshAccount: () => Effect.void,
      readAccountKey: () => Effect.sync(() => holder),
      readSessionToken: () => Effect.sync(() => session),
      // Another account signs in while the hand-off's browser page is open, holding a session of its own.
      obtainSession: () =>
        Effect.sync(() => {
          holder = "bob@example.com";
          session = "session-bob";
        }),
    });

    const removed = yield* Effect.provide(switched.removeMember(ACME.id, GRACE.userId), api.layer);

    assert.deepEqual(removed, { ok: false, failure: WORKSPACE_CALL_FAILURE.UNANSWERED });
    assert.equal(api.requests().length, 0);
  }),
);

it.effect("a hand-off that leaves no session sends nothing and answers unanswered", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "POST /api/workspaces/leave": { answer: () => ({ workspaceId: ACME.id }) },
    });
    const withdrawn = {
      readSessionToken: () => Effect.succeed(undefined),
      obtainSession: () => Effect.void,
    };

    const left = yield* Effect.provide(client(withdrawn).leave(ACME.id), api.layer);

    assert.deepEqual(left, { ok: false, failure: WORKSPACE_CALL_FAILURE.UNANSWERED });
    assert.equal(api.requests().length, 0);
  }),
);

const INVITATION = {
  id: "inv-1",
  email: "alan@example.com",
  role: WORKSPACE_ROLE.MEMBER,
  expiresAt: "2026-10-16T12:00:00.000Z",
  acceptUrl: "https://tryluke.dev/accept-invitation.html?id=inv-1&email=alan%40example.com",
};

it.effect(
  "invites, reads pending invitations, and cancels one, every call under the Mac's session",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        "POST /api/workspaces/invitations": {
          answer: () => ({ invitation: INVITATION }),
          status: 201,
        },
        "GET /api/workspaces/invitations": { answer: () => ({ invitations: [INVITATION] }) },
        "POST /api/workspaces/invitations/cancel": { answer: () => ({ invitations: [] }) },
      });
      const workspaces = client();

      const made = yield* Effect.provide(
        workspaces.invite(ACME.id, " alan@example.com ", WORKSPACE_ROLE.MEMBER),
        api.layer,
      );
      const pending = yield* Effect.provide(workspaces.invitations(ACME.id), api.layer);
      const left = yield* Effect.provide(
        workspaces.cancelInvitation(ACME.id, INVITATION.id),
        api.layer,
      );

      assert.deepEqual(made, { ok: true, answer: INVITATION });
      assert.deepEqual(pending, { ok: true, answer: [INVITATION] });
      assert.deepEqual(left, { ok: true, answer: [] });
      assert.deepEqual(api.credentials(), ["session-1", "session-1", "session-1"]);
      assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), {
        workspaceId: ACME.id,
        email: "alan@example.com",
        role: WORKSPACE_ROLE.MEMBER,
      });
      assert.equal(api.requests()[1]?.searchParams.get("workspaceId"), ACME.id);
    }),
);

it.effect(
  "an address already in or invited is named, and an address or role the service would refuse never travels",
  () =>
    Effect.gen(function* () {
      const api = refusing(
        "POST /api/workspaces/invitations",
        HOSTED_API_ERROR.ALREADY_INVITED,
        HTTP_STATUS.CONFLICT,
      );
      const workspaces = client();

      const again = yield* Effect.provide(
        workspaces.invite(ACME.id, "alan@example.com", WORKSPACE_ROLE.MEMBER),
        api.layer,
      );
      const notAnAddress = yield* Effect.provide(
        workspaces.invite(ACME.id, "alan", WORKSPACE_ROLE.MEMBER),
        api.layer,
      );
      const asOwner = yield* Effect.provide(
        workspaces.invite(ACME.id, "alan@example.com", WORKSPACE_ROLE.OWNER),
        api.layer,
      );

      assert.deepEqual(again, { ok: false, failure: WORKSPACE_CALL_FAILURE.ALREADY_INVITED });
      assert.deepEqual(notAnAddress, { ok: false, failure: WORKSPACE_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(asOwner, { ok: false, failure: WORKSPACE_CALL_FAILURE.UNANSWERED });
      assert.equal(api.requests().length, 1);
    }),
);
