import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { createAutomation } from "@luke/database/models/automation-store";
import { createCodingAgent } from "@luke/database/models/coding-agent-store";
import {
  type MemberSeams,
  OrganizationRefused,
  type WorkspaceSeams,
} from "@luke/database/models/workspace-seams";
import { ensurePersonalWorkspace } from "@luke/database/models/workspace-store";
import { member, organization, user } from "@luke/database/schemas/auth";
import { task } from "@luke/database/schemas/task";
import { joinWorkspace } from "@luke/database/testing";
import { GITHUB_INSTALL_STATUS, HOSTED_SERVICE_PATH } from "@luke/features";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
  type AutomationScope,
} from "@luke/features/automation-wire";
import { INBOX_REPLY, INBOX_RESPONSE } from "@luke/features/inbox-wire";
import {
  workspaceInvitationAnswerSchema,
  workspaceInvitationsAnswerSchema,
} from "@luke/features/workspace-invitation-wire";
import {
  WORKSPACE_BOUNDS,
  WORKSPACE_PHOTO_BOUNDS,
  WORKSPACE_PHOTO_TYPE,
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspacePhotoType,
  workspaceAnswerSchema,
  workspaceGithubConnectAnswerSchema,
  workspaceMembersAnswerSchema,
  workspacesAnswerSchema,
} from "@luke/features/workspace-wire";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { and, eq } from "drizzle-orm";
import { Cause, Clock, type Context, Effect, Layer, Option, Result, type Schema } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { githubInstallApp } from "../github/github-install-app.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { answerInboxItem, postInboxItem } from "../inbox/inbox-store.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { openedPagePolicy, SANDBOXED_PAGE } from "../testing/content-policy.js";
import {
  type FakeGitHub,
  GITHUB_FIXTURE_REFUSED_CODE,
  githubReaching,
  openGithubUser,
} from "../testing/github-app-fake.js";
import { openWorkspacePlugin } from "../testing/workspace-plugin.js";
import { workspaceGithubProcedures } from "./workspace-github-procedures.js";
import { workspaceInvitationsProcedures } from "./workspace-invitations-procedures.js";
import { type WorkspacesAppSeams, workspacesApp } from "./workspaces-app.js";

/**
 * The account's workspaces, answered by their group the way a function
 * answers them, and GitHub connected through the App's Setup URL and the
 * one-time authorization after it, over Better Auth's own organization
 * plugin on PGlite and a GitHub the test scripts: the bearer names the
 * account and nothing else does, a workspace a member creates is theirs to
 * own, only an owner or admin connects GitHub, nobody disconnects it from
 * Luke, and an installation is linked to a workspace only through a live
 * intent, only where the user who authorized sees it, and only to one
 * workspace.
 *
 * Synthetic accounts, bearers, installations, and logins throughout.
 */

const ORIGIN = "https://luke.test";
const INSTALL_ADDRESS = "https://github.com/apps/luke/installations/new";
const LANDING = "/github-installed.html?status=";

const ACME = { id: 31_001, login: "acme", accountType: "Organization", repositories: [] } as const;
const LABS = {
  id: 31_002,
  login: "acme-labs",
  accountType: "Organization",
  repositories: [],
} as const;

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
    updateMemberRole: () => Effect.die("no member write without a session"),
    leaveOrganization: () => Effect.die("no member write without a session"),
    updateOrganization: () => Effect.die("no member write without a session"),
  },
  resolveSessionUserId: () => Effect.succeed(Option.none()),
};

/** An OAuth bearer stands for the account it names. */
const bearerUserId = (incoming: Request) =>
  Effect.succeed(
    Option.fromNullishOr(incoming.headers.get("authorization")?.replace(/^Bearer /u, "")),
  );

/** The paths the hosted oRPC router answers, every other one the old groups. */
const HOSTED_PATHS: ReadonlySet<string> = new Set([
  HOSTED_SERVICE_PATH.WORKSPACE_GITHUB_CONNECT,
  HOSTED_SERVICE_PATH.WORKSPACE_GITHUB_DISCONNECT,
  HOSTED_SERVICE_PATH.WORKSPACES_INVITATIONS,
  HOSTED_SERVICE_PATH.WORKSPACES_INVITATIONS_CANCEL,
  HOSTED_SERVICE_PATH.WORKSPACES_INVITATION_OFFER,
]);

/**
 * One request answered by the hosted oRPC router, the workspaces group, and the install group over
 * the ambient database and the GitHub given, its response read by `read`
 * before the handler is let go; an OAuth bearer stands for the account it
 * names, and a session bearer is read by the plugin itself.
 */
