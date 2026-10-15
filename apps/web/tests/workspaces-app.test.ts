import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  type MemberSeams,
  OrganizationRefused,
  type WorkspaceSeams,
} from "@luke/database/models/workspace-seams";
import { ensurePersonalWorkspace } from "@luke/database/models/workspace-store";
import { member, organization, user } from "@luke/database/schemas/auth";
import { joinWorkspace } from "@luke/database/testing";
import { GITHUB_INSTALL_STATUS, HOSTED_SERVICE_PATH } from "@luke/features";
import {
  workspaceInvitationAnswerSchema,
  workspaceInvitationsAnswerSchema,
} from "@luke/features/workspace-invitation-wire";
import {
  WORKSPACE_ROLE,
  type Workspace,
  workspaceAnswerSchema,
  workspaceGithubConnectAnswerSchema,
  workspacesAnswerSchema,
} from "@luke/features/workspace-wire";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "@luke/service/http/http";
import {
  type FakeGitHub,
  GITHUB_FIXTURE_REFUSED_CODE,
  githubReaching,
  openGithubUser,
} from "@luke/service/testing/github-app-fake";
import { openWorkspacePlugin } from "@luke/service/testing/workspace-plugin";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { eq } from "drizzle-orm";
import { Cause, Clock, Effect, Layer, Option, Result, type Schema } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { githubInstallApp } from "../server/github-install-app";
import { type WorkspacesAppSeams, workspacesApp } from "../server/workspaces-app";

/**
 * The account's workspaces, answered by their group the way a function
 * answers them, and GitHub connected through the App's Setup URL and the
 * one-time authorization after it, over Better Auth's own organization
 * plugin on PGlite and a GitHub the test scripts: the bearer names the
 * account and nothing else does, a workspace a member creates is theirs to
 * own, only an owner or admin connects or disconnects GitHub, and an installation is linked to a workspace
 * only through a live intent and only where the user who authorized sees
 * it, one installation to one workspace.
 *
 * Synthetic accounts, bearers, installations, and logins throughout.
 */

const ORIGIN = "https://luke.test";
const INSTALL_ADDRESS = "https://github.com/apps/luke/installations/new";
const LANDING = "/github-installed.html?status=";

const ACME = { id: 31_001, login: "acme", accountType: "Organization", repositories: [] } as const;

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
  readonly location: string | null;
}

/** An account under the name given, signed in with GitHub, its token on its account row. */
const openGithubAccount = (name: string) =>
  Effect.gen(function* () {
    const userId = yield* openGithubUser();
    yield* Database.use((db) => db.update(user).set({ name }).where(eq(user.id, userId)));
    return userId;
  });

/** The plugin's member writes and the session they are made under, for the paths that write through the plugin. */
interface SessionSeams {
  readonly members: MemberSeams;
  readonly resolveSessionUserId: WorkspacesAppSeams["resolveSessionUserId"];
}

/** No session at all: a path that takes one finds none, and nothing writes through the plugin. */
const NO_SESSION: SessionSeams = {
  members: {
    inviteMember: () => Effect.die("no member write without a session"),
    listInvitations: () => Effect.die("no member write without a session"),
    cancelInvitation: () => Effect.die("no member write without a session"),
    removeMember: () => Effect.die("no member write without a session"),
    leaveOrganization: () => Effect.die("no member write without a session"),
  },
  resolveSessionUserId: () => Effect.succeed(Option.none()),
};

/**
 * One request answered by the workspaces group and the install group over
 * the ambient database and the GitHub given; an OAuth bearer stands for the
 * account it names, and a session bearer is read by the plugin itself.
 */
const send = (
  seams: WorkspaceSeams,
  github: FakeGitHub,
  request: Request,
  session: SessionSeams = NO_SESSION,
) =>
  Effect.gen(function* () {
    // The handler runs on the router's own fiber, so it is handed the test's clock: an intent's expiry and a token's are read off it.
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      github.layer,
    );
    const routes = Layer.mergeAll(
      workspacesApp({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(incoming.headers.get("authorization")?.replace(/^Bearer /u, "")),
          ),
        resolveSessionUserId: session.resolveSessionUserId,
        workspaces: seams,
        members: session.members,
      }),
      githubInstallApp(),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(
      routes.pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const response = yield* Effect.promise(() => handler(request));
    const text = yield* Effect.promise(() => response.text());
    yield* Effect.promise(() => dispose());
    // SAFETY: the groups answer JSON or a redirect; the test compares the body as the wire value it is.
    const body = (text === "" ? undefined : JSON.parse(text)) as WireBoundaryInput;
    return { status: response.status, body, location: response.headers.get("location") };
  });

/** A bearer's request to the workspaces group: a read, or a POST with the body given. */
function bearerRequest(path: string, userId: string | undefined, body?: WireBoundaryInput) {
  const headers = new Headers();
  if (userId !== undefined) headers.set("authorization", `Bearer ${userId}`);
  const init: RequestInit = { method: "GET", headers };
  if (body !== undefined) {
    init.method = "POST";
    init.body = JSON.stringify(body);
  }
  return new Request(new URL(path, ORIGIN), init);
}

