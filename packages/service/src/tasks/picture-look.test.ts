import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import {
  DESCRIPTION_ATTACHMENT_KEEP,
  keepDescriptionAttachment,
} from "@repo/database/models/description-attachments";
import { createTask } from "@repo/database/models/task-store";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, joinWorkspace, openWorkspace } from "@repo/database/testing";
import { descriptionAttachmentAddress } from "@repo/features/description-attachment-link";
import { PICTURE_MEDIA_TYPE, PICTURE_TYPE, type Picture } from "@repo/features/picture-wire";
import { unparsedWire } from "@repo/wire";
import { webmBytes } from "@repo/wire/testing";
import { Effect } from "effect";
import { Base64 } from "effect/encoding";
import type { DescriptionDocumentBinding } from "./description-notes.js";
import {
  lookNamedOnly,
  PICTURE_LOOK_REFUSAL,
  PICTURE_LOOK_STATUS,
  pictureNotLooked,
  runLookAtPicture,
} from "./picture-look.js";

/**
 * `look_at_picture`, the planning model's and a coding agent's look at one
 * of the description's pictures, through its public functions against a real
 * dialect: a member's look hands the model the picture as an image while
 * the conversation keeps only that it looked; a picture of another description, one
 * the description does not hold, and one read by an account outside the plan's
 * workspace are refused alike; a video is refused, and its bytes reach no
 * model in any form; and a turn looks as often as it asks. The
 * model is the boundary, played by reading what it would be shown.
 *
 * Synthetic accounts and pictures throughout.
 */

/** A picture's bytes: a PNG's signature and a few more, which is all the store reads of them. */
const PICTURE: Picture = {
  contentType: PICTURE_TYPE.PNG,
  bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]),
};

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

/** Two plans in a workspace the owner made and the teammate joined, a picture the teammate pasted into the first, and an account in neither. */
const openPicturedTasks = Effect.gen(function* () {
  const owner = yield* openAccount;
  const teammate = yield* openAccount;
  const outsider = yield* openAccount;
  const workspace = yield* openWorkspace(owner);
  yield* joinWorkspace(workspace, teammate);
  const task = yield* createTask(owner, { organizationId: workspace, name: "Invites" });
  const other = yield* createTask(owner, { organizationId: workspace, name: "Billing" });
  const kept = yield* keepDescriptionAttachment(teammate, task.id, PICTURE);
  if (kept.status !== DESCRIPTION_ATTACHMENT_KEEP.KEPT)
    return assert.fail("the picture was not kept");
  const address = descriptionAttachmentAddress({ taskId: task.id, attachmentId: kept.id }, "acme");
  return { owner, outsider, planId: task.id, otherId: other.id, attachmentId: kept.id, address };
});

/** A look as a turn makes one: bound to the description as the account. */
function lookCall(userId: string, taskId: string): DescriptionDocumentBinding {
  return { userId, taskId: taskId };
}

const look = (call: DescriptionDocumentBinding, address: string) =>
  runLookAtPicture(call, unparsedWire({ address }));

it.layer(getTestDB())("look_at_picture", (it) => {
  it.effect("a member's look answers the picture, its type and its bytes", () =>
    Effect.gen(function* () {
      const { owner, planId: taskId, address } = yield* openPicturedTasks;
      const base64 = Base64.encode(PICTURE.bytes);

      const answered = yield* look(lookCall(owner, taskId), address);

      assert.deepEqual(answered, {
        status: PICTURE_LOOK_STATUS.LOOKED,
        mediaType: PICTURE_TYPE.PNG,
        image: base64,
      });
    }),
  );

  it.effect(
    "a picture of another description, one the description does not hold, an outsider's look, and an address that is no picture's are refused, in words the model reads and keeps",
    () =>
      Effect.gen(function* () {
        const {
          owner,
          outsider,
          planId: taskId,
          otherId,
          attachmentId,
          address,
        } = yield* openPicturedTasks;
        const missing = descriptionAttachmentAddress(
          { taskId: taskId, attachmentId: randomUUID() },
          "acme",
        );
        const pageOfTask = address.slice(0, address.indexOf("/files/"));

        const answers = [
          yield* look(lookCall(owner, otherId), address),
          yield* look(lookCall(owner, taskId), missing),
          yield* look(lookCall(outsider, taskId), address),
          yield* look(lookCall(owner, taskId), pageOfTask),
          yield* runLookAtPicture(lookCall(owner, taskId), unparsedWire({ attachmentId })),
        ];

        assert.deepEqual(answers, [
          pictureNotLooked(PICTURE_LOOK_REFUSAL.ELSEWHERE),
          pictureNotLooked(PICTURE_LOOK_REFUSAL.NO_PICTURE),
          pictureNotLooked(PICTURE_LOOK_REFUSAL.NO_PICTURE),
          pictureNotLooked(PICTURE_LOOK_REFUSAL.ELSEWHERE),
          pictureNotLooked(PICTURE_LOOK_REFUSAL.UNREADABLE),
        ]);
      }),
  );

  it.effect(
    "a turn looks at the description's pictures as often as it asks, and every look answers the picture",
    () =>
      Effect.gen(function* () {
        const { owner, planId: taskId, address } = yield* openPicturedTasks;

        const statuses: string[] = [];
        for (let at = 0; at < 12; at += 1) {
          statuses.push((yield* look(lookCall(owner, taskId), address)).status);
        }

        assert.deepEqual(
          statuses,
          Array.from({ length: 12 }, () => PICTURE_LOOK_STATUS.LOOKED),
        );
      }),
  );

  it.effect(
    "a look at a video the description holds is refused, pointing at its words, and the model is handed none of its bytes",
    () =>
      Effect.gen(function* () {
        const { owner, planId: taskId } = yield* openPicturedTasks;
        const video: Picture = {
          contentType: PICTURE_MEDIA_TYPE.WEBM,
          bytes: webmBytes(1280, 800),
        };
        const kept = yield* keepDescriptionAttachment(owner, taskId, video);
        if (kept.status !== DESCRIPTION_ATTACHMENT_KEEP.KEPT)
          return assert.fail("the video was not kept");
        const address = descriptionAttachmentAddress({ taskId, attachmentId: kept.id }, "acme");

        const answered = yield* look(lookCall(owner, taskId), address);

        assert.deepEqual(answered, pictureNotLooked(PICTURE_LOOK_REFUSAL.VIDEO));
      }),
  );

  it.effect(
    "a look answering a video's bytes would still reach the model as the refusal, never as its base64",
    () =>
      Effect.sync(() => {
        const base64 = Base64.encode(webmBytes(1280, 800));
        const forged = unparsedWire({
          status: PICTURE_LOOK_STATUS.LOOKED,
          mediaType: PICTURE_MEDIA_TYPE.WEBM,
          image: base64,
        });

        const shown = lookNamedOnly(forged);

        assert.deepEqual(shown, pictureNotLooked(PICTURE_LOOK_REFUSAL.VIDEO));
        assert.ok(!JSON.stringify(shown).includes(base64));
      }),
  );
});
