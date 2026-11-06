import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import {
  DESCRIPTION_COMMENT_OUTCOME,
  startDescriptionCommentThread,
} from "@repo/database/models/description-comments";
import { createTask, saveDescriptionText } from "@repo/database/models/task-store";
import { attachment } from "@repo/database/schemas/attachment";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, joinWorkspace, openWorkspace } from "@repo/database/testing";
import { AGENT_ATTACHMENT_TYPE } from "@repo/features/agent-wire";
import { PICTURE_BOUNDS, PICTURE_MEDIA_TYPE, PICTURE_TYPE } from "@repo/features/picture-wire";
import {
  DESCRIPTION_ATTACHMENT_BOUNDS,
  DESCRIPTION_ATTACHMENT_REFUSAL,
  descriptionAttachmentAnswerSchema,
} from "@repo/features/description-attachment-wire";
import {
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_SCOPE,
} from "@repo/features/description-comment-wire";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "@repo/service/http/http";
import type { UserIdResolver } from "@repo/service/http/http-effect";
import { hostedFetch } from "@repo/service/orpc/handler";
import { modelCatalogOf } from "@repo/service/providers/model-catalog";
import type { WebServices } from "@repo/service/runtime";
import { taskFilesProcedures } from "@repo/service/tasks/task-files-procedures";
import { tasksApp } from "@repo/service/tasks/tasks-app";
import {
  type OpenedPagePolicy,
  openedPagePolicy,
  SANDBOXED_PAGE,
} from "@repo/service/testing/content-policy";
import { NO_GITHUB } from "@repo/service/testing/github-app-fake";
import {
  CONNECTOR_ASKED_NOTHING,
  integrationConnectOf,
} from "@repo/service/testing/integration-connect";
import { unparsedWire } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { paddedTo, webmBytes } from "@repo/wire/testing";
import { Clock, type Context, Effect, Layer, Option, Result } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";

const ORIGIN = "https://app.test";
const ATTACHMENT = "/api/plans/attachment";

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);
const PNG_URL = `data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}`;

interface Answered {
  readonly status: number;
  readonly contentType: string | null;
  readonly cache: string | null;
  readonly policy: OpenedPagePolicy;
  readonly bytes: Uint8Array;
}

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

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
    const resolveUserId: UserIdResolver = (incoming) =>
      Effect.succeed(
        Option.fromNullishOr(incoming.headers.get("authorization")?.replace("Bearer ", "")),
      );
    const { handler, dispose } = HttpRouter.toWebHandler(
      tasksApp({ resolveUserId }).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const keep = hostedFetch({ taskFiles: taskFilesProcedures({ resolveUserId }) });
    const webServices = (yield* Effect.scoped(
      Layer.build(services),
    )) as Context.Context<WebServices>;
    const response = yield* Effect.promise(() =>
      request.method === "POST" ? keep(request, webServices) : handler(request),
    );
    const bytes = new Uint8Array(yield* Effect.promise(() => response.arrayBuffer()));
    yield* Effect.promise(() => dispose());
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      cache: response.headers.get("cache-control"),
      policy: openedPagePolicy(response.headers),
      bytes,
    } satisfies Answered;
  });

function upload(
  taskId: string,
  userId: string | undefined,
  body: string,
  headers: Readonly<Record<string, string>> = {},
): Request {
  return new Request(new URL(`/api/plans/${taskId}/attachments`, ORIGIN), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(userId === undefined ? undefined : { authorization: `Bearer ${userId}` }),
      ...headers,
    },
    body,
  });
}

function pictureBody(picture: string): string {
  return JSON.stringify({ picture });
}

function read(taskId: string, attachmentId: string, userId: string): Request {
  const url = new URL(ATTACHMENT, ORIGIN);
  url.searchParams.set("id", taskId);
  url.searchParams.set("attachment", attachmentId);
  return new Request(url, { headers: { authorization: `Bearer ${userId}` } });
}

function uploaded(answered: Answered) {
  const answer = readEither(descriptionAttachmentAnswerSchema)(
    unparsedWire(JSON.parse(new TextDecoder().decode(answered.bytes))),
  );
  if (Result.isFailure(answer)) return assert.fail(answer.failure.refusal);
  return answer.success;
}