/** GitHub's return through the Setup URL, with the query given. */
function setupRequest(query: Record<string, string>) {
  const search = new URLSearchParams(query);
  return new Request(new URL(`${HOSTED_SERVICE_PATH.GITHUB_INSTALLED}?${search}`, ORIGIN), {
    redirect: "manual",
  });
}

/** What an answer carries under the wire's schema, failing the test where it is not the wire's. */
function readAs<A>(
  answered: Pick<Answer, "status" | "body">,
  schema: Schema.Codec<A, unknown>,
  status: number,
): A {
  assert.equal(answered.status, status);
  const read = readEither(schema)(unparsedWire(answered.body));
  if (Result.isFailure(read)) return assert.fail(`not the wire's: ${read.failure.refusal}`);
  return read.success;
}

/** The workspaces the bearer's account reads. */
const workspacesOf = (seams: WorkspaceSeams, github: FakeGitHub, userId: string) =>
  Effect.map(
    send(seams, github, bearerRequest(HOSTED_SERVICE_PATH.WORKSPACES, userId)),
    (answered) => readAs(answered, workspacesAnswerSchema, HOSTED_HTTP_STATUS.OK).workspaces,
  );

/** The workspace an account creates under the name given. */
const createAs = (seams: WorkspaceSeams, github: FakeGitHub, userId: string, name: string) =>
  Effect.map(
    send(seams, github, bearerRequest(HOSTED_SERVICE_PATH.WORKSPACES, userId, { name })),
    (answered) => readAs(answered, workspaceAnswerSchema, HOSTED_HTTP_STATUS.CREATED).workspace,
  );

/** The state the install address carries for an owner's or admin's connect of the workspace. */
const connectState = (
  seams: WorkspaceSeams,
  github: FakeGitHub,
  userId: string,
  workspaceId: string,
) =>
  Effect.gen(function* () {
    const answered = yield* send(
      seams,
      github,
      bearerRequest(HOSTED_SERVICE_PATH.WORKSPACE_GITHUB_CONNECT, userId, { workspaceId }),
    );
    const { url } = readAs(answered, workspaceGithubConnectAnswerSchema, HOSTED_HTTP_STATUS.OK);
    assert.equal(url.split("?")[0], INSTALL_ADDRESS);
    return new URL(url).searchParams.get("state") ?? assert.fail("no state on the install address");
  });

/** GitHub's web flow, which hands every authorization this code unless a test says otherwise. */
const ONE_TIME_CODE = "one-time-code";

/**
 * Where GitHub's return through the Setup URL lands the browser, as its
 * status word: at once, or once GitHub's one-time authorization returns to
 * the callback the Setup URL sent it on to, with the code given, or with
 * none where the user declined.
 */
const landedAt = (
  seams: WorkspaceSeams,
  github: FakeGitHub,
  query: Record<string, string>,
  code: string | null = ONE_TIME_CODE,
) =>
  Effect.gen(function* () {
    const setup = yield* send(seams, github, setupRequest(query));
    assert.equal(setup.status, 303);
    const location = setup.location ?? assert.fail("the Setup URL sent the browser nowhere");
    if (location.startsWith(LANDING)) return location.replace(LANDING, "");
    const authorize = new URL(location);
    assert.equal(
      `${authorize.origin}${authorize.pathname}`,
      "https://github.com/login/oauth/authorize",
    );
    const callback = new URL(authorize.searchParams.get("redirect_uri") ?? "");
    assert.equal(
      callback.toString(),
      `${ORIGIN}${HOSTED_SERVICE_PATH.GITHUB_INSTALLED_AUTHORIZED}`,
    );
    if (code !== null) callback.searchParams.set("code", code);
    callback.searchParams.set("state", authorize.searchParams.get("state") ?? "");
    const returned = yield* send(seams, github, new Request(callback, { redirect: "manual" }));
    assert.equal(returned.status, 303);
    return returned.location?.replace(LANDING, "");
  });

/** The GitHub account a workspace in the list carries. */
function githubOf(workspaces: readonly Workspace[], workspaceId: string) {
  return workspaces.find((workspace) => workspace.id === workspaceId)?.github;
}

it.effect("a request without a bearer is refused and makes no workspace", () =>
  Effect.gen(function* () {
    const { seams, database } = yield* openWorkspacePlugin;
    yield* Effect.gen(function* () {
      yield* openGithubAccount("Ada Lovelace");

      const answered = yield* send(
        seams,
        githubReaching([]),
        bearerRequest(HOSTED_SERVICE_PATH.WORKSPACES, undefined),
      );

      assert.deepEqual(
        { status: answered.status, body: answered.body },
        {
          status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
          body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
        },
      );
      assert.deepEqual(
        yield* Database.use((db) => db.select({ id: organization.id }).from(organization)),
        [],
      );
    }).pipe(Effect.provide(database));
  }),
);

it.effect(
  "the first read makes the account's first workspace, owned and with no GitHub account",
  () =>
    Effect.gen(function* () {
      const { seams, database } = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const github = githubReaching([ACME]);

        const first = yield* workspacesOf(seams, github, ada);
        const second = yield* workspacesOf(seams, github, ada);

        assert.deepEqual(first, [
          {
            id: first[0]?.id,
            name: "Ada Lovelace",
            slug: `personal-${ada}`,
            role: WORKSPACE_ROLE.OWNER,
            github: null,
            memberCount: 1,
          },
        ]);
        assert.deepEqual(second, first);
        assert.equal(github.sent.length, 0);
      }).pipe(Effect.provide(database));
    }),
);

