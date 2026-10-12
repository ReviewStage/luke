import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { type Workspace, workspacesAnswerSchema } from "@sidecar/hosted/workspace-wire";
import { unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { eq } from "drizzle-orm";
import { Cause, Effect, Layer, Option, Result } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { SqlClient } from "effect/unstable/sql";
import { organization, user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../server/hosted/http";
import type { WorkspaceSeams } from "../server/hosted/workspace-seams";
import { workspacesApp } from "../server/workspaces-app";
import { openWorkspacePlugin } from "./support/workspace-plugin";

/**
 * The account's workspaces, answered by the group the way a function
 * answers them, over Better Auth's own organization plugin on PGlite: the
 * bearer names the account and nothing else does, the first read makes the
 * account's personal workspace and no later one makes another, and each
 * member of a shared workspace sees it beside their own personal one.
 *
 * Synthetic accounts and bearers throughout.
 */

const ORIGIN = "https://luke.test";
const WORKSPACES = "/api/workspaces";

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

const openUser = (name: string) =>
  Effect.gen(function* () {
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name, email: `${userId}@luke.test` });
    return userId;
  });

/** One request answered by the group over the ambient database, each bearer standing for the account it names. */
const ask = (seams: WorkspaceSeams, userId: string | undefined) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    const { handler, dispose } = HttpRouter.toWebHandler(
      workspacesApp({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(incoming.headers.get("authorization")?.replace(/^Bearer /u, "")),
          ),
        workspaces: seams,
      }).pipe(HttpRouter.provideRequest(Layer.succeed(SqlClient.SqlClient, client))),
      { disableLogger: true },
    );
    const request = new Request(new URL(WORKSPACES, ORIGIN), {
      headers: userId === undefined ? {} : { authorization: `Bearer ${userId}` },
    });
    const response = yield* Effect.promise(() => handler(request));
    // SAFETY: the group answers JSON; the test compares it as the wire value it is.
    const body = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;
    yield* Effect.promise(() => dispose());
    return { status: response.status, body } satisfies Answer;
  });

/** The workspaces an answer carries, failing the test where it is not the wire's. */
function workspacesOf(answered: Answer): readonly Workspace[] {
  assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
  const read = readEither(workspacesAnswerSchema)(unparsedWire(answered.body));
  if (Result.isFailure(read)) return assert.fail(`not the wire's: ${read.failure.refusal}`);
  return read.success.workspaces;
}

it.effect("a request without a bearer is refused and makes no workspace", () =>
  Effect.gen(function* () {
    const { seams, database } = yield* openWorkspacePlugin;
    yield* Effect.gen(function* () {
      yield* openUser("Ada Lovelace");

      const answered = yield* ask(seams, undefined);

      assert.deepEqual(answered, {
        status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
        body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
      });
      assert.deepEqual(yield* db.select({ id: organization.id }).from(organization), []);
    }).pipe(Effect.provide(database));
  }),
);

it.effect("the first read makes the personal workspace, and the second answers the same one", () =>
  Effect.gen(function* () {
    const { seams, database } = yield* openWorkspacePlugin;
    yield* Effect.gen(function* () {
      const ada = yield* openUser("Ada Lovelace");

      const first = workspacesOf(yield* ask(seams, ada));
      const second = workspacesOf(yield* ask(seams, ada));

      assert.equal(first.length, 1);
      assert.deepEqual(first, [{ id: first[0]?.id, name: "Ada Lovelace", personal: true }]);
      assert.deepEqual(second, first);
      assert.deepEqual(
        yield* db
          .select({ slug: organization.slug })
          .from(organization)
          .where(eq(organization.id, first[0]?.id ?? "")),
        [{ slug: `personal-${ada}` }],
      );
    }).pipe(Effect.provide(database));
  }),
);

it.effect(
  "two members of a shared workspace each see their own personal one flagged, then the shared one",
  () =>
    Effect.gen(function* () {
      const { api, seams, database } = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openUser("Ada Lovelace");
        const grace = yield* openUser("Grace Hopper");
        const acme = yield* Effect.promise(() =>
          api.createOrganization({ body: { name: "Acme", slug: "acme", userId: ada } }),
        );
        yield* Effect.promise(() =>
          api.addMember({ body: { userId: grace, organizationId: acme.id, role: "member" } }),
        );

        const adas = workspacesOf(yield* ask(seams, ada));
        const graces = workspacesOf(yield* ask(seams, grace));

        assert.deepEqual(
          adas.map(({ name, personal }) => ({ name, personal })),
          [
            { name: "Ada Lovelace", personal: true },
            { name: "Acme", personal: false },
          ],
        );
        assert.deepEqual(
          graces.map(({ name, personal }) => ({ name, personal })),
          [
            { name: "Grace Hopper", personal: true },
            { name: "Acme", personal: false },
          ],
        );
        assert.equal(adas[1]?.id, acme.id);
        assert.equal(graces[1]?.id, acme.id);
        assert.notEqual(adas[0]?.id, graces[0]?.id);
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
      const ada = yield* openUser("Ada Lovelace");

      const answered = yield* ask(refusing, ada);

      assert.deepEqual(answered, {
        status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
        body: { error: HOSTED_API_ERROR.UNAVAILABLE },
      });
    }).pipe(Effect.provide(database));
  }),
);