const answered = <A>(
  seams: WorkspaceSeams,
  github: FakeGitHub,
  request: Request,
  session: SessionSeams,
  read: (response: Response) => Promise<A>,
) =>
  Effect.gen(function* () {
    // The handler runs on the router's own fiber, so it is handed the test's clock: an intent's expiry and a token's are read off it.
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      github.layer,
    );
    if (HOSTED_PATHS.has(new URL(request.url).pathname)) {
      const context = yield* Effect.context<never>().pipe(Effect.provide(services));
      const procedures = hostedFetch({
        workspaceGithub: workspaceGithubProcedures({ resolveUserId: bearerUserId }),
        workspaceInvitations: workspaceInvitationsProcedures(session),
      });
      // SAFETY: the procedures yield the database, the clock and GitHub alone, which is all a test provides of the web runtime's services.
      const response = yield* Effect.promise(() =>
        procedures(request, context as Context.Context<WebServices>),
      );
      return yield* Effect.promise(() => read(response));
    }
    const routes = Layer.mergeAll(
      workspacesApp({
        resolveUserId: bearerUserId,
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
    const result = yield* Effect.promise(() => read(response));
    yield* Effect.promise(() => dispose());
    return result;
  });

/** One request answered as `answered` answers it, its body read as the JSON it is, or a redirect's location. */
const send = (
  seams: WorkspaceSeams,
  github: FakeGitHub,
  request: Request,
  session: SessionSeams = NO_SESSION,
) =>
  answered(seams, github, request, session, async (response): Promise<Answer> => {
    const text = await response.text();
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
    headers.set("content-type", "application/json");
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
  "the first read makes the account's first workspace, owned, personal, and with no GitHub account",
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
            githubInstallations: [],
            memberCount: 1,
            personal: true,
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
            githubInstallations: [],
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
        for (const name of ["Admin", "Sign in", "Changelog", "Tasks", "Personal team", "Acme"]) {
          named.push((yield* createAs(seams, github, ada, name)).slug);
        }

        assert.deepEqual(named, [
          "workspace-admin",
          "workspace-sign-in",
          "workspace-changelog",
          "workspace-tasks",
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

it.effect(
  "connecting a second GitHub account adds it beside the first, which stays the one a desktop from before several reads",
  () =>
    Effect.gen(function* () {
      const { seams, database } = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const github = githubReaching([ACME, LABS]);
        const acme = yield* createAs(seams, github, ada, "Acme");
        const connect = (installation: { readonly id: number }) =>
          Effect.flatMap(connectState(seams, github, ada, acme.id), (state) =>
            landedAt(seams, github, {
              installation_id: String(installation.id),
              setup_action: "install",
              state,
            }),
          );

        const first = yield* connect(ACME);
        yield* TestClock.adjust("1 minute");
        const second = yield* connect(LABS);
        const again = yield* connect(ACME);

        assert.deepEqual(
          [first, second, again],
          [
            GITHUB_INSTALL_STATUS.CONNECTED,
            GITHUB_INSTALL_STATUS.CONNECTED,
            GITHUB_INSTALL_STATUS.CONNECTED,
          ],
        );
        const [workspace] = (yield* workspacesOf(seams, github, ada)).filter(
          (one) => one.id === acme.id,
        );
        assert.deepEqual(
          { github: workspace?.github, githubInstallations: workspace?.githubInstallations },
          {
            github: { login: "acme", active: true },
            githubInstallations: [
              { installationId: ACME.id, login: "acme", active: true },
              { installationId: LABS.id, login: "acme-labs", active: true },
            ],
          },
        );
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
  "the disconnect a Mac from before several connections sends is refused to an owner, an admin, and a member alike, and removes nothing",
  () =>
    Effect.gen(function* () {
      const { api, seams, database } = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const grace = yield* openGithubAccount("Grace Hopper");
        const linus = yield* openGithubAccount("Linus");
        const github = githubReaching([ACME]);
        const acme = yield* createAs(seams, github, ada, "Acme");
        for (const [userId, role] of [
          [grace, WORKSPACE_ROLE.ADMIN],
          [linus, WORKSPACE_ROLE.MEMBER],
        ] as const) {
          yield* Effect.promise(() =>
            api.addMember({ body: { userId, organizationId: acme.id, role } }),
          );
        }
        yield* landedAt(seams, github, {
          installation_id: String(ACME.id),
          setup_action: "install",
          state: yield* connectState(seams, github, ada, acme.id),
        });
        const pending = yield* connectState(seams, github, ada, acme.id);
        const disconnect = (userId: string) =>
          send(
            seams,
            github,
            bearerRequest(HOSTED_SERVICE_PATH.WORKSPACE_GITHUB_DISCONNECT, userId, {
              workspaceId: acme.id,
            }),
          );

        const refusals = yield* Effect.forEach([ada, grace, linus], (userId) =>
          Effect.map(disconnect(userId), ({ status, body }) => ({ status, body })),
        );

        assert.deepEqual(
          refusals,
          [ada, grace, linus].map(() => ({
            status: 403,
            body: { error: HOSTED_API_ERROR.NOT_PERMITTED },
          })),
        );
        const [workspace] = (yield* workspacesOf(seams, github, linus)).filter(
          (one) => one.id === acme.id,
        );
        assert.deepEqual(
          { github: workspace?.github, githubInstallations: workspace?.githubInstallations },
          {
            github: { login: "acme", active: true },
            githubInstallations: [{ installationId: ACME.id, login: "acme", active: true }],
          },
        );
        // A connect begun before the refused disconnect still links: nothing was spent.
        assert.equal(
          yield* landedAt(seams, github, {
            installation_id: String(ACME.id),
            setup_action: "install",
            state: pending,
          }),
          GITHUB_INSTALL_STATUS.CONNECTED,
        );
      }).pipe(Effect.provide(database));
    }),
);

it.effect(
  "an admin demoted to member while GitHub authorizes lands as expired and links nothing",
  () =>
    Effect.gen(function* () {
      const { api, seams, database } = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const grace = yield* openGithubAccount("Grace Hopper");
        const github = githubReaching([ACME]);
        const acme = yield* createAs(seams, github, ada, "Acme");
        yield* Effect.promise(() =>
          api.addMember({
            body: { userId: grace, organizationId: acme.id, role: WORKSPACE_ROLE.ADMIN },
          }),
        );
        const state = yield* connectState(seams, github, grace, acme.id);
        yield* Database.use((db) =>
          db.update(member).set({ role: WORKSPACE_ROLE.MEMBER }).where(eq(member.userId, grace)),
        );

        const landed = yield* landedAt(seams, github, {
          installation_id: String(ACME.id),
          setup_action: "install",
          state,
        });

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

/** The account renaming the workspace, under its session. */
const renaming = (plugin: WorkspacePlugin, userId: string, workspaceId: string, name: string) =>
  postedInSession(plugin, userId, HOSTED_SERVICE_PATH.WORKSPACES_RENAME, { workspaceId, name });

/** The account setting the workspace's photo, or removing it with null, under its session. */
const settingPhoto = (
  plugin: WorkspacePlugin,
  userId: string,
  workspaceId: string,
  photo: string | null,
) =>
  postedInSession(plugin, userId, HOSTED_SERVICE_PATH.WORKSPACES_PHOTO_SET, { workspaceId, photo });

/** The text a workspace's `logo` holds, as the plugin's row keeps it. */
const logoOf = (organizationId: string) =>
  Effect.map(
    Database.use((db) =>
      db
        .select({ logo: organization.logo })
        .from(organization)
        .where(eq(organization.id, organizationId)),
    ),
    ([row]) => (row ?? assert.fail(`no organization ${organizationId}`)).logo,
  );

/** A workspace's name and slug, as the plugin's row holds them. */
const organizationOf = (organizationId: string) =>
  Effect.map(
    Database.use((db) =>
      db
        .select({ name: organization.name, slug: organization.slug })
        .from(organization)
        .where(eq(organization.id, organizationId)),
    ),
    ([row]) => row ?? assert.fail(`no organization ${organizationId}`),
  );

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

/** Gives the account a sign-in picture at an address, as its provider's profile would. */
const pictured = (userId: string, image: string) =>
  Database.use((db) => db.update(user).set({ image }).where(eq(user.id, userId)));

it.effect(
  "a member's sign-in picture is listed where the window may draw it, and one on any other host is left out",
  () =>
    Effect.gen(function* () {
      const { api, seams, database } = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const grace = yield* openGithubAccount("Grace Hopper");
        const alan = yield* openGithubAccount("Alan Turing");
        const linus = yield* openGithubAccount("Linus Torvalds");
        const acme = yield* openTeam(api, ada, [
          { userId: grace, role: "member" },
          { userId: alan, role: "member" },
          { userId: linus, role: "member" },
        ]);
        yield* pictured(ada, "https://lh3.googleusercontent.com/a/ada=s96-c");
        yield* pictured(grace, "https://avatars.githubusercontent.com/u/1?v=4");
        yield* pictured(alan, "https://tracker.example/alan.png");

        const answered = yield* readMembers(seams, grace, membersAt(acme));

        assert.deepEqual(answered, {
          status: HOSTED_HTTP_STATUS.OK,
          body: {
            members: [
              {
                userId: ada,
                name: "Ada Lovelace",
                email: `${ada}@luke.test`,
                role: "owner",
                pictureUrl: "https://lh3.googleusercontent.com/a/ada=s96-c",
              },
              { userId: alan, name: "Alan Turing", email: `${alan}@luke.test`, role: "member" },
              {
                userId: grace,
                name: "Grace Hopper",
                email: `${grace}@luke.test`,
                role: "member",
                pictureUrl: "https://avatars.githubusercontent.com/u/1?v=4",
              },
              {
                userId: linus,
                name: "Linus Torvalds",
                email: `${linus}@luke.test`,
                role: "member",
              },
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

/** Where the group serves a workspace's photo, its workspace in the query the path's rewrite moves it into. */
const photoAt = (workspaceId: string) =>
  `/api/workspaces/photo?${new URLSearchParams({ id: workspaceId })}`;

/** A photo read under the bearer's account, as its status, the headers it was served under, and its bytes in base64. */
const readPhoto = (seams: WorkspaceSeams, userId: string | undefined, workspaceId: string) =>
  answered(
    seams,
    NO_GITHUB_TO_READ,
    bearerRequest(photoAt(workspaceId), userId),
    NO_SESSION,
    async (response) => ({
      status: response.status,
      contentType: response.headers.get("content-type"),
      nosniff: response.headers.get("x-content-type-options"),
      cacheControl: response.headers.get("cache-control"),
      policy: openedPagePolicy(response.headers),
      base64: Buffer.from(await response.arrayBuffer()).toString("base64"),
    }),
  );

it.effect(
  "a workspace's photo is served as its bytes under its type to a member, and is not found to anyone else or where there is none",
  () =>
    Effect.gen(function* () {
      const { api, seams, database } = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const grace = yield* openGithubAccount("Grace Hopper");
        const mallory = yield* openGithubAccount("Mallory");
        const acme = yield* openTeam(api, ada, [{ userId: grace, role: "member" }]);
        const png = "iVBORw0KGgo=";
        const keepLogo = (logo: string | null) =>
          Database.use((db) =>
            db.update(organization).set({ logo }).where(eq(organization.id, acme)),
          );
        yield* keepLogo(`data:image/png;base64,${png}`);

        const member = yield* readPhoto(seams, grace, acme);
        const outsider = yield* readPhoto(seams, mallory, acme);
        const anonymous = yield* readPhoto(seams, undefined, acme);
        yield* keepLogo("https://example.test/acme.png");
        const notAPhoto = yield* readPhoto(seams, ada, acme);
        yield* keepLogo(null);
        const none = yield* readPhoto(seams, ada, acme);

        assert.deepEqual(member, {
          status: HOSTED_HTTP_STATUS.OK,
          contentType: "image/png",
          nosniff: "nosniff",
          cacheControl: "private, no-store",
          policy: SANDBOXED_PAGE,
          base64: png,
        });
        assert.equal(outsider.status, HOSTED_HTTP_STATUS.NOT_FOUND);
        assert.equal(anonymous.status, HOSTED_HTTP_STATUS.UNAUTHORIZED);
        assert.equal(notAPhoto.status, HOSTED_HTTP_STATUS.NOT_FOUND);
        assert.equal(none.status, HOSTED_HTTP_STATUS.NOT_FOUND);
        const refusal = yield* send(
          seams,
          NO_GITHUB_TO_READ,
          bearerRequest(photoAt(acme), mallory),
        );
        assert.deepEqual(refusal.body, { error: HOSTED_API_ERROR.NOT_FOUND });
      }).pipe(Effect.provide(database));
    }),
);

it.effect(
  "a members read names who the workspace's work credits but left, with their picture, and nobody who left without work there",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      const { api, seams, database } = plugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const grace = yield* openGithubAccount("Grace Hopper");
        const alan = yield* openGithubAccount("Alan Turing");
        const acme = yield* openTeam(api, ada, [
          { userId: grace, role: "member" },
          { userId: alan, role: "member" },
        ]);
        yield* pictured(grace, "https://avatars.githubusercontent.com/u/1?v=4");
        yield* Database.use((db) =>
          db
            .insert(task)
            .values({ userId: grace, organizationId: acme, name: "Relay retries", document: "" }),
        );
        yield* leaving(plugin, grace, acme);
        yield* removing(plugin, ada, acme, alan);

        const answered = yield* readMembers(seams, ada, membersAt(acme));

        assert.deepEqual(answered, {
          status: HOSTED_HTTP_STATUS.OK,
          body: {
            members: [
              { userId: ada, name: "Ada Lovelace", email: `${ada}@luke.test`, role: "owner" },
            ],
            former: [
              {
                userId: grace,
                name: "Grace Hopper",
                pictureUrl: "https://avatars.githubusercontent.com/u/1?v=4",
              },
            ],
          },
        });
      }).pipe(Effect.provide(database));
    }),
);

it.effect(
  "a members read names who left having only answered an Inbox item of an agent with no task",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      const { api, seams, database } = plugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const lin = yield* openGithubAccount("Lin Chen");
        const acme = yield* openTeam(api, ada, [{ userId: lin, role: "member" }]);
        const started = yield* createCodingAgent(ada, {
          taskId: null,
          organizationId: acme,
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          repository: "acme/relay",
          planSnapshot: null,
          prompt: "Sweep the flaky tests.",
        });
        const agent = { userId: ada, taskId: null, agentId: Option.getOrThrow(started).agent.id };
        const posted = yield* postInboxItem(agent, {
          key: "branch-protection",
          title: "Require a review on main",
          response: { type: INBOX_RESPONSE.TODO },
          needsReply: false,
        });
        assert.ok(Result.isSuccess(posted));
        const done = { reply: INBOX_REPLY.DONE } as const;
        assert.ok(
          Option.isSome(yield* answerInboxItem(lin, posted.success.id, 1, done, randomUUID())),
        );
        yield* leaving(plugin, lin, acme);

        const answered = yield* readMembers(seams, ada, membersAt(acme));

        assert.deepEqual(answered, {
          status: HOSTED_HTTP_STATUS.OK,
          body: {
            members: [
              { userId: ada, name: "Ada Lovelace", email: `${ada}@luke.test`, role: "owner" },
            ],
            former: [{ userId: lin, name: "Lin Chen" }],
          },
        });
      }).pipe(Effect.provide(database));
    }),
);

it.effect(
  "a members read names who left having made one of the workspace's automations, and nobody whose only automation was their own",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      const { api, seams, database } = plugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const lin = yield* openGithubAccount("Lin Chen");
        const kai = yield* openGithubAccount("Kai Ito");
        const acme = yield* openTeam(api, ada, [
          { userId: lin, role: "member" },
          { userId: kai, role: "member" },
        ]);
        const making = (userId: string, scope: AutomationScope) =>
          createAutomation(userId, {
            taskId: null,
            organizationId: acme,
            repositories: ["acme/relay"],
            name: "Flaky-test sweep",
            scope,
            trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 9 * * 1-5", timezone: "UTC" },
            action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Fix the flakiest test." },
            guards: AUTOMATION_DEFAULT_GUARDS,
            nextRunAt: null,
            webhookSecretHash: null,
          });
        assert.ok(Option.isSome(yield* making(lin, AUTOMATION_SCOPE.WORKSPACE)));
        assert.ok(Option.isSome(yield* making(kai, AUTOMATION_SCOPE.PERSONAL)));
        yield* leaving(plugin, lin, acme);
        yield* leaving(plugin, kai, acme);

        const answered = yield* readMembers(seams, ada, membersAt(acme));

        assert.deepEqual(answered, {
          status: HOSTED_HTTP_STATUS.OK,
          body: {
            members: [
              { userId: ada, name: "Ada Lovelace", email: `${ada}@luke.test`, role: "owner" },
            ],
            former: [{ userId: lin, name: "Lin Chen" }],
          },
        });
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

/** The account giving a teammate a role, under its session. */
const changingRole = (
  plugin: WorkspacePlugin,
  userId: string,
  workspaceId: string,
  changed: string,
  role: string,
) =>
  postedInSession(plugin, userId, HOSTED_SERVICE_PATH.WORKSPACES_MEMBERS_ROLE, {
    workspaceId,
    userId: changed,
    role,
  });

/** The account handing the workspace to a teammate, under its session. */
const transferring = (plugin: WorkspacePlugin, userId: string, workspaceId: string, heir: string) =>
  postedInSession(plugin, userId, HOSTED_SERVICE_PATH.WORKSPACES_TRANSFER, {
    workspaceId,
    userId: heir,
  });

/** Each member's role in a workspace, by account, as the plugin's rows hold them. */
const rolesIn = (organizationId: string) =>
  Effect.map(membersOf(organizationId), (rows) =>
    Object.fromEntries(rows.map((row) => [row.userId, row.role])),
  );

/** Each member's role, by account, as a members answer carries them, failing the test where it is not one. */
const rolesAnswered = (answer: Pick<Answer, "status" | "body">) =>
  Object.fromEntries(
    readAs(answer, workspaceMembersAnswerSchema, HOSTED_HTTP_STATUS.OK).members.map((one) => [
      one.userId,
      one.role,
    ]),
  );

/** A member's row made an owner's, as a handover cut short between its two writes leaves the heir. */
const ownerByHand = (organizationId: string, userId: string) =>
  Database.use((db) =>
    db
      .update(member)
      .set({ role: WORKSPACE_ROLE.OWNER })
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId))),
  );

it.effect(
  "the owner makes a member an admin and an admin a member, answered with the members, and an admin's or a member's change is refused",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const grace = yield* openGithubAccount("Grace Hopper");
        const alan = yield* openGithubAccount("Alan Turing");
        const acme = yield* openTeam(plugin.api, ada, [
          { userId: grace, role: "admin" },
          { userId: alan, role: "member" },
        ]);

        const byAdmin = yield* changingRole(plugin, grace, acme, alan, WORKSPACE_ROLE.ADMIN);
        const byMember = yield* changingRole(plugin, alan, acme, grace, WORKSPACE_ROLE.MEMBER);
        const unchanged = yield* rolesIn(acme);
        const promoted = rolesAnswered(
          yield* changingRole(plugin, ada, acme, alan, WORKSPACE_ROLE.ADMIN),
        );
        const demoted = rolesAnswered(
          yield* changingRole(plugin, ada, acme, grace, WORKSPACE_ROLE.MEMBER),
        );

        const notPermitted = refusedAs(
          HOSTED_HTTP_STATUS.FORBIDDEN,
          HOSTED_API_ERROR.NOT_PERMITTED,
        );
        assert.deepEqual(byAdmin, notPermitted);
        assert.deepEqual(byMember, notPermitted);
        assert.deepEqual(unchanged, { [ada]: "owner", [grace]: "admin", [alan]: "member" });
        assert.deepEqual(promoted, { [ada]: "owner", [grace]: "admin", [alan]: "admin" });
        assert.deepEqual(demoted, { [ada]: "owner", [grace]: "member", [alan]: "admin" });
        assert.deepEqual(yield* rolesIn(acme), demoted);
      }).pipe(Effect.provide(plugin.database));
    }),
);

