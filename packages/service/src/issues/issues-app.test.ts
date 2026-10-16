import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { member, organization, user } from "@luke/database/schemas/auth";
import { getTestDB } from "@luke/database/testing";
import {
  ISSUE_PRIORITY,
  ISSUE_STATUS,
  issueAnswerSchema,
  issueListAnswerSchema,
} from "@luke/features/issue-wire";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Clock, DateTime, Effect, Layer, Option, Result, type Schema } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { issuesApp } from "./issues-app.js";

/**
 * A workspace's issues, answered by the group the way a function answers
 * them, over a real dialect: a member files, lists, reads, and changes
 * them, an account outside the workspace reaches none of them, and a body
 * or a method the paths do not take is refused.
 *
 * Synthetic accounts, bearers, and workspaces throughout.
 */

const ORIGIN = "https://luke.test";

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** The group answering one request, as the rewrite hands it a path's id under `id`. */
const answer = (
  bearers: ReadonlyMap<string, string>,
  path: string,
  bearer: string,
  init: { readonly method?: string; readonly body?: unknown },
) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(
      issuesApp({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(bearers.get(incoming.headers.get("authorization") ?? "")),
          ),
      }).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const one = /^\/api\/issues\/([^/?]+)$/u.exec(path);
    const routed = one === null ? path : `/api/issues/issue?id=${one[1]}`;
    const response = yield* Effect.promise(() =>
      handler(
        new Request(`${ORIGIN}${routed}`, {
          method: init.method ?? "GET",
          headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
          ...(init.body === undefined ? undefined : { body: JSON.stringify(init.body) }),
        }),
      ),
    );
    const text = yield* Effect.promise(() => response.text());
    yield* Effect.promise(() => dispose());
    // SAFETY: the group answers JSON; the test reads it as the wire value it is.
    const body = (text.length === 0 ? text : JSON.parse(text)) as WireBoundaryInput;
    return { status: response.status, body } satisfies Answer;
  });

/** A member of a fresh workspace and an account outside it, each behind its own bearer. */
const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, outsider] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  for (const id of [owner, outsider]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  }
  const workspaceId = randomUUID();
  const now = yield* DateTime.nowAsDate;
  yield* db
    .insert(organization)
    .values({ id: workspaceId, name: "Acme", slug: `acme-${workspaceId}`, createdAt: now });
  yield* db.insert(member).values({
    id: randomUUID(),
    organizationId: workspaceId,
    userId: owner,
    role: "owner",
    createdAt: now,
  });
  const bearers = new Map([
    [`Bearer ${owner}`, owner],
    [`Bearer ${outsider}`, outsider],
  ]);
  const ask = (
    path: string,
    userId: string,
    init: { readonly method?: string; readonly body?: unknown } = {},
  ) => answer(bearers, path, userId, init);
  return { owner, outsider, workspaceId, ask };
});

/** The answer read through its schema, failing the test where the status or the body is not what it should be. */
function readAnswer<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  status: number,
  answered: Answer,
): S["Type"] {
  assert.equal(answered.status, status, JSON.stringify(answered.body));
  const read = readEither(schema)(unparsedWire(answered.body));
  if (Result.isFailure(read)) assert.fail(`not the answer: ${JSON.stringify(answered.body)}`);
  return read.success;
}

const refusal = (status: number, error: string): Answer => ({ status, body: { error } });