it.effect(
  "a workspace a member creates is theirs to own, its name trimmed, and a second of the same name is its own",
  () =>
    Effect.gen(function* () {
      const { seams, database } = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const github = githubReaching([]);

        const acme = yield* createAs(seams, github, ada, "  Acme Platform  ");
        const again = yield* createAs(seams, github, ada, "Acme Platform");
        const blank = yield* send(
          seams,
          github,
          bearerRequest(HOSTED_SERVICE_PATH.WORKSPACES, ada, { name: "   " }),
        );

        assert.deepEqual(
          { ...acme, id: undefined },
          {
            id: undefined,
            name: "Acme Platform",
            slug: "acme-platform",
            role: WORKSPACE_ROLE.OWNER,
            github: null,
            memberCount: 1,
          },
        );
        assert.notEqual(again.id, acme.id);
        assert.match(again.slug ?? "", /^acme-platform-[0-9a-f]{8}$/u);
        assert.deepEqual(
          (yield* workspacesOf(seams, github, ada)).map(({ name }) => name),
          ["Ada Lovelace", "Acme Platform", "Acme Platform"],
        );
        assert.deepEqual(
          yield* Database.use((db) =>
            db
              .select({ userId: member.userId, role: member.role })
              .from(member)
              .where(eq(member.organizationId, acme.id)),
          ),
          [{ userId: ada, role: WORKSPACE_ROLE.OWNER }],
        );
        assert.deepEqual(
          { status: blank.status, body: blank.body },
          { status: 400, body: { error: HOSTED_API_ERROR.INVALID_REQUEST } },
        );
      }).pipe(Effect.provide(database));
    }),
);

it.effect(
  "a workspace named as one of Luke's own pages, or as an account's first, is slugged apart from it",
  () =>
    Effect.gen(function* () {
      const { seams, database } = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const github = githubReaching([]);

        const named = [];
        for (const name of ["Admin", "Sign in", "Changelog", "Personal team", "Acme"]) {
          named.push((yield* createAs(seams, github, ada, name)).slug);
        }

        assert.deepEqual(named, [
          "workspace-admin",
          "workspace-sign-in",
          "workspace-changelog",
          "workspace-personal-team",
          "acme",
        ]);
      }).pipe(Effect.provide(database));
    }),
);

it.effect(
  "connect answers the App's install address with an intent for an owner or admin, and refuses a member and a stranger",
  () =>
    Effect.gen(function* () {
      const { api, seams, database } = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const grace = yield* openGithubAccount("Grace Hopper");
        const linus = yield* openGithubAccount("Linus");
        const mallory = yield* openGithubAccount("Mallory");
        const github = githubReaching([]);
        const acme = yield* createAs(seams, github, ada, "Acme");
        for (const [userId, role] of [
          [grace, WORKSPACE_ROLE.ADMIN],
          [linus, WORKSPACE_ROLE.MEMBER],
        ] as const) {
          yield* Effect.promise(() =>
            api.addMember({ body: { userId, organizationId: acme.id, role } }),
          );
        }
        const connect = (userId: string) =>
          send(
            seams,
            github,
            bearerRequest(HOSTED_SERVICE_PATH.WORKSPACE_GITHUB_CONNECT, userId, {
              workspaceId: acme.id,
            }),
          );

        const owners = yield* connectState(seams, github, ada, acme.id);
        const admins = yield* connectState(seams, github, grace, acme.id);
        const members = yield* connect(linus);
        const strangers = yield* connect(mallory);

        assert.notEqual(owners, admins);
        assert.deepEqual(
          { status: members.status, body: members.body },
          { status: 403, body: { error: HOSTED_API_ERROR.NOT_PERMITTED } },
        );
        assert.deepEqual(
          { status: strangers.status, body: strangers.body },
          { status: HOSTED_HTTP_STATUS.NOT_FOUND, body: { error: HOSTED_API_ERROR.NOT_FOUND } },
        );
      }).pipe(Effect.provide(database));
    }),
);

it.effect(
  "the installation the one-time-authorized user sees is linked to the intent's workspace, the user's token is revoked, and the intent links once",
  () =>
    Effect.gen(function* () {
      const { api, seams, database } = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const linus = yield* openGithubAccount("Linus");
        const github = githubReaching([ACME]);
        const acme = yield* createAs(seams, github, ada, "Acme");
        yield* Effect.promise(() =>
          api.addMember({ body: { userId: linus, organizationId: acme.id, role: "member" } }),
        );
        const state = yield* connectState(seams, github, ada, acme.id);
        const returned = { installation_id: String(ACME.id), setup_action: "install", state };

        const first = yield* landedAt(seams, github, returned);
        const again = yield* landedAt(seams, github, returned);

        assert.equal(first, GITHUB_INSTALL_STATUS.CONNECTED);
        assert.equal(again, GITHUB_INSTALL_STATUS.EXPIRED);
        assert.equal(github.sent.filter((sent) => sent.method === "DELETE").length, 1);
        const connected = { login: "acme", active: true };
        assert.deepEqual(githubOf(yield* workspacesOf(seams, github, ada), acme.id), connected);
        assert.deepEqual(githubOf(yield* workspacesOf(seams, github, linus), acme.id), connected);
      }).pipe(Effect.provide(database));
    }),
);