it.effect(
  "a role change of the owner, of oneself, or to owner is refused, and one in a workspace the account is not in, or of an account not in it, is not found",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const grace = yield* openGithubAccount("Grace Hopper");
        const alan = yield* openGithubAccount("Alan Turing");
        const mallory = yield* openGithubAccount("Mallory");
        const acme = yield* openTeam(plugin.api, ada, [
          { userId: grace, role: "admin" },
          { userId: alan, role: "member" },
        ]);
        // A second owner, as a handover cut short leaves one, is still an owner nobody changes.
        yield* ownerByHand(acme, grace);

        const ofOwner = yield* changingRole(plugin, ada, acme, grace, WORKSPACE_ROLE.MEMBER);
        const ofSelf = yield* changingRole(plugin, ada, acme, ada, WORKSPACE_ROLE.ADMIN);
        const toOwner = yield* changingRole(plugin, ada, acme, alan, WORKSPACE_ROLE.OWNER);
        const byOutsider = yield* changingRole(plugin, mallory, acme, alan, WORKSPACE_ROLE.ADMIN);
        const ofOutsider = yield* changingRole(plugin, ada, acme, mallory, WORKSPACE_ROLE.ADMIN);

        const notPermitted = refusedAs(
          HOSTED_HTTP_STATUS.FORBIDDEN,
          HOSTED_API_ERROR.NOT_PERMITTED,
        );
        const notFound = refusedAs(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);
        assert.deepEqual(ofOwner, notPermitted);
        assert.deepEqual(ofSelf, notPermitted);
        assert.deepEqual(
          toOwner,
          refusedAs(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.deepEqual(byOutsider, notFound);
        assert.deepEqual(ofOutsider, notFound);
        assert.deepEqual(yield* rolesIn(acme), {
          [ada]: "owner",
          [grace]: "owner",
          [alan]: "member",
        });
      }).pipe(Effect.provide(plugin.database));
    }),
);

