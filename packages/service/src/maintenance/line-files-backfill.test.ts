import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { user } from "@luke/database/schemas/auth";
import { conversations, messages } from "@luke/database/schemas/storage";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import { getTestDB } from "@luke/database/testing";
import { HOSTED_API_ERROR } from "@luke/features";
import { CODING_AGENT_ATTACHMENT_TYPE } from "@luke/features/coding-agent-wire";
import { MESSAGE_ROLE } from "@luke/wire";
import { Effect, Redacted } from "effect";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { handleLineFilesBackfill, type LineFilesBackfillOptions } from "./line-files-backfill.js";

/**
 * The backfill of lines' inline files as its endpoint answers it, over a
 * real dialect: under the deployment's secret alone, a GET counts what is
 * still inline and moves nothing, a POST moves it all and says nothing
 * remains, and a POST again moves nothing. Synthetic accounts and bytes.
 */

const SECRET = "cron-secret-for-this-test";

/** A row written as a line was before the move: words, then two files inline. */
const inlineRow = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const [conversation] = yield* db
    .insert(conversations)
    .values({ userId, kind: CONVERSATION_KIND.CODING_AGENT })
    .returning({ id: conversations.id });
  assert.ok(conversation);
  const file = (mediaType: string, bytes: Buffer) => ({
    type: "file" as const,
    mediaType,
    filename: "file",
    url: `data:${mediaType};base64,${bytes.toString("base64")}`,
  });
  yield* db.insert(messages).values({
    userId,
    conversationId: conversation.id,
    seq: 1,
    clientId: randomUUID(),
    role: MESSAGE_ROLE.USER,
    parts: [
      { type: "text", text: "Look at these.", state: "done" },
      file(CODING_AGENT_ATTACHMENT_TYPE.PNG, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1])),
      file(CODING_AGENT_ATTACHMENT_TYPE.TEXT, Buffer.from("notes\n")),
    ],
    placedAt: new Date(),
  });
});

it.layer(getTestDB())("the backfill of lines' inline files", (it) => {
  it.effect(
    "is refused without the deployment's secret, counts on a GET, moves everything on a POST, and moves nothing the second time",
    () =>
      Effect.gen(function* () {
        yield* inlineRow;
        yield* inlineRow;
        const ask = (
          init: { method?: string; bearer?: string },
          held: Pick<LineFilesBackfillOptions, "cronSecret"> = {
            cronSecret: Redacted.make(SECRET),
          },
        ) =>
          Effect.gen(function* () {
            const response = yield* handleLineFilesBackfill({
              request: new Request("https://luke.test/api/maintenance/inline-attachments", {
                method: init.method ?? "POST",
                headers:
                  init.bearer === undefined ? {} : { authorization: `Bearer ${init.bearer}` },
              }),
              ...held,
            });
            return { status: response.status, body: yield* Effect.promise(() => response.json()) };
          });

        assert.deepEqual(yield* ask({ method: "DELETE", bearer: SECRET }), {
          status: HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
          body: { error: HOSTED_API_ERROR.METHOD_NOT_ALLOWED },
        });
        for (const refused of [yield* ask({}), yield* ask({ bearer: "not-the-secret" })]) {
          assert.deepEqual(refused, {
            status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
            body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
          });
        }
        assert.deepEqual(yield* ask({ bearer: SECRET }, { cronSecret: undefined }), {
          status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
          body: { error: HOSTED_API_ERROR.UNAVAILABLE },
        });

        assert.deepEqual(yield* ask({ method: "GET", bearer: SECRET }), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { remainingRows: 2, remainingParts: 4 },
        });
        assert.deepEqual(yield* ask({ bearer: SECRET }), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { moved: 2, read: 2, remainingRows: 0, remainingParts: 0 },
        });
        assert.deepEqual(yield* ask({ bearer: SECRET }), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { moved: 0, read: 0, remainingRows: 0, remainingParts: 0 },
        });
      }),
  );
});