it.effect(
  "an installation id the one-time-authorized user cannot see, a declined or refused authorization, an expired intent, and a request link nothing",
  () =>
    Effect.gen(function* () {
      const { seams, database } = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const github = githubReaching([ACME]);
        const acme = yield* createAs(seams, github, ada, "Acme");

        const forged = yield* landedAt(seams, github, {
          installation_id: "424242",
          setup_action: "install",
          state: yield* connectState(seams, github, ada, acme.id),
        });
        const declined = yield* landedAt(
          seams,
          github,
          {
            installation_id: String(ACME.id),
            setup_action: "install",
            state: yield* connectState(seams, github, ada, acme.id),
          },
          null,
        );
        const refused = yield* landedAt(
          seams,
          github,
          {
            installation_id: String(ACME.id),
            setup_action: "install",
            state: yield* connectState(seams, github, ada, acme.id),
          },
          GITHUB_FIXTURE_REFUSED_CODE,
        );
        const stale = yield* connectState(seams, github, ada, acme.id);
        yield* TestClock.adjust("2 hours");
        const expired = yield* landedAt(seams, github, {
          installation_id: String(ACME.id),
          setup_action: "install",
          state: stale,
        });
        const requested = yield* landedAt(seams, github, {
          setup_action: "request",
          state: yield* connectState(seams, github, ada, acme.id),
        });

        assert.equal(forged, GITHUB_INSTALL_STATUS.NOT_FOUND);
        assert.equal(declined, GITHUB_INSTALL_STATUS.NOT_FOUND);
        assert.equal(refused, GITHUB_INSTALL_STATUS.NOT_FOUND);
        assert.equal(expired, GITHUB_INSTALL_STATUS.EXPIRED);
        assert.equal(requested, GITHUB_INSTALL_STATUS.REQUESTED);
        assert.equal(githubOf(yield* workspacesOf(seams, github, ada), acme.id), null);
      }).pipe(Effect.provide(database));
    }),
);

it.effect("an installation connected to one workspace is refused for a second", () =>
  Effect.gen(function* () {
    const { seams, database } = yield* openWorkspacePlugin;
    yield* Effect.gen(function* () {
      const ada = yield* openGithubAccount("Ada Lovelace");
      const github = githubReaching([ACME]);
      const first = yield* createAs(seams, github, ada, "Acme");
      const second = yield* createAs(seams, github, ada, "Acme Labs");
      const connectTo = (workspaceId: string) =>
        Effect.flatMap(connectState(seams, github, ada, workspaceId), (state) =>
          landedAt(seams, github, {
            installation_id: String(ACME.id),
            setup_action: "install",
            state,
          }),
        );

      const linked = yield* connectTo(first.id);
      const refused = yield* connectTo(second.id);

      assert.equal(linked, GITHUB_INSTALL_STATUS.CONNECTED);
      assert.equal(refused, GITHUB_INSTALL_STATUS.ALREADY_CONNECTED);
      const workspaces = yield* workspacesOf(seams, github, ada);
      assert.deepEqual(githubOf(workspaces, first.id), { login: "acme", active: true });
      assert.equal(githubOf(workspaces, second.id), null);
    }).pipe(Effect.provide(database));
  }),
);

it.effect("the account's first workspace connects GitHub like any other, by its owner", () =>
  Effect.gen(function* () {
    const { seams, database } = yield* openWorkspacePlugin;
    yield* Effect.gen(function* () {
      const ada = yield* openGithubAccount("Ada Lovelace");
      const github = githubReaching([ACME]);
      const [first] = yield* workspacesOf(seams, github, ada);
      assert.ok(first);

      const landed = yield* landedAt(seams, github, {
        installation_id: String(ACME.id),
        setup_action: "install",
        state: yield* connectState(seams, github, ada, first.id),
      });

      assert.equal(landed, GITHUB_INSTALL_STATUS.CONNECTED);
      assert.deepEqual(githubOf(yield* workspacesOf(seams, github, ada), first.id), {
        login: "acme",
        active: true,
      });
    }).pipe(Effect.provide(database));
  }),
);

it.effect(
  "an owner or admin disconnects the workspace's GitHub organization, and a member cannot",
  () =>
    Effect.gen(function* () {
      const { api, seams, database } = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const linus = yield* openGithubAccount("Linus");
        const github = githubReaching([ACME]);
        const acme = yield* createAs(seams, github, ada, "Acme");
        yield* Effect.promise(() =>
          api.addMember({ body: { userId: linus, organizationId: acme.id, role: "member" } }),
        );
        yield* landedAt(seams, github, {
          installation_id: String(ACME.id),
          setup_action: "install",
          state: yield* connectState(seams, github, ada, acme.id),
        });
        const disconnect = (userId: string) =>
          send(
            seams,
            github,
            bearerRequest(HOSTED_SERVICE_PATH.WORKSPACE_GITHUB_DISCONNECT, userId, {
              workspaceId: acme.id,
            }),
          );

        const members = yield* disconnect(linus);
        const stillConnected = githubOf(yield* workspacesOf(seams, github, ada), acme.id);
        const owners = yield* disconnect(ada);

        assert.deepEqual(
          { status: members.status, body: members.body },
          { status: 403, body: { error: HOSTED_API_ERROR.NOT_PERMITTED } },
        );
        assert.deepEqual(stillConnected, { login: "acme", active: true });
        assert.equal(
          readAs(owners, workspaceAnswerSchema, HOSTED_HTTP_STATUS.OK).workspace.github,
          null,
        );
        assert.equal(githubOf(yield* workspacesOf(seams, github, linus), acme.id), null);
      }).pipe(Effect.provide(database));
    }),
);