it.effect(
  "the owner hands the workspace to an admin, who owns it as the old owner becomes an admin, and each reads it so",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const grace = yield* openGithubAccount("Grace Hopper");
        const alan = yield* openGithubAccount("Alan Turing");
        const acme = yield* openTeam(plugin.api, ada, [
          { userId: grace, role: "admin" },
          { userId: alan, role: "member" },
        ]);

        const handedOver = rolesAnswered(yield* transferring(plugin, ada, acme, grace));
        const roleOf = (userId: string) =>
          Effect.map(
            workspacesOf(plugin.seams, NO_GITHUB_TO_READ, userId),
            (listed) => listed.find((each) => each.id === acme)?.role,
          );

        assert.deepEqual(handedOver, { [ada]: "admin", [grace]: "owner", [alan]: "member" });
        assert.deepEqual(yield* rolesIn(acme), handedOver);
        assert.equal(yield* roleOf(ada), WORKSPACE_ROLE.ADMIN);
        assert.equal(yield* roleOf(grace), WORKSPACE_ROLE.OWNER);
        // The old owner, an admin now, may leave, and the new owner may not.
        assert.deepEqual(yield* leaving(plugin, grace, acme), {
          status: HOSTED_HTTP_STATUS.FORBIDDEN,
          body: { error: HOSTED_API_ERROR.NOT_PERMITTED },
        });
        assert.deepEqual(yield* leaving(plugin, ada, acme), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { workspaceId: acme },
        });
      }).pipe(Effect.provide(plugin.database));
    }),
);

