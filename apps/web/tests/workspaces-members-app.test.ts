import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import type { WireBoundaryInput } from "@sidecar/wire";
import { betterAuth } from "better-auth";
import { organization as organizationPlugin } from "better-auth/plugins";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { Effect, Option } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { authDatabaseAdapter } from "../server/auth-database";
import { DISABLED_AUTH_PATHS, ORGANIZATION_OPTIONS } from "../server/auth-policy";
import * as authSchema from "../server/db/auth-schema";
import { member } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../server/hosted/http";
import { ADDABLE_ROLE, WORKSPACE_MEMBERS_PATH } from "../server/hosted/workspace-members-wire";
import { workspaceMemberSeams, workspaceSeams } from "../server/hosted/workspace-seams";
import { ensurePersonalWorkspace } from "../server/hosted/workspace-store";
import { workspacesMembersApp } from "../server/workspaces-members-app";
import { openMigratedPglite, sqlClientOverPglite } from "./support/sql-client";

/**
 * The Workspaces page's Add by email, answered by the group the way a
 * function answers it, over Better Auth with the organization plugin on a
 * migrated PGlite of its own: the sessions, the plugin's permission check,
 * and its server-only `addMember` are all the plugin's own. An owner or an
 * admin adds an account that already signs in, and nobody else adds anyone;
 * an address no account holds, a personal workspace, and an account already
 * in are refused with nothing written.
 *
 * The test's auth service signs accounts up by password, which the
 * deployment's does not offer, only so each account holds a real session
 * cookie. Synthetic accounts throughout.
 */

const ORIGIN = "https://luke.test";
const PASSWORD = "workspaces-members-test-password";

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

interface Account {
  readonly id: string;
  readonly email: string;
  /** The `Cookie` header the account's browser session sends. */
  readonly cookie: string;
}

const refusal = (status: number, error: string): Answer => ({ status, body: { error } });

/** Better Auth with the organization plugin over a migrated PGlite, the group over the same database, and a way to sign an account up. */
const openService = Effect.gen(function* () {
  const client = yield* Effect.acquireRelease(Effect.promise(openMigratedPglite), (opened) =>
    Effect.promise(() => opened.close()),
  );
  const plugin = betterAuth({
    database: authDatabaseAdapter(drizzle(client, { schema: authSchema })),
    baseURL: "http://127.0.0.1",
    secret: "workspaces-members-test-secret-with-enough-length",
    disabledPaths: [...DISABLED_AUTH_PATHS],
    emailAndPassword: { enabled: true },
    plugins: [organizationPlugin(ORGANIZATION_OPTIONS)],
  });
  const database = sqlClientOverPglite(client);
  const { handler, dispose } = HttpRouter.toWebHandler(
    workspacesMembersApp(workspaceMemberSeams(plugin.api)).pipe(
      HttpRouter.provideRequest(database),
    ),
    { disableLogger: true },
  );
  yield* Effect.addFinalizer(() => Effect.promise(() => dispose()));

  const signUp = (name: string) =>
    Effect.promise(async (): Promise<Account> => {
      const email = `${name.toLowerCase()}-${randomUUID()}@luke.test`;
      const { headers, response } = await plugin.api.signUpEmail({
        body: { name, email, password: PASSWORD },
        returnHeaders: true,
      });
      const cookie = headers
        .getSetCookie()
        .map((line) => line.split(";")[0])
        .join("; ");
      return { id: response.user.id, email, cookie };
    });

  const ask = (caller: Account | undefined, body: WireBoundaryInput, method = "POST") =>
    Effect.promise(async (): Promise<Answer> => {
      const init: RequestInit = { method };
      if (caller !== undefined) init.headers = { cookie: caller.cookie };
      if (method === "POST") init.body = JSON.stringify(body);
      const response = await handler(new Request(new URL(WORKSPACE_MEMBERS_PATH, ORIGIN), init));
      // SAFETY: the group answers JSON; the test compares it as the wire value it is.
      return { status: response.status, body: (await response.json()) as WireBoundaryInput };
    });

  return { seams: workspaceSeams(plugin.api), database, signUp, ask };
});

/** The workspace's members as `[userId, role]`, oldest first. */
const membersOf = (organizationId: string) =>
  Effect.map(
    db
      .select({ userId: member.userId, role: member.role })
      .from(member)
      .where(eq(member.organizationId, organizationId))
      .orderBy(asc(member.createdAt), asc(member.id)),
    (rows) => rows.map((row): [string, string] => [row.userId, row.role]),
  );