it.effect("a connect begun before a disconnect lands as expired after it and links nothing", () =>
  Effect.gen(function* () {
    const { seams, database } = yield* openWorkspacePlugin;
    yield* Effect.gen(function* () {
      const ada = yield* openGithubAccount("Ada Lovelace");
      const github = githubReaching([ACME]);
      const acme = yield* createAs(seams, github, ada, "Acme");
      const pending = yield* connectState(seams, github, ada, acme.id);

      const disconnected = yield* send(
        seams,
        github,
        bearerRequest(HOSTED_SERVICE_PATH.WORKSPACE_GITHUB_DISCONNECT, ada, {
          workspaceId: acme.id,
        }),
      );
      const landed = yield* landedAt(seams, github, {
        installation_id: String(ACME.id),
        setup_action: "install",
        state: pending,
      });

      assert.equal(disconnected.status, HOSTED_HTTP_STATUS.OK);
      assert.equal(landed, GITHUB_INSTALL_STATUS.EXPIRED);
      assert.equal(githubOf(yield* workspacesOf(seams, github, ada), acme.id), null);
    }).pipe(Effect.provide(database));
  }),
);

it.effect("a plugin that refuses the account's first workspace is answered as unavailable", () =>
  Effect.gen(function* () {
    const { database } = yield* openWorkspacePlugin;
    const refusing: WorkspaceSeams = {
      createOrganization: () =>
        Effect.fail(new Cause.UnknownError(undefined, "Failed to create organization")),
    };
    yield* Effect.gen(function* () {
      const ada = yield* openGithubAccount(`Ada ${randomUUID()}`);

      const answered = yield* send(
        refusing,
        githubReaching([]),
        bearerRequest(HOSTED_SERVICE_PATH.WORKSPACES, ada),
      );

      assert.deepEqual(
        { status: answered.status, body: answered.body },
        {
          status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
          body: { error: HOSTED_API_ERROR.UNAVAILABLE },
        },
      );
    }).pipe(Effect.provide(database));
  }),
);

/** The Better Auth API the plugin's tests stand over. */
type WorkspacePluginApi = Effect.Success<typeof openWorkspacePlugin>["api"];

/** A GitHub the account reaches nothing on: a members read asks GitHub nothing. */
const NO_GITHUB_TO_READ = githubReaching([]);

/** Where a workspace's members are read, the workspace named in the query. */
const membersAt = (workspaceId: string) =>
  `${HOSTED_SERVICE_PATH.WORKSPACES_MEMBERS}?${new URLSearchParams({ workspaceId })}`;

/** A members read under the bearer's account, as its status and body. */
const readMembers = (seams: WorkspaceSeams, userId: string, path: string) =>
  Effect.map(send(seams, NO_GITHUB_TO_READ, bearerRequest(path, userId)), ({ status, body }) => ({
    status,
    body,
  }));

const refusedAs = (status: number, error: string) => ({ status, body: { error } });

type WorkspacePlugin = Effect.Success<typeof openWorkspacePlugin>;

/** A POST under a fresh session of the account's, signed as the Mac carries one, as its status and body. */
const postedInSession = (
  plugin: WorkspacePlugin,
  userId: string,
  path: string,
  body: WireBoundaryInput,
) =>
  Effect.gen(function* () {
    const sessionBearer = yield* plugin.sessionBearerOf(userId);
    const { status, body: answered } = yield* send(
      plugin.seams,
      NO_GITHUB_TO_READ,
      bearerRequest(path, sessionBearer, body),
      plugin,
    );
    return { status, body: answered };
  });

/** One member removed by the account, under its session. */
const removing = (plugin: WorkspacePlugin, userId: string, workspaceId: string, removed: string) =>
  postedInSession(plugin, userId, HOSTED_SERVICE_PATH.WORKSPACES_MEMBERS_REMOVE, {
    workspaceId,
    userId: removed,
  });

/** The account leaving the workspace, under its session. */
const leaving = (plugin: WorkspacePlugin, userId: string, workspaceId: string) =>
  postedInSession(plugin, userId, HOSTED_SERVICE_PATH.WORKSPACES_LEAVE, { workspaceId });

/** Who is in a workspace, by account and role, as the plugin's rows hold them. */
const membersOf = (organizationId: string) =>
  Database.use((db) =>
    db
      .select({ userId: member.userId, role: member.role })
      .from(member)
      .where(eq(member.organizationId, organizationId))
      .orderBy(member.role, member.userId),
  );

