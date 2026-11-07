import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { DESCRIPTION_ATTACHMENT_BOUNDS } from "@repo/features/description-attachment-wire";
import {
  PICTURE_BOUNDS,
  PICTURE_MEDIA_TYPE,
  PICTURE_TYPE,
  type Picture,
} from "@repo/features/picture-wire";
import { paddedTo, pngBytes, webmBytes } from "@repo/wire/testing";
import { Effect, Exit, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, joinWorkspace, openWorkspace } from "../../testing/index.js";
import {
  DESCRIPTION_ATTACHMENT_KEEP,
  keepDescriptionAttachment,
  readDescriptionAttachment,
} from "../description-attachments.js";
import { createTask } from "../task-store.js";

/**
 * A description's pictures over a real dialect: kept by a member, read by every
 * member of the plan's workspace and by nobody else, held to the description's
 * bound, a video among them to a video's bound and the description's count of
 * videos, and refused on a plan the account does not reach.
 *
 * Synthetic accounts and pictures throughout.
 */

/** A picture's bytes: a PNG's signature and a few more, which is all the store reads of them. */
const PICTURE: Picture = {
  contentType: PICTURE_TYPE.PNG,
  bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]),
};

/** A recording an agent made, as small as a WebM that states its size may be. */
const VIDEO: Picture = { contentType: PICTURE_MEDIA_TYPE.WEBM, bytes: webmBytes(1280, 800) };

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

/** A plan in a workspace the owner made and the teammate joined, and an account in neither. */
const openSharedTask = Effect.gen(function* () {
  const owner = yield* openAccount;
  const teammate = yield* openAccount;
  const outsider = yield* openAccount;
  const workspace = yield* openWorkspace(owner);
  yield* joinWorkspace(workspace, teammate);
  const { id: taskId } = yield* createTask(owner, { organizationId: workspace, name: "Invites" });
  return { owner, teammate, outsider, taskId };
});

/** The id a keep answered, failing the test where it kept nothing. */
function keptId(kept: { readonly status: string; readonly id?: string }): string {
  assert.equal(kept.status, DESCRIPTION_ATTACHMENT_KEEP.KEPT);
  assert.ok(kept.id);
  return kept.id;
}

it.layer(getTestDB())("a description's pictures", (it) => {
  it.effect(
    "a picture a teammate pasted reads for every member of the plan's workspace, and as nothing for anyone else",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, outsider, taskId } = yield* openSharedTask;

        const id = keptId(yield* keepDescriptionAttachment(teammate, taskId, PICTURE));

        const read = yield* readDescriptionAttachment(owner, taskId, id);
        assert.ok(Option.isSome(read));
        assert.equal(read.value.contentType, PICTURE_TYPE.PNG);
        assert.deepEqual([...read.value.bytes], [...PICTURE.bytes]);
        assert.ok(Option.isNone(yield* readDescriptionAttachment(outsider, taskId, id)));
        assert.equal(
          (yield* keepDescriptionAttachment(outsider, taskId, PICTURE)).status,
          DESCRIPTION_ATTACHMENT_KEEP.NO_TASK,
        );
      }),
  );

  it.effect("a picture is read only under the description it was kept on", () =>
    Effect.gen(function* () {
      const first = yield* openSharedTask;
      const second = yield* openSharedTask;
      const id = keptId(yield* keepDescriptionAttachment(first.owner, first.taskId, PICTURE));

      assert.ok(Option.isNone(yield* readDescriptionAttachment(second.owner, second.taskId, id)));
    }),
  );

  it.effect(
    "a description keeps no more pictures than its bound, and one the account does not reach keeps none",
    () =>
      Effect.gen(function* () {
        const { owner, taskId } = yield* openSharedTask;
        for (let kept = 0; kept < DESCRIPTION_ATTACHMENT_BOUNDS.MAX_PER_DESCRIPTION; kept += 1) {
          keptId(yield* keepDescriptionAttachment(owner, taskId, PICTURE));
        }

        assert.equal(
          (yield* keepDescriptionAttachment(owner, taskId, PICTURE)).status,
          DESCRIPTION_ATTACHMENT_KEEP.TOO_MANY,
        );

        const other = yield* openSharedTask;
        assert.equal(
          (yield* keepDescriptionAttachment(owner, other.taskId, PICTURE)).status,
          DESCRIPTION_ATTACHMENT_KEEP.NO_TASK,
        );
      }),
  );

  it.effect(
    "a recording is kept as it was sent up to a video's bound, which a picture is not",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, taskId } = yield* openSharedTask;
        const video: Picture = {
          contentType: PICTURE_MEDIA_TYPE.WEBM,
          bytes: paddedTo(webmBytes(1280, 800), PICTURE_BOUNDS.MAX_VIDEO_BYTES),
        };

        const id = keptId(yield* keepDescriptionAttachment(owner, taskId, video));

        const read = yield* readDescriptionAttachment(teammate, taskId, id);
        assert.ok(Option.isSome(read));
        assert.equal(read.value.contentType, PICTURE_MEDIA_TYPE.WEBM);
        assert.equal(read.value.bytes.length, PICTURE_BOUNDS.MAX_VIDEO_BYTES);
        const tooLong = {
          ...video,
          bytes: paddedTo(video.bytes, PICTURE_BOUNDS.MAX_VIDEO_BYTES + 1),
        };
        assert.ok(
          Exit.isFailure(yield* Effect.exit(keepDescriptionAttachment(owner, taskId, tooLong))),
        );
        const large: Picture = {
          contentType: PICTURE_TYPE.PNG,
          bytes: paddedTo(pngBytes(4000, 3000), PICTURE_BOUNDS.MAX_BYTES + 1),
        };
        assert.ok(
          Exit.isFailure(yield* Effect.exit(keepDescriptionAttachment(owner, taskId, large))),
        );
      }),
  );

  it.effect(
    "a description keeps no more videos than its bound of them, and pictures still beside them",
    () =>
      Effect.gen(function* () {
        const { owner, taskId } = yield* openSharedTask;
        for (
          let kept = 0;
          kept < DESCRIPTION_ATTACHMENT_BOUNDS.MAX_VIDEOS_PER_DESCRIPTION;
          kept += 1
        ) {
          keptId(yield* keepDescriptionAttachment(owner, taskId, VIDEO));
        }

        assert.equal(
          (yield* keepDescriptionAttachment(owner, taskId, VIDEO)).status,
          DESCRIPTION_ATTACHMENT_KEEP.TOO_MANY_VIDEOS,
        );
        keptId(yield* keepDescriptionAttachment(owner, taskId, PICTURE));
      }),
  );
});