it.layer(getTestDB())("the issues routes", (it) => {
  it.effect("a member files issues numbered one and two, and lists both", () =>
    Effect.gen(function* () {
      const { owner, workspaceId, ask } = yield* openAccounts;
      const file = (title: string) =>
        ask("/api/issues", owner, { method: "POST", body: { workspaceId, title } });

      const first = readAnswer(issueAnswerSchema, HOSTED_HTTP_STATUS.CREATED, yield* file("One"));
      const second = readAnswer(issueAnswerSchema, HOSTED_HTTP_STATUS.CREATED, yield* file("Two"));
      const listed = readAnswer(
        issueListAnswerSchema,
        HOSTED_HTTP_STATUS.OK,
        yield* ask(`/api/issues?workspaceId=${workspaceId}`, owner),
      );

      assert.deepEqual([first.issue.number, second.issue.number], [1, 2]);
      assert.deepEqual(first.issue.creator, { userId: owner, name: "Test User" });
      assert.deepEqual(listed.issues.map((issue) => issue.title).toSorted(), ["One", "Two"]);
    }),
  );

  it.effect("an account outside the workspace is answered not found on every path", () =>
    Effect.gen(function* () {
      const { owner, outsider, workspaceId, ask } = yield* openAccounts;
      const made = readAnswer(
        issueAnswerSchema,
        HOSTED_HTTP_STATUS.CREATED,
        yield* ask("/api/issues", owner, { method: "POST", body: { workspaceId, title: "Ours" } }),
      );

      const listed = yield* ask(`/api/issues?workspaceId=${workspaceId}`, outsider);
      const filed = yield* ask("/api/issues", outsider, {
        method: "POST",
        body: { workspaceId, title: "Theirs" },
      });
      const read = yield* ask(`/api/issues/${made.issue.id}`, outsider);
      const changed = yield* ask(`/api/issues/${made.issue.id}`, outsider, {
        method: "PATCH",
        body: { title: "Taken" },
      });
      const kept = readAnswer(
        issueAnswerSchema,
        HOSTED_HTTP_STATUS.OK,
        yield* ask(`/api/issues/${made.issue.id}`, owner),
      );

      const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);
      assert.deepEqual(listed, notFound);
      assert.deepEqual(filed, notFound);
      assert.deepEqual(read, notFound);
      assert.deepEqual(changed, notFound);
      assert.equal(kept.issue.title, "Ours");
    }),
  );

  it.effect("a change lands, and the answer is the issue as kept", () =>
    Effect.gen(function* () {
      const { owner, workspaceId, ask } = yield* openAccounts;
      const made = readAnswer(
        issueAnswerSchema,
        HOSTED_HTTP_STATUS.CREATED,
        yield* ask("/api/issues", owner, { method: "POST", body: { workspaceId, title: "Bug" } }),
      );

      const changed = readAnswer(
        issueAnswerSchema,
        HOSTED_HTTP_STATUS.OK,
        yield* ask(`/api/issues/${made.issue.id}`, owner, {
          method: "PATCH",
          body: { status: ISSUE_STATUS.IN_PROGRESS, priority: ISSUE_PRIORITY.HIGH },
        }),
      );
      const read = readAnswer(
        issueAnswerSchema,
        HOSTED_HTTP_STATUS.OK,
        yield* ask(`/api/issues/${made.issue.id}`, owner),
      );

      assert.equal(changed.issue.status, ISSUE_STATUS.IN_PROGRESS);
      assert.equal(changed.issue.priority, ISSUE_PRIORITY.HIGH);
      assert.deepEqual(read.issue, changed.issue);
    }),
  );

  it.effect("an archived issue leaves the list and stands in the archived one", () =>
    Effect.gen(function* () {
      const { owner, workspaceId, ask } = yield* openAccounts;
      const made = readAnswer(
        issueAnswerSchema,
        HOSTED_HTTP_STATUS.CREATED,
        yield* ask("/api/issues", owner, { method: "POST", body: { workspaceId, title: "Old" } }),
      );

      readAnswer(
        issueAnswerSchema,
        HOSTED_HTTP_STATUS.OK,
        yield* ask(`/api/issues/${made.issue.id}`, owner, {
          method: "PATCH",
          body: { archived: true },
        }),
      );
      const standing = readAnswer(
        issueListAnswerSchema,
        HOSTED_HTTP_STATUS.OK,
        yield* ask(`/api/issues?workspaceId=${workspaceId}`, owner),
      );
      const archived = readAnswer(
        issueListAnswerSchema,
        HOSTED_HTTP_STATUS.OK,
        yield* ask(`/api/issues?workspaceId=${workspaceId}&archived=true`, owner),
      );

      assert.deepEqual(standing.issues, []);
      assert.deepEqual(
        archived.issues.map((issue) => issue.id),
        [made.issue.id],
      );
    }),
  );

  it.effect(
    "a body that is no issue, a list that names no workspace, a change that names nothing, and a method the path does not take are refused",
    () =>
      Effect.gen(function* () {
        const { owner, workspaceId, ask } = yield* openAccounts;
        const made = readAnswer(
          issueAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask("/api/issues", owner, { method: "POST", body: { workspaceId, title: "Bug" } }),
        );

        const blank = yield* ask("/api/issues", owner, {
          method: "POST",
          body: { workspaceId, title: "   " },
        });
        const extraKey = yield* ask("/api/issues", owner, {
          method: "POST",
          body: { workspaceId, title: "Bug", number: 7 },
        });
        const unnamed = yield* ask("/api/issues", owner);
        const notABoolean = yield* ask(
          `/api/issues?workspaceId=${workspaceId}&archived=maybe`,
          owner,
        );
        const empty = yield* ask(`/api/issues/${made.issue.id}`, owner, {
          method: "PATCH",
          body: {},
        });
        const unknownStatus = yield* ask(`/api/issues/${made.issue.id}`, owner, {
          method: "PATCH",
          body: { status: "blocked" },
        });
        const deleted = yield* ask(`/api/issues/${made.issue.id}`, owner, { method: "DELETE" });
        const put = yield* ask("/api/issues", owner, { method: "PUT", body: {} });

        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
        const notAllowed = refusal(
          HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
          HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
        );
        assert.deepEqual(blank, invalid);
        assert.deepEqual(extraKey, invalid);
        assert.deepEqual(unnamed, invalid);
        assert.deepEqual(notABoolean, invalid);
        assert.deepEqual(empty, invalid);
        assert.deepEqual(unknownStatus, invalid);
        assert.deepEqual(deleted, notAllowed);
        assert.deepEqual(put, notAllowed);
      }),
  );

  it.effect("a bearer that names no account is refused before anything is read", () =>
    Effect.gen(function* () {
      const { workspaceId, ask } = yield* openAccounts;

      const unsigned = yield* ask(`/api/issues?workspaceId=${workspaceId}`, "nobody");

      assert.deepEqual(
        unsigned,
        refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN),
      );
    }),
  );
});