/** A shared workspace the owner makes through the plugin's server-only create, its teammates added under their roles through its server-only add. */
const openTeam = (
  api: WorkspacePluginApi,
  ownerId: string,
  teammates: readonly { readonly userId: string; readonly role: "admin" | "member" }[],
) =>
  Effect.gen(function* () {
    const made = yield* Effect.promise(() =>
      api.createOrganization({ body: { name: "Acme", slug: `acme-${ownerId}`, userId: ownerId } }),
    );
    for (const teammate of teammates) {
      yield* Effect.promise(() =>
        api.addMember({
          body: { userId: teammate.userId, organizationId: made.id, role: teammate.role },
        }),
      );
    }
    return made.id;
  });

it.effect("a member reads the workspace's members, owners first, then admins, then members", () =>
  Effect.gen(function* () {
    const { api, seams, database } = yield* openWorkspacePlugin;
    yield* Effect.gen(function* () {
      const ada = yield* openGithubAccount("Ada Lovelace");
      const grace = yield* openGithubAccount("Grace Hopper");
      const alan = yield* openGithubAccount("Alan Turing");
      const acme = yield* openTeam(api, ada, [
        { userId: grace, role: "member" },
        { userId: alan, role: "admin" },
      ]);

      const answered = yield* readMembers(seams, grace, membersAt(acme));

      assert.deepEqual(answered, {
        status: HOSTED_HTTP_STATUS.OK,
        body: {
          members: [
            { userId: ada, name: "Ada Lovelace", email: `${ada}@luke.test`, role: "owner" },
            { userId: alan, name: "Alan Turing", email: `${alan}@luke.test`, role: "admin" },
            { userId: grace, name: "Grace Hopper", email: `${grace}@luke.test`, role: "member" },
          ],
        },
      });
    }).pipe(Effect.provide(database));
  }),
);

it.effect(
  "an account outside the workspace, or naming no workspace, reads none of its members",
  () =>
    Effect.gen(function* () {
      const { api, seams, database } = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const mallory = yield* openGithubAccount("Mallory");
        const acme = yield* openTeam(api, ada, []);

        const outsider = yield* readMembers(seams, mallory, membersAt(acme));
        const nowhere = yield* readMembers(seams, ada, membersAt("org-nowhere"));
        const unnamed = yield* readMembers(seams, ada, HOSTED_SERVICE_PATH.WORKSPACES_MEMBERS);

        const notFound = refusedAs(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);
        assert.deepEqual(outsider, notFound);
        assert.deepEqual(nowhere, notFound);
        assert.deepEqual(
          unnamed,
          refusedAs(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
      }).pipe(Effect.provide(database));
    }),
);

it.effect(
  "a member cannot remove another, an admin cannot remove the owner, and an admin removes a member",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      const { api, seams, database } = plugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const grace = yield* openGithubAccount("Grace Hopper");
        const alan = yield* openGithubAccount("Alan Turing");
        const acme = yield* openTeam(api, ada, [
          { userId: grace, role: "admin" },
          { userId: alan, role: "member" },
        ]);

        const byMember = yield* removing(plugin, alan, acme, grace);
        const ofOwner = yield* removing(plugin, grace, acme, ada);
        const byAdmin = yield* removing(plugin, grace, acme, alan);

        const notPermitted = refusedAs(
          HOSTED_HTTP_STATUS.FORBIDDEN,
          HOSTED_API_ERROR.NOT_PERMITTED,
        );
        assert.deepEqual(byMember, notPermitted);
        assert.deepEqual(ofOwner, notPermitted);
        assert.deepEqual(byAdmin, {
          status: HOSTED_HTTP_STATUS.OK,
          body: {
            members: [
              { userId: ada, name: "Ada Lovelace", email: `${ada}@luke.test`, role: "owner" },
              { userId: grace, name: "Grace Hopper", email: `${grace}@luke.test`, role: "admin" },
            ],
          },
        });
        assert.deepEqual(
          yield* readMembers(seams, alan, membersAt(acme)),
          refusedAs(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
      }).pipe(Effect.provide(database));
    }),
);

it.effect("an owner cannot leave, and a member leaves", () =>
  Effect.gen(function* () {
    const plugin = yield* openWorkspacePlugin;
    const { api, database } = plugin;
    yield* Effect.gen(function* () {
      const ada = yield* openGithubAccount("Ada Lovelace");
      const grace = yield* openGithubAccount("Grace Hopper");
      const acme = yield* openTeam(api, ada, [{ userId: grace, role: "member" }]);

      const byOwner = yield* leaving(plugin, ada, acme);
      const byMember = yield* leaving(plugin, grace, acme);

      assert.deepEqual(
        byOwner,
        refusedAs(HOSTED_HTTP_STATUS.FORBIDDEN, HOSTED_API_ERROR.NOT_PERMITTED),
      );
      assert.deepEqual(byMember, { status: HOSTED_HTTP_STATUS.OK, body: { workspaceId: acme } });
      assert.deepEqual(yield* membersOf(acme), [{ userId: ada, role: WORKSPACE_ROLE.OWNER }]);
    }).pipe(Effect.provide(database));
  }),
);