it.effect(
  "a handover to a member, by an admin, of the account's first workspace, or of a workspace the account is not in is refused, and moves no role",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const grace = yield* openGithubAccount("Grace Hopper");
        const alan = yield* openGithubAccount("Alan Turing");
        const mallory = yield* openGithubAccount("Mallory");
        const acme = yield* openTeam(plugin.api, ada, [
          { userId: grace, role: "admin" },
          { userId: alan, role: "member" },
        ]);
        const first = Option.getOrThrow(yield* ensurePersonalWorkspace(ada, plugin.seams));
        yield* Effect.promise(() =>
          plugin.api.addMember({ body: { userId: grace, organizationId: first, role: "admin" } }),
        );

        const toMember = yield* transferring(plugin, ada, acme, alan);
        const byAdmin = yield* transferring(plugin, grace, acme, alan);
        const ofFirst = yield* transferring(plugin, ada, first, grace);
        const byOutsider = yield* transferring(plugin, mallory, acme, grace);

        const notPermitted = refusedAs(
          HOSTED_HTTP_STATUS.FORBIDDEN,
          HOSTED_API_ERROR.NOT_PERMITTED,
        );
        assert.deepEqual(toMember, notPermitted);
        assert.deepEqual(byAdmin, notPermitted);
        assert.deepEqual(ofFirst, notPermitted);
        assert.deepEqual(
          byOutsider,
          refusedAs(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(yield* rolesIn(acme), {
          [ada]: "owner",
          [grace]: "admin",
          [alan]: "member",
        });
        assert.deepEqual(yield* rolesIn(first), { [ada]: "owner", [grace]: "admin" });
      }).pipe(Effect.provide(plugin.database));
    }),
);

it.effect(
  "a handover cut short after its heir was made an owner is finished by the old owner trying again",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const grace = yield* openGithubAccount("Grace Hopper");
        const acme = yield* openTeam(plugin.api, ada, [{ userId: grace, role: "admin" }]);
        yield* ownerByHand(acme, grace);

        const finished = rolesAnswered(yield* transferring(plugin, ada, acme, grace));

        assert.deepEqual(finished, { [ada]: "admin", [grace]: "owner" });
      }).pipe(Effect.provide(plugin.database));
    }),
);

it.effect(
  "the owner removes an admin, an admin cannot remove another admin, and nobody removes themselves",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const grace = yield* openGithubAccount("Grace Hopper");
        const alan = yield* openGithubAccount("Alan Turing");
        const linus = yield* openGithubAccount("Linus Torvalds");
        const acme = yield* openTeam(plugin.api, ada, [
          { userId: grace, role: "admin" },
          { userId: alan, role: "admin" },
          { userId: linus, role: "admin" },
        ]);

        const adminOfAdmin = yield* removing(plugin, grace, acme, alan);
        const adminOfSelf = yield* removing(plugin, grace, acme, grace);
        const ownerOfSelf = yield* removing(plugin, ada, acme, ada);
        const ownerOfAdmin = rolesAnswered(yield* removing(plugin, ada, acme, linus));

        const notPermitted = refusedAs(
          HOSTED_HTTP_STATUS.FORBIDDEN,
          HOSTED_API_ERROR.NOT_PERMITTED,
        );
        assert.deepEqual(adminOfAdmin, notPermitted);
        assert.deepEqual(adminOfSelf, notPermitted);
        assert.deepEqual(ownerOfSelf, notPermitted);
        assert.deepEqual(ownerOfAdmin, { [ada]: "owner", [grace]: "admin", [alan]: "admin" });
      }).pipe(Effect.provide(plugin.database));
    }),
);

