import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@sidecar/database/core/query";
import type { WorkspaceSeams } from "@sidecar/database/models/workspace-seams";
import { member, organization, user } from "@sidecar/database/schemas/auth";
import { GITHUB_INSTALL_STATUS, HOSTED_SERVICE_PATH } from "@sidecar/hosted";
import {
  WORKSPACE_ROLE,
  type Workspace,
  workspaceAnswerSchema,
  workspaceGithubConnectAnswerSchema,
  workspacesAnswerSchema,
} from "@sidecar/hosted/workspace-wire";
import { unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { eq } from "drizzle-orm";
import { Cause, Clock, Effect, Layer, Option, Result, type Schema } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { githubInstallApp } from "../server/github-install-app";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../server/hosted/http";
import { workspacesApp } from "../server/workspaces-app";
import { type FakeGitHub, githubReaching, openGithubUser } from "./support/github-app-fake";
import { openWorkspacePlugin } from "./support/workspace-plugin";

/**
 * The account's workspaces, answered by their group the way a function
 * answers them, and a GitHub organization connected through the App's Setup
 * URL, over Better Auth's own organization plugin on PGlite and a GitHub the
 * test scripts: the bearer names the account and nothing else does, a
 * workspace a member creates is theirs to own, only an owner or admin
 * connects or disconnects GitHub, and the Setup URL links an installation to
 * a workspace only through a live intent and only where the account's own
 * GitHub token sees it, one installation to one workspace.
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

/** One request answered by the workspaces group and the install group over the ambient database and the GitHub given; a bearer stands for the account it names. */
const send = (seams: WorkspaceSeams, github: FakeGitHub, request: Request) =>
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
        workspaces: seams,
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
function readAs<A>(answered: Answer, schema: Schema.Codec<A, unknown>, status: number): A {
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

/** Where GitHub's return through the Setup URL lands the browser, as its status word. */
const landedAt = (seams: WorkspaceSeams, github: FakeGitHub, query: Record<string, string>) =>
  Effect.map(send(seams, github, setupRequest(query)), (answered) => {
    assert.equal(answered.status, 303);
    return answered.location?.replace(LANDING, "");
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

it.effect("the first read makes the personal workspace, owned and with no GitHub account", () =>
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
          personal: true,
          role: WORKSPACE_ROLE.OWNER,
          github: null,
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
            personal: false,
            role: WORKSPACE_ROLE.OWNER,
            github: null,
          },
        );
        assert.notEqual(again.id, acme.id);
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
  "the Setup URL links the installation the account's own token sees to the intent's workspace, and the intent links once",
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
        const connected = { login: "acme", active: true };
        assert.deepEqual(githubOf(yield* workspacesOf(seams, github, ada), acme.id), connected);
        assert.deepEqual(githubOf(yield* workspacesOf(seams, github, linus), acme.id), connected);
      }).pipe(Effect.provide(database));
    }),
);

it.effect(
  "a forged installation id the account's token cannot see, an expired intent, and a request link nothing",
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

it.effect("a plugin that refuses the personal workspace is answered as unavailable", () =>
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