it.effect(
  "a removal or a leaving under the Mac's OAuth token rather than its session is refused as unauthenticated",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      const { api, database } = plugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const grace = yield* openGithubAccount("Grace Hopper");
        const acme = yield* openTeam(api, ada, [{ userId: grace, role: "member" }]);

        // The OAuth bearer stands for its account on every other path here.
        const underToken = (path: string, body: WireBoundaryInput) =>
          Effect.map(
            send(plugin.seams, NO_GITHUB_TO_READ, bearerRequest(path, ada, body), plugin),
            ({ status, body }) => ({ status, body }),
          );
        const removed = yield* underToken(HOSTED_SERVICE_PATH.WORKSPACES_MEMBERS_REMOVE, {
          workspaceId: acme,
          userId: grace,
        });
        const left = yield* underToken(HOSTED_SERVICE_PATH.WORKSPACES_LEAVE, {
          workspaceId: acme,
        });

        const unauthenticated = refusedAs(
          HOSTED_HTTP_STATUS.UNAUTHORIZED,
          HOSTED_API_ERROR.INVALID_TOKEN,
        );
        assert.deepEqual(removed, unauthenticated);
        assert.deepEqual(left, unauthenticated);
        assert.deepEqual(yield* membersOf(acme), [
          { userId: grace, role: WORKSPACE_ROLE.MEMBER },
          { userId: ada, role: WORKSPACE_ROLE.OWNER },
        ]);
      }).pipe(Effect.provide(database));
    }),
);

it.effect(
  "the plugin's refusal of a member write is not permitted, its refusal of the session unauthenticated, and its failure unavailable",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      const { api, database } = plugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const grace = yield* openGithubAccount("Grace Hopper");
        const acme = yield* openTeam(api, ada, [{ userId: grace, role: "member" }]);
        const leavingAgainst = (members: MemberSeams) =>
          leaving({ ...plugin, members }, grace, acme);
        const answering = (
          write: Effect.Effect<void, OrganizationRefused | Cause.UnknownError>,
        ): MemberSeams => ({
          ...NO_SESSION.members,
          removeMember: () => write,
          leaveOrganization: () => write,
        });

        const forbidden = yield* leavingAgainst(
          answering(Effect.fail(new OrganizationRefused({ status: 403 }))),
        );
        const signedOut = yield* leavingAgainst(
          answering(Effect.fail(new OrganizationRefused({ status: 401 }))),
        );
        const broken = yield* leavingAgainst(
          answering(Effect.fail(new Cause.UnknownError("the plugin threw"))),
        );

        assert.deepEqual(
          forbidden,
          refusedAs(HOSTED_HTTP_STATUS.FORBIDDEN, HOSTED_API_ERROR.NOT_PERMITTED),
        );
        assert.deepEqual(
          signedOut,
          refusedAs(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN),
        );
        assert.deepEqual(
          broken,
          refusedAs(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE),
        );
      }).pipe(Effect.provide(database));
    }),
);

/** The invitations path, a workspace's pending ones named in the query. */
const invitationsAt = (workspaceId: string) =>
  `${HOSTED_SERVICE_PATH.WORKSPACES_INVITATIONS}?${new URLSearchParams({ workspaceId })}`;

/** A read under a fresh session of the account's, as its status and body. */
const readInSession = (plugin: WorkspacePlugin, userId: string, path: string) =>
  Effect.gen(function* () {
    const sessionBearer = yield* plugin.sessionBearerOf(userId);
    const { status, body } = yield* send(
      plugin.seams,
      NO_GITHUB_TO_READ,
      bearerRequest(path, sessionBearer),
      plugin,
    );
    return { status, body };
  });

/** An invitation asked for by the account, under its session. */
const inviting = (plugin: WorkspacePlugin, userId: string, workspaceId: string, email: string) =>
  postedInSession(plugin, userId, HOSTED_SERVICE_PATH.WORKSPACES_INVITATIONS, {
    workspaceId,
    email,
    role: "member",
  });

it.effect(
  "an admin invites by address, reads the invitation pending with its accept link, and cancels it",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const grace = yield* openGithubAccount("Grace Hopper");
        const acme = yield* openTeam(plugin.api, ada, [{ userId: grace, role: "admin" }]);

        const made = readAs(
          yield* inviting(plugin, grace, acme, "  Alan@Example.com "),
          workspaceInvitationAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
        ).invitation;
        const listed = readAs(
          yield* readInSession(plugin, ada, invitationsAt(acme)),
          workspaceInvitationsAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
        ).invitations;
        const canceled = yield* postedInSession(
          plugin,
          ada,
          HOSTED_SERVICE_PATH.WORKSPACES_INVITATIONS_CANCEL,
          { workspaceId: acme, invitationId: made.id },
        );

        assert.equal(made.email, "alan@example.com");
        assert.equal(made.role, "member");
        const link = new URL(made.acceptUrl);
        assert.equal(link.origin + link.pathname, `${ORIGIN}/accept-invitation.html`);
        assert.equal(link.searchParams.get("id"), made.id);
        assert.deepEqual(listed, [made]);
        assert.deepEqual(canceled, { status: HOSTED_HTTP_STATUS.OK, body: { invitations: [] } });
      }).pipe(Effect.provide(plugin.database));
    }),
);