it.effect(
  "an owner and an admin rename the workspace, its ends trimmed and its slug left as it was, and a member is refused",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const grace = yield* openGithubAccount("Grace Hopper");
        const alan = yield* openGithubAccount("Alan Turing");
        const acme = yield* openTeam(plugin.api, ada, [
          { userId: grace, role: "admin" },
          { userId: alan, role: "member" },
        ]);
        const slug = `acme-${ada}`;

        const byOwner = readAs(
          yield* renaming(plugin, ada, acme, "  Acme Labs "),
          workspaceAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
        ).workspace;
        const byAdmin = readAs(
          yield* renaming(plugin, grace, acme, "Acme Research"),
          workspaceAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
        ).workspace;
        const byMember = yield* renaming(plugin, alan, acme, "Alan's");

        assert.deepEqual(
          { name: byOwner.name, slug: byOwner.slug, role: byOwner.role },
          { name: "Acme Labs", slug, role: WORKSPACE_ROLE.OWNER },
        );
        assert.deepEqual(
          { name: byAdmin.name, slug: byAdmin.slug, role: byAdmin.role },
          { name: "Acme Research", slug, role: WORKSPACE_ROLE.ADMIN },
        );
        assert.deepEqual(
          byMember,
          refusedAs(HOSTED_HTTP_STATUS.FORBIDDEN, HOSTED_API_ERROR.NOT_PERMITTED),
        );
        assert.deepEqual(yield* organizationOf(acme), { name: "Acme Research", slug });
      }).pipe(Effect.provide(plugin.database));
    }),
);

it.effect(
  "an account's first workspace is listed as personal and its rename refused to its owner and an admin of it alike, while a team's is neither",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const grace = yield* openGithubAccount("Grace Hopper");
        const personal = yield* ensurePersonalWorkspace(ada, plugin.seams);
        assert.ok(Option.isSome(personal));
        yield* Effect.promise(() =>
          plugin.api.addMember({
            body: { userId: grace, organizationId: personal.value, role: "admin" },
          }),
        );
        yield* openTeam(plugin.api, ada, []);

        const listedOf = (userId: string) =>
          Effect.map(workspacesOf(plugin.seams, githubReaching([]), userId), (listed) =>
            listed.map(({ name, personal }) => ({ name, personal })),
          );
        const byOwner = yield* renaming(plugin, ada, personal.value, "Ada's");
        const byAdmin = yield* renaming(plugin, grace, personal.value, "Grace's");

        assert.deepEqual(yield* listedOf(ada), [
          { name: "Ada Lovelace", personal: true },
          { name: "Acme", personal: undefined },
        ]);
        assert.deepEqual(yield* listedOf(grace), [
          { name: "Grace Hopper", personal: true },
          { name: "Ada Lovelace", personal: true },
        ]);
        const refused = refusedAs(HOSTED_HTTP_STATUS.FORBIDDEN, HOSTED_API_ERROR.NOT_PERMITTED);
        assert.deepEqual(byOwner, refused);
        assert.deepEqual(byAdmin, refused);
        assert.deepEqual(yield* organizationOf(personal.value), {
          name: "Ada Lovelace",
          slug: `personal-${ada}`,
        });
      }).pipe(Effect.provide(plugin.database));
    }),
);

it.effect(
  "a rename to a blank name or one past the bound is refused as invalid, and one of a workspace the account is not in as not found",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const mallory = yield* openGithubAccount("Mallory");
        const acme = yield* openTeam(plugin.api, ada, []);

        const blank = yield* renaming(plugin, ada, acme, "   ");
        const long = yield* renaming(
          plugin,
          ada,
          acme,
          "a".repeat(WORKSPACE_BOUNDS.MAX_NAME_CHARS + 1),
        );
        const outsider = yield* renaming(plugin, mallory, acme, "Mallory's");

        const invalid = refusedAs(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
        assert.deepEqual(blank, invalid);
        assert.deepEqual(long, invalid);
        assert.deepEqual(
          outsider,
          refusedAs(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(yield* organizationOf(acme), { name: "Acme", slug: `acme-${ada}` });
      }).pipe(Effect.provide(plugin.database));
    }),
);

/** A photo's `data:` URL of the type given, holding `bytes` bytes. */
/** Each photo type's signature, which a photo's bytes must open with to be the image its label names. */
const PHOTO_SIGNATURES = {
  [WORKSPACE_PHOTO_TYPE.PNG]: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  [WORKSPACE_PHOTO_TYPE.JPEG]: [0xff, 0xd8, 0xff],
  [WORKSPACE_PHOTO_TYPE.WEBP]: [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
} as const satisfies Record<WorkspacePhotoType, readonly number[]>;

/** A photo of `bytes` bytes of the type given as its `data:` URL: its signature, then filler. */
const photoOfBytes = (type: WorkspacePhotoType, bytes: number) => {
  const buffer = Buffer.alloc(bytes, 7);
  buffer.set(PHOTO_SIGNATURES[type]);
  return `data:${type};base64,${buffer.toString("base64")}`;
};

it.effect(
  "an owner and an admin set the workspace's photo, which the list then versions and the photo's path serves, null removes it, and a member is refused",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const grace = yield* openGithubAccount("Grace Hopper");
        const alan = yield* openGithubAccount("Alan Turing");
        const acme = yield* openTeam(plugin.api, ada, [
          { userId: grace, role: "admin" },
          { userId: alan, role: "member" },
        ]);
        const png = "iVBORw0KGgo=";
        const webp = "UklGRgAAAABXRUJQ";
        const listed = (userId: string) =>
          Effect.map(
            workspacesOf(plugin.seams, NO_GITHUB_TO_READ, userId),
            (workspaces) => workspaces.find((each) => each.id === acme)?.photoVersion,
          );

        const byOwner = readAs(
          yield* settingPhoto(plugin, ada, acme, `data:image/png;base64,${png}`),
          workspaceAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
        ).workspace;
        const ownerVersion = yield* listed(alan);
        const ownerPhoto = yield* readPhoto(plugin.seams, alan, acme);
        const byAdmin = readAs(
          yield* settingPhoto(plugin, grace, acme, `data:image/webp;base64,${webp}`),
          workspaceAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
        ).workspace;
        const adminPhoto = yield* readPhoto(plugin.seams, alan, acme);
        const byMember = yield* settingPhoto(plugin, alan, acme, null);
        const keptThroughMember = yield* logoOf(acme);
        const removed = readAs(
          yield* settingPhoto(plugin, grace, acme, null),
          workspaceAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
        ).workspace;

        assert.ok(byOwner.photoVersion !== undefined, "the owner's photo is versioned");
        assert.equal(ownerVersion, byOwner.photoVersion);
        assert.deepEqual(
          {
            status: ownerPhoto.status,
            contentType: ownerPhoto.contentType,
            base64: ownerPhoto.base64,
          },
          { status: HOSTED_HTTP_STATUS.OK, contentType: "image/png", base64: png },
        );
        assert.ok(byAdmin.photoVersion !== undefined, "the admin's photo is versioned");
        assert.notEqual(byAdmin.photoVersion, byOwner.photoVersion);
        assert.deepEqual(
          {
            status: adminPhoto.status,
            contentType: adminPhoto.contentType,
            base64: adminPhoto.base64,
          },
          { status: HOSTED_HTTP_STATUS.OK, contentType: "image/webp", base64: webp },
        );
        assert.deepEqual(
          byMember,
          refusedAs(HOSTED_HTTP_STATUS.FORBIDDEN, HOSTED_API_ERROR.NOT_PERMITTED),
        );
        assert.equal(keptThroughMember, `data:image/webp;base64,${webp}`);
        assert.equal(removed.photoVersion, undefined);
        assert.equal(yield* listed(alan), undefined);
        assert.equal(
          (yield* readPhoto(plugin.seams, alan, acme)).status,
          HOSTED_HTTP_STATUS.NOT_FOUND,
        );
        assert.equal(yield* logoOf(acme), null);
      }).pipe(Effect.provide(plugin.database));
    }),
);