const openSharedTask = Effect.gen(function* () {
  const owner = yield* openAccount;
  const teammate = yield* openAccount;
  const outsider = yield* openAccount;
  const workspace = yield* openWorkspace(owner);
  yield* joinWorkspace(workspace, teammate);
  const { id: taskId } = yield* createTask(owner, { organizationId: workspace, name: "Invites" });
  return { owner, teammate, outsider, planId: taskId };
});

it.layer(getTestDB())("a description's picture routes", (it) => {
  it.effect(
    "a file a teammate's comment carries is served to every member as its bytes, and to nobody else",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, outsider, planId: taskId } = yield* openSharedTask;
        const text = "## Goal\n\nInvites expire in seven days.\n";
        yield* saveDescriptionText(owner, taskId, text);
        const pdf = new TextEncoder().encode("%PDF-1.4\n");
        const from = text.indexOf("seven days");
        const started = yield* startDescriptionCommentThread(
          { actor: DESCRIPTION_COMMENT_ACTOR.MEMBER, userId: teammate },
          taskId,
          {
            clientKey: randomUUID(),
            scope: DESCRIPTION_COMMENT_SCOPE.WORDS,
            quote: "seven days",
            anchor: { from, to: from + "seven days".length },
            text,
            words: "The flow is attached.",
            attachments: [
              {
                name: "flow.pdf",
                mediaType: AGENT_ATTACHMENT_TYPE.PDF,
                data: Buffer.from(pdf).toString("base64"),
              },
            ],
          },
        );
        assert.ok(
          started.status === DESCRIPTION_COMMENT_OUTCOME.DONE && "thread" in started.answer,
        );
        const fileId = started.answer.thread.entries[0]?.files?.[0]?.attachmentId;
        assert.ok(fileId !== undefined);

        const served = yield* ask(read(taskId, fileId, owner));
        assert.equal(served.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(served.contentType, AGENT_ATTACHMENT_TYPE.PDF);
        assert.equal(served.cache, "private, no-store");
        assert.deepEqual(served.policy, SANDBOXED_PAGE);
        assert.deepEqual([...served.bytes], [...pdf]);
        assert.equal(
          (yield* ask(read(taskId, fileId, outsider))).status,
          HOSTED_HTTP_STATUS.NOT_FOUND,
        );
      }),
  );

  it.effect(
    "a picture a teammate keeps on the description is served to every member as its bytes, and to nobody else",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, outsider, planId: taskId } = yield* openSharedTask;

        const kept = yield* ask(upload(taskId, teammate, pictureBody(PNG_URL)));

        assert.equal(kept.status, HOSTED_HTTP_STATUS.CREATED);
        const answer = uploaded(kept);
        assert.ok("id" in answer);
        const served = yield* ask(read(taskId, answer.id, owner));
        assert.equal(served.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(served.contentType, PICTURE_TYPE.PNG);
        assert.equal(served.cache, "private, no-store");
        assert.deepEqual(served.policy, SANDBOXED_PAGE);
        assert.deepEqual([...served.bytes], [...PNG_BYTES]);
        assert.equal(
          (yield* ask(read(taskId, answer.id, outsider))).status,
          HOSTED_HTTP_STATUS.NOT_FOUND,
        );
        assert.equal(
          (yield* ask(upload(taskId, outsider, pictureBody(PNG_URL)))).status,
          HOSTED_HTTP_STATUS.NOT_FOUND,
        );
      }),
  );

  it.effect("bytes that are not the image their label names are refused, and nothing is kept", () =>
    Effect.gen(function* () {
      const { owner, planId: taskId } = yield* openSharedTask;
      const mislabeled = PNG_URL.replace("image/png", "image/webp");

      const refused = yield* ask(upload(taskId, owner, pictureBody(mislabeled)));

      assert.equal(refused.status, HOSTED_HTTP_STATUS.BAD_REQUEST);
      assert.equal(
        JSON.parse(new TextDecoder().decode(refused.bytes)).error,
        HOSTED_API_ERROR.INVALID_REQUEST,
      );
    }),
  );

  it.effect(
    "an upload refuses as the old route did, byte for byte: no bearer before its body is read, a key the upload does not name, and a body past its bound",
    () =>
      Effect.gen(function* () {
        const { owner, planId: taskId } = yield* openSharedTask;
        const bare = (answered: Answered) => ({
          status: answered.status,
          contentType: answered.contentType,
          cache: answered.cache,
          text: new TextDecoder().decode(answered.bytes),
        });
        const json = "application/json";

        assert.deepEqual(bare(yield* ask(upload(taskId, undefined, '{"picture":7}'))), {
          status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
          contentType: json,
          cache: null,
          text: '{"error":"invalid-token"}',
        });
        assert.deepEqual(
          bare(yield* ask(upload(taskId, owner, JSON.stringify({ picture: PNG_URL, extra: 1 })))),
          {
            status: HOSTED_HTTP_STATUS.BAD_REQUEST,
            contentType: json,
            cache: null,
            text: '{"error":"invalid-request"}',
          },
        );
        assert.deepEqual(
          bare(
            yield* ask(
              upload(taskId, owner, pictureBody(PNG_URL), {
                "content-length": String(
                  Math.ceil(PICTURE_BOUNDS.MAX_SENT_VIDEO_BYTES / 3) * 4 + 1_025,
                ),
              }),
            ),
          ),
          {
            status: HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE,
            contentType: json,
            cache: null,
            text: '{"error":"request-too-large"}',
          },
        );
        assert.deepEqual(bare(yield* ask(upload("not-a-plan", owner, pictureBody(PNG_URL)))), {
          status: HOSTED_HTTP_STATUS.NOT_FOUND,
          contentType: json,
          cache: null,
          text: '{"error":"not-found"}',
        });
      }),
  );

  it.effect("a description holding its bound of pictures refuses one more in band", () =>
    Effect.gen(function* () {
      const { owner, planId: taskId } = yield* openSharedTask;
      const db = yield* Database;
      yield* db.insert(attachment).values(
        Array.from({ length: DESCRIPTION_ATTACHMENT_BOUNDS.MAX_PER_DESCRIPTION }, () => ({
          taskId: taskId,
          userId: owner,
          contentType: PICTURE_TYPE.PNG,
          byteCount: PNG_BYTES.length,
          bytes: PNG_BYTES,
          createdAt: new Date(0),
        })),
      );

      const refused = yield* ask(upload(taskId, owner, pictureBody(PNG_URL)));

      assert.equal(refused.status, HOSTED_HTTP_STATUS.OK);
      assert.deepEqual(uploaded(refused), { refused: DESCRIPTION_ATTACHMENT_REFUSAL.TOO_MANY });
    }),
  );

  it.effect(
    "a recording a member keeps is served as the video it was sent, and one past a sent video's bound, or past the description's videos, is not kept",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, planId: taskId } = yield* openSharedTask;
        const recording = webmBytes(1280, 800);
        const videoUrl = (bytes: Uint8Array) =>
          `data:${PICTURE_MEDIA_TYPE.WEBM};base64,${Buffer.from(bytes).toString("base64")}`;

        const kept = uploaded(yield* ask(upload(taskId, owner, pictureBody(videoUrl(recording)))));
        assert.ok("id" in kept);
        const served = yield* ask(read(taskId, kept.id, teammate));
        const long = paddedTo(recording, PICTURE_BOUNDS.MAX_SENT_VIDEO_BYTES + 1);
        const tooLong = yield* ask(upload(taskId, owner, pictureBody(videoUrl(long))));
        const db = yield* Database;
        yield* db.insert(attachment).values(
          Array.from(
            { length: DESCRIPTION_ATTACHMENT_BOUNDS.MAX_VIDEOS_PER_DESCRIPTION - 1 },
            () => ({
              taskId: taskId,
              userId: owner,
              contentType: PICTURE_MEDIA_TYPE.WEBM,
              byteCount: recording.length,
              bytes: recording,
              createdAt: new Date(0),
            }),
          ),
        );
        const past = yield* ask(upload(taskId, owner, pictureBody(videoUrl(recording))));

        assert.equal(served.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(served.contentType, PICTURE_MEDIA_TYPE.WEBM);
        assert.deepEqual([...served.bytes], [...recording]);
        assert.equal(tooLong.status, HOSTED_HTTP_STATUS.BAD_REQUEST);
        assert.equal(past.status, HOSTED_HTTP_STATUS.OK);
        assert.deepEqual(uploaded(past), {
          refused: DESCRIPTION_ATTACHMENT_REFUSAL.TOO_MANY_VIDEOS,
        });
        assert.ok("id" in uploaded(yield* ask(upload(taskId, owner, pictureBody(PNG_URL)))));
      }),
  );
});
