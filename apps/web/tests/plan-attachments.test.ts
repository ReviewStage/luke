import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { createTask } from "@luke/database/models/task-store";
import { user } from "@luke/database/schemas/auth";
import { planAttachment } from "@luke/database/schemas/plan-attachment";
import {
  fakeWorkspaceSeams,
  getTestDB,
  joinWorkspace,
  openWorkspace,
} from "@luke/database/testing";
import { PICTURE_TYPE } from "@luke/features/picture-wire";
import {
  PLAN_ATTACHMENT_BOUNDS,
  PLAN_ATTACHMENT_REFUSAL,
  planAttachmentAnswerSchema,
} from "@luke/features/plan-attachment-wire";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "@luke/service/http/http";
import { modelCatalogOf } from "@luke/service/providers/model-catalog";
import { tasksApp } from "@luke/service/tasks/tasks-app";
import { NO_GITHUB } from "@luke/service/testing/github-app-fake";
import {
  CONNECTOR_ASKED_NOTHING,
  integrationConnectOf,
} from "@luke/service/testing/integration-connect";
import { unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Clock, Effect, Layer, Option, Result } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";

/**
 * A plan's pictures through the routes a desktop calls, over a real
 * dialect: a member keeps a picture on a teammate's plan and every member
 * of the workspace reads its bytes back under the type they were sniffed
 * to be, never cached on the way; an account outside the workspace keeps
 * and reads nothing, exactly as for a plan that does not exist; bytes that
 * are not the image their label names are refused; and a plan at its bound
 * refuses in band.
 *
 * Synthetic accounts, bearers, and pictures throughout.
 */

const ORIGIN = "https://luke.test";
const ATTACHMENTS = "/api/plans/attachments";
const ATTACHMENT = "/api/plans/attachment";

/** A PNG's signature and a few bytes more: all the service reads of a picture. */
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);
const PNG_URL = `data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}`;

/** What a route answered: its status, type, cache rule, and body as bytes. */
interface Answered {
  readonly status: number;
  readonly contentType: string | null;
  readonly cache: string | null;
  readonly policy: string | null;
  readonly bytes: Uint8Array;
}

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

/** The plan routes over the test's own database, every bearer `Bearer <account>`, answering one request. */
const ask = (request: Request) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      NO_GITHUB,
      modelCatalogOf([]),
      integrationConnectOf(() => CONNECTOR_ASKED_NOTHING),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(
      tasksApp({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(incoming.headers.get("authorization")?.replace("Bearer ", "")),
          ),
        workspaces: yield* fakeWorkspaceSeams,
        eveOrigin: () => undefined,
      }).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const response = yield* Effect.promise(() => handler(request));
    const bytes = new Uint8Array(yield* Effect.promise(() => response.arrayBuffer()));
    yield* Effect.promise(() => dispose());
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      cache: response.headers.get("cache-control"),
      policy: response.headers.get("content-security-policy"),
      bytes,
    } satisfies Answered;
  });

function upload(planId: string, userId: string, picture: string): Request {
  const url = new URL(ATTACHMENTS, ORIGIN);
  url.searchParams.set("id", planId);
  return new Request(url, {
    method: "POST",
    headers: { authorization: `Bearer ${userId}` },
    body: JSON.stringify({ picture }),
  });
}

function read(planId: string, attachmentId: string, userId: string): Request {
  const url = new URL(ATTACHMENT, ORIGIN);
  url.searchParams.set("id", planId);
  url.searchParams.set("attachment", attachmentId);
  return new Request(url, { headers: { authorization: `Bearer ${userId}` } });
}

/** An answer's JSON body as the upload's wire reads it, failing the test where it does not. */
function uploaded(answered: Answered) {
  const answer = readEither(planAttachmentAnswerSchema)(
    unparsedWire(JSON.parse(new TextDecoder().decode(answered.bytes))),
  );
  if (Result.isFailure(answer)) return assert.fail(answer.failure.refusal);
  return answer.success;
}

/** A plan in a workspace the owner made and the teammate joined, and an account in neither. */
const openSharedTask = Effect.gen(function* () {
  const owner = yield* openAccount;
  const teammate = yield* openAccount;
  const outsider = yield* openAccount;
  const workspace = yield* openWorkspace(owner);
  yield* joinWorkspace(workspace, teammate);
  const { id: planId } = yield* createTask(owner, { organizationId: workspace, name: "Invites" });
  return { owner, teammate, outsider, planId };
});

it.layer(getTestDB())("a plan's picture routes", (it) => {
  it.effect(
    "a picture a teammate keeps on the plan is served to every member as its bytes, and to nobody else",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, outsider, planId } = yield* openSharedTask;

        const kept = yield* ask(upload(planId, teammate, PNG_URL));

        assert.equal(kept.status, HOSTED_HTTP_STATUS.CREATED);
        const answer = uploaded(kept);
        assert.ok("id" in answer);
        const served = yield* ask(read(planId, answer.id, owner));
        assert.equal(served.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(served.contentType, PICTURE_TYPE.PNG);
        assert.equal(served.cache, "private, no-store");
        // Note that a page a browser opens from the bytes runs no script and stands in an origin of its own.
        assert.equal(served.policy, "default-src 'none'; style-src 'unsafe-inline'; sandbox");
        assert.deepEqual([...served.bytes], [...PNG_BYTES]);
        assert.equal(
          (yield* ask(read(planId, answer.id, outsider))).status,
          HOSTED_HTTP_STATUS.NOT_FOUND,
        );
        assert.equal(
          (yield* ask(upload(planId, outsider, PNG_URL))).status,
          HOSTED_HTTP_STATUS.NOT_FOUND,
        );
      }),
  );

  it.effect("bytes that are not the image their label names are refused, and nothing is kept", () =>
    Effect.gen(function* () {
      const { owner, planId } = yield* openSharedTask;
      const mislabelled = PNG_URL.replace("image/png", "image/webp");

      const refused = yield* ask(upload(planId, owner, mislabelled));

      assert.equal(refused.status, HOSTED_HTTP_STATUS.BAD_REQUEST);
      assert.equal(
        JSON.parse(new TextDecoder().decode(refused.bytes)).error,
        HOSTED_API_ERROR.INVALID_REQUEST,
      );
    }),
  );

  it.effect("a plan holding its bound of pictures refuses one more in band", () =>
    Effect.gen(function* () {
      const { owner, planId } = yield* openSharedTask;
      const db = yield* Database;
      yield* db.insert(planAttachment).values(
        Array.from({ length: PLAN_ATTACHMENT_BOUNDS.MAX_PER_PLAN }, () => ({
          taskId: planId,
          userId: owner,
          contentType: PICTURE_TYPE.PNG,
          byteCount: PNG_BYTES.length,
          bytes: PNG_BYTES,
          createdAt: new Date(0),
        })),
      );

      const refused = yield* ask(upload(planId, owner, PNG_URL));

      assert.equal(refused.status, HOSTED_HTTP_STATUS.OK);
      assert.deepEqual(uploaded(refused), { refused: PLAN_ATTACHMENT_REFUSAL.TOO_MANY });
    }),
  );
});