it.effect(
  "a photo that is not a PNG, JPEG, or WebP data: URL, whose bytes are not the image its label names, or is past the byte bound, is refused as invalid, one of a workspace the account is not in as not found, and one at the bound is set",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const mallory = yield* openGithubAccount("Mallory");
        const acme = yield* openTeam(plugin.api, ada, []);
        const atBound = photoOfBytes(WORKSPACE_PHOTO_TYPE.JPEG, WORKSPACE_PHOTO_BOUNDS.MAX_BYTES);

        const refusals = [];
        for (const photo of [
          "data:text/plain;base64,aGVsbG8=",
          "data:image/svg+xml;base64,PHN2Zy8+",
          "https://example.test/acme.png",
          "data:image/png;base64,not base64",
          "data:image/png;base64,aGVsbG8=",
          photoOfBytes(WORKSPACE_PHOTO_TYPE.PNG, WORKSPACE_PHOTO_BOUNDS.MAX_BYTES + 1),
        ]) {
          refusals.push(yield* settingPhoto(plugin, ada, acme, photo));
        }
        const outsider = yield* settingPhoto(plugin, mallory, acme, atBound);
        const untouched = yield* logoOf(acme);
        const set = yield* settingPhoto(plugin, ada, acme, atBound);

        const invalid = refusedAs(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
        assert.deepEqual(refusals, [invalid, invalid, invalid, invalid, invalid, invalid]);
        assert.deepEqual(
          outsider,
          refusedAs(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.equal(untouched, null);
        assert.equal(set.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(yield* logoOf(acme), atBound);
      }).pipe(Effect.provide(plugin.database));
    }),
);

it.effect(
  "a removal, a leaving, a rename, or a photo under the Mac's OAuth token rather than its session is refused as unauthenticated",
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
        const renamed = yield* underToken(HOSTED_SERVICE_PATH.WORKSPACES_RENAME, {
          workspaceId: acme,
          name: "Acme Labs",
        });
        const photographed = yield* underToken(HOSTED_SERVICE_PATH.WORKSPACES_PHOTO_SET, {
          workspaceId: acme,
          photo: "data:image/png;base64,iVBORw0KGgo=",
        });

        const unauthenticated = refusedAs(
          HOSTED_HTTP_STATUS.UNAUTHORIZED,
          HOSTED_API_ERROR.INVALID_TOKEN,
        );
        assert.deepEqual(removed, unauthenticated);
        assert.deepEqual(left, unauthenticated);
        assert.deepEqual(renamed, unauthenticated);
        assert.deepEqual(photographed, unauthenticated);
        assert.equal(yield* logoOf(acme), null);
        assert.deepEqual(yield* organizationOf(acme), { name: "Acme", slug: `acme-${ada}` });
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

/** An invitation asked for by the account, under its session, as a member unless told otherwise. */
const inviting = (
  plugin: WorkspacePlugin,
  userId: string,
  workspaceId: string,
  email: string,
  role = "member",
) =>
  postedInSession(plugin, userId, HOSTED_SERVICE_PATH.WORKSPACES_INVITATIONS, {
    workspaceId,
    email,
    role,
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

/** The accept page's read of the invitation `id`. */
const offerAt = (id: string) =>
  `${HOSTED_SERVICE_PATH.WORKSPACES_INVITATION_OFFER}?${new URLSearchParams({ id })}`;

/** The account's address marked verified, as a provider's sign-in marks it, and that address. */
const verified = (userId: string) =>
  Effect.gen(function* () {
    yield* Database.use((db) =>
      db.update(user).set({ emailVerified: true }).where(eq(user.id, userId)),
    );
    return `${userId}@luke.test`;
  });

/** The invitation accepted through the plugin's own call, under the account's session, as the accept page accepts it. */
const accepting = (plugin: WorkspacePlugin, userId: string, invitationId: string) =>
  Effect.gen(function* () {
    const sessionBearer = yield* plugin.sessionBearerOf(userId);
    return yield* Effect.promise(() =>
      plugin.api
        .acceptInvitation({
          headers: new Headers({ authorization: `Bearer ${sessionBearer}` }),
          body: { invitationId },
        })
        .then(
          () => true,
          () => false,
        ),
    );
  });

it.effect(
  "an invitation whose inviter left is still offered to its recipient, naming nobody, and its recipient accepts it",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const grace = yield* openGithubAccount("Grace Hopper");
        const alan = yield* openGithubAccount("Alan Turing");
        const alanAddress = yield* verified(alan);
        const acme = yield* openTeam(plugin.api, ada, [{ userId: grace, role: "admin" }]);
        const made = readAs(
          yield* inviting(plugin, grace, acme, alanAddress),
          workspaceInvitationAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
        ).invitation;

        const whileIn = yield* readInSession(plugin, alan, offerAt(made.id));
        yield* leaving(plugin, grace, acme);
        const afterLeaving = yield* readInSession(plugin, alan, offerAt(made.id));
        const accepted = yield* accepting(plugin, alan, made.id);

        assert.deepEqual(whileIn, {
          status: HOSTED_HTTP_STATUS.OK,
          body: {
            offer: {
              id: made.id,
              workspaceName: "Acme",
              role: "member",
              inviter: { name: "Grace Hopper", email: `${grace}@luke.test` },
            },
          },
        });
        assert.deepEqual(afterLeaving, {
          status: HOSTED_HTTP_STATUS.OK,
          body: { offer: { id: made.id, workspaceName: "Acme", role: "member" } },
        });
        assert.equal(accepted, true);
        assert.deepEqual(
          (yield* membersOf(acme)).find((row) => row.userId === alan),
          { userId: alan, role: "member" },
        );
      }).pipe(Effect.provide(plugin.database));
    }),
);