it.effect(
  "the account's first workspace takes invitations and reads its members like any other",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const first = Option.getOrThrow(yield* ensurePersonalWorkspace(ada, plugin.seams));

        const made = readAs(
          yield* inviting(plugin, ada, first, "alan@example.com"),
          workspaceInvitationAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
        ).invitation;
        const listed = readAs(
          yield* readInSession(plugin, ada, invitationsAt(first)),
          workspaceInvitationsAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
        ).invitations;
        const members = yield* readMembers(plugin.seams, ada, membersAt(first));

        assert.equal(made.email, "alan@example.com");
        assert.deepEqual(listed, [made]);
        assert.deepEqual(members, {
          status: HOSTED_HTTP_STATUS.OK,
          body: {
            members: [
              { userId: ada, name: "Ada Lovelace", email: `${ada}@luke.test`, role: "owner" },
            ],
          },
        });
      }).pipe(Effect.provide(plugin.database));
    }),
);

it.effect(
  "an address already a member or already invited is refused as already invited, and nothing is sent twice",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const grace = yield* openGithubAccount("Grace Hopper");
        const acme = yield* openTeam(plugin.api, ada, [{ userId: grace, role: "member" }]);

        yield* inviting(plugin, ada, acme, "alan@example.com");
        const again = yield* inviting(plugin, ada, acme, "alan@example.com");
        const member = yield* inviting(plugin, ada, acme, `${grace}@luke.test`);

        const alreadyInvited = refusedAs(
          HOSTED_HTTP_STATUS.CONFLICT,
          HOSTED_API_ERROR.ALREADY_INVITED,
        );
        assert.deepEqual(again, alreadyInvited);
        assert.deepEqual(member, alreadyInvited);
        const pending = readAs(
          yield* readInSession(plugin, ada, invitationsAt(acme)),
          workspaceInvitationsAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
        ).invitations;
        assert.deepEqual(
          pending.map((one) => one.email),
          ["alan@example.com"],
        );
      }).pipe(Effect.provide(plugin.database));
    }),
);

it.effect(
  "a member neither invites nor reads invitations, and another workspace's invitation is not canceled",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const grace = yield* openGithubAccount("Grace Hopper");
        const acme = yield* openTeam(plugin.api, ada, [{ userId: grace, role: "member" }]);
        const other = yield* openTeam(plugin.api, grace, []);
        const elsewhere = readAs(
          yield* inviting(plugin, grace, other, "someone@example.com"),
          workspaceInvitationAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
        ).invitation;

        const answers = [
          yield* inviting(plugin, grace, acme, "alan@example.com"),
          yield* readInSession(plugin, grace, invitationsAt(acme)),
        ];
        const crossed = yield* postedInSession(
          plugin,
          ada,
          HOSTED_SERVICE_PATH.WORKSPACES_INVITATIONS_CANCEL,
          { workspaceId: acme, invitationId: elsewhere.id },
        );

        const notPermitted = refusedAs(
          HOSTED_HTTP_STATUS.FORBIDDEN,
          HOSTED_API_ERROR.NOT_PERMITTED,
        );
        assert.deepEqual(answers, [notPermitted, notPermitted]);
        assert.deepEqual(
          crossed,
          refusedAs(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
      }).pipe(Effect.provide(plugin.database));
    }),
);

it.effect(
  "invitations under the Mac's OAuth token rather than its session are unauthenticated",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const acme = yield* openTeam(plugin.api, ada, []);

        const read = yield* send(
          plugin.seams,
          NO_GITHUB_TO_READ,
          bearerRequest(invitationsAt(acme), ada),
          plugin,
        );
        const made = yield* send(
          plugin.seams,
          NO_GITHUB_TO_READ,
          bearerRequest(HOSTED_SERVICE_PATH.WORKSPACES_INVITATIONS, ada, {
            workspaceId: acme,
            email: "alan@example.com",
            role: "member",
          }),
          plugin,
        );

        const unauthenticated = refusedAs(
          HOSTED_HTTP_STATUS.UNAUTHORIZED,
          HOSTED_API_ERROR.INVALID_TOKEN,
        );
        assert.deepEqual({ status: read.status, body: read.body }, unauthenticated);
        assert.deepEqual({ status: made.status, body: made.body }, unauthenticated);
      }).pipe(Effect.provide(plugin.database));
    }),
);

it.effect("each workspace says how many members it has, to every member alike", () =>
  Effect.gen(function* () {
    const { seams, database } = yield* openWorkspacePlugin;
    yield* Effect.gen(function* () {
      const ada = yield* openGithubAccount("Ada Lovelace");
      const grace = yield* openGithubAccount("Grace Hopper");
      const github = githubReaching([]);
      const acme = yield* createAs(seams, github, ada, "Acme");
      yield* joinWorkspace(acme.id, grace);

      const countOf = (workspaces: readonly { id: string; memberCount?: number }[]) =>
        workspaces.find((each) => each.id === acme.id)?.memberCount;
      assert.equal(countOf(yield* workspacesOf(seams, github, ada)), 2);
      assert.equal(countOf(yield* workspacesOf(seams, github, grace)), 2);
      // The account's first workspace holds the account alone.
      const [first] = yield* workspacesOf(seams, github, grace);
      assert.equal(first?.memberCount, 1);
    }).pipe(Effect.provide(database));
  }),
);
