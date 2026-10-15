import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { PICTURE_TYPE, type Picture } from "@luke/features/picture-wire";
import { planAttachmentAddress } from "@luke/features/plan-attachment-link";
import { PLAN_ATTACHMENT_BOUNDS } from "@luke/features/plan-attachment-wire";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { plan } from "../../schemas/plan.js";
import { getTestDB, joinWorkspace, openWorkspace } from "../../testing/index.js";
import {
  keepPlanAttachment,
  PLAN_ATTACHMENT_KEEP,
  purgeUnsavedAttachments,
  readPlanAttachment,
} from "../plan-attachments.js";
import { createPlan, savePlanText } from "../plan-store.js";

/**
 * A plan's pictures over a real dialect: kept by a member, read by every
 * member of the plan's workspace and by nobody else, held to the plan's
 * bound, refused on an archived plan, and swept a day after upload only
 * where no save ever named them.
 *
 * Synthetic accounts and pictures throughout.
 */

/** A picture's bytes: a PNG's signature and a few more, which is all the store reads of them. */
const PICTURE: Picture = {
  contentType: PICTURE_TYPE.PNG,
  bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]),
};

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

/** A plan in a workspace the owner made and the teammate joined, and an account in neither. */
const openSharedPlan = Effect.gen(function* () {
  const owner = yield* openAccount;
  const teammate = yield* openAccount;
  const outsider = yield* openAccount;
  const workspace = yield* openWorkspace(owner);
  yield* joinWorkspace(workspace, teammate);
  const { id: planId } = yield* createPlan(owner, { organizationId: workspace, name: "Invites" });
  return { owner, teammate, outsider, planId };
});

/** The id a keep answered, failing the test where it kept nothing. */
function keptId(kept: { readonly status: string; readonly id?: string }): string {
  assert.equal(kept.status, PLAN_ATTACHMENT_KEEP.KEPT);
  assert.ok(kept.id);
  return kept.id;
}

it.layer(getTestDB())("a plan's pictures", (it) => {
  it.effect(
    "a picture a teammate pasted reads for every member of the plan's workspace, and as nothing for anyone else",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, outsider, planId } = yield* openSharedPlan;

        const id = keptId(yield* keepPlanAttachment(teammate, planId, PICTURE));

        const read = yield* readPlanAttachment(owner, planId, id);
        assert.ok(Option.isSome(read));
        assert.equal(read.value.contentType, PICTURE_TYPE.PNG);
        assert.deepEqual([...read.value.bytes], [...PICTURE.bytes]);
        assert.ok(Option.isNone(yield* readPlanAttachment(outsider, planId, id)));
        assert.equal(
          (yield* keepPlanAttachment(outsider, planId, PICTURE)).status,
          PLAN_ATTACHMENT_KEEP.NO_PLAN,
        );
      }),
  );

  it.effect("a picture is read only under the plan it was kept on", () =>
    Effect.gen(function* () {
      const first = yield* openSharedPlan;
      const second = yield* openSharedPlan;
      const id = keptId(yield* keepPlanAttachment(first.owner, first.planId, PICTURE));

      assert.ok(Option.isNone(yield* readPlanAttachment(second.owner, second.planId, id)));
    }),
  );

  it.effect("a plan keeps no more pictures than its bound, and an archived plan keeps none", () =>
    Effect.gen(function* () {
      const { owner, planId } = yield* openSharedPlan;
      for (let kept = 0; kept < PLAN_ATTACHMENT_BOUNDS.MAX_PER_PLAN; kept += 1) {
        keptId(yield* keepPlanAttachment(owner, planId, PICTURE));
      }

      assert.equal(
        (yield* keepPlanAttachment(owner, planId, PICTURE)).status,
        PLAN_ATTACHMENT_KEEP.TOO_MANY,
      );

      const other = yield* openSharedPlan;
      const db = yield* Database;
      yield* db
        .update(plan)
        .set({ archivedAt: new Date(0) })
        .where(eq(plan.id, other.planId));
      assert.equal(
        (yield* keepPlanAttachment(other.owner, other.planId, PICTURE)).status,
        PLAN_ATTACHMENT_KEEP.NO_PLAN,
      );
    }),
  );

  it.effect(
    "the sweep deletes the pictures uploaded before its cutoff that no save named, and keeps every picture a save did",
    () =>
      Effect.gen(function* () {
        const { owner, planId } = yield* openSharedPlan;
        const named = keptId(yield* keepPlanAttachment(owner, planId, PICTURE));
        const undone = keptId(yield* keepPlanAttachment(owner, planId, PICTURE));
        const address = planAttachmentAddress({ planId, attachmentId: named }, "acme");
        yield* savePlanText(owner, planId, `## Approach\n\n![The mock](${address})\n`);
        // A later save that no longer names it leaves it saved, since a restore can bring it back.
        yield* savePlanText(owner, planId, "## Approach\n\nNo picture now.\n");

        // Every picture here was uploaded at the test clock's start; the cutoff is the sweep's, a day before its own now.
        assert.equal(
          yield* purgeUnsavedAttachments(new Date(0)),
          0,
          "none was uploaded before the cutoff",
        );
        // Note that the sweep deletes a batch at a time, and other tests' uploads share the database.
        let purged = yield* purgeUnsavedAttachments(new Date(1));
        while (purged > 0) purged = yield* purgeUnsavedAttachments(new Date(1));

        assert.ok(Option.isSome(yield* readPlanAttachment(owner, planId, named)));
        assert.ok(Option.isNone(yield* readPlanAttachment(owner, planId, undone)));
      }),
  );
});