it.effect(
  "an invitation to an account's first workspace is offered under its owner's name as it stands now",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const alan = yield* openGithubAccount("Alan Turing");
        const alanAddress = yield* verified(alan);
        const first = Option.getOrThrow(yield* ensurePersonalWorkspace(ada, plugin.seams));
        const made = readAs(
          yield* inviting(plugin, ada, first, alanAddress),
          workspaceInvitationAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
        ).invitation;
        yield* Database.use((db) =>
          db.update(user).set({ name: "Dr Ada Lovelace" }).where(eq(user.id, ada)),
        );

        const offered = yield* readInSession(plugin, alan, offerAt(made.id));

        assert.deepEqual(offered.body, {
          offer: {
            id: made.id,
            workspaceName: "Dr Ada Lovelace",
            role: "member",
            inviter: { name: "Dr Ada Lovelace", email: `${ada}@luke.test` },
          },
        });
      }).pipe(Effect.provide(plugin.database));
    }),
);

it.effect(
  "the accept page's read says an invitation canceled or expired is spent, one for another address or an unverified one is refused, and asks for a session",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const alan = yield* openGithubAccount("Alan Turing");
        const alanAddress = yield* verified(alan);
        const kim = yield* openGithubAccount("Kim Lee");
        yield* verified(kim);
        const una = yield* openGithubAccount("Una Verified");
        const acme = yield* openTeam(plugin.api, ada, []);
        const invited = (email: string) =>
          Effect.map(
            inviting(plugin, ada, acme, email),
            (answer) =>
              readAs(answer, workspaceInvitationAnswerSchema, HOSTED_HTTP_STATUS.CREATED)
                .invitation,
          );
        const canceled = yield* invited("someone@example.com");
        yield* postedInSession(plugin, ada, HOSTED_SERVICE_PATH.WORKSPACES_INVITATIONS_CANCEL, {
          workspaceId: acme,
          invitationId: canceled.id,
        });
        const forAlan = yield* invited(alanAddress);
        const forUna = yield* invited(`${una}@luke.test`);

        const spentWhenCanceled = yield* readInSession(plugin, alan, offerAt(canceled.id));
        const otherAddress = yield* readInSession(plugin, kim, offerAt(forAlan.id));
        const unverifiedAddress = yield* readInSession(plugin, una, offerAt(forUna.id));
        const noSession = yield* send(
          plugin.seams,
          NO_GITHUB_TO_READ,
          bearerRequest(offerAt(forAlan.id), undefined),
          plugin,
        );
        yield* TestClock.setTime(Date.parse(forAlan.expiresAt) + 1);
        const spentWhenExpired = yield* readInSession(plugin, alan, offerAt(forAlan.id));

        assert.deepEqual(spentWhenCanceled.body, { refused: "spent" });
        assert.deepEqual(otherAddress.body, { refused: "not-recipient" });
        assert.deepEqual(unverifiedAddress.body, { refused: "unverified" });
        assert.equal(noSession.status, HOSTED_HTTP_STATUS.UNAUTHORIZED);
        assert.deepEqual(spentWhenExpired.body, { refused: "spent" });
      }).pipe(Effect.provide(plugin.database));
    }),
);

it.effect("an admin's invitation as an admin is refused, and the owner invites as an admin", () =>
  Effect.gen(function* () {
    const plugin = yield* openWorkspacePlugin;
    yield* Effect.gen(function* () {
      const ada = yield* openGithubAccount("Ada Lovelace");
      const grace = yield* openGithubAccount("Grace Hopper");
      const acme = yield* openTeam(plugin.api, ada, [{ userId: grace, role: "admin" }]);

      const byAdmin = yield* inviting(plugin, grace, acme, "alan@example.com", "admin");
      const byOwner = readAs(
        yield* inviting(plugin, ada, acme, "alan@example.com", "admin"),
        workspaceInvitationAnswerSchema,
        HOSTED_HTTP_STATUS.CREATED,
      ).invitation;

      assert.deepEqual(
        byAdmin,
        refusedAs(HOSTED_HTTP_STATUS.FORBIDDEN, HOSTED_API_ERROR.NOT_PERMITTED),
      );
      assert.deepEqual(
        { email: byOwner.email, role: byOwner.role },
        {
          email: "alan@example.com",
          role: "admin",
        },
      );
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
  "invitations under the Mac's OAuth token rather than its session are unauthenticated, whatever input they carry",
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

        // A malformed input is read only after the caller, so it is unauthenticated too, as it always was.
        const malformed = yield* send(
          plugin.seams,
          NO_GITHUB_TO_READ,
          bearerRequest(HOSTED_SERVICE_PATH.WORKSPACES_INVITATIONS_CANCEL, ada, {
            workspaceId: 7,
            stray: true,
          }),
          plugin,
        );
        const malformedRead = yield* send(
          plugin.seams,
          NO_GITHUB_TO_READ,
          bearerRequest(HOSTED_SERVICE_PATH.WORKSPACES_INVITATIONS, ada),
          plugin,
        );

        const unauthenticated = refusedAs(
          HOSTED_HTTP_STATUS.UNAUTHORIZED,
          HOSTED_API_ERROR.INVALID_TOKEN,
        );
        assert.deepEqual({ status: read.status, body: read.body }, unauthenticated);
        assert.deepEqual({ status: made.status, body: made.body }, unauthenticated);
        assert.deepEqual({ status: malformed.status, body: malformed.body }, unauthenticated);
        assert.deepEqual(
          { status: malformedRead.status, body: malformedRead.body },
          unauthenticated,
        );
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