it.effect(
  "an owner adds an admin by email, the admin adds a member, and each member row is the plugin's",
  () =>
    Effect.gen(function* () {
      const { seams, database, signUp, ask } = yield* openService;
      const owner = yield* signUp("Owner");
      const admin = yield* signUp("Admin");
      const teammate = yield* signUp("Teammate");
      const { id: acme } = yield* seams.createOrganization({
        name: "Acme",
        slug: `acme-${randomUUID()}`,
        userId: owner.id,
        metadata: {},
      });

      const byOwner = yield* ask(owner, {
        organizationId: acme,
        email: `  ${admin.email.toUpperCase()} `,
        role: ADDABLE_ROLE.ADMIN,
      });
      const byAdmin = yield* ask(admin, {
        organizationId: acme,
        email: teammate.email,
        role: ADDABLE_ROLE.MEMBER,
      });

      assert.equal(byOwner.status, HOSTED_HTTP_STATUS.OK);
      assert.equal(byAdmin.status, HOSTED_HTTP_STATUS.OK);
      yield* Effect.gen(function* () {
        const members = yield* membersOf(acme);
        assert.deepEqual(
          new Map(members),
          new Map([
            [owner.id, "owner"],
            [admin.id, ADDABLE_ROLE.ADMIN],
            [teammate.id, ADDABLE_ROLE.MEMBER],
          ]),
        );
      }).pipe(Effect.provide(database));
    }),
);

it.effect(
  "a member, a stranger, and a signed-out request add nobody, and nor does an unknown address",
  () =>
    Effect.gen(function* () {
      const { seams, database, signUp, ask } = yield* openService;
      const owner = yield* signUp("Owner");
      const teammate = yield* signUp("Teammate");
      const stranger = yield* signUp("Stranger");
      const { id: acme } = yield* seams.createOrganization({
        name: "Acme",
        slug: `acme-${randomUUID()}`,
        userId: owner.id,
        metadata: {},
      });
      const addTeammate = { organizationId: acme, email: teammate.email, role: "member" };
      assert.equal((yield* ask(owner, addTeammate)).status, HOSTED_HTTP_STATUS.OK);
      const before = yield* Effect.provide(membersOf(acme), database);

      const addStranger = { organizationId: acme, email: stranger.email, role: "member" };
      const byMember = yield* ask(teammate, addStranger);
      const byStranger = yield* ask(stranger, {
        organizationId: acme,
        email: stranger.email,
        role: "admin",
      });
      const signedOut = yield* ask(undefined, addStranger);
      const unknown = yield* ask(owner, {
        organizationId: acme,
        email: `nobody-${randomUUID()}@luke.test`,
        role: "member",
      });

      assert.deepEqual(byMember, refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND));
      assert.deepEqual(
        byStranger,
        refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
      );
      assert.deepEqual(
        signedOut,
        refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN),
      );
      assert.deepEqual(unknown, refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND));
      assert.deepEqual(yield* Effect.provide(membersOf(acme), database), before);
    }),
);

it.effect(
  "a personal workspace takes nobody, an account already in is refused, and only a POST of a known role is read",
  () =>
    Effect.gen(function* () {
      const { seams, database, signUp, ask } = yield* openService;
      const owner = yield* signUp("Owner");
      const teammate = yield* signUp("Teammate");
      const personal = yield* Effect.provide(ensurePersonalWorkspace(owner.id, seams), database);
      assert.ok(Option.isSome(personal));
      const { id: acme } = yield* seams.createOrganization({
        name: "Acme",
        slug: `acme-${randomUUID()}`,
        userId: owner.id,
        metadata: {},
      });
      const addTeammate = { organizationId: acme, email: teammate.email, role: "member" };
      assert.equal((yield* ask(owner, addTeammate)).status, HOSTED_HTTP_STATUS.OK);

      const toPersonal = yield* ask(owner, { ...addTeammate, organizationId: personal.value });
      const twice = yield* ask(owner, { ...addTeammate, role: "admin" });
      const asOwner = yield* ask(owner, { ...addTeammate, role: "owner" });
      const read = yield* ask(owner, addTeammate, "GET");

      const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
      assert.deepEqual(toPersonal, invalid);
      assert.deepEqual(twice, invalid, "the plugin refuses an account already a member");
      assert.deepEqual(asOwner, invalid);
      assert.deepEqual(
        read,
        refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
      );
      yield* Effect.gen(function* () {
        assert.deepEqual(yield* membersOf(personal.value), [[owner.id, "owner"]]);
        assert.deepEqual(
          new Map(yield* membersOf(acme)),
          new Map([
            [owner.id, "owner"],
            [teammate.id, ADDABLE_ROLE.MEMBER],
          ]),
        );
      }).pipe(Effect.provide(database));
    }),
);
