import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { keepPlanAttachment, PLAN_ATTACHMENT_KEEP } from "@luke/database/models/plan-attachments";
import { createTask } from "@luke/database/models/task-store";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, joinWorkspace, openWorkspace } from "@luke/database/testing";
import { PICTURE_TYPE, type Picture } from "@luke/features/picture-wire";
import { planAttachmentAddress } from "@luke/features/plan-attachment-link";
import { unparsedWire } from "@luke/wire";
import { Effect } from "effect";
import { Base64 } from "effect/encoding";
import {
  PICTURE_LOOK_REFUSAL,
  PICTURE_LOOK_STATUS,
  pictureLookModelOutput,
  pictureNotLooked,
  runLookAtPicture,
  storedPictureLookOutput,
} from "./picture-look.js";
import type { PlanDocumentBinding } from "./plan-notes.js";

/**
 * `look_at_picture`, the planning model's and a coding agent's look at one
 * of the plan's pictures, through its public functions against a real
 * dialect: a member's look hands the model the picture as an image while
 * the conversation keeps only that it looked; a picture of another plan, one
 * the plan does not hold, and one read by an account outside the plan's
 * workspace are refused alike; and a turn looks as often as it asks. The
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
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

/** Two plans in a workspace the owner made and the teammate joined, a picture the teammate pasted into the first, and an account in neither. */
const openPicturedTasks = Effect.gen(function* () {
  const owner = yield* openAccount;
  const teammate = yield* openAccount;
  const outsider = yield* openAccount;
  const workspace = yield* openWorkspace(owner);
  yield* joinWorkspace(workspace, teammate);
  const plan = yield* createTask(owner, { organizationId: workspace, name: "Invites" });
  const other = yield* createTask(owner, { organizationId: workspace, name: "Billing" });
  const kept = yield* keepPlanAttachment(teammate, plan.id, PICTURE);
  if (kept.status !== PLAN_ATTACHMENT_KEEP.KEPT) return assert.fail("the picture was not kept");
  const address = planAttachmentAddress({ taskId: plan.id, attachmentId: kept.id }, "acme");
  return { owner, outsider, planId: plan.id, otherId: other.id, attachmentId: kept.id, address };
});

/** A look as a turn makes one: bound to the plan as the account. */
function lookCall(userId: string, planId: string): PlanDocumentBinding {
  return { userId, taskId: planId };
}

const look = (call: PlanDocumentBinding, address: string) =>
  runLookAtPicture(call, unparsedWire({ address }));

it.layer(getTestDB())("look_at_picture", (it) => {
  it.effect(
    "a member's look hands the model the picture as an image, and the conversation keeps only that it looked",
    () =>
      Effect.gen(function* () {
        const { owner, planId, address } = yield* openPicturedTasks;
        const base64 = Base64.encode(PICTURE.bytes);

        const answered = yield* look(lookCall(owner, planId), address);
        const shown = pictureLookModelOutput(unparsedWire({ ...answered }));
        const kept = storedPictureLookOutput(unparsedWire({ ...answered }));

        assert.deepEqual(shown, {
          type: "content",
          value: [
            { type: "text", text: "The picture you asked to see:" },
            { type: "file", data: { type: "data", data: base64 }, mediaType: PICTURE_TYPE.PNG },
          ],
        });
        assert.deepEqual(kept, { status: PICTURE_LOOK_STATUS.LOOKED });
      }),
  );

  it.effect(
    "a picture of another plan, one the plan does not hold, an outsider's look, and an address that is no picture's are refused, in words the model reads and keeps",
    () =>
      Effect.gen(function* () {
        const { owner, outsider, planId, otherId, attachmentId, address } =
          yield* openPicturedTasks;
        const missing = planAttachmentAddress(
          { taskId: planId, attachmentId: randomUUID() },
          "acme",
        );
        const pageOfTask = address.slice(0, address.indexOf("/files/"));

        const answers = [
          yield* look(lookCall(owner, otherId), address),
          yield* look(lookCall(owner, planId), missing),
          yield* look(lookCall(outsider, planId), address),
          yield* look(lookCall(owner, planId), pageOfTask),
          yield* runLookAtPicture(lookCall(owner, planId), unparsedWire({ attachmentId })),
        ];

        assert.deepEqual(answers, [
          pictureNotLooked(PICTURE_LOOK_REFUSAL.ELSEWHERE),
          pictureNotLooked(PICTURE_LOOK_REFUSAL.NO_PICTURE),
          pictureNotLooked(PICTURE_LOOK_REFUSAL.NO_PICTURE),
          pictureNotLooked(PICTURE_LOOK_REFUSAL.ELSEWHERE),
          pictureNotLooked(PICTURE_LOOK_REFUSAL.UNREADABLE),
        ]);
        // A refusal is the model's to read, so the conversation keeps it whole.
        const refused = unparsedWire({ ...answers[0] });
        assert.deepEqual(storedPictureLookOutput(refused), refused);
      }),
  );

  it.effect(
    "a turn looks at the plan's pictures as often as it asks, and every look answers the picture",
    () =>
      Effect.gen(function* () {
        const { owner, planId, address } = yield* openPicturedTasks;

        const statuses: string[] = [];
        for (let at = 0; at < 12; at += 1) {
          statuses.push((yield* look(lookCall(owner, planId), address)).status);
        }

        assert.deepEqual(
          statuses,
          Array.from({ length: 12 }, () => PICTURE_LOOK_STATUS.LOOKED),
        );
      }),
  );
});
